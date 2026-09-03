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
                """
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
        parsed = validate_profile(profile)
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


def dollars(value: Any) -> str:
    try:
        return f"{float(value or 0) / 500_000:.4f}"
    except (TypeError, ValueError):
        return "0.0000"


async def platform_usage(session: sqlite3.Row, target_id: int) -> dict[str, Any]:
    children = await authorized_json(session, "/api/sub-accounts")
    items = children if isinstance(children, list) else children.get("items", [])
    source = next(
        (item for item in items if isinstance(item, dict) and int(item.get("id", 0)) == target_id),
        None,
    )
    if source is None:
        raise BackendError(404, "子账号不存在")

    channels: list[dict[str, Any]] = []
    identifiers: set[int] = set()
    expected_total: int | None = None
    expected_size: int | None = None
    page = 1
    while True:
        data = await authorized_json(session, f"/api/channels?page={page}&page_size=500")
        if not isinstance(data, dict) or not isinstance(data.get("items"), list):
            raise BackendError(502, "渠道数据格式不正确，无法准确统计。")
        try:
            total = int(data["total"])
            page_size = int(data["page_size"])
            current_page = int(data["page"])
        except (KeyError, TypeError, ValueError) as error:
            raise BackendError(502, "渠道分页数据不完整，请刷新重试。") from error
        if current_page != page or total < 0 or page_size <= 0:
            raise BackendError(502, "渠道分页数据不完整，请刷新重试。")
        if expected_total is not None and (total != expected_total or page_size != expected_size):
            raise BackendError(502, "读取期间渠道记录发生变化，请刷新重试。")
        expected_total, expected_size = total, page_size
        page_items = data["items"]
        if len(page_items) != min(page_size, total - len(channels)):
            raise BackendError(502, "渠道分页数据不完整，请刷新重试。")
        for item in page_items:
            if not isinstance(item, dict):
                raise BackendError(502, "渠道数据格式不正确，无法准确统计。")
            try:
                channel_id = int(item["id"])
                uploader_id = int(item.get("uploader_id", 0))
                quota = int(item.get("used_quota", 0))
            except (KeyError, TypeError, ValueError) as error:
                raise BackendError(502, "渠道数据格式不正确，无法准确统计。") from error
            if channel_id in identifiers:
                raise BackendError(502, "读取期间渠道记录发生变化，请刷新重试。")
            identifiers.add(channel_id)
            channels.append(
                {
                    "uploader_id": uploader_id,
                    "category": str(item.get("category") or "").strip(),
                    "quota": quota,
                }
            )
        if len(channels) == total:
            break
        page += 1

    grouped: dict[str, dict[str, Any]] = {}
    total_quota = 0
    channel_count = 0
    for channel in channels:
        if channel["uploader_id"] != target_id:
            continue
        category = channel["category"]
        group = grouped.setdefault(category, {"category": category, "quota": 0, "channelCount": 0})
        group["quota"] += channel["quota"]
        group["channelCount"] += 1
        total_quota += channel["quota"]
        channel_count += 1
    platforms = sorted(grouped.values(), key=lambda item: (-item["quota"], item["category"]))
    return {
        "totalAmount": dollars(total_quota),
        "channelCount": channel_count,
        "listedAmount": None if "used_quota" not in source else dollars(source["used_quota"]),
        "amountsDiffer": "used_quota" in source and int(source["used_quota"] or 0) != total_quota,
        "platforms": [
            {
                "category": item["category"],
                "channelCount": item["channelCount"],
                "amount": dollars(item["quota"]),
                "sharePercent": f"{(item['quota'] / total_quota * 100) if total_quota else 0:.2f}",
            }
            for item in platforms
        ],
    }


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
            login_body: dict[str, Any] = {"username": username, "password": password}
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
            parsed = validate_profile(profile)
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

        usage_match = re.fullmatch(r"/api/sub-accounts/(\d+)/platform-usage", path)
        if usage_match and request.method == "GET":
            if session["role"] not in {"supplier", "admin"}:
                raise BackendError(403, "当前账号无权管理子账号")
            target_id = int(usage_match.group(1))
            data = await platform_usage(session, target_id)
            return success_response(request, request_id, data, cookie)

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
