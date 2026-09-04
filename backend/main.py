from __future__ import annotations

import asyncio
import hashlib
import json
import os
import re
import secrets
import threading
import time
import uuid
from contextlib import contextmanager
from datetime import datetime
from decimal import Decimal, InvalidOperation
from pathlib import Path
from typing import Any, Iterator
from urllib.parse import urlencode
from zoneinfo import ZoneInfo

import httpx
import psycopg
from dotenv import load_dotenv
from fastapi import FastAPI, Request
from fastapi.responses import JSONResponse
from psycopg.rows import dict_row


load_dotenv(Path(__file__).resolve().parent.parent / ".env")


UPSTREAM_ORIGIN = "https://gys.oljuxj.xyz"
COOKIE_NAME = "key_system_session"
DAY_MS = 86_400_000
MODEL_GAPS_CACHE_KEY = "model-gaps:v1"
MODEL_GAPS_CACHE_TTL_MS = 3 * 60_000
MODEL_GAPS_REFRESH_LEASE_MS = 75_000
SUPER_ADMIN_USERNAME = "sanyeAdmin"
SUPER_ADMIN_ROLE = "super_admin"
LOCAL_AUTH_SOURCE = "local"
GYS_TIMEZONE = ZoneInfo("Asia/Shanghai")
CHANNEL_USAGE_CATEGORIES = (
    "aws",
    "aws_a",
    "anthropic",
    "anthropic_small",
    "anthropic_test",
    "anthropic_ent",
    "openai",
    "azure",
    "azure_claude",
    "ai_studio",
    "vertexai",
    "vertexai_claude",
    "openrouter",
    "opencode",
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


def decimal_text(value: Decimal) -> str:
    formatted = format(value, "f")
    return formatted.rstrip("0").rstrip(".") if "." in formatted else formatted


DbRow = dict[str, Any]


def hash_local_password(password: str, iterations: int = 600_000) -> str:
    salt = secrets.token_bytes(16)
    digest = hashlib.pbkdf2_hmac("sha256", password.encode("utf-8"), salt, iterations)
    return f"pbkdf2_sha256${iterations}${salt.hex()}${digest.hex()}"


def verify_local_password(password: str, encoded: str) -> bool:
    try:
        scheme, raw_iterations, raw_salt, expected = encoded.split("$", 3)
        iterations = int(raw_iterations)
        salt = bytes.fromhex(raw_salt)
        expected_bytes = bytes.fromhex(expected)
    except (TypeError, ValueError):
        return False
    if scheme != "pbkdf2_sha256" or not 100_000 <= iterations <= 2_000_000:
        return False
    actual = hashlib.pbkdf2_hmac("sha256", password.encode("utf-8"), salt, iterations)
    return secrets.compare_digest(actual, expected_bytes)


class PostgresDatabase:
    def __init__(self, database_url: str) -> None:
        self.raw = psycopg.connect(
            database_url,
            autocommit=True,
            connect_timeout=10,
            row_factory=dict_row,
        )

    @staticmethod
    def query(sql: str) -> str:
        return sql.replace("?", "%s")

    def execute(self, sql: str, params: tuple[Any, ...] = ()) -> Any:
        return self.raw.execute(self.query(sql), params)

    def executemany(self, sql: str, params: list[tuple[Any, ...]]) -> None:
        with self.raw.cursor() as cursor:
            cursor.executemany(self.query(sql), params)

    @contextmanager
    def transaction(self) -> Iterator[None]:
        with self.raw.transaction():
            yield

    def commit(self) -> None:
        return

    def rollback(self) -> None:
        return


class BackendError(Exception):
    def __init__(self, status: int, message: str, request_id: str | None = None):
        super().__init__(message)
        self.status = status
        self.message = message
        self.request_id = request_id


class SessionStore:
    def __init__(self) -> None:
        database_url = os.environ.get(
            "DATABASE_URL",
            "postgresql://gys:gys_local_password@127.0.0.1:5433/gys",
        )
        self.connection = PostgresDatabase(database_url)
        self.lock = threading.RLock()
        with self.lock:
            with self.connection.transaction():
                self.connection.execute(
                    "SELECT pg_advisory_xact_lock(hashtextextended('gys-schema-init', 0))"
                )
                self.connection.execute(
                    "SELECT pg_advisory_xact_lock(hashtextextended('account-alias-namespace', 0))"
                )
                for statement in (
                    "CREATE EXTENSION IF NOT EXISTS citext",
                    """
                    CREATE TABLE IF NOT EXISTS local_accounts (
                        id BIGSERIAL PRIMARY KEY,
                        username CITEXT NOT NULL UNIQUE,
                        display_name TEXT NOT NULL,
                        password_hash TEXT NOT NULL,
                        role TEXT NOT NULL,
                        active SMALLINT NOT NULL DEFAULT 1,
                        created_at BIGINT NOT NULL,
                        updated_at BIGINT NOT NULL
                    )
                    """,
                    """
                    CREATE TABLE IF NOT EXISTS upstream_sessions (
                        token_hash TEXT PRIMARY KEY,
                        upstream_user_id BIGINT,
                        local_account_id BIGINT,
                        username TEXT,
                        display_name TEXT,
                        role TEXT,
                        cookies TEXT NOT NULL,
                        auth_source TEXT NOT NULL DEFAULT 'upstream',
                        authenticated SMALLINT NOT NULL DEFAULT 0,
                        created_at BIGINT NOT NULL,
                        expires_at BIGINT NOT NULL
                    )
                    """,
                    """
                    CREATE INDEX IF NOT EXISTS idx_upstream_sessions_expires_at
                    ON upstream_sessions(expires_at)
                    """,
                    """
                    CREATE TABLE IF NOT EXISTS rate_limits (
                        name TEXT PRIMARY KEY,
                        count INTEGER NOT NULL,
                        expires_at BIGINT NOT NULL
                    )
                    """,
                    """
                    CREATE INDEX IF NOT EXISTS idx_rate_limits_expires_at
                    ON rate_limits(expires_at)
                    """,
                    """
                    CREATE TABLE IF NOT EXISTS app_metadata (
                        key TEXT PRIMARY KEY,
                        value TEXT NOT NULL
                    )
                    """,
                    """
                    CREATE TABLE IF NOT EXISTS shared_api_cache (
                        cache_key TEXT PRIMARY KEY,
                        payload TEXT,
                        refreshed_at BIGINT NOT NULL DEFAULT 0,
                        refresh_owner TEXT,
                        refresh_lease_until BIGINT NOT NULL DEFAULT 0
                    )
                    """,
                    """
                    CREATE TABLE IF NOT EXISTS announcements (
                        id BIGSERIAL PRIMARY KEY,
                        title TEXT NOT NULL,
                        content TEXT NOT NULL,
                        is_published SMALLINT NOT NULL DEFAULT 1,
                        created_by_user_id BIGINT NOT NULL,
                        created_by_username CITEXT NOT NULL,
                        created_at BIGINT NOT NULL,
                        updated_at BIGINT NOT NULL,
                        published_at BIGINT
                    )
                    """,
                    """
                    CREATE INDEX IF NOT EXISTS idx_announcements_published_time
                    ON announcements(is_published, published_at DESC, id DESC)
                    """,
                    """
                    CREATE TABLE IF NOT EXISTS account_aliases (
                        public_username CITEXT PRIMARY KEY,
                        upstream_username CITEXT NOT NULL UNIQUE,
                        display_name TEXT NOT NULL,
                        account_kind TEXT NOT NULL DEFAULT 'primary',
                        upstream_user_id BIGINT,
                        active SMALLINT NOT NULL DEFAULT 1,
                        created_at BIGINT NOT NULL,
                        updated_at BIGINT NOT NULL
                    )
                    """,
                    """
                    CREATE TABLE IF NOT EXISTS category_exchange_rates (
                        sub_account_user_id BIGINT NOT NULL,
                        category TEXT NOT NULL,
                        rate_percent TEXT NOT NULL DEFAULT '100',
                        settled_amount TEXT NOT NULL DEFAULT '0',
                        updated_at BIGINT NOT NULL,
                        PRIMARY KEY (sub_account_user_id, category)
                    )
                    """,
                    """
                    CREATE TABLE IF NOT EXISTS category_settlement_records (
                        id BIGSERIAL PRIMARY KEY,
                        sub_account_user_id BIGINT NOT NULL,
                        category TEXT NOT NULL,
                        previous_amount TEXT NOT NULL,
                        settled_amount TEXT NOT NULL,
                        change_amount TEXT NOT NULL,
                        rate_percent TEXT NOT NULL,
                        settlement_amount TEXT NOT NULL DEFAULT '0',
                        created_at BIGINT NOT NULL
                    )
                    """,
                    """
                    CREATE INDEX IF NOT EXISTS idx_category_settlement_records_account_time
                    ON category_settlement_records(sub_account_user_id, created_at DESC, id DESC)
                    """,
                    """
                    ALTER TABLE account_aliases
                    ADD COLUMN IF NOT EXISTS account_kind TEXT NOT NULL DEFAULT 'primary'
                    """,
                    """
                    ALTER TABLE account_aliases
                    ADD COLUMN IF NOT EXISTS upstream_user_id BIGINT
                    """,
                    """
                    CREATE INDEX IF NOT EXISTS idx_account_aliases_upstream_user_id
                    ON account_aliases(upstream_user_id)
                    """,
                    """
                    ALTER TABLE category_exchange_rates
                    ADD COLUMN IF NOT EXISTS settled_amount TEXT NOT NULL DEFAULT '0'
                    """,
                    """
                    ALTER TABLE category_settlement_records
                    ADD COLUMN IF NOT EXISTS settlement_amount TEXT NOT NULL DEFAULT '0'
                    """,
                    """
                    ALTER TABLE upstream_sessions
                    ADD COLUMN IF NOT EXISTS local_account_id BIGINT
                    """,
                    """
                    ALTER TABLE upstream_sessions
                    ADD COLUMN IF NOT EXISTS auth_source TEXT NOT NULL DEFAULT 'upstream'
                    """,
                    """
                    CREATE INDEX IF NOT EXISTS idx_upstream_sessions_local_account
                    ON upstream_sessions(local_account_id)
                    """,
                ):
                    self.connection.execute(statement)
                reserved_alias = self.connection.execute(
                    """
                    SELECT public_username, upstream_username
                    FROM account_aliases
                    WHERE public_username = ? OR upstream_username = ?
                    LIMIT 1
                    """,
                    (SUPER_ADMIN_USERNAME, SUPER_ADMIN_USERNAME),
                ).fetchone()
                if reserved_alias is not None:
                    raise RuntimeError(
                        "account_aliases contains the reserved local super-admin username"
                    )
                duplicate_sub_id = self.connection.execute(
                    """
                    SELECT upstream_user_id
                    FROM account_aliases
                    WHERE account_kind = 'sub' AND upstream_user_id IS NOT NULL
                    GROUP BY upstream_user_id
                    HAVING COUNT(*) > 1
                    LIMIT 1
                    """
                ).fetchone()
                if duplicate_sub_id is not None:
                    raise RuntimeError(
                        "account_aliases contains duplicate sub-account upstream_user_id: "
                        f"{duplicate_sub_id['upstream_user_id']}"
                    )
                self.connection.execute(
                    """
                    CREATE UNIQUE INDEX IF NOT EXISTS ux_account_aliases_sub_upstream_user_id
                    ON account_aliases(upstream_user_id)
                    WHERE account_kind = 'sub' AND upstream_user_id IS NOT NULL
                    """
                )
                now = int(time.time() * 1000)
                super_admin = self.connection.execute(
                    "SELECT id FROM local_accounts WHERE username = ?",
                    (SUPER_ADMIN_USERNAME,),
                ).fetchone()
                if super_admin is None:
                    initial_password = os.environ.get(
                        "SUPER_ADMIN_INITIAL_PASSWORD", ""
                    )
                    if not initial_password or len(initial_password) > 4_096:
                        raise RuntimeError(
                            "SUPER_ADMIN_INITIAL_PASSWORD is required for first startup"
                        )
                    self.connection.execute(
                        """
                        INSERT INTO local_accounts
                            (username, display_name, password_hash, role, active, created_at, updated_at)
                        VALUES (?, ?, ?, ?, 1, ?, ?)
                        """,
                        (
                            SUPER_ADMIN_USERNAME,
                            SUPER_ADMIN_USERNAME,
                            hash_local_password(initial_password),
                            SUPER_ADMIN_ROLE,
                            now,
                            now,
                        ),
                    )
                else:
                    self.connection.execute(
                        """
                        UPDATE local_accounts
                        SET display_name = ?, role = ?, updated_at = ?
                        WHERE id = ?
                        """,
                        (
                            SUPER_ADMIN_USERNAME,
                            SUPER_ADMIN_ROLE,
                            now,
                            int(super_admin["id"]),
                        ),
                    )
                self.connection.execute(
                    """
                    UPDATE upstream_sessions AS sessions
                    SET username = aliases.public_username,
                        display_name = aliases.display_name
                    FROM account_aliases AS aliases
                    WHERE sessions.auth_source = 'upstream'
                      AND aliases.active = 1
                      AND sessions.username::citext = aliases.upstream_username
                      AND (
                        (
                          aliases.account_kind = 'sub'
                          AND aliases.upstream_user_id = sessions.upstream_user_id
                          AND sessions.role = 'sub'
                        )
                        OR (
                          aliases.account_kind = 'primary'
                          AND sessions.role IN ('admin', 'supplier')
                        )
                      )
                    """
                )

    @staticmethod
    def token_hash(token: str) -> str:
        return hashlib.sha256(token.encode("utf-8")).hexdigest()

    def create_session(
        self,
        profile: dict[str, Any] | None = None,
        cookies: str = "[]",
    ) -> tuple[str, DbRow]:
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
            with self.connection.transaction():
                self.connection.execute(
                    "DELETE FROM upstream_sessions WHERE expires_at <= ?",
                    (now,),
                )
                self.connection.execute(
                    """
                    INSERT INTO upstream_sessions
                        (token_hash, upstream_user_id, username, display_name, role,
                         cookies, authenticated, created_at, expires_at)
                    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
                    """,
                    values,
                )
                row = self.connection.execute(
                    "SELECT * FROM upstream_sessions WHERE token_hash = ?", (values[0],)
                ).fetchone()
        if row is None:
            raise BackendError(503, "会话服务暂时不可用")
        return token, row

    def create_local_session(self, username: str, password: str) -> tuple[str, DbRow] | None:
        token = secrets.token_urlsafe(32)
        now = int(time.time() * 1000)
        with self.lock:
            with self.connection.transaction():
                account = self.connection.execute(
                    """
                    SELECT id, username, display_name, password_hash, role, active
                    FROM local_accounts
                    WHERE username = ?
                    FOR UPDATE
                    """,
                    (username,),
                ).fetchone()
                if account is None:
                    return None
                if (
                    not int(account["active"])
                    or not verify_local_password(password, str(account["password_hash"]))
                ):
                    raise BackendError(401, "账号或密码不正确")
                if str(account["role"]) != SUPER_ADMIN_ROLE:
                    raise BackendError(403, "当前账号无权登录管理端")
                values = (
                    self.token_hash(token),
                    int(account["id"]),
                    str(account["username"]),
                    str(account["display_name"] or account["username"]),
                    str(account["role"]),
                    "[]",
                    LOCAL_AUTH_SOURCE,
                    1,
                    now,
                    now + 7 * DAY_MS,
                )
                self.connection.execute(
                    "DELETE FROM upstream_sessions WHERE expires_at <= ?",
                    (now,),
                )
                self.connection.execute(
                    """
                    INSERT INTO upstream_sessions
                        (token_hash, local_account_id, username, display_name, role,
                         cookies, auth_source, authenticated, created_at, expires_at)
                    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
                    """,
                    values,
                )
                row = self.connection.execute(
                    "SELECT * FROM upstream_sessions WHERE token_hash = ?", (values[0],)
                ).fetchone()
        if row is None:
            raise BackendError(503, "会话服务暂时不可用")
        return token, row

    def create_authenticated_upstream_session(
        self,
        login_username: str,
        resolved_upstream_username: str,
        profile: dict[str, Any] | None,
        cookies: str,
    ) -> tuple[str, DbRow, dict[str, Any]]:
        parsed = validate_profile(profile)
        if parsed["username"].casefold() != resolved_upstream_username.casefold():
            raise BackendError(401, "登录账号信息不一致，请重新登录")

        token = secrets.token_urlsafe(32)
        now = int(time.time() * 1000)
        with self.lock:
            with self.connection.transaction():
                self.connection.execute(
                    "SELECT pg_advisory_xact_lock(hashtextextended('account-alias-namespace', 0))"
                )
                alias = self.connection.execute(
                    """
                    SELECT public_username, upstream_username, display_name, account_kind,
                           upstream_user_id, active
                    FROM account_aliases
                    WHERE public_username = ?
                    """,
                    (login_username,),
                ).fetchone()
                if (
                    alias is None
                    or not int(alias["active"])
                    or str(alias["upstream_username"]).casefold()
                    != resolved_upstream_username.casefold()
                    or not self.alias_matches_upstream_identity(
                        alias,
                        parsed["id"],
                        parsed["role"],
                    )
                ):
                    raise BackendError(403, "账号未配置有效登录映射，请联系管理员")
                parsed["username"] = str(alias["public_username"])
                parsed["display_name"] = str(
                    alias["display_name"] or alias["public_username"]
                )

                self.connection.execute(
                    "DELETE FROM upstream_sessions WHERE expires_at <= ?",
                    (now,),
                )
                self.connection.execute(
                    """
                    INSERT INTO upstream_sessions
                        (token_hash, upstream_user_id, username, display_name, role,
                         cookies, auth_source, authenticated, created_at, expires_at)
                    VALUES (?, ?, ?, ?, ?, ?, 'upstream', 1, ?, ?)
                    """,
                    (
                        self.token_hash(token),
                        parsed["id"],
                        parsed["username"],
                        parsed["display_name"],
                        parsed["role"],
                        cookies,
                        now,
                        now + 7 * DAY_MS,
                    ),
                )
                row = self.connection.execute(
                    "SELECT * FROM upstream_sessions WHERE token_hash = ?",
                    (self.token_hash(token),),
                ).fetchone()
        if row is None:
            raise BackendError(503, "会话服务暂时不可用")
        parsed["auth_source"] = "upstream"
        return token, row, parsed

    def change_local_password(
        self,
        local_account_id: int,
        old_password: str,
        new_password: str,
    ) -> None:
        with self.lock:
            with self.connection.transaction():
                row = self.connection.execute(
                    """
                    SELECT password_hash, active
                    FROM local_accounts
                    WHERE id = ?
                    FOR UPDATE
                    """,
                    (local_account_id,),
                ).fetchone()
                if (
                    row is None
                    or not int(row["active"])
                    or not verify_local_password(old_password, str(row["password_hash"]))
                ):
                    raise BackendError(400, "旧密码不正确")
                self.connection.execute(
                    """
                    UPDATE local_accounts
                    SET password_hash = ?, updated_at = ?
                    WHERE id = ?
                    """,
                    (
                        hash_local_password(new_password),
                        int(time.time() * 1000),
                        local_account_id,
                    ),
                )
                self.connection.execute(
                    "DELETE FROM upstream_sessions WHERE local_account_id = ?",
                    (local_account_id,),
                )

    def local_account_is_active(self, local_account_id: int, username: str, role: str) -> bool:
        with self.lock:
            row = self.connection.execute(
                """
                SELECT 1
                FROM local_accounts
                WHERE id = ? AND username = ? AND role = ? AND active = 1
                """,
                (local_account_id, username, role),
            ).fetchone()
        return row is not None

    @staticmethod
    def alias_matches_upstream_identity(
        alias: DbRow,
        upstream_user_id: Any,
        role: Any,
    ) -> bool:
        account_kind = str(alias.get("account_kind") or "")
        role_name = str(role or "")
        if account_kind == "primary":
            return role_name in {"admin", "supplier"}
        if account_kind != "sub" or role_name != "sub":
            return False
        mapped_user_id = alias.get("upstream_user_id")
        try:
            return (
                mapped_user_id is not None
                and upstream_user_id is not None
                and int(mapped_user_id) == int(upstream_user_id)
            )
        except (TypeError, ValueError):
            return False

    def get_session(self, token: str) -> DbRow | None:
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
        if int(row.get("authenticated") or 0) and row.get("auth_source") == "upstream":
            with self.lock:
                alias = self.connection.execute(
                    """
                    SELECT account_kind, upstream_user_id
                    FROM account_aliases
                    WHERE public_username = ? AND active = 1
                    """,
                    (row.get("username"),),
                ).fetchone()
            if alias is None or not self.alias_matches_upstream_identity(
                alias,
                row.get("upstream_user_id"),
                row.get("role"),
            ):
                return None
        return row

    def current(self, session: DbRow) -> DbRow:
        with self.lock:
            row = self.connection.execute(
                "SELECT * FROM upstream_sessions WHERE token_hash = ?",
                (session["token_hash"],),
            ).fetchone()
        return row or session

    def save_cookies(self, session: DbRow, cookies: str) -> None:
        with self.lock:
            self.connection.execute(
                "UPDATE upstream_sessions SET cookies = ? WHERE token_hash = ?",
                (cookies, session["token_hash"]),
            )
            self.connection.commit()

    def save_profile(self, session: DbRow, profile: dict[str, Any]) -> dict[str, Any]:
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
        parsed["auth_source"] = "upstream"
        return parsed

    def resolve_login_username(self, username: str) -> str:
        with self.lock:
            alias = self.connection.execute(
                """
                SELECT upstream_username, active
                FROM account_aliases
                WHERE public_username = ?
                """,
                (username,),
            ).fetchone()
            if alias is not None:
                if not int(alias["active"]):
                    raise BackendError(403, "账号未配置有效登录映射，请联系管理员")
                return str(alias["upstream_username"])
        raise BackendError(403, "账号未配置有效登录映射，请联系管理员")

    def publicize_profile(self, profile: dict[str, Any]) -> dict[str, Any]:
        parsed = validate_profile(profile)
        with self.lock:
            alias = self.connection.execute(
                """
                SELECT public_username, display_name, account_kind, upstream_user_id
                FROM account_aliases
                WHERE upstream_username = ? AND active = 1
                """,
                (parsed["username"],),
            ).fetchone()
        if alias is None or not self.alias_matches_upstream_identity(
            alias,
            parsed["id"],
            parsed["role"],
        ):
            raise BackendError(401, "账号未配置有效登录映射，请重新登录")
        parsed["username"] = str(alias["public_username"])
        parsed["display_name"] = str(alias["display_name"] or alias["public_username"])
        parsed["auth_source"] = "upstream"
        return parsed

    def account_mappings(self) -> list[DbRow]:
        with self.lock:
            rows = self.connection.execute(
                """
                SELECT public_username, upstream_username, display_name, account_kind,
                       upstream_user_id, active, created_at, updated_at
                FROM account_aliases
                ORDER BY account_kind, public_username
                """
            ).fetchall()
        return [dict(row) for row in rows]

    def create_account_mapping(
        self,
        public_username: str,
        upstream_username: str,
        display_name: str,
        account_kind: str,
        upstream_user_id: int | None,
    ) -> DbRow:
        if (
            public_username.casefold() == SUPER_ADMIN_USERNAME.casefold()
            or upstream_username.casefold() == SUPER_ADMIN_USERNAME.casefold()
        ):
            raise BackendError(409, "超级管理员账号名不可用于用户映射")
        now = int(time.time() * 1000)
        with self.lock:
            try:
                with self.connection.transaction():
                    self.connection.execute(
                        "SELECT pg_advisory_xact_lock(hashtextextended('account-alias-namespace', 0))"
                    )
                    conflict = self.connection.execute(
                        """
                        SELECT 1
                        FROM account_aliases
                        WHERE public_username IN (?, ?)
                           OR upstream_username IN (?, ?)
                        """,
                        (
                            public_username,
                            upstream_username,
                            public_username,
                            upstream_username,
                        ),
                    ).fetchone()
                    if conflict is not None:
                        raise BackendError(409, "本站用户名或 GYS 用户名已存在")
                    if account_kind == "sub":
                        id_conflict = self.connection.execute(
                            """
                            SELECT 1
                            FROM account_aliases
                            WHERE account_kind = 'sub' AND upstream_user_id = ?
                            """,
                            (upstream_user_id,),
                        ).fetchone()
                        if id_conflict is not None:
                            raise BackendError(409, "子账号 ID 已绑定其他用户映射")
                    row = self.connection.execute(
                        """
                        INSERT INTO account_aliases
                            (public_username, upstream_username, display_name, account_kind,
                             upstream_user_id, active, created_at, updated_at)
                        VALUES (?, ?, ?, ?, ?, 1, ?, ?)
                        RETURNING public_username, upstream_username, display_name, account_kind,
                                  upstream_user_id, active, created_at, updated_at
                        """,
                        (
                            public_username,
                            upstream_username,
                            display_name,
                            account_kind,
                            upstream_user_id,
                            now,
                            now,
                        ),
                    ).fetchone()
                    self.connection.execute(
                        """
                        DELETE FROM upstream_sessions
                        WHERE auth_source = 'upstream' AND username::citext IN (?, ?)
                        """,
                        (public_username, upstream_username),
                    )
            except psycopg.errors.UniqueViolation as error:
                raise BackendError(409, "本站用户名或 GYS 用户名已存在") from error
        if row is None:
            raise BackendError(503, "用户映射保存失败")
        return dict(row)

    def update_account_mapping(
        self,
        current_public_username: str,
        public_username: str,
        upstream_username: str,
        display_name: str,
        active: bool,
        account_kind: str | None,
        upstream_user_id: int | None,
    ) -> DbRow:
        if (
            public_username.casefold() == SUPER_ADMIN_USERNAME.casefold()
            or upstream_username.casefold() == SUPER_ADMIN_USERNAME.casefold()
        ):
            raise BackendError(409, "超级管理员账号名不可用于用户映射")
        now = int(time.time() * 1000)
        with self.lock:
            try:
                with self.connection.transaction():
                    self.connection.execute(
                        "SELECT pg_advisory_xact_lock(hashtextextended('account-alias-namespace', 0))"
                    )
                    current = self.connection.execute(
                        """
                        SELECT public_username, upstream_username, account_kind, upstream_user_id
                        FROM account_aliases
                        WHERE public_username = ?
                        FOR UPDATE
                        """,
                        (current_public_username,),
                    ).fetchone()
                    if current is None:
                        raise BackendError(404, "用户映射不存在")
                    next_account_kind = account_kind or str(current["account_kind"])
                    next_upstream_user_id = (
                        upstream_user_id
                        if account_kind is not None
                        else current["upstream_user_id"]
                    )
                    conflict = self.connection.execute(
                        """
                        SELECT 1
                        FROM account_aliases
                        WHERE public_username <> ?
                          AND (
                            public_username IN (?, ?)
                            OR upstream_username IN (?, ?)
                          )
                        """,
                        (
                            current_public_username,
                            public_username,
                            upstream_username,
                            public_username,
                            upstream_username,
                        ),
                    ).fetchone()
                    if conflict is not None:
                        raise BackendError(409, "本站用户名或 GYS 用户名已存在")
                    if next_account_kind == "sub":
                        id_conflict = self.connection.execute(
                            """
                            SELECT 1
                            FROM account_aliases
                            WHERE account_kind = 'sub'
                              AND upstream_user_id = ?
                              AND public_username <> ?
                            """,
                            (next_upstream_user_id, current_public_username),
                        ).fetchone()
                        if id_conflict is not None:
                            raise BackendError(409, "子账号 ID 已绑定其他用户映射")
                    row = self.connection.execute(
                        """
                        UPDATE account_aliases
                        SET public_username = ?, upstream_username = ?, display_name = ?,
                            account_kind = ?, upstream_user_id = ?, active = ?, updated_at = ?
                        WHERE public_username = ?
                        RETURNING public_username, upstream_username, display_name, account_kind,
                                  upstream_user_id, active, created_at, updated_at
                        """,
                        (
                            public_username,
                            upstream_username,
                            display_name,
                            next_account_kind,
                            next_upstream_user_id,
                            1 if active else 0,
                            now,
                            current_public_username,
                        ),
                    ).fetchone()
                    session_names = (
                        str(current["public_username"]),
                        str(current["upstream_username"]),
                    )
                    self.connection.execute(
                        """
                        DELETE FROM upstream_sessions
                        WHERE auth_source = 'upstream' AND username::citext IN (?, ?, ?, ?)
                        """,
                        (*session_names, public_username, upstream_username),
                    )
            except psycopg.errors.UniqueViolation as error:
                raise BackendError(409, "用户名或子账号 ID 已绑定其他用户映射") from error
        if row is None:
            raise BackendError(404, "用户映射不存在")
        return dict(row)

    def publicize_sub_accounts(self, data: Any) -> Any:
        if isinstance(data, list):
            return [self.publicize_sub_account(item) if isinstance(item, dict) else item for item in data]
        if not isinstance(data, dict):
            return data
        items = data.get("items")
        if isinstance(items, list):
            return {
                **data,
                "items": [
                    self.publicize_sub_account(item) if isinstance(item, dict) else item
                    for item in items
                ],
            }
        if "id" in data and "username" in data:
            return self.publicize_sub_account(data)
        return data

    def publicize_sub_account(self, item: dict[str, Any]) -> dict[str, Any]:
        upstream_username = item.get("username")
        upstream_username = (
            upstream_username.strip() if isinstance(upstream_username, str) else ""
        )
        try:
            upstream_user_id = int(item.get("id"))
        except (TypeError, ValueError):
            upstream_user_id = 0

        alias: DbRow | None = None
        if upstream_user_id > 0 and upstream_username:
            with self.lock:
                alias = self.connection.execute(
                    """
                    SELECT public_username, display_name, active
                    FROM account_aliases
                    WHERE account_kind = 'sub'
                      AND upstream_user_id = ?
                      AND upstream_username = ?
                    """,
                    (upstream_user_id, upstream_username),
                ).fetchone()

        return {
            **item,
            "username": upstream_username,
            "original_username": upstream_username,
            "upstream_username": upstream_username,
            "public_username": str(alias["public_username"]) if alias is not None else None,
            "mapping_active": bool(int(alias["active"])) if alias is not None else None,
            "mapping_display_name": (
                str(alias["display_name"] or alias["public_username"])
                if alias is not None
                else None
            ),
        }

    def delete_sub_account_alias(self, upstream_user_id: int) -> None:
        with self.lock:
            with self.connection.transaction():
                self.connection.execute(
                    "SELECT pg_advisory_xact_lock(hashtextextended('account-alias-namespace', 0))"
                )
                self.connection.execute(
                    "DELETE FROM account_aliases WHERE account_kind = 'sub' AND upstream_user_id = ?",
                    (upstream_user_id,),
                )

    def category_rates(self, sub_account_user_id: int) -> dict[str, Decimal]:
        with self.lock:
            rows = self.connection.execute(
                """
                SELECT category, rate_percent
                FROM category_exchange_rates
                WHERE sub_account_user_id = ?
                """,
                (sub_account_user_id,),
            ).fetchall()
        rates = {category: Decimal("100") for category in CHANNEL_USAGE_CATEGORIES}
        for row in rows:
            category = str(row["category"])
            if category not in rates:
                continue
            try:
                value = Decimal(str(row["rate_percent"]))
            except (InvalidOperation, TypeError, ValueError):
                continue
            if value.is_finite() and Decimal(0) <= value <= Decimal("100000"):
                rates[category] = value
        return rates

    def category_settled_amounts(self, sub_account_user_id: int) -> dict[str, Decimal]:
        with self.lock:
            rows = self.connection.execute(
                """
                SELECT category, settled_amount
                FROM category_exchange_rates
                WHERE sub_account_user_id = ?
                """,
                (sub_account_user_id,),
            ).fetchall()
        amounts = {category: Decimal(0) for category in CHANNEL_USAGE_CATEGORIES}
        for row in rows:
            category = str(row["category"])
            if category not in amounts:
                continue
            try:
                value = Decimal(str(row["settled_amount"]))
            except (InvalidOperation, TypeError, ValueError):
                continue
            if value.is_finite() and Decimal(0) <= value <= Decimal("1000000000000"):
                amounts[category] = value
        return amounts

    def save_category_rates(
        self,
        sub_account_user_id: int,
        rates: dict[str, Decimal],
    ) -> None:
        now = int(time.time() * 1000)
        values = []
        for category in CHANNEL_USAGE_CATEGORIES:
            values.append(
                (
                    sub_account_user_id,
                    category,
                    decimal_text(rates[category]),
                    now,
                )
            )
        with self.lock:
            with self.connection.transaction():
                self.connection.executemany(
                    """
                    INSERT INTO category_exchange_rates
                        (sub_account_user_id, category, rate_percent, settled_amount, updated_at)
                    VALUES (?, ?, ?, '0', ?)
                    ON CONFLICT(sub_account_user_id, category) DO UPDATE SET
                        rate_percent = excluded.rate_percent,
                        updated_at = excluded.updated_at
                    """,
                    values,
                )

    def record_settlement(
        self,
        sub_account_user_id: int,
        category: str,
        consumption_amount: Decimal,
        total_usage_amount: Decimal,
    ) -> dict[str, Any]:
        now = int(time.time() * 1000)
        with self.lock:
            with self.connection.transaction():
                self.connection.execute(
                    """
                    SELECT pg_advisory_xact_lock(
                        hashtextextended(CAST(? AS text) || ':' || ?, 0)
                    )
                    """,
                    (sub_account_user_id, category),
                )
                row = self.connection.execute(
                    """
                    SELECT rate_percent, settled_amount
                    FROM category_exchange_rates
                    WHERE sub_account_user_id = ? AND category = ?
                    FOR UPDATE
                    """,
                    (sub_account_user_id, category),
                ).fetchone()
                rate = Decimal("100")
                previous = Decimal(0)
                if row is not None:
                    try:
                        stored_rate = Decimal(str(row["rate_percent"]))
                        if (
                            stored_rate.is_finite()
                            and Decimal(0) <= stored_rate <= Decimal("100000")
                        ):
                            rate = stored_rate
                    except (InvalidOperation, TypeError, ValueError):
                        pass
                    try:
                        stored_settled = Decimal(str(row["settled_amount"]))
                        if stored_settled.is_finite() and stored_settled >= 0:
                            previous = stored_settled
                    except (InvalidOperation, TypeError, ValueError):
                        pass
                available = max(Decimal(0), total_usage_amount - previous)
                if consumption_amount <= 0:
                    raise BackendError(400, "本次结算消耗额度必须大于 0")
                if consumption_amount > available:
                    raise BackendError(
                        409,
                        f"本次结算消耗额度不能超过可结算额度 ${dollar_amount(available)}",
                    )
                settled = previous + consumption_amount
                settlement_amount = consumption_amount * rate / Decimal(100)
                self.connection.execute(
                    """
                    INSERT INTO category_exchange_rates
                        (sub_account_user_id, category, rate_percent, settled_amount, updated_at)
                    VALUES (?, ?, ?, ?, ?)
                    ON CONFLICT(sub_account_user_id, category) DO UPDATE SET
                        settled_amount = excluded.settled_amount,
                        updated_at = excluded.updated_at
                    """,
                    (
                        sub_account_user_id,
                        category,
                        decimal_text(rate),
                        decimal_text(settled),
                        now,
                    ),
                )
                cursor = self.connection.execute(
                    """
                    INSERT INTO category_settlement_records
                        (sub_account_user_id, category, previous_amount, settled_amount,
                         change_amount, rate_percent, settlement_amount, created_at)
                    VALUES (?, ?, ?, ?, ?, ?, ?, ?)
                    RETURNING id
                    """,
                    (
                        sub_account_user_id,
                        category,
                        decimal_text(previous),
                        decimal_text(settled),
                        decimal_text(consumption_amount),
                        decimal_text(rate),
                        decimal_text(settlement_amount),
                        now,
                    ),
                )
                inserted = cursor.fetchone()
                if inserted is None:
                    raise BackendError(503, "结算记录保存失败")
                record_id = int(inserted["id"])
        return {
            "id": record_id,
            "category": category,
            "previous_amount": decimal_text(previous),
            "settled_amount": decimal_text(settled),
            "change_amount": decimal_text(consumption_amount),
            "rate_percent": decimal_text(rate),
            "settlement_amount": decimal_text(settlement_amount),
            "created_at": now,
        }

    def settlement_records(
        self,
        sub_account_user_id: int,
        limit: int = 100,
    ) -> list[dict[str, Any]]:
        bounded_limit = max(1, min(limit, 500))
        with self.lock:
            rows = self.connection.execute(
                """
                SELECT id, category, previous_amount, settled_amount, change_amount,
                       rate_percent, settlement_amount, created_at
                FROM category_settlement_records
                WHERE sub_account_user_id = ?
                ORDER BY created_at DESC, id DESC
                LIMIT ?
                """,
                (sub_account_user_id, bounded_limit),
            ).fetchall()
        return [dict(row) for row in rows]

    def delete_category_rates(self, sub_account_user_id: int) -> None:
        with self.lock:
            with self.connection.transaction():
                self.connection.execute(
                    """
                    DELETE FROM category_exchange_rates
                    WHERE sub_account_user_id = ?
                    """,
                    (sub_account_user_id,),
                )
                self.connection.execute(
                    """
                    DELETE FROM category_settlement_records
                    WHERE sub_account_user_id = ?
                    """,
                    (sub_account_user_id,),
                )

    def announcements(self, published_only: bool = True) -> list[DbRow]:
        where = "WHERE is_published = 1" if published_only else ""
        limit = 100 if published_only else 500
        with self.lock:
            rows = self.connection.execute(
                f"""
                SELECT id, title, content, is_published,
                       created_at, updated_at, published_at
                FROM announcements
                {where}
                ORDER BY COALESCE(published_at, updated_at) DESC, id DESC
                LIMIT ?
                """,
                (limit,),
            ).fetchall()
        return [dict(row) for row in rows]

    def create_announcement(
        self,
        title: str,
        content: str,
        created_by_user_id: int,
        created_by_username: str,
    ) -> DbRow:
        now = int(time.time() * 1000)
        with self.lock:
            row = self.connection.execute(
                """
                INSERT INTO announcements
                    (title, content, is_published, created_by_user_id,
                     created_by_username, created_at, updated_at, published_at)
                VALUES (?, ?, 1, ?, ?, ?, ?, ?)
                RETURNING id, title, content, is_published,
                          created_at, updated_at, published_at
                """,
                (
                    title,
                    content,
                    created_by_user_id,
                    created_by_username,
                    now,
                    now,
                    now,
                ),
            ).fetchone()
        if row is None:
            raise BackendError(503, "公告保存失败")
        return dict(row)

    def set_announcement_published(self, announcement_id: int, published: bool) -> DbRow:
        now = int(time.time() * 1000)
        published_value = 1 if published else 0
        with self.lock:
            row = self.connection.execute(
                """
                UPDATE announcements
                SET is_published = ?, updated_at = ?,
                    published_at = CASE WHEN ? = 1 THEN ? ELSE NULL END
                WHERE id = ?
                RETURNING id, title, content, is_published,
                          created_at, updated_at, published_at
                """,
                (published_value, now, published_value, now, announcement_id),
            ).fetchone()
        if row is None:
            raise BackendError(404, "公告不存在")
        return dict(row)

    def delete_announcement(self, announcement_id: int) -> None:
        with self.lock:
            row = self.connection.execute(
                "DELETE FROM announcements WHERE id = ? RETURNING id",
                (announcement_id,),
            ).fetchone()
        if row is None:
            raise BackendError(404, "公告不存在")

    def touch(self, session: DbRow) -> int:
        now = int(time.time() * 1000)
        expires_at = min(int(session["created_at"]) + 30 * DAY_MS, now + 7 * DAY_MS)
        with self.lock:
            self.connection.execute(
                "UPDATE upstream_sessions SET expires_at = ? WHERE token_hash = ?",
                (expires_at, session["token_hash"]),
            )
            self.connection.commit()
        return max(0, (expires_at - now) // 1000)

    def delete(self, session: DbRow | None) -> None:
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
            with self.connection.transaction():
                self.connection.execute(
                    "SELECT pg_advisory_xact_lock(hashtextextended(?, 0))",
                    (f"rate-limit:{key}",),
                )
                row = self.connection.execute(
                    "SELECT count, expires_at FROM rate_limits WHERE name = ? FOR UPDATE",
                    (key,),
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
        return allowed

    def read_shared_cache(self, cache_key: str) -> tuple[Any | None, int, int]:
        with self.lock:
            row = self.connection.execute(
                """
                SELECT payload, refreshed_at, refresh_lease_until
                FROM shared_api_cache
                WHERE cache_key = ?
                """,
                (cache_key,),
            ).fetchone()
        if row is None or not isinstance(row.get("payload"), str):
            return (
                None,
                int(row["refreshed_at"]) if row is not None else 0,
                int(row["refresh_lease_until"]) if row is not None else 0,
            )
        try:
            payload = json.loads(row["payload"])
        except (TypeError, ValueError):
            payload = None
        return payload, int(row["refreshed_at"]), int(row["refresh_lease_until"])

    def claim_shared_cache_refresh(
        self,
        cache_key: str,
        minimum_refreshed_at: int,
        lease_ms: int,
    ) -> str | None:
        now = int(time.time() * 1000)
        owner = uuid.uuid4().hex
        with self.lock:
            with self.connection.transaction():
                self.connection.execute(
                    "SELECT pg_advisory_xact_lock(hashtextextended(?, 0))",
                    (f"shared-cache:{cache_key}",),
                )
                row = self.connection.execute(
                    """
                    SELECT payload, refreshed_at, refresh_lease_until
                    FROM shared_api_cache
                    WHERE cache_key = ?
                    FOR UPDATE
                    """,
                    (cache_key,),
                ).fetchone()
                if (
                    row is not None
                    and isinstance(row.get("payload"), str)
                    and int(row["refreshed_at"]) > minimum_refreshed_at
                ):
                    return None
                if row is not None and int(row["refresh_lease_until"]) > now:
                    return None
                self.connection.execute(
                    """
                    INSERT INTO shared_api_cache
                        (cache_key, payload, refreshed_at, refresh_owner, refresh_lease_until)
                    VALUES (?, NULL, 0, ?, ?)
                    ON CONFLICT(cache_key) DO UPDATE SET
                        refresh_owner = excluded.refresh_owner,
                        refresh_lease_until = excluded.refresh_lease_until
                    """,
                    (cache_key, owner, now + lease_ms),
                )
        return owner

    def save_shared_cache(self, cache_key: str, owner: str, payload: Any) -> bool:
        now = int(time.time() * 1000)
        serialized = json.dumps(payload, ensure_ascii=False, separators=(",", ":"))
        with self.lock:
            row = self.connection.execute(
                """
                UPDATE shared_api_cache
                SET payload = ?, refreshed_at = ?, refresh_owner = NULL,
                    refresh_lease_until = 0
                WHERE cache_key = ? AND refresh_owner = ?
                RETURNING cache_key
                """,
                (serialized, now, cache_key, owner),
            ).fetchone()
        return row is not None

    def release_shared_cache_refresh(self, cache_key: str, owner: str) -> None:
        with self.lock:
            self.connection.execute(
                """
                UPDATE shared_api_cache
                SET refresh_owner = NULL, refresh_lease_until = 0
                WHERE cache_key = ? AND refresh_owner = ?
                """,
                (cache_key, owner),
            )


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


def public_profile(session: DbRow) -> dict[str, Any]:
    if not session["authenticated"]:
        raise BackendError(401, "请重新登录账号")
    if session.get("auth_source") == LOCAL_AUTH_SOURCE:
        local_account_id = session.get("local_account_id")
        if not local_account_id or not store.local_account_is_active(
            int(local_account_id),
            str(session.get("username") or ""),
            str(session.get("role") or ""),
        ):
            raise BackendError(401, "请重新登录账号")
        return {
            "id": int(local_account_id),
            "user_id": int(local_account_id),
            "username": session["username"],
            "display_name": session["display_name"] or session["username"],
            "role": session["role"],
            "auth_source": LOCAL_AUTH_SOURCE,
        }
    if not session["upstream_user_id"]:
        raise BackendError(401, "请重新登录账号")
    return {
        "id": session["upstream_user_id"],
        "user_id": session["upstream_user_id"],
        "username": session["username"],
        "display_name": session["display_name"] or session["username"],
        "role": session["role"],
        "auth_source": "upstream",
    }


def is_super_admin(session: DbRow) -> bool:
    local_account_id = session.get("local_account_id")
    return bool(
        session.get("auth_source") == LOCAL_AUTH_SOURCE
        and session.get("role") == SUPER_ADMIN_ROLE
        and str(session.get("username") or "").strip().casefold()
        == SUPER_ADMIN_USERNAME.casefold()
        and local_account_id
        and store.local_account_is_active(
            int(local_account_id),
            str(session.get("username") or ""),
            SUPER_ADMIN_ROLE,
        )
    )


def assert_super_admin(session: DbRow) -> None:
    if not is_super_admin(session):
        raise BackendError(403, "当前账号无权使用超级管理员功能")


def assert_announcement_admin(session: DbRow) -> None:
    if not is_super_admin(session):
        raise BackendError(403, "当前账号无权管理公告")


def account_mapping_payload(row: DbRow) -> dict[str, Any]:
    upstream_user_id = row.get("upstream_user_id")
    return {
        "public_username": str(row["public_username"]),
        "upstream_username": str(row["upstream_username"]),
        "display_name": str(row["display_name"]),
        "account_kind": str(row["account_kind"]),
        "upstream_user_id": int(upstream_user_id) if upstream_user_id is not None else None,
        "active": bool(int(row["active"])),
        "created_at": int(row["created_at"]),
        "updated_at": int(row["updated_at"]),
    }


def parse_account_mapping_body(
    body: dict[str, Any],
    *,
    require_active: bool,
) -> tuple[str, str, str, bool, str | None, int | None]:
    public_username = body.get("public_username")
    upstream_username = body.get("upstream_username")
    display_name = body.get("display_name")
    public_username = (
        public_username.strip() if isinstance(public_username, str) else ""
    )
    upstream_username = (
        upstream_username.strip() if isinstance(upstream_username, str) else ""
    )
    display_name = display_name.strip() if isinstance(display_name, str) else ""
    if not re.fullmatch(r"[A-Za-z0-9_.-]{3,64}", public_username):
        raise BackendError(400, "本站用户名须为3至64位字母、数字、点、横线或下划线")
    if not re.fullmatch(r"[A-Za-z0-9_.-]{3,64}", upstream_username):
        raise BackendError(400, "GYS用户名须为3至64位字母、数字、点、横线或下划线")
    if (
        public_username.casefold() == SUPER_ADMIN_USERNAME.casefold()
        or upstream_username.casefold() == SUPER_ADMIN_USERNAME.casefold()
    ):
        raise BackendError(409, "超级管理员账号名不可用于用户映射")
    if not display_name or len(display_name) > 128:
        raise BackendError(400, "显示名须为 1 至 128 个字符")
    if require_active and "active" not in body:
        raise BackendError(400, "用户映射状态无效")
    active = body.get("active", True)
    if not isinstance(active, bool):
        raise BackendError(400, "用户映射状态无效")

    account_kind: str | None = None
    upstream_user_id: int | None = None
    if "account_kind" in body:
        raw_account_kind = body.get("account_kind")
        account_kind = raw_account_kind.strip() if isinstance(raw_account_kind, str) else ""
        if account_kind not in {"primary", "sub"}:
            raise BackendError(400, "账号类型无效")
        raw_upstream_user_id = body.get("upstream_user_id")
        if account_kind == "sub":
            if isinstance(raw_upstream_user_id, bool):
                raise BackendError(400, "子账号 ID 必须为正整数")
            try:
                upstream_user_id = int(raw_upstream_user_id)
            except (TypeError, ValueError):
                raise BackendError(400, "子账号 ID 必须为正整数") from None
            if upstream_user_id <= 0:
                raise BackendError(400, "子账号 ID 必须为正整数")
        elif raw_upstream_user_id is not None and raw_upstream_user_id != "":
            raise BackendError(400, "主账号不能设置子账号 ID")
    elif (
        "upstream_user_id" in body
        and body.get("upstream_user_id") is not None
        and body.get("upstream_user_id") != ""
    ):
        raise BackendError(400, "请先选择账号类型")
    return (
        public_username,
        upstream_username,
        display_name,
        active,
        account_kind,
        upstream_user_id,
    )


def announcement_payload(row: DbRow) -> dict[str, Any]:
    published_at = row.get("published_at")
    return {
        "id": int(row["id"]),
        "title": str(row["title"]),
        "content": str(row["content"]),
        "published": bool(int(row["is_published"])),
        "createdAt": int(row["created_at"]),
        "updatedAt": int(row["updated_at"]),
        "publishedAt": int(published_at) if published_at is not None else None,
    }


def build_upload_tag(user_id: int, category: str, now: datetime | None = None) -> str:
    clean_category = category.strip().lower()
    if user_id <= 0 or not re.fullmatch(r"[a-z0-9_]{1,64}", clean_category):
        raise BackendError(400, "上传分类无效")
    current = now.astimezone(GYS_TIMEZONE) if now else datetime.now(GYS_TIMEZONE)
    return f"{user_id}-{clean_category}-{current.strftime('%H%M%S')}"


def quota_decimal(value: Any) -> Decimal:
    try:
        quota = Decimal(str(value or 0))
    except (InvalidOperation, TypeError, ValueError) as error:
        raise BackendError(502, "渠道消耗数据格式不正确") from error
    if not quota.is_finite():
        raise BackendError(502, "渠道消耗数据格式不正确")
    return quota


def quota_dollars(value: Decimal) -> str:
    return f"{value / Decimal(500_000):.4f}"


def dollar_amount(value: Decimal) -> str:
    return f"{value:.4f}"


def category_rates_payload(
    sub_account_user_id: int,
) -> dict[str, Any]:
    rates = store.category_rates(sub_account_user_id)
    settled_amounts = store.category_settled_amounts(sub_account_user_id)
    settlement_records = store.settlement_records(sub_account_user_id)
    return {
        "userId": sub_account_user_id,
        "rates": [
            {
                "category": category,
                "ratePercent": decimal_text(rates[category]),
                "settledAmount": dollar_amount(settled_amounts[category]),
            }
            for category in CHANNEL_USAGE_CATEGORIES
        ],
        "settlementRecords": [settlement_record_payload(record) for record in settlement_records],
    }


def settlement_record_payload(record: DbRow) -> dict[str, Any]:
    consumption_amount = Decimal(str(record["change_amount"]))
    return {
        "id": int(record["id"]),
        "category": str(record["category"]),
        "previousAmount": dollar_amount(Decimal(str(record["previous_amount"]))),
        "settledAmount": dollar_amount(Decimal(str(record["settled_amount"]))),
        "changeAmount": dollar_amount(consumption_amount),
        "consumptionAmount": dollar_amount(consumption_amount),
        "ratePercent": decimal_text(Decimal(str(record["rate_percent"]))),
        "settlementAmount": dollar_amount(Decimal(str(record["settlement_amount"]))),
        "createdAt": int(record["created_at"]),
    }


async def channel_model_usage(session: DbRow, channel_id: int) -> dict[str, Any]:
    page = 1
    loaded = 0
    models: dict[str, dict[str, Any]] = {}
    seen_log_ids: set[int] = set()
    request_count = 0
    while True:
        query = urlencode({"page": page, "page_size": 200, "type": 0})
        data = await authorized_json(session, f"/api/channels/{channel_id}/logs?{query}")
        if not isinstance(data, dict) or not isinstance(data.get("items"), list):
            raise BackendError(502, "模型消耗日志格式不正确，无法准确统计")
        try:
            total = int(data.get("total", 0))
            current_page = int(data.get("page", page))
            page_size = int(data.get("page_size", 200))
        except (TypeError, ValueError) as error:
            raise BackendError(502, "模型消耗日志分页不完整，请刷新重试") from error
        if total < 0 or current_page != page or page_size <= 0:
            raise BackendError(502, "模型消耗日志分页不完整，请刷新重试")
        page_items = data["items"]
        for log in page_items:
            if not isinstance(log, dict):
                raise BackendError(502, "模型消耗日志格式不正确，无法准确统计")
            raw_log_id = log.get("id")
            if raw_log_id is not None:
                try:
                    log_id = int(raw_log_id)
                except (TypeError, ValueError) as error:
                    raise BackendError(502, "模型消耗日志格式不正确，无法准确统计") from error
                if log_id in seen_log_ids:
                    continue
                seen_log_ids.add(log_id)
            model = str(log.get("model_name") or log.get("model") or "").strip()
            model_usage = models.setdefault(model, {"quota": Decimal(0), "requestCount": 0})
            model_usage["quota"] += quota_decimal(
                log.get("quota", log.get("used_quota", 0))
            )
            model_usage["requestCount"] += 1
            request_count += 1
        loaded += len(page_items)
        if loaded >= total:
            break
        if not page_items:
            raise BackendError(502, "模型消耗日志分页不完整，请刷新重试")
        page += 1
    return {
        "models": models,
        "quota": sum((item["quota"] for item in models.values()), Decimal(0)),
        "requestCount": request_count,
    }


async def sub_account_tag_usage(
    session: DbRow,
    target_id: int,
    requested_category: str | None,
) -> dict[str, Any]:
    category_filter = requested_category.strip().lower() if requested_category else ""
    if category_filter and category_filter not in CHANNEL_USAGE_CATEGORIES:
        raise BackendError(400, "渠道分类无效")
    category_filters = (category_filter,) if category_filter else CHANNEL_USAGE_CATEGORIES
    category_rates = store.category_rates(target_id)
    category_settled_amounts = store.category_settled_amounts(target_id)

    children = await authorized_json(session, "/api/sub-accounts")
    child_items = children if isinstance(children, list) else children.get("items", []) if isinstance(children, dict) else []
    source: dict[str, Any] | None = None
    for item in child_items if isinstance(child_items, list) else []:
        if not isinstance(item, dict):
            continue
        try:
            item_id = int(item.get("id", 0))
        except (TypeError, ValueError):
            continue
        if item_id == target_id:
            source = item
            break
    if source is None:
        raise BackendError(404, "子账号不存在")

    matching_tags: set[str] = set()
    seen_channel_ids: set[int] = set()
    channels: list[dict[str, Any]] = []

    async def load_category_channels(category: str) -> list[dict[str, Any]]:
        query_tag = f"{target_id}-{category}"
        category_channels: list[dict[str, Any]] = []
        page = 1
        loaded = 0
        while True:
            query = urlencode({"page": page, "page_size": 500, "tag": query_tag})
            data = await authorized_json(session, f"/api/channels?{query}")
            if not isinstance(data, dict) or not isinstance(data.get("items"), list):
                raise BackendError(502, "渠道数据格式不正确，无法准确统计")
            try:
                total = int(data.get("total", 0))
                current_page = int(data.get("page", page))
                page_size = int(data.get("page_size", 500))
            except (TypeError, ValueError) as error:
                raise BackendError(502, "渠道分页数据不完整，请刷新重试") from error
            if total < 0 or current_page != page or page_size <= 0:
                raise BackendError(502, "渠道分页数据不完整，请刷新重试")
            page_items = data["items"]
            for channel in page_items:
                if not isinstance(channel, dict):
                    raise BackendError(502, "渠道数据格式不正确，无法准确统计")
                tag = str(channel.get("tag") or "").strip()
                if tag != query_tag and not tag.startswith(f"{query_tag}-"):
                    continue
                channel_category = str(channel.get("category") or "").strip().lower()
                if channel_category != category:
                    continue
                try:
                    channel_id = int(channel.get("id"))
                except (TypeError, ValueError) as error:
                    raise BackendError(502, "渠道数据格式不正确，无法准确统计") from error
                category_channels.append(
                    {
                        "id": channel_id,
                        "category": channel_category,
                        "tag": tag,
                        "quota": quota_decimal(channel.get("used_quota", channel.get("quota", 0))),
                    }
                )
            loaded += len(page_items)
            if loaded >= total:
                break
            if not page_items:
                raise BackendError(502, "渠道分页数据不完整，请刷新重试")
            page += 1
        return category_channels

    category_channel_results = await asyncio.gather(
        *(load_category_channels(category) for category in category_filters)
    )
    for category_channels in category_channel_results:
        for channel in category_channels:
            if channel["id"] in seen_channel_ids:
                continue
            seen_channel_ids.add(channel["id"])
            matching_tags.add(channel["tag"])
            channels.append(channel)

    semaphore = asyncio.Semaphore(4)

    async def load_model_usage(channel: dict[str, Any]) -> tuple[dict[str, Any], dict[str, Any]]:
        async with semaphore:
            usage = await channel_model_usage(session, channel["id"])
        return channel, usage

    usage_results = await asyncio.gather(*(load_model_usage(channel) for channel in channels))
    grouped: dict[tuple[str, str], dict[str, Any]] = {}
    categories: dict[str, dict[str, Any]] = {
        category: {
            "category": category,
            "quota": Decimal(0),
            "channelIds": set(),
            "tags": set(),
            "models": set(),
            "requestCount": 0,
        }
        for category in category_filters
    }
    total_quota = Decimal(0)
    total_requests = 0

    def add_usage(
        channel: dict[str, Any],
        model: str,
        quota: Decimal,
        request_count: int,
    ) -> None:
        key = (channel["category"], model)
        group = grouped.setdefault(
            key,
            {
                "category": channel["category"],
                "model": model,
                "quota": Decimal(0),
                "channelIds": set(),
                "tags": set(),
                "requestCount": 0,
            },
        )
        group["quota"] += quota
        group["channelIds"].add(channel["id"])
        group["tags"].add(channel["tag"])
        group["requestCount"] += request_count

    for channel, usage in usage_results:
        logged_quota = usage["quota"]
        channel_quota = channel["quota"]
        effective_quota = max(channel_quota, logged_quota)
        total_quota += effective_quota
        total_requests += usage["requestCount"]
        category = categories.setdefault(
            channel["category"],
            {
                "category": channel["category"],
                "quota": Decimal(0),
                "channelIds": set(),
                "tags": set(),
                "models": set(),
                "requestCount": 0,
            },
        )
        category["quota"] += effective_quota
        category["channelIds"].add(channel["id"])
        category["tags"].add(channel["tag"])
        category["requestCount"] += usage["requestCount"]
        for model, model_usage in usage["models"].items():
            add_usage(
                channel,
                model,
                model_usage["quota"],
                model_usage["requestCount"],
            )
            category["models"].add(model)
        unattributed = max(Decimal(0), channel_quota - logged_quota)
        if unattributed:
            add_usage(channel, "", unattributed, 0)
            category["models"].add("")

    rows = sorted(grouped.values(), key=lambda item: (-item["quota"], item["category"], item["model"]))
    category_rows = [categories[category] for category in category_filters]
    listed_quota = quota_decimal(source.get("used_quota")) if "used_quota" in source else None
    total_payable_amount = sum(
        (
            Decimal(quota_dollars(category["quota"]))
            - category_settled_amounts[category["category"]]
        )
        * category_rates[category["category"]]
        / Decimal(100)
        for category in category_rows
    )
    return {
        "totalAmount": quota_dollars(total_quota),
        "totalPayableAmount": dollar_amount(total_payable_amount),
        "listedAmount": quota_dollars(listed_quota) if listed_quota is not None else None,
        "amountsDiffer": listed_quota is not None and listed_quota != total_quota,
        "channelCount": len(seen_channel_ids),
        "tagCount": len(matching_tags),
        "platformCount": sum(1 for category in category_rows if category["channelIds"]),
        "modelCount": len(rows),
        "requestCount": total_requests,
        "queryPrefix": (
            f"{target_id}-{category_filters[0]}"
            if len(category_filters) == 1
            else f"{target_id}-{{category}}"
        ),
        "categories": [
            {
                "category": category["category"],
                "channelCount": len(category["channelIds"]),
                "tagCount": len(category["tags"]),
                "modelCount": len(category["models"]),
                "requestCount": category["requestCount"],
                "ratePercent": decimal_text(category_rates[category["category"]]),
                "amount": quota_dollars(category["quota"]),
                "settledAmount": dollar_amount(
                    category_settled_amounts[category["category"]]
                ),
                "payableAmount": dollar_amount(
                    (
                        Decimal(quota_dollars(category["quota"]))
                        - category_settled_amounts[category["category"]]
                    )
                    * category_rates[category["category"]]
                    / Decimal(100)
                ),
            }
            for category in category_rows
        ],
        "rows": [
            {
                "category": row["category"],
                "model": row["model"],
                "channelCount": len(row["channelIds"]),
                "tagCount": len(row["tags"]),
                "requestCount": row["requestCount"],
                "amount": quota_dollars(row["quota"]),
                "sharePercent": f"{(row['quota'] / total_quota * 100) if total_quota else 0:.2f}",
            }
            for row in rows
        ],
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
    session: DbRow,
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
    session: DbRow,
    path: str,
    *,
    method: str = "GET",
    body: dict[str, Any] | None = None,
) -> Any:
    response, payload = await upstream_raw(session, path, method=method, body=body)
    return unwrap(response, payload)


async def authorized_json(
    session: DbRow,
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


async def cached_model_gaps(session: DbRow) -> Any:
    stale_payload: Any | None = None
    cold_cache_deadline = time.monotonic() + MODEL_GAPS_REFRESH_LEASE_MS / 1000

    while True:
        now = int(time.time() * 1000)
        payload, refreshed_at, _ = store.read_shared_cache(MODEL_GAPS_CACHE_KEY)
        if payload is not None and refreshed_at > now - MODEL_GAPS_CACHE_TTL_MS:
            return payload
        if payload is not None:
            stale_payload = payload

        owner = store.claim_shared_cache_refresh(
            MODEL_GAPS_CACHE_KEY,
            now - MODEL_GAPS_CACHE_TTL_MS,
            MODEL_GAPS_REFRESH_LEASE_MS,
        )
        if owner is not None:
            try:
                fresh_payload = sanitize_data(
                    await authorized_json(session, "/api/model-gaps")
                )
                if store.save_shared_cache(
                    MODEL_GAPS_CACHE_KEY,
                    owner,
                    fresh_payload,
                ):
                    return fresh_payload
                latest_payload, _, _ = store.read_shared_cache(MODEL_GAPS_CACHE_KEY)
                return latest_payload if latest_payload is not None else fresh_payload
            except Exception:
                store.release_shared_cache_refresh(MODEL_GAPS_CACHE_KEY, owner)
                if stale_payload is not None:
                    return stale_payload
                raise

        latest_payload, latest_refreshed_at, _ = store.read_shared_cache(
            MODEL_GAPS_CACHE_KEY
        )
        latest_now = int(time.time() * 1000)
        if (
            latest_payload is not None
            and latest_refreshed_at > latest_now - MODEL_GAPS_CACHE_TTL_MS
        ):
            return latest_payload
        if latest_payload is not None:
            stale_payload = latest_payload
        if stale_payload is not None:
            return stale_payload
        if time.monotonic() >= cold_cache_deadline:
            raise BackendError(503, "模型缺口数据正在更新，请稍后重试")
        await asyncio.sleep(0.2)


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
            local_session = store.create_local_session(username, password)
            if local_session is not None:
                old_session = session
                token, session = local_session
                store.delete(old_session)
                return success_response(
                    request,
                    request_id,
                    public_profile(session),
                    (token, 7 * 86_400),
                )
            upstream_username = store.resolve_login_username(username)
            if session is None or session["authenticated"]:
                token, session = store.create_session()
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
            latest = store.current(session)
            old_session = session
            token, session, parsed = store.create_authenticated_upstream_session(
                username,
                upstream_username,
                profile if isinstance(profile, dict) else None,
                latest["cookies"],
            )
            store.delete(old_session)
            return success_response(request, request_id, parsed, (token, 7 * 86_400))

        if path == "/api/auth/logout" and request.method == "POST":
            store.delete(session)
            return success_response(request, request_id, {"message": "已退出登录"}, ("", 0))

        if session is None or not session["authenticated"]:
            raise BackendError(401, "请重新登录账号")
        cookie = (token, store.touch(session))

        if path == "/api/auth/profile" and request.method == "GET":
            if session.get("auth_source") == LOCAL_AUTH_SOURCE:
                return success_response(request, request_id, public_profile(session), cookie)
            profile = await authorized_json(session, path)
            data = store.save_profile(session, profile) if isinstance(profile, dict) else public_profile(session)
            return success_response(request, request_id, data, cookie)

        if path == "/api/auth/refresh" and request.method == "POST":
            if session.get("auth_source") == LOCAL_AUTH_SOURCE:
                return success_response(request, request_id, public_profile(session), cookie)
            await upstream_json(session, path, method="POST", body={})
            profile = await upstream_json(session, "/api/auth/profile")
            data = store.save_profile(session, profile) if isinstance(profile, dict) else public_profile(session)
            return success_response(request, request_id, data, cookie)

        if path == "/api/model-gaps" and request.method == "GET":
            refresh = request.query_params.get("refresh")
            if refresh not in {None, "1", "true"}:
                raise BackendError(400, "刷新参数无效")
            for field in ("user_id", "supplier_id", "uploader_id", "upstream_id"):
                if field in request.query_params:
                    raise BackendError(400, "不允许指定数据账号")
            if session.get("auth_source") == LOCAL_AUTH_SOURCE:
                assert_super_admin(session)
                cached_payload, _, _ = store.read_shared_cache(MODEL_GAPS_CACHE_KEY)
                if cached_payload is None:
                    raise BackendError(503, "模型缺口数据尚未缓存，请稍后重试")
                return success_response(
                    request,
                    request_id,
                    cached_payload,
                    cookie,
                )
            return success_response(
                request,
                request_id,
                await cached_model_gaps(session),
                cookie,
            )

        if path == "/api/announcements" and request.method == "GET":
            rows = store.announcements(published_only=True)
            return success_response(
                request,
                request_id,
                {
                    "items": [announcement_payload(row) for row in rows],
                    "total": len(rows),
                },
                cookie,
            )

        if path == "/api/announcement-management" and request.method in {"GET", "POST"}:
            assert_announcement_admin(session)
            if request.method == "GET":
                rows = store.announcements(published_only=False)
                return success_response(
                    request,
                    request_id,
                    {
                        "items": [announcement_payload(row) for row in rows],
                        "total": len(rows),
                    },
                    cookie,
                )

            actor = public_profile(session)
            if not store.within_limit(
                f"announcement-publish:{session.get('auth_source')}:{actor['user_id']}",
                30,
                60_000,
            ):
                raise BackendError(429, "公告发布过于频繁，请稍后重试")
            body = await read_body(request)
            title = body.get("title")
            content = body.get("content")
            title = title.strip() if isinstance(title, str) else ""
            content = content.strip() if isinstance(content, str) else ""
            if not title or len(title) > 120:
                raise BackendError(400, "公告标题须为 1 至 120 个字符")
            if not content or len(content) > 5_000:
                raise BackendError(400, "公告内容须为 1 至 5000 个字符")
            row = store.create_announcement(
                title,
                content,
                int(actor["user_id"]),
                str(actor["username"]),
            )
            return success_response(
                request,
                request_id,
                announcement_payload(row),
                cookie,
            )

        announcement_match = re.fullmatch(r"/api/announcement-management/(\d+)", path)
        if announcement_match and request.method in {"PATCH", "DELETE"}:
            assert_announcement_admin(session)
            announcement_id = int(announcement_match.group(1))
            if announcement_id <= 0:
                raise BackendError(400, "公告 ID 无效")
            if request.method == "DELETE":
                store.delete_announcement(announcement_id)
                return success_response(
                    request,
                    request_id,
                    {"id": announcement_id, "message": "公告已删除"},
                    cookie,
                )

            body = await read_body(request)
            published = body.get("published")
            if not isinstance(published, bool):
                raise BackendError(400, "公告发布状态无效")
            row = store.set_announcement_published(announcement_id, published)
            return success_response(
                request,
                request_id,
                announcement_payload(row),
                cookie,
            )

        if path == "/api/user-mappings" and request.method in {"GET", "POST"}:
            assert_super_admin(session)
            if request.method == "GET":
                rows = store.account_mappings()
                return success_response(
                    request,
                    request_id,
                    {
                        "items": [account_mapping_payload(row) for row in rows],
                        "total": len(rows),
                    },
                    cookie,
                )

            body = await read_body(request)
            (
                public_username,
                upstream_username,
                display_name,
                _,
                account_kind,
                upstream_user_id,
            ) = (
                parse_account_mapping_body(body, require_active=False)
            )
            row = store.create_account_mapping(
                public_username,
                upstream_username,
                display_name,
                account_kind or "primary",
                upstream_user_id,
            )
            return success_response(
                request,
                request_id,
                account_mapping_payload(row),
                cookie,
            )

        mapping_match = re.fullmatch(r"/api/user-mappings/([A-Za-z0-9_.-]{3,64})", path)
        if mapping_match and request.method == "PUT":
            assert_super_admin(session)
            body = await read_body(request)
            (
                public_username,
                upstream_username,
                display_name,
                active,
                account_kind,
                upstream_user_id,
            ) = (
                parse_account_mapping_body(body, require_active=True)
            )
            row = store.update_account_mapping(
                mapping_match.group(1),
                public_username,
                upstream_username,
                display_name,
                active,
                account_kind,
                upstream_user_id,
            )
            return success_response(
                request,
                request_id,
                account_mapping_payload(row),
                cookie,
            )

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
            if session.get("auth_source") == LOCAL_AUTH_SOURCE:
                local_account_id = session.get("local_account_id")
                if not local_account_id:
                    raise BackendError(401, "请重新登录账号")
                store.change_local_password(
                    int(local_account_id),
                    old_password,
                    new_password,
                )
                return success_response(
                    request,
                    request_id,
                    {"message": "密码修改成功"},
                    ("", 0),
                )
            data = await authorized_json(session, path, method="POST", body=body)
            return success_response(request, request_id, sanitize_data(data), cookie)

        if session.get("auth_source") == LOCAL_AUTH_SOURCE:
            raise BackendError(403, "超级管理员无权访问此功能")

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
            upstream_username = body.get("gys_username")
            display_name = body.get("display_name")
            password = body.get("password")
            upstream_username = (
                upstream_username.strip() if isinstance(upstream_username, str) else ""
            )
            display_name = display_name.strip() if isinstance(display_name, str) else ""
            password = password if isinstance(password, str) else ""
            if not re.fullmatch(r"[A-Za-z0-9_.-]{3,64}", upstream_username):
                raise BackendError(400, "GYS用户名须为3至64位字母、数字、点、横线或下划线")
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
            public_data = (
                store.publicize_sub_account(data)
                if isinstance(data, dict)
                else data
            )
            return success_response(request, request_id, sanitize_data(public_data), cookie)

        sub_account_match = re.fullmatch(r"/api/sub-accounts/(\d+)", path)
        if sub_account_match and request.method in {"PUT", "DELETE"}:
            if session["role"] not in {"supplier", "admin"}:
                raise BackendError(403, "当前账号无权管理子账号")
            target_id = int(sub_account_match.group(1))
            if target_id <= 0:
                raise BackendError(400, "子账号 ID 无效")
            if request.method == "DELETE":
                data = await authorized_json(session, path, method="DELETE")
                store.delete_category_rates(target_id)
                store.delete_sub_account_alias(target_id)
                return success_response(request, request_id, sanitize_data(data), cookie)

            body = await read_body(request)
            display_name = body.get("display_name")
            status = body.get("status")
            password = body.get("password")
            display_name = display_name.strip() if isinstance(display_name, str) else ""
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
            data = await authorized_json(session, path, method="PUT", body=update_body)
            return success_response(request, request_id, sanitize_data(data), cookie)

        rates_match = re.fullmatch(r"/api/sub-accounts/(\d+)/category-rates", path)
        if rates_match and request.method in {"GET", "PUT"}:
            if session["role"] not in {"supplier", "admin"}:
                raise BackendError(403, "当前账号无权设置子账号汇率")
            target_id = int(rates_match.group(1))
            if target_id <= 0:
                raise BackendError(400, "子账号 ID 无效")
            if request.method == "GET":
                return success_response(
                    request,
                    request_id,
                    category_rates_payload(target_id),
                    cookie,
                )

            body = await read_body(request)
            raw_rates = body.get("rates")
            if not isinstance(raw_rates, dict) or set(raw_rates) != set(CHANNEL_USAGE_CATEGORIES):
                raise BackendError(400, "请完整填写全部渠道分类汇率")
            parsed_rates: dict[str, Decimal] = {}
            for category in CHANNEL_USAGE_CATEGORIES:
                raw_value = raw_rates.get(category)
                if isinstance(raw_value, bool) or not isinstance(raw_value, (int, float, str)):
                    raise BackendError(400, f"{category} 汇率格式不正确")
                try:
                    value = Decimal(str(raw_value).strip())
                except (InvalidOperation, ValueError) as error:
                    raise BackendError(400, f"{category} 汇率格式不正确") from error
                if not value.is_finite() or value < 0 or value > Decimal("100000"):
                    raise BackendError(400, f"{category} 汇率须在 0% 至 100000% 之间")
                parsed_rates[category] = value
            store.save_category_rates(target_id, parsed_rates)
            return success_response(
                request,
                request_id,
                category_rates_payload(target_id),
                cookie,
            )

        settlement_match = re.fullmatch(r"/api/sub-accounts/(\d+)/settlements", path)
        if settlement_match and request.method == "POST":
            if session["role"] not in {"supplier", "admin"}:
                raise BackendError(403, "当前账号无权结算子账号消耗")
            target_id = int(settlement_match.group(1))
            if target_id <= 0:
                raise BackendError(400, "子账号 ID 无效")
            body = await read_body(request)
            category = body.get("category")
            category = category.strip().lower() if isinstance(category, str) else ""
            if category not in CHANNEL_USAGE_CATEGORIES:
                raise BackendError(400, "渠道分类无效")
            raw_consumption_amount = body.get("consumptionAmount")
            if (
                isinstance(raw_consumption_amount, bool)
                or not isinstance(raw_consumption_amount, (int, float, str))
            ):
                raise BackendError(400, "本次结算消耗额度格式不正确")
            try:
                consumption_amount = Decimal(str(raw_consumption_amount).strip())
            except (InvalidOperation, ValueError) as error:
                raise BackendError(400, "本次结算消耗额度格式不正确") from error
            if (
                not consumption_amount.is_finite()
                or consumption_amount <= 0
                or consumption_amount > Decimal("1000000000000")
            ):
                raise BackendError(400, "本次结算消耗额度必须大于 0")
            if consumption_amount.normalize().as_tuple().exponent < -4:
                raise BackendError(400, "本次结算消耗额度最多保留 4 位小数")

            usage = await sub_account_tag_usage(session, target_id, category)
            category_usage = next(
                (
                    item
                    for item in usage.get("categories", [])
                    if isinstance(item, dict) and item.get("category") == category
                ),
                None,
            )
            if category_usage is None:
                raise BackendError(502, "渠道分类消耗数据不完整，请刷新后重试")
            try:
                total_usage_amount = Decimal(str(category_usage.get("amount", "0")))
            except (InvalidOperation, ValueError) as error:
                raise BackendError(502, "渠道分类消耗数据格式不正确") from error
            record = store.record_settlement(
                target_id,
                category,
                consumption_amount,
                total_usage_amount,
            )
            settled_amount = Decimal(str(record["settled_amount"]))
            rate_percent = Decimal(str(record["rate_percent"]))
            outstanding_amount = max(Decimal(0), total_usage_amount - settled_amount)
            return success_response(
                request,
                request_id,
                {
                    "settlement": settlement_record_payload(record),
                    "category": {
                        "category": category,
                        "totalAmount": dollar_amount(total_usage_amount),
                        "settledAmount": dollar_amount(settled_amount),
                        "outstandingAmount": dollar_amount(outstanding_amount),
                        "ratePercent": decimal_text(rate_percent),
                        "payableAmount": dollar_amount(
                            outstanding_amount * rate_percent / Decimal(100)
                        ),
                    },
                },
                cookie,
            )

        usage_match = re.fullmatch(r"/api/sub-accounts/(\d+)/tag-usage", path)
        if usage_match and request.method == "GET":
            if session["role"] not in {"supplier", "admin"}:
                raise BackendError(403, "当前账号无权查看子账号消耗")
            target_id = int(usage_match.group(1))
            if target_id <= 0:
                raise BackendError(400, "子账号 ID 无效")
            category = request.query_params.get("category")
            data = await sub_account_tag_usage(session, target_id, category)
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
        assigned_tag: str | None = None
        if request.method == "POST" and path in {"/api/channels", "/api/channels/batch"}:
            category = body.get("category") if body is not None else None
            if not isinstance(category, str):
                raise BackendError(400, "上传分类无效")
            try:
                user_id = int(session["upstream_user_id"])
            except (TypeError, ValueError) as error:
                raise BackendError(401, "用户身份无效，请重新登录") from error
            assigned_tag = build_upload_tag(user_id, category)
            body = {**body, "tag": assigned_tag}
        full_path = path + (f"?{request.url.query}" if request.url.query else "")
        data = await authorized_json(session, full_path, method=request.method, body=body)

        if assigned_tag and isinstance(data, dict):
            data = {**data, "tag": assigned_tag}

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
