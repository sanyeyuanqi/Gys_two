from __future__ import annotations

import hashlib
import json
import os
import re
import secrets
import sqlite3
import threading
import time
import uuid
from pathlib import Path
from typing import Any

import httpx
from fastapi import FastAPI, Request
from fastapi.responses import JSONResponse


UPSTREAM_ORIGIN = "https://gys.oljuxj.xyz"
COOKIE_NAME = "key_system_session"
DAY_MS = 86_400_000
DEFAULT_ACCOUNT_ALIASES = (
    ("sanyeyuanqi", "hhxxzz4", "sanyeyuanqi"),
    ("okoko", "okoko", "okoko"),
)
PUBLIC_AUTH = {
    "/api/auth/login-captcha",
    "/api/auth/captcha/slide",
    "/api/auth/captcha/slide/check",
}
READ_PATHS = (
    re.compile(r"^/api/(dashboard|channels|sub-accounts|apikeys|model-gaps|disable-keywords)$"),
    re.compile(r"^/api/channels/(summary|tags|tag-summary|category-models)$"),
    re.compile(r"^/api/channels/\d+/(usage|logs|key-usage|sync-detail|test)$"),
    re.compile(r"^/api/(stats/daily|settings/upload-switch)$"),
)
WRITE_PATHS = {
    "POST": (
        re.compile(r"^/api/channels(?:/batch|/sync)?$"),
        re.compile(r"^/api/channels/\d+/status$"),
        re.compile(r"^/api/(apikeys|disable-keywords)$"),
    ),
    "PUT": (re.compile(r"^/api/channels/\d+(?:/status)?$"),),
    "PATCH": (),
    "DELETE": (re.compile(r"^/api/(channels|apikeys)/\d+$"),),
}


class BackendError(Exception):
    def __init__(self, status: int, message: str, request_id: str | None = None):
        super().__init__(message)
        self.status = status
        self.message = message
        self.request_id = request_id


class SessionStore:
    def __init__(self) -> None:
        default_dir = Path(__file__).resolve().parent.parent / ".gys-backend"
        data_dir = Path(os.environ.get("GYS_BACKEND_DATA_DIR", default_dir)).resolve()
        data_dir.mkdir(parents=True, exist_ok=True)
        self.connection = sqlite3.connect(
            data_dir / "sessions.sqlite3",
            check_same_thread=False,
            timeout=5,
        )
        self.connection.row_factory = sqlite3.Row
        self.lock = threading.RLock()
        with self.lock:
            self.connection.executescript(
                """
                PRAGMA journal_mode = WAL;
                CREATE TABLE IF NOT EXISTS upstream_sessions (
                    token_hash TEXT PRIMARY KEY,
                    upstream_user_id INTEGER,
                    username TEXT,
                    display_name TEXT,
                    role TEXT,
                    cookies TEXT NOT NULL,
                    authenticated INTEGER NOT NULL DEFAULT 0,
                    created_at INTEGER NOT NULL,
                    expires_at INTEGER NOT NULL
                );
                CREATE INDEX IF NOT EXISTS idx_upstream_sessions_expires_at
                    ON upstream_sessions(expires_at);
                CREATE TABLE IF NOT EXISTS rate_limits (
                    name TEXT PRIMARY KEY,
                    count INTEGER NOT NULL,
                    expires_at INTEGER NOT NULL
                );
                CREATE INDEX IF NOT EXISTS idx_rate_limits_expires_at
                    ON rate_limits(expires_at);
                CREATE TABLE IF NOT EXISTS account_aliases (
                    public_username TEXT COLLATE NOCASE PRIMARY KEY,
                    upstream_username TEXT COLLATE NOCASE NOT NULL UNIQUE,
                    display_name TEXT NOT NULL,
                    account_kind TEXT NOT NULL DEFAULT 'primary',
                    upstream_user_id INTEGER,
                    active INTEGER NOT NULL DEFAULT 1,
                    created_at INTEGER NOT NULL,
                    updated_at INTEGER NOT NULL
                );
                """
            )
            alias_columns = {
                str(row["name"])
                for row in self.connection.execute("PRAGMA table_info(account_aliases)").fetchall()
            }
            if "account_kind" not in alias_columns:
                self.connection.execute(
                    "ALTER TABLE account_aliases ADD COLUMN account_kind TEXT NOT NULL DEFAULT 'primary'"
                )
            if "upstream_user_id" not in alias_columns:
                self.connection.execute(
                    "ALTER TABLE account_aliases ADD COLUMN upstream_user_id INTEGER"
                )
            self.connection.execute(
                "CREATE INDEX IF NOT EXISTS idx_account_aliases_upstream_user_id "
                "ON account_aliases(upstream_user_id)"
            )
            now = int(time.time() * 1000)
            self.connection.executemany(
                """
                INSERT INTO account_aliases
                    (public_username, upstream_username, display_name, account_kind,
                     active, created_at, updated_at)
                VALUES (?, ?, ?, 'primary', 1, ?, ?)
                ON CONFLICT(public_username) DO UPDATE SET
                    upstream_username = excluded.upstream_username,
                    display_name = excluded.display_name,
                    account_kind = 'primary',
                    active = 1,
                    updated_at = excluded.updated_at
                """,
                [(*mapping, now, now) for mapping in DEFAULT_ACCOUNT_ALIASES],
            )
            for public_username, upstream_username, display_name in DEFAULT_ACCOUNT_ALIASES:
                self.connection.execute(
                    """
                    UPDATE upstream_sessions
                    SET username = ?, display_name = ?
                    WHERE role IN ('admin', 'supplier') AND username = ?
                    """,
                    (public_username, display_name, upstream_username),
                )
            self.connection.commit()

    @staticmethod
    def token_hash(token: str) -> str:
        return hashlib.sha256(token.encode("utf-8")).hexdigest()

    def create_session(
        self,
        profile: dict[str, Any] | None = None,
        cookies: str = "[]",
    ) -> tuple[str, sqlite3.Row]:
        token = secrets.token_urlsafe(32)
        now = int(time.time() * 1000)
        parsed = validate_profile(profile) if profile else None
        authenticated = 1 if parsed else 0
        lifetime = 7 * DAY_MS if authenticated else 10 * 60_000
        values = (
            self.token_hash(token),
            parsed["id"] if parsed else None,
            parsed["username"] if parsed else None,
            parsed["display_name"] if parsed else None,
            parsed["role"] if parsed else None,
            cookies,
            authenticated,
            now,
            now + lifetime,
        )
        with self.lock:
            self.connection.execute("DELETE FROM upstream_sessions WHERE expires_at <= ?", (now,))
            self.connection.execute(
                """
                INSERT INTO upstream_sessions
                    (token_hash, upstream_user_id, username, display_name, role,
                     cookies, authenticated, created_at, expires_at)
                VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
                """,
                values,
            )
            self.connection.commit()
            row = self.connection.execute(
                "SELECT * FROM upstream_sessions WHERE token_hash = ?", (values[0],)
            ).fetchone()
        if row is None:
            raise BackendError(503, "会话服务暂时不可用")
        return token, row

    def get_session(self, token: str) -> sqlite3.Row | None:
        if not re.fullmatch(r"[A-Za-z0-9_-]{43}", token or ""):
            return None
        now = int(time.time() * 1000)
        with self.lock:
            row = self.connection.execute(
                "SELECT * FROM upstream_sessions WHERE token_hash = ? AND expires_at > ?",
                (self.token_hash(token), now),
            ).fetchone()
        if row is None or int(row["created_at"]) + 30 * DAY_MS <= now:
            return None
        return row

    def current(self, session: sqlite3.Row) -> sqlite3.Row:
        with self.lock:
            row = self.connection.execute(
                "SELECT * FROM upstream_sessions WHERE token_hash = ?",
                (session["token_hash"],),
            ).fetchone()
        return row or session

    def save_cookies(self, session: sqlite3.Row, cookies: str) -> None:
        with self.lock:
            self.connection.execute(
                "UPDATE upstream_sessions SET cookies = ? WHERE token_hash = ?",
                (cookies, session["token_hash"]),
            )
            self.connection.commit()

    def save_profile(self, session: sqlite3.Row, profile: dict[str, Any]) -> dict[str, Any]:
        parsed = self.publicize_profile(profile)
        with self.lock:
            self.connection.execute(
                """
                UPDATE upstream_sessions
                SET upstream_user_id = ?, username = ?, display_name = ?,
                    role = ?, authenticated = 1
                WHERE token_hash = ?
                """,
                (
                    parsed["id"],
                    parsed["username"],
                    parsed["display_name"],
                    parsed["role"],
                    session["token_hash"],
                ),
            )
            self.connection.commit()
        return parsed

    def resolve_login_username(self, username: str) -> str:
        with self.lock:
            alias = self.connection.execute(
                """
                SELECT upstream_username
                FROM account_aliases
                WHERE public_username = ? AND active = 1
                """,
                (username,),
            ).fetchone()
            if alias is not None:
                return str(alias["upstream_username"])
            reserved = self.connection.execute(
                """
                SELECT 1
                FROM account_aliases
                WHERE upstream_username = ? AND active = 1
                """,
                (username,),
            ).fetchone()
        if reserved is not None:
            raise BackendError(401, "请使用映射后的用户名登录")
        return username

    def publicize_profile(self, profile: dict[str, Any]) -> dict[str, Any]:
        parsed = validate_profile(profile)
        with self.lock:
            alias = self.connection.execute(
                """
                SELECT public_username, display_name
                FROM account_aliases
                WHERE upstream_username = ? AND active = 1
                """,
                (parsed["username"],),
            ).fetchone()
        if alias is not None:
            parsed["username"] = str(alias["public_username"])
            parsed["display_name"] = str(alias["display_name"] or alias["public_username"])
        return parsed

    def reserve_sub_account_alias(
        self,
        public_username: str,
        upstream_username: str,
        display_name: str,
    ) -> None:
        now = int(time.time() * 1000)
        with self.lock:
            conflict = self.connection.execute(
                """
                SELECT 1 FROM account_aliases
                WHERE active = 1 AND (public_username = ? OR upstream_username = ?)
                """,
                (public_username, upstream_username),
            ).fetchone()
            if conflict is not None:
                raise BackendError(409, "本站用户名已存在")
            self.connection.execute(
                "DELETE FROM account_aliases WHERE active = 0 AND public_username = ?",
                (public_username,),
            )
            self.connection.execute(
                """
                INSERT INTO account_aliases
                    (public_username, upstream_username, display_name, account_kind,
                     upstream_user_id, active, created_at, updated_at)
                VALUES (?, ?, ?, 'sub', NULL, 1, ?, ?)
                """,
                (public_username, upstream_username, display_name, now, now),
            )
            self.connection.commit()

    def release_sub_account_alias(self, upstream_username: str) -> None:
        with self.lock:
            self.connection.execute(
                "DELETE FROM account_aliases WHERE account_kind = 'sub' AND upstream_username = ?",
                (upstream_username,),
            )
            self.connection.commit()

    def attach_sub_account_alias(self, upstream_username: str, upstream_user_id: int | None) -> None:
        if upstream_user_id is None or upstream_user_id <= 0:
            return
        with self.lock:
            self.connection.execute(
                """
                UPDATE account_aliases
                SET upstream_user_id = ?, updated_at = ?
                WHERE account_kind = 'sub' AND upstream_username = ?
                """,
                (upstream_user_id, int(time.time() * 1000), upstream_username),
            )
            self.connection.commit()

    def ensure_sub_account_alias(self, item: dict[str, Any]) -> dict[str, Any]:
        try:
            upstream_user_id = int(item.get("id"))
        except (TypeError, ValueError):
            return item
        upstream_username = item.get("username")
        upstream_username = upstream_username.strip() if isinstance(upstream_username, str) else ""
        if upstream_user_id <= 0 or not upstream_username:
            return item
        display_name = item.get("display_name")
        display_name = display_name.strip() if isinstance(display_name, str) else upstream_username
        now = int(time.time() * 1000)
        with self.lock:
            alias = self.connection.execute(
                """
                SELECT public_username, display_name
                FROM account_aliases
                WHERE upstream_username = ? AND active = 1
                """,
                (upstream_username,),
            ).fetchone()
            if alias is None:
                base = f"sub_{upstream_user_id}"
                public_username = base
                suffix = 2
                while self.connection.execute(
                    "SELECT 1 FROM account_aliases WHERE public_username = ? AND active = 1",
                    (public_username,),
                ).fetchone() is not None:
                    public_username = f"{base}_{suffix}"
                    suffix += 1
                self.connection.execute(
                    """
                    INSERT INTO account_aliases
                        (public_username, upstream_username, display_name, account_kind,
                         upstream_user_id, active, created_at, updated_at)
                    VALUES (?, ?, ?, 'sub', ?, 1, ?, ?)
                    """,
                    (public_username, upstream_username, display_name, upstream_user_id, now, now),
                )
                alias = {"public_username": public_username, "display_name": display_name}
            else:
                self.connection.execute(
                    """
                    UPDATE account_aliases
                    SET upstream_user_id = COALESCE(upstream_user_id, ?), updated_at = ?
                    WHERE upstream_username = ?
                    """,
                    (upstream_user_id, now, upstream_username),
                )
            self.connection.execute(
                """
                UPDATE upstream_sessions
                SET username = ?, display_name = ?
                WHERE role = 'sub' AND username = ?
                """,
                (alias["public_username"], alias["display_name"], upstream_username),
            )
            self.connection.commit()
        return {
            **item,
            "original_username": upstream_username,
            "username": str(alias["public_username"]),
            "display_name": str(alias["display_name"] or alias["public_username"]),
        }

    def publicize_sub_accounts(self, data: Any) -> Any:
        if isinstance(data, list):
            return [self.ensure_sub_account_alias(item) if isinstance(item, dict) else item for item in data]
        if not isinstance(data, dict):
            return data
        items = data.get("items")
        if isinstance(items, list):
            return {
                **data,
                "items": [
                    self.ensure_sub_account_alias(item) if isinstance(item, dict) else item
                    for item in items
                ],
            }
        return data

    def rename_sub_account_alias(
        self,
        upstream_user_id: int,
        public_username: str,
        display_name: str,
    ) -> None:
        now = int(time.time() * 1000)
        with self.lock:
            current = self.connection.execute(
                """
                SELECT public_username, upstream_username
                FROM account_aliases
                WHERE account_kind = 'sub' AND upstream_user_id = ? AND active = 1
                """,
                (upstream_user_id,),
            ).fetchone()
            if current is None:
                raise BackendError(404, "子账号映射不存在，请刷新后重试")
            conflict = self.connection.execute(
                """
                SELECT 1 FROM account_aliases
                WHERE public_username = ? AND public_username <> ? AND active = 1
                """,
                (public_username, current["public_username"]),
            ).fetchone()
            if conflict is not None:
                raise BackendError(409, "本站用户名已存在")
            self.connection.execute(
                """
                UPDATE account_aliases
                SET public_username = ?, display_name = ?, updated_at = ?
                WHERE account_kind = 'sub' AND upstream_user_id = ?
                """,
                (public_username, display_name, now, upstream_user_id),
            )
            self.connection.execute(
                """
                UPDATE upstream_sessions
                SET username = ?, display_name = ?
                WHERE role = 'sub' AND username IN (?, ?)
                """,
                (public_username, display_name, current["public_username"], current["upstream_username"]),
            )
            self.connection.commit()

    def assert_sub_account_alias_available(self, upstream_user_id: int, public_username: str) -> None:
        with self.lock:
            current = self.connection.execute(
                """
                SELECT public_username
                FROM account_aliases
                WHERE account_kind = 'sub' AND upstream_user_id = ? AND active = 1
                """,
                (upstream_user_id,),
            ).fetchone()
            if current is None:
                raise BackendError(404, "子账号映射不存在，请刷新后重试")
            conflict = self.connection.execute(
                """
                SELECT 1 FROM account_aliases
                WHERE public_username = ? AND public_username <> ? AND active = 1
                """,
                (public_username, current["public_username"]),
            ).fetchone()
        if conflict is not None:
            raise BackendError(409, "本站用户名已存在")

    def delete_sub_account_alias(self, upstream_user_id: int) -> None:
        with self.lock:
            self.connection.execute(
                "DELETE FROM account_aliases WHERE account_kind = 'sub' AND upstream_user_id = ?",
                (upstream_user_id,),
            )
            self.connection.commit()

    def touch(self, session: sqlite3.Row) -> int:
        now = int(time.time() * 1000)
        expires_at = min(int(session["created_at"]) + 30 * DAY_MS, now + 7 * DAY_MS)
        with self.lock:
            self.connection.execute(
                "UPDATE upstream_sessions SET expires_at = ? WHERE token_hash = ?",
                (expires_at, session["token_hash"]),
            )
            self.connection.commit()
        return max(0, (expires_at - now) // 1000)

    def delete(self, session: sqlite3.Row | None) -> None:
        if session is None:
            return
        with self.lock:
            self.connection.execute(
                "DELETE FROM upstream_sessions WHERE token_hash = ?",
                (session["token_hash"],),
            )
            self.connection.commit()

    def within_limit(self, name: str, maximum: int, window_ms: int) -> bool:
        key = self.token_hash(name)
        now = int(time.time() * 1000)
        with self.lock:
            row = self.connection.execute(
                "SELECT count, expires_at FROM rate_limits WHERE name = ?", (key,)
            ).fetchone()
            if row is None or int(row["expires_at"]) <= now:
                self.connection.execute(
                    """
                    INSERT INTO rate_limits (name, count, expires_at) VALUES (?, 1, ?)
                    ON CONFLICT(name) DO UPDATE SET count = 1, expires_at = excluded.expires_at
                    """,
                    (key, now + window_ms),
                )
                allowed = True
            else:
                next_count = int(row["count"]) + 1
                self.connection.execute(
                    "UPDATE rate_limits SET count = ? WHERE name = ?", (next_count, key)
                )
                allowed = next_count <= maximum
            self.connection.commit()
        return allowed


store = SessionStore()
app = FastAPI(title="GYS Backend", version="1.0.0", docs_url="/backend/docs")


def deserialize_cookies(value: str) -> httpx.Cookies:
    cookies = httpx.Cookies()
    try:
        items = json.loads(value)
        if not isinstance(items, list):
            return cookies
        for item in items:
            if not isinstance(item, dict) or not item.get("name"):
                continue
            options: dict[str, str] = {"path": str(item.get("path") or "/")}
            if item.get("domain"):
                options["domain"] = str(item["domain"])
            cookies.set(str(item["name"]), str(item.get("value") or ""), **options)
    except (TypeError, ValueError, json.JSONDecodeError):
        pass
    return cookies


def serialize_cookies(cookies: httpx.Cookies) -> str:
    return json.dumps(
        [
            {
                "name": cookie.name,
                "value": cookie.value,
                "domain": cookie.domain,
                "path": cookie.path,
            }
            for cookie in cookies.jar
        ],
        ensure_ascii=False,
        separators=(",", ":"),
    )


async def read_body(request: Request) -> dict[str, Any]:
    body = await request.body()
    if not body:
        return {}
    if len(body) > 4 * 1024 * 1024:
        raise BackendError(413, "提交内容过大")
    content_type = request.headers.get("content-type", "").split(";", 1)[0].strip().lower()
    if content_type != "application/json":
        raise BackendError(415, "请使用 JSON 提交数据")
    try:
        value = json.loads(body)
    except (UnicodeDecodeError, json.JSONDecodeError) as error:
        raise BackendError(400, "提交内容必须是 JSON 对象") from error
    if not isinstance(value, dict):
        raise BackendError(400, "提交内容必须是 JSON 对象")
    return value


def validate_profile(profile: dict[str, Any] | None) -> dict[str, Any]:
    if not isinstance(profile, dict):
        raise BackendError(502, "原 GYS 数据服务返回了无效账号信息")
    try:
        user_id = int(profile.get("user_id", profile.get("id")))
    except (TypeError, ValueError) as error:
        raise BackendError(502, "原 GYS 数据服务返回了无效账号信息") from error
    username = profile.get("username")
    username = username.strip() if isinstance(username, str) else ""
    role = profile.get("role") if isinstance(profile.get("role"), str) else ""
    display_name = profile.get("display_name")
    display_name = display_name.strip() if isinstance(display_name, str) else username
    if user_id <= 0 or not username or role not in {"admin", "supplier", "sub"}:
        raise BackendError(502, "原 GYS 数据服务返回了无效账号信息")
    return {
        "id": user_id,
        "user_id": user_id,
        "username": username,
        "display_name": display_name or username,
        "role": role,
    }


def public_profile(session: sqlite3.Row) -> dict[str, Any]:
    if not session["authenticated"] or not session["upstream_user_id"]:
        raise BackendError(401, "请登录原 GYS 账号")
    return {
        "id": session["upstream_user_id"],
        "user_id": session["upstream_user_id"],
        "username": session["username"],
        "display_name": session["display_name"] or session["username"],
        "role": session["role"],
    }


def unwrap(response: httpx.Response, payload: Any) -> Any:
    if not isinstance(payload, dict):
        if response.is_success:
            return payload
        raise BackendError(response.status_code, "原 GYS 数据服务请求失败")
    raw_code = payload.get("code")
    try:
        code = int(raw_code) if raw_code is not None else 0
    except (TypeError, ValueError):
        code = -1
    failed = not response.is_success or payload.get("success") is False or (
        raw_code is not None and code != 0
    )
    if failed:
        mapped = {40001: 400, 40101: 401, 40301: 403, 40401: 404, 50001: 500}
        status = response.status_code if not response.is_success else mapped.get(code, 400)
        message = payload.get("message")
        raise BackendError(
            status,
            message if isinstance(message, str) and message else "原 GYS 数据服务请求失败",
            payload.get("request_id") if isinstance(payload.get("request_id"), str) else None,
        )
    return payload.get("data", payload)


def is_unauthorized(response: httpx.Response, payload: Any) -> bool:
    if response.status_code == 401:
        return True
    if not isinstance(payload, dict):
        return False
    try:
        return int(payload.get("code", 0)) == 40101
    except (TypeError, ValueError):
        return False


async def upstream_raw(
    session: sqlite3.Row,
    path: str,
    *,
    method: str = "GET",
    body: dict[str, Any] | None = None,
) -> tuple[httpx.Response, Any]:
    target = httpx.URL(UPSTREAM_ORIGIN).join(path)
    upstream = httpx.URL(UPSTREAM_ORIGIN)
    if (
        target.scheme != upstream.scheme
        or target.host != upstream.host
        or target.port != upstream.port
        or not target.path.startswith("/api/")
    ):
        raise BackendError(400, "无效的数据接口")
    current = store.current(session)
    cookies = deserialize_cookies(current["cookies"])
    try:
        async with httpx.AsyncClient(
            cookies=cookies,
            headers={
                "accept": "application/json",
                "origin": UPSTREAM_ORIGIN,
                "referer": f"{UPSTREAM_ORIGIN}/",
            },
            follow_redirects=False,
            timeout=60,
        ) as client:
            response = await client.request(
                method,
                target,
                json=body if body is not None else None,
            )
            store.save_cookies(session, serialize_cookies(client.cookies))
    except httpx.RequestError as error:
        raise BackendError(502, "原 GYS 数据服务暂时不可用，请稍后重试") from error
    try:
        payload = response.json()
    except ValueError as error:
        raise BackendError(502, "原 GYS 数据服务返回了无效响应") from error
    return response, payload


async def upstream_json(
    session: sqlite3.Row,
    path: str,
    *,
    method: str = "GET",
    body: dict[str, Any] | None = None,
) -> Any:
    response, payload = await upstream_raw(session, path, method=method, body=body)
    return unwrap(response, payload)


async def authorized_json(
    session: sqlite3.Row,
    path: str,
    *,
    method: str = "GET",
    body: dict[str, Any] | None = None,
) -> Any:
    response, payload = await upstream_raw(session, path, method=method, body=body)
    if not is_unauthorized(response, payload):
        return unwrap(response, payload)
    try:
        await upstream_json(session, "/api/auth/refresh", method="POST", body={})
    except BackendError as error:
        if error.status in {401, 403}:
            raise BackendError(401, "登录状态已失效，请重新登录", error.request_id) from error
        raise
    response, payload = await upstream_raw(session, path, method=method, body=body)
    if is_unauthorized(response, payload):
        raise BackendError(401, "登录状态已失效，请重新登录")
    return unwrap(response, payload)


def sanitize_data(value: Any) -> Any:
    if isinstance(value, list):
        return [sanitize_data(item) for item in value]
    if not isinstance(value, dict):
        return value
    blocked = {"key_full", "access_token", "refresh_token", "password", "password_hash"}
    return {key: sanitize_data(item) for key, item in value.items() if key not in blocked}


def request_origin(request: Request) -> str:
    configured = os.environ.get("GYS_PUBLIC_ORIGIN", "").strip()
    if configured:
        return configured.rstrip("/")
    forwarded = request.headers.get("x-gys-public-origin", "").strip()
    if forwarded:
        return forwarded.rstrip("/")
    return str(request.base_url).rstrip("/")


def check_origin(request: Request) -> None:
    if request.headers.get("sec-fetch-site") == "cross-site":
        raise BackendError(403, "不允许跨站请求")
    if request.method in {"GET", "HEAD", "OPTIONS"}:
        return
    origin = request.headers.get("origin")
    if origin and origin.rstrip("/") != request_origin(request):
        raise BackendError(403, "请求来源校验失败")


def session_cookie(request: Request, token: str, age: int) -> str:
    forwarded_proto = request.headers.get("x-forwarded-proto", "")
    secure = request.url.scheme == "https" or forwarded_proto == "https"
    suffix = "; Secure" if secure else ""
    return f"{COOKIE_NAME}={token}; Path=/; HttpOnly; SameSite=Lax; Max-Age={age}{suffix}"


def success_response(
    request: Request,
    request_id: str,
    data: Any,
    cookie: tuple[str, int] | None = None,
) -> JSONResponse:
    response = JSONResponse(
        {"success": True, "data": data, "request_id": request_id},
        headers={"cache-control": "no-store", "x-content-type-options": "nosniff"},
    )
    if cookie:
        response.headers.append("set-cookie", session_cookie(request, cookie[0], cookie[1]))
    return response


def error_response(request: Request, request_id: str, error: Exception) -> JSONResponse:
    status = error.status if isinstance(error, BackendError) else 500
    message = error.message if isinstance(error, BackendError) else "服务暂时不可用，请稍后重试"
    response = JSONResponse(
        {
            "success": False,
            "code": status * 100 + 1,
            "message": message,
            "request_id": error.request_id if isinstance(error, BackendError) and error.request_id else request_id,
        },
        status_code=status,
        headers={"cache-control": "no-store", "x-content-type-options": "nosniff"},
    )
    if status == 401 and not request.url.path.startswith("/openapi/"):
        response.headers.append("set-cookie", session_cookie(request, "", 0))
    return response


def client_key(request: Request) -> str:
    forwarded = request.headers.get("x-forwarded-for", "").split(",", 1)[0].strip()
    return forwarded or (request.client.host if request.client else "unknown")


@app.get("/healthz")
async def health() -> dict[str, str]:
    return {"status": "ok", "backend": "fastapi"}


@app.api_route("/openapi/v1/{open_path:path}", methods=["GET", "POST"])
async def forward_open_api(open_path: str, request: Request) -> JSONResponse:
    request_id = str(uuid.uuid4())
    try:
        path = f"/openapi/v1/{open_path}"
        allowed = (
            (path == "/openapi/v1/whoami" and request.method == "GET")
            or (path == "/openapi/v1/meta" and request.method == "GET")
            or (path == "/openapi/v1/channels" and request.method in {"GET", "POST"})
        )
        if not allowed:
            raise BackendError(404, "接口不存在")
        authorization = request.headers.get("authorization", "")
        if not re.fullmatch(r"Bearer\s+\S+", authorization, re.IGNORECASE):
            raise BackendError(401, "API Key 缺失、无效或已停用")
        for field in ("user_id", "supplier_id", "uploader_id"):
            if field in request.query_params:
                raise BackendError(400, "不允许指定数据账号")
        body = await read_body(request) if request.method == "POST" else None
        if body and any(field in body for field in ("user_id", "supplier_id", "uploader_id", "role")):
            raise BackendError(400, "不允许指定数据账号")
        target = f"{UPSTREAM_ORIGIN}{path}"
        if request.url.query:
            target += f"?{request.url.query}"
        try:
            async with httpx.AsyncClient(timeout=60, follow_redirects=False) as client:
                response = await client.request(
                    request.method,
                    target,
                    headers={"accept": "application/json", "authorization": authorization},
                    json=body if body is not None else None,
                )
        except httpx.RequestError as error:
            raise BackendError(502, "原 GYS 数据服务暂时不可用，请稍后重试") from error
        try:
            payload = response.json()
        except ValueError as error:
            raise BackendError(502, "原 GYS 数据服务返回了无效响应") from error
        return success_response(request, request_id, sanitize_data(unwrap(response, payload)))
    except Exception as error:  # The envelope is part of the public API contract.
        return error_response(request, request_id, error)


@app.api_route("/api/{api_path:path}", methods=["GET", "POST", "PUT", "PATCH", "DELETE"])
async def handle_api(api_path: str, request: Request) -> JSONResponse:
    request_id = str(uuid.uuid4())
    cookie: tuple[str, int] | None = None
    try:
        check_origin(request)
        path = f"/api/{api_path}"
        token = request.cookies.get(COOKIE_NAME, "")
        session = store.get_session(token)
        remote_key = client_key(request)

        if path in PUBLIC_AUTH:
            method = "POST" if path.endswith("/check") else "GET"
            if request.method != method:
                raise BackendError(405, "不支持此操作")
            if not store.within_limit(f"public-auth:{remote_key}", 120, 60_000):
                raise BackendError(429, "请求过于频繁，请稍后重试")
            if session is None or session["authenticated"]:
                token, session = store.create_session()
                cookie = (token, 600)
            data = await upstream_json(
                session,
                path,
                method=method,
                body=await read_body(request) if method == "POST" else None,
            )
            return success_response(request, request_id, sanitize_data(data), cookie)

        if path == "/api/auth/login" and request.method == "POST":
            body = await read_body(request)
            username = body.get("username", "")
            username = username.strip() if isinstance(username, str) else ""
            password = body.get("password") if isinstance(body.get("password"), str) else ""
            if not username or not password or len(username) > 128 or len(password) > 4096:
                raise BackendError(401, "账号或密码不正确")
            if not store.within_limit(f"login:{remote_key}:{username.lower()}", 10, 5 * 60_000):
                raise BackendError(429, "登录尝试过多，请五分钟后重试")
            if session is None or session["authenticated"]:
                token, session = store.create_session()
            upstream_username = store.resolve_login_username(username)
            login_body: dict[str, Any] = {"username": upstream_username, "password": password}
            if isinstance(body.get("captcha_token"), str):
                login_body["captcha_token"] = body["captcha_token"]
            try:
                profile = await upstream_json(session, path, method="POST", body=login_body)
            except BackendError as error:
                if 400 <= error.status < 500:
                    raise BackendError(
                        error.status,
                        error.message or "账号、密码或验证码不正确",
                        error.request_id,
                    ) from error
                raise
            parsed = store.publicize_profile(profile)
            latest = store.current(session)
            old_session = session
            token, session = store.create_session(parsed, latest["cookies"])
            store.delete(old_session)
            return success_response(request, request_id, parsed, (token, 7 * 86_400))

        if path == "/api/auth/logout" and request.method == "POST":
            store.delete(session)
            return success_response(request, request_id, {"message": "已退出登录"}, ("", 0))

        if session is None or not session["authenticated"]:
            raise BackendError(401, "请登录原 GYS 账号")
        cookie = (token, store.touch(session))

        if path == "/api/auth/profile" and request.method == "GET":
            profile = await authorized_json(session, path)
            data = store.save_profile(session, profile) if isinstance(profile, dict) else public_profile(session)
            return success_response(request, request_id, data, cookie)

        if path == "/api/auth/refresh" and request.method == "POST":
            await upstream_json(session, path, method="POST", body={})
            profile = await upstream_json(session, "/api/auth/profile")
            data = store.save_profile(session, profile) if isinstance(profile, dict) else public_profile(session)
            return success_response(request, request_id, data, cookie)

        if path == "/api/auth/password" and request.method == "POST":
            body = await read_body(request)
            old_password = body.get("old_password")
            new_password = body.get("new_password")
            if (
                not isinstance(old_password, str)
                or not isinstance(new_password, str)
                or len(new_password) < 6
                or len(new_password) > 4096
            ):
                raise BackendError(400, "密码格式不正确")
            data = await authorized_json(session, path, method="POST", body=body)
            return success_response(request, request_id, sanitize_data(data), cookie)

        if path == "/api/sub-accounts" and request.method == "GET":
            if session["role"] not in {"supplier", "admin"}:
                raise BackendError(403, "当前账号无权管理子账号")
            data = await authorized_json(session, path)
            return success_response(
                request,
                request_id,
                sanitize_data(store.publicize_sub_accounts(data)),
                cookie,
            )

        if path == "/api/sub-accounts" and request.method == "POST":
            if session["role"] not in {"supplier", "admin"}:
                raise BackendError(403, "当前账号无权管理子账号")
            body = await read_body(request)
            username = body.get("username")
            display_name = body.get("display_name")
            password = body.get("password")
            username = username.strip() if isinstance(username, str) else ""
            display_name = display_name.strip() if isinstance(display_name, str) else ""
            password = password if isinstance(password, str) else ""
            if not re.fullmatch(r"[A-Za-z0-9_.-]{3,64}", username):
                raise BackendError(400, "本站用户名须为3至64位字母、数字、点、横线或下划线")
            if not display_name or len(display_name) > 128:
                raise BackendError(400, "请输入有效的显示名")
            if (
                len(password) < 8
                or len(password) > 4096
                or not re.search(r"[A-Za-z]", password)
                or not re.search(r"\d", password)
                or not re.search(r"[^A-Za-z0-9]", password)
            ):
                raise BackendError(400, "密码至少8位，须含字母、数字和特殊字符")
            upstream_username = f"gys{secrets.token_hex(10)}"
            store.reserve_sub_account_alias(username, upstream_username, display_name)
            try:
                data = await authorized_json(
                    session,
                    path,
                    method="POST",
                    body={
                        "username": upstream_username,
                        "display_name": display_name,
                        "password": password,
                    },
                )
            except Exception:
                store.release_sub_account_alias(upstream_username)
                raise
            created_id: int | None = None
            if isinstance(data, dict):
                try:
                    created_id = int(data.get("id", data.get("user_id")))
                except (TypeError, ValueError):
                    created_id = None
                data = {
                    **data,
                    "original_username": upstream_username,
                    "username": username,
                    "display_name": display_name,
                }
            store.attach_sub_account_alias(upstream_username, created_id)
            return success_response(request, request_id, sanitize_data(data), cookie)

        sub_account_match = re.fullmatch(r"/api/sub-accounts/(\d+)", path)
        if sub_account_match and request.method in {"PUT", "DELETE"}:
            if session["role"] not in {"supplier", "admin"}:
                raise BackendError(403, "当前账号无权管理子账号")
            target_id = int(sub_account_match.group(1))
            if target_id <= 0:
                raise BackendError(400, "子账号 ID 无效")
            if request.method == "DELETE":
                data = await authorized_json(session, path, method="DELETE")
                store.delete_sub_account_alias(target_id)
                return success_response(request, request_id, sanitize_data(data), cookie)

            body = await read_body(request)
            username = body.get("username")
            display_name = body.get("display_name")
            status = body.get("status")
            password = body.get("password")
            username = username.strip() if isinstance(username, str) else ""
            display_name = display_name.strip() if isinstance(display_name, str) else ""
            if not re.fullmatch(r"[A-Za-z0-9_.-]{3,64}", username):
                raise BackendError(400, "本站用户名须为3至64位字母、数字、点、横线或下划线")
            if not display_name or len(display_name) > 128:
                raise BackendError(400, "请输入有效的显示名")
            if isinstance(status, bool):
                status = int(status)
            if status not in {0, 1}:
                raise BackendError(400, "账号状态无效")
            update_body: dict[str, Any] = {"display_name": display_name, "status": status}
            if password is not None and password != "":
                if not isinstance(password, str) or (
                    len(password) < 8
                    or len(password) > 4096
                    or not re.search(r"[A-Za-z]", password)
                    or not re.search(r"\d", password)
                    or not re.search(r"[^A-Za-z0-9]", password)
                ):
                    raise BackendError(400, "密码至少8位，须含字母、数字和特殊字符")
                update_body["password"] = password
            store.assert_sub_account_alias_available(target_id, username)
            data = await authorized_json(session, path, method="PUT", body=update_body)
            store.rename_sub_account_alias(target_id, username, display_name)
            return success_response(request, request_id, sanitize_data(data), cookie)

        allowed_patterns = READ_PATHS if request.method == "GET" else WRITE_PATHS.get(request.method, ())
        if not any(pattern.fullmatch(path) for pattern in allowed_patterns):
            raise BackendError(404, "接口不存在")
        for field in ("user_id", "supplier_id", "uploader_id", "upstream_id"):
            if field in request.query_params:
                raise BackendError(400, "不允许指定数据账号")
        body = None if request.method in {"GET", "DELETE"} else await read_body(request)
        if body and any(
            field in body for field in ("user_id", "supplier_id", "uploader_id", "role", "username", "password")
        ):
            raise BackendError(400, "不允许修改账号归属")
        full_path = path + (f"?{request.url.query}" if request.url.query else "")
        data = await authorized_json(session, full_path, method=request.method, body=body)

        if path == "/api/dashboard" and isinstance(data, dict):
            current_profile = public_profile(store.current(session))
            data["display_name"] = current_profile["display_name"]

        if path == "/api/stats/daily" and isinstance(data, dict):
            days = data.get("days") if isinstance(data.get("days"), list) else []
            quotas = [float(day.get("total_quota", day.get("quota", 0)) or 0) for day in days]
            maximum = max([0, *quotas])
            data["average_quota"] = round(float(data.get("total_quota", 0) or 0) / len(days)) if days else 0
            data["days"] = [
                {
                    **day,
                    "share_percent": round(float(day.get("total_quota", day.get("quota", 0)) or 0) / maximum * 100)
                    if maximum
                    else 0,
                    "active_channel_count": sum(
                        1
                        for channel in (day.get("channels") if isinstance(day.get("channels"), list) else [])
                        if float(channel.get("quota", 0) or 0) > 0
                    ),
                }
                for day in days
                if isinstance(day, dict)
            ]
        return success_response(request, request_id, sanitize_data(data), cookie)
    except Exception as error:  # Every frontend response uses the same envelope.
        return error_response(request, request_id, error)
