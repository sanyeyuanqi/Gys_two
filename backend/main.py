from __future__ import annotations

import asyncio
import hashlib
import json
import logging
import os
import re
import secrets
import socket
import threading
import time
import uuid
from contextlib import asynccontextmanager, contextmanager
from datetime import datetime
from decimal import Decimal, InvalidOperation, localcontext
from pathlib import Path
from typing import Any, Iterator
from urllib.parse import urlencode
from zoneinfo import ZoneInfo

import httpx
import psycopg
from cryptography.fernet import Fernet, InvalidToken
from dotenv import load_dotenv
from fastapi import FastAPI, Request
from fastapi.responses import JSONResponse
from psycopg.rows import dict_row


PROJECT_ROOT = Path(__file__).resolve().parent.parent
load_dotenv(PROJECT_ROOT / ".env")


UPSTREAM_ORIGIN = "https://gys.oljuxj.xyz"
COOKIE_NAME = "key_system_session"
SESSION_COOKIE_CIPHER_PREFIX = "fernet:v1:"
SESSION_COOKIE_KEY_PATH = PROJECT_ROOT / ".gys-backend" / "session-cookie.key"
DAY_MS = 86_400_000
MODEL_GAPS_CACHE_KEY = "model-gaps:v1"
MODEL_GAPS_CACHE_TTL_MS = 3 * 60_000
MODEL_GAPS_REFRESH_LEASE_MS = 75_000
CHANNEL_SUMMARY_REFRESH_CACHE_KEY = "channel-summaries-refresh:v1"
CHANNEL_SUMMARY_REFRESH_INTERVAL_MS = 3 * 60_000
CHANNEL_SUMMARY_REFRESH_LEASE_MS = 10 * 60_000
CHANNEL_SUMMARY_TOTAL_CATEGORY = "__total__"
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


def channel_summary_amount(value: Decimal) -> str:
    with localcontext() as context:
        context.prec = 64
        return f"{value / Decimal(500_000):.2f}"


DbRow = dict[str, Any]


def load_session_cookie_cipher() -> Fernet:
    encoded_key = os.environ.get("SESSION_COOKIE_ENCRYPTION_KEY", "").strip()
    if not encoded_key:
        try:
            encoded_key = SESSION_COOKIE_KEY_PATH.read_text(encoding="ascii").strip()
        except FileNotFoundError:
            SESSION_COOKIE_KEY_PATH.parent.mkdir(parents=True, exist_ok=True)
            generated_key = Fernet.generate_key().decode("ascii")
            try:
                descriptor = os.open(
                    SESSION_COOKIE_KEY_PATH,
                    os.O_WRONLY | os.O_CREAT | os.O_EXCL,
                    0o600,
                )
            except FileExistsError:
                encoded_key = SESSION_COOKIE_KEY_PATH.read_text(encoding="ascii").strip()
            else:
                with os.fdopen(descriptor, "w", encoding="ascii") as target:
                    target.write(generated_key)
                encoded_key = generated_key
        except OSError as error:
            raise RuntimeError(
                "SESSION_COOKIE_ENCRYPTION_KEY is required when the local key file is unavailable"
            ) from error
    try:
        return Fernet(encoded_key.encode("ascii"))
    except (ValueError, UnicodeEncodeError) as error:
        raise RuntimeError("SESSION_COOKIE_ENCRYPTION_KEY is invalid") from error


SESSION_COOKIE_CIPHER = load_session_cookie_cipher()


def unprotect_session_cookies(value: str) -> str:
    if not value.startswith(SESSION_COOKIE_CIPHER_PREFIX):
        return value
    encrypted = value.removeprefix(SESSION_COOKIE_CIPHER_PREFIX)
    try:
        return SESSION_COOKIE_CIPHER.decrypt(encrypted.encode("ascii")).decode("utf-8")
    except (InvalidToken, UnicodeDecodeError, UnicodeEncodeError) as error:
        raise RuntimeError("Stored upstream Cookie cannot be decrypted") from error


def protect_session_cookies(value: str) -> str:
    if value.startswith(SESSION_COOKIE_CIPHER_PREFIX):
        unprotect_session_cookies(value)
        return value
    plaintext = unprotect_session_cookies(value)
    encrypted = SESSION_COOKIE_CIPHER.encrypt(plaintext.encode("utf-8")).decode("ascii")
    return f"{SESSION_COOKIE_CIPHER_PREFIX}{encrypted}"


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


def channel_summary_decimal(value: Any, field_name: str) -> Decimal:
    if isinstance(value, bool) or not isinstance(value, (int, float, str)):
        raise BackendError(502, f"渠道汇总的{field_name}格式不正确")
    try:
        parsed = Decimal(str(value).strip())
    except (InvalidOperation, ValueError) as error:
        raise BackendError(502, f"渠道汇总的{field_name}格式不正确") from error
    if (
        not parsed.is_finite()
        or parsed < 0
        or parsed >= Decimal("1e44")
        or parsed.normalize().as_tuple().exponent < -6
    ):
        raise BackendError(502, f"渠道汇总的{field_name}格式不正确")
    return parsed


def channel_summary_integer(value: Any, field_name: str) -> int:
    parsed = channel_summary_decimal(value, field_name)
    if parsed != parsed.to_integral_value() or parsed > Decimal(9_223_372_036_854_775_807):
        raise BackendError(502, f"渠道汇总的{field_name}格式不正确")
    return int(parsed)


def normalize_channel_summary(data: Any) -> dict[str, Any]:
    if not isinstance(data, dict) or not isinstance(data.get("categories"), list):
        raise BackendError(502, "渠道汇总数据格式不正确")
    if len(data["categories"]) > 256:
        raise BackendError(502, "渠道汇总分类数量异常")

    normalized_categories: list[dict[str, Any]] = []
    seen_categories: set[str] = set()
    for raw_category in data["categories"]:
        if not isinstance(raw_category, dict):
            raise BackendError(502, "渠道汇总分类格式不正确")
        category = raw_category.get("category")
        category = category.strip().lower() if isinstance(category, str) else ""
        if (
            not re.fullmatch(r"[a-z0-9][a-z0-9_.-]{0,63}", category)
            or category == CHANNEL_SUMMARY_TOTAL_CATEGORY
            or category in seen_categories
        ):
            raise BackendError(502, "渠道汇总分类格式不正确")
        seen_categories.add(category)
        row_count = channel_summary_integer(raw_category.get("rows", 0), "渠道数量")
        alive_rows = channel_summary_integer(
            raw_category.get("alive_rows", 0),
            "启用渠道数量",
        )
        if alive_rows > row_count:
            raise BackendError(502, "渠道汇总的启用渠道数量格式不正确")
        normalized_categories.append(
            {
                "category": category,
                "quota": channel_summary_decimal(raw_category.get("quota", 0), "消耗额度"),
                "rows": row_count,
                "alive_rows": alive_rows,
            }
        )

    count = channel_summary_integer(data.get("count"), "渠道总数")
    if count > 0 and not normalized_categories:
        raise BackendError(502, "渠道汇总分类数据不完整")
    return {
        "count": count,
        "total_quota": channel_summary_decimal(data.get("total_quota"), "总消耗额度"),
        "categories": normalized_categories,
    }


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
                now = int(time.time() * 1000)
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
                        cookie_updated_at BIGINT NOT NULL DEFAULT 0,
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
                    CREATE TABLE IF NOT EXISTS channel_summary_snapshots (
                        upstream_user_id BIGINT NOT NULL,
                        public_username CITEXT NOT NULL,
                        category TEXT NOT NULL,
                        quota NUMERIC(50, 6) NOT NULL DEFAULT 0,
                        row_count BIGINT NOT NULL DEFAULT 0,
                        alive_rows BIGINT NOT NULL DEFAULT 0,
                        refreshed_at BIGINT NOT NULL,
                        snapshot_id TEXT NOT NULL,
                        PRIMARY KEY (upstream_user_id, category)
                    )
                    """,
                    """
                    CREATE INDEX IF NOT EXISTS idx_channel_summary_snapshots_username
                    ON channel_summary_snapshots(public_username, refreshed_at DESC)
                    """,
                    """
                    CREATE TABLE IF NOT EXISTS announcements (
                        id BIGSERIAL PRIMARY KEY,
                        title TEXT NOT NULL,
                        content TEXT NOT NULL,
                        title_en TEXT NOT NULL DEFAULT '',
                        content_en TEXT NOT NULL DEFAULT '',
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
                    CREATE TABLE IF NOT EXISTS settlement_transaction_ids (
                        transaction_id TEXT PRIMARY KEY
                    )
                    """,
                    """
                    CREATE TABLE IF NOT EXISTS sub_account_sequences (
                        parent_upstream_user_id BIGINT PRIMARY KEY,
                        last_number BIGINT NOT NULL DEFAULT 0
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
                    ALTER TABLE category_settlement_records
                    ADD COLUMN IF NOT EXISTS transaction_id TEXT
                    """,
                    """
                    ALTER TABLE category_settlement_records
                    ADD COLUMN IF NOT EXISTS payer_json TEXT
                    """,
                    """
                    ALTER TABLE category_settlement_records
                    ADD COLUMN IF NOT EXISTS payee_json TEXT
                    """,
                    """
                    CREATE INDEX IF NOT EXISTS idx_settlement_transaction
                    ON category_settlement_records(sub_account_user_id, transaction_id)
                    """,
                    """
                    ALTER TABLE upstream_sessions
                    ADD COLUMN IF NOT EXISTS local_account_id BIGINT
                    """,
                    """
                    ALTER TABLE account_aliases
                    ADD COLUMN IF NOT EXISTS parent_upstream_user_id BIGINT
                    """,
                    """
                    ALTER TABLE account_aliases
                    ADD COLUMN IF NOT EXISTS sync_enabled BOOLEAN NOT NULL DEFAULT TRUE
                    """,
                    """
                    ALTER TABLE upstream_sessions
                    ADD COLUMN IF NOT EXISTS auth_source TEXT NOT NULL DEFAULT 'upstream'
                    """,
                    """
                    ALTER TABLE upstream_sessions
                    ADD COLUMN IF NOT EXISTS cookie_updated_at BIGINT NOT NULL DEFAULT 0
                    """,
                    """
                    ALTER TABLE announcements
                    ADD COLUMN IF NOT EXISTS title_en TEXT NOT NULL DEFAULT ''
                    """,
                    """
                    ALTER TABLE announcements
                    ADD COLUMN IF NOT EXISTS content_en TEXT NOT NULL DEFAULT ''
                    """,
                    """
                    CREATE INDEX IF NOT EXISTS idx_upstream_sessions_local_account
                    ON upstream_sessions(local_account_id)
                    """,
                    """
                    CREATE INDEX IF NOT EXISTS idx_upstream_sessions_upstream_user
                    ON upstream_sessions(upstream_user_id)
                    """,
                    """
                    UPDATE upstream_sessions
                    SET cookie_updated_at = created_at
                    WHERE cookie_updated_at = 0
                      AND auth_source = 'upstream'
                      AND authenticated = 1
                    """,
                ):
                    self.connection.execute(statement)
                self.connection.execute(
                    """
                    DELETE FROM upstream_sessions
                    WHERE expires_at <= ? OR created_at + ? <= ?
                    """,
                    (now, 30 * DAY_MS, now),
                )
                stored_cookie_rows = self.connection.execute(
                    """
                    SELECT token_hash, cookies
                    FROM upstream_sessions
                    WHERE auth_source = 'upstream'
                    """
                ).fetchall()
                for stored_cookie_row in stored_cookie_rows:
                    stored_value = str(stored_cookie_row["cookies"])
                    protected_value = protect_session_cookies(stored_value)
                    if protected_value != stored_value:
                        self.connection.execute(
                            "UPDATE upstream_sessions SET cookies = ? WHERE token_hash = ?",
                            (protected_value, stored_cookie_row["token_hash"]),
                        )
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
                          AND (
                            aliases.upstream_user_id IS NULL
                            OR aliases.upstream_user_id = sessions.upstream_user_id
                          )
                        )
                      )
                    """
                )
                self.connection.execute(
                    """
                    UPDATE account_aliases AS aliases
                    SET upstream_user_id = recent.upstream_user_id,
                        updated_at = GREATEST(aliases.updated_at, recent.created_at)
                    FROM (
                        SELECT DISTINCT ON (username::citext)
                               username::citext AS public_username,
                               upstream_user_id,
                               created_at
                        FROM upstream_sessions
                        WHERE auth_source = 'upstream'
                          AND authenticated = 1
                          AND upstream_user_id IS NOT NULL
                          AND role IN ('admin', 'supplier')
                          AND expires_at > ?
                          AND created_at + ? > ?
                        ORDER BY username::citext, created_at DESC
                    ) AS recent
                    WHERE aliases.account_kind = 'primary'
                      AND aliases.active = 1
                      AND aliases.upstream_user_id IS NULL
                      AND aliases.public_username = recent.public_username
                    """,
                    (now, 30 * DAY_MS, now),
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
            protect_session_cookies(cookies),
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
                    FOR UPDATE
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
                if (
                    str(alias["account_kind"]) == "primary"
                    and alias.get("upstream_user_id") is None
                ):
                    self.connection.execute(
                        """
                        UPDATE account_aliases
                        SET upstream_user_id = ?, updated_at = ?
                        WHERE public_username = ? AND upstream_user_id IS NULL
                        """,
                        (parsed["id"], now, alias["public_username"]),
                    )
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
                         cookies, cookie_updated_at, auth_source, authenticated,
                         created_at, expires_at)
                    VALUES (?, ?, ?, ?, ?, ?, ?, 'upstream', 1, ?, ?)
                    """,
                    (
                        self.token_hash(token),
                        parsed["id"],
                        parsed["username"],
                        parsed["display_name"],
                        parsed["role"],
                        protect_session_cookies(cookies),
                        now,
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
            if role_name not in {"admin", "supplier"}:
                return False
            mapped_user_id = alias.get("upstream_user_id")
            if mapped_user_id is None:
                return True
            try:
                return upstream_user_id is not None and int(mapped_user_id) == int(upstream_user_id)
            except (TypeError, ValueError):
                return False
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
        if row is None:
            raise BackendError(401, "登录状态已失效，请重新登录")
        return dict(row)

    def save_cookies(
        self,
        session: DbRow,
        cookies: str,
        expected_cookie_updated_at: int,
    ) -> bool:
        cookie_updated_at = max(
            int(time.time() * 1000),
            expected_cookie_updated_at + 1,
        )
        with self.lock:
            row = self.connection.execute(
                """
                UPDATE upstream_sessions
                SET cookies = ?, cookie_updated_at = ?
                WHERE token_hash = ?
                  AND auth_source = 'upstream'
                  AND cookie_updated_at = ?
                RETURNING token_hash
                """,
                (
                    protect_session_cookies(cookies),
                    cookie_updated_at,
                    session["token_hash"],
                    expected_cookie_updated_at,
                ),
            ).fetchone()
            self.connection.commit()
        return row is not None

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

    def active_channel_summary_sessions(self) -> list[DbRow]:
        now = int(time.time() * 1000)
        with self.lock:
            rows = self.connection.execute(
                """
                SELECT DISTINCT ON (sessions.upstream_user_id) sessions.*
                FROM upstream_sessions AS sessions
                JOIN account_aliases AS aliases
                  ON aliases.public_username = sessions.username
                WHERE sessions.auth_source = 'upstream'
                  AND sessions.authenticated = 1
                  AND sessions.upstream_user_id IS NOT NULL
                  AND sessions.cookie_updated_at > 0
                  AND sessions.expires_at > ?
                  AND aliases.active = 1
                  AND (
                    (
                      aliases.account_kind = 'sub'
                      AND aliases.upstream_user_id = sessions.upstream_user_id
                      AND sessions.role = 'sub'
                    )
                    OR (
                      aliases.account_kind = 'primary'
                      AND sessions.role IN ('admin', 'supplier')
                      AND (
                        aliases.upstream_user_id IS NULL
                        OR aliases.upstream_user_id = sessions.upstream_user_id
                      )
                    )
                  )
                ORDER BY sessions.upstream_user_id,
                         sessions.cookie_updated_at DESC,
                         sessions.created_at DESC,
                         sessions.expires_at DESC
                """,
                (now,),
            ).fetchall()
        return [dict(row) for row in rows]

    def active_channel_summary_session(self, session: DbRow) -> DbRow | None:
        token_hash = str(session.get("token_hash") or "")
        if not re.fullmatch(r"[0-9a-f]{64}", token_hash):
            return None
        now = int(time.time() * 1000)
        with self.lock:
            row = self.connection.execute(
                """
                SELECT sessions.*
                FROM upstream_sessions AS sessions
                JOIN account_aliases AS aliases
                  ON aliases.public_username = sessions.username
                WHERE sessions.token_hash = ?
                  AND sessions.auth_source = 'upstream'
                  AND sessions.authenticated = 1
                  AND sessions.upstream_user_id IS NOT NULL
                  AND sessions.expires_at > ?
                  AND aliases.active = 1
                  AND (
                    (
                      aliases.account_kind = 'sub'
                      AND aliases.upstream_user_id = sessions.upstream_user_id
                      AND sessions.role = 'sub'
                    )
                    OR (
                      aliases.account_kind = 'primary'
                      AND sessions.role IN ('admin', 'supplier')
                      AND (
                        aliases.upstream_user_id IS NULL
                        OR aliases.upstream_user_id = sessions.upstream_user_id
                      )
                    )
                  )
                """,
                (token_hash, now),
            ).fetchone()
        return dict(row) if row is not None else None


    def active_channel_summary_session_for_mapping(
        self,
        public_username: str,
    ) -> DbRow | None:
        now = int(time.time() * 1000)
        with self.lock:
            row = self.connection.execute(
                """
                SELECT sessions.*
                FROM account_aliases AS aliases
                JOIN upstream_sessions AS sessions
                  ON sessions.username = aliases.public_username
                 AND sessions.upstream_user_id = aliases.upstream_user_id
                WHERE aliases.public_username = ?
                  AND aliases.active = 1
                  AND aliases.upstream_user_id IS NOT NULL
                  AND sessions.auth_source = 'upstream'
                  AND sessions.authenticated = 1
                  AND sessions.cookie_updated_at > 0
                  AND sessions.expires_at > ?
                  AND (
                    (
                      aliases.account_kind = 'sub'
                      AND sessions.role = 'sub'
                    )
                    OR (
                      aliases.account_kind = 'primary'
                      AND sessions.role IN ('admin', 'supplier')
                    )
                  )
                ORDER BY sessions.cookie_updated_at DESC,
                         sessions.created_at DESC,
                         sessions.expires_at DESC
                LIMIT 1
                """,
                (public_username, now),
            ).fetchone()
        return dict(row) if row is not None else None

    def save_channel_summary(
        self,
        session: DbRow,
        summary: dict[str, Any],
        observed_at: int | None = None,
    ) -> int:
        token_hash = str(session.get("token_hash") or "")
        if not re.fullmatch(r"[0-9a-f]{64}", token_hash):
            raise BackendError(401, "用户身份无效，请重新登录")

        now = int(time.time() * 1000)
        refreshed_at = (
            min(now, max(0, int(observed_at)))
            if observed_at is not None
            else now
        )
        snapshot_id = uuid.uuid4().hex
        with self.lock:
            with self.connection.transaction():
                self.connection.execute(
                    "SELECT pg_advisory_xact_lock(hashtextextended('account-alias-namespace', 0))"
                )
                identity = self.connection.execute(
                    """
                    SELECT sessions.upstream_user_id, aliases.public_username
                    FROM upstream_sessions AS sessions
                    JOIN account_aliases AS aliases
                      ON aliases.public_username = sessions.username
                    WHERE sessions.token_hash = ?
                      AND sessions.auth_source = 'upstream'
                      AND sessions.authenticated = 1
                      AND sessions.upstream_user_id IS NOT NULL
                      AND sessions.expires_at > ?
                      AND aliases.active = 1
                      AND (
                        (
                          aliases.account_kind = 'sub'
                          AND aliases.upstream_user_id = sessions.upstream_user_id
                          AND sessions.role = 'sub'
                        )
                        OR (
                          aliases.account_kind = 'primary'
                          AND sessions.role IN ('admin', 'supplier')
                          AND (
                            aliases.upstream_user_id IS NULL
                            OR aliases.upstream_user_id = sessions.upstream_user_id
                          )
                        )
                      )
                    FOR UPDATE OF sessions, aliases
                    """,
                    (token_hash, now),
                ).fetchone()
                if identity is None:
                    raise BackendError(401, "登录状态已失效，请重新登录")
                upstream_user_id = int(identity["upstream_user_id"])
                public_username = str(identity["public_username"])
                values: list[tuple[Any, ...]] = [
                    (
                        upstream_user_id,
                        public_username,
                        CHANNEL_SUMMARY_TOTAL_CATEGORY,
                        summary["total_quota"],
                        summary["count"],
                        0,
                        refreshed_at,
                        snapshot_id,
                    )
                ]
                values.extend(
                    (
                        upstream_user_id,
                        public_username,
                        item["category"],
                        item["quota"],
                        item["rows"],
                        item["alive_rows"],
                        refreshed_at,
                        snapshot_id,
                    )
                    for item in summary["categories"]
                )
                self.connection.execute(
                    "SELECT pg_advisory_xact_lock(hashtextextended(?, 0))",
                    (f"channel-summary:{upstream_user_id}",),
                )
                latest = self.connection.execute(
                    """
                    SELECT refreshed_at
                    FROM channel_summary_snapshots
                    WHERE upstream_user_id = ? AND category = ?
                    """,
                    (upstream_user_id, CHANNEL_SUMMARY_TOTAL_CATEGORY),
                ).fetchone()
                if latest is not None and int(latest["refreshed_at"]) > refreshed_at:
                    return int(latest["refreshed_at"])
                self.connection.execute(
                    """
                    DELETE FROM channel_summary_snapshots
                    WHERE public_username = ? AND upstream_user_id <> ?
                    """,
                    (public_username, upstream_user_id),
                )
                self.connection.executemany(
                    """
                    INSERT INTO channel_summary_snapshots
                        (upstream_user_id, public_username, category, quota,
                         row_count, alive_rows, refreshed_at, snapshot_id)
                    VALUES (?, ?, ?, ?, ?, ?, ?, ?)
                    ON CONFLICT(upstream_user_id, category) DO UPDATE SET
                        public_username = excluded.public_username,
                        quota = excluded.quota,
                        row_count = excluded.row_count,
                        alive_rows = excluded.alive_rows,
                        refreshed_at = excluded.refreshed_at,
                        snapshot_id = excluded.snapshot_id
                    """,
                    values,
                )
                self.connection.execute(
                    """
                    DELETE FROM channel_summary_snapshots
                    WHERE upstream_user_id = ? AND snapshot_id <> ?
                    """,
                    (upstream_user_id, snapshot_id),
                )
        return refreshed_at

    def channel_summary_for_user_id(self, upstream_user_id: int) -> dict[str, Any]:
        if upstream_user_id <= 0:
            raise BackendError(400, "子账号 ID 无效")
        with self.lock:
            with self.connection.transaction():
                self.connection.execute(
                    "SELECT pg_advisory_xact_lock(hashtextextended(?, 0))",
                    (f"channel-summary:{upstream_user_id}",),
                )
                total = self.connection.execute(
                    """
                    SELECT public_username, quota, row_count, alive_rows,
                           refreshed_at, snapshot_id
                    FROM channel_summary_snapshots
                    WHERE upstream_user_id = ? AND category = ?
                    ORDER BY refreshed_at DESC
                    LIMIT 1
                    """,
                    (upstream_user_id, CHANNEL_SUMMARY_TOTAL_CATEGORY),
                ).fetchone()
                if total is None:
                    return {
                        "available": False,
                        "userId": upstream_user_id,
                        "publicUsername": "",
                        "channelCount": 0,
                        "totalQuota": "0",
                        "totalAmount": "0.00",
                        "refreshedAt": None,
                        "categories": [],
                    }
                categories = self.connection.execute(
                    """
                    SELECT category, quota, row_count, alive_rows
                    FROM channel_summary_snapshots
                    WHERE upstream_user_id = ?
                      AND snapshot_id = ?
                      AND category <> ?
                    ORDER BY quota DESC, category
                    """,
                    (
                        upstream_user_id,
                        total["snapshot_id"],
                        CHANNEL_SUMMARY_TOTAL_CATEGORY,
                    ),
                ).fetchall()

        return {
            "available": True,
            "userId": upstream_user_id,
            "publicUsername": str(total["public_username"]),
            "channelCount": int(total["row_count"]),
            "totalQuota": decimal_text(Decimal(str(total["quota"]))),
            "totalAmount": channel_summary_amount(Decimal(str(total["quota"]))),
            "refreshedAt": int(total["refreshed_at"]),
            "categories": [
                {
                    "category": str(row["category"]),
                    "quota": decimal_text(Decimal(str(row["quota"]))),
                    "amount": channel_summary_amount(Decimal(str(row["quota"]))),
                    "channelCount": int(row["row_count"]),
                    "aliveChannelCount": int(row["alive_rows"]),
                }
                for row in categories
            ],
        }

    def channel_summary_for_mapping(self, public_username: str) -> dict[str, Any]:
        with self.lock:
            with self.connection.transaction():
                self.connection.execute(
                    "SELECT pg_advisory_xact_lock(hashtextextended('account-alias-namespace', 0))"
                )
                mapping = self.connection.execute(
                    """
                    SELECT public_username, upstream_user_id
                    FROM account_aliases
                    WHERE public_username = ?
                    FOR SHARE
                    """,
                    (public_username,),
                ).fetchone()
                if mapping is None:
                    raise BackendError(404, "用户映射不存在")
                total = self.connection.execute(
                    """
                    SELECT upstream_user_id, quota, row_count, alive_rows,
                           refreshed_at, snapshot_id
                    FROM channel_summary_snapshots
                    WHERE public_username = ? AND category = ?
                    ORDER BY refreshed_at DESC
                    LIMIT 1
                    """,
                    (mapping["public_username"], CHANNEL_SUMMARY_TOTAL_CATEGORY),
                ).fetchone()
                if total is None:
                    mapped_user_id = mapping.get("upstream_user_id")
                    return {
                        "available": False,
                        "userId": int(mapped_user_id) if mapped_user_id is not None else None,
                        "publicUsername": str(mapping["public_username"]),
                        "channelCount": 0,
                        "totalQuota": "0",
                        "totalAmount": "0.00",
                        "refreshedAt": None,
                        "categories": [],
                    }
                self.connection.execute(
                    "SELECT pg_advisory_xact_lock(hashtextextended(?, 0))",
                    (f"channel-summary:{int(total['upstream_user_id'])}",),
                )
                categories = self.connection.execute(
                    """
                    SELECT category, quota, row_count, alive_rows
                    FROM channel_summary_snapshots
                    WHERE upstream_user_id = ?
                      AND snapshot_id = ?
                      AND category <> ?
                    ORDER BY quota DESC, category
                    """,
                    (
                        total["upstream_user_id"],
                        total["snapshot_id"],
                        CHANNEL_SUMMARY_TOTAL_CATEGORY,
                    ),
                ).fetchall()

        rates = self.category_rates(int(total["upstream_user_id"]))
        settled_amounts = self.category_settled_amounts(int(total["upstream_user_id"]))
        return {
            "available": True,
            "userId": int(total["upstream_user_id"]),
            "publicUsername": str(mapping["public_username"]),
            "channelCount": int(total["row_count"]),
            "totalQuota": decimal_text(Decimal(str(total["quota"]))),
            "totalAmount": channel_summary_amount(Decimal(str(total["quota"]))),
            "refreshedAt": int(total["refreshed_at"]),
            "categories": [
                {
                    "category": str(row["category"]),
                    "ratePercent": decimal_text(rates.get(str(row["category"]), Decimal("100"))),
                    "quota": decimal_text(Decimal(str(row["quota"]))),
                    "amount": channel_summary_amount(Decimal(str(row["quota"]))),
                    "settledAmount": dollar_amount(settled_amounts.get(str(row["category"]), Decimal(0))),
                    "outstandingAmount": dollar_amount(max(
                        Decimal(0), Decimal(quota_dollars(Decimal(str(row["quota"]))))
                        - settled_amounts.get(str(row["category"]), Decimal(0)),
                    )),
                    "channelCount": int(row["row_count"]),
                    "aliveChannelCount": int(row["alive_rows"]),
                }
                for row in categories
            ],
        }

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

    def admin_sync_enabled(self, parent_id: int) -> bool:
        with self.lock:
            row = self.connection.execute(
                "SELECT sync_enabled FROM account_aliases WHERE upstream_user_id = ? AND account_kind = 'primary' AND active = 1",
                (parent_id,),
            ).fetchone()
        return bool(row and row["sync_enabled"])

    def managed_mapping_ids(self, parent_id: int) -> set[int]:
        with self.lock:
            rows = self.connection.execute(
                "SELECT upstream_user_id FROM account_aliases WHERE parent_upstream_user_id = ? AND account_kind = 'sub' AND upstream_user_id IS NOT NULL",
                (parent_id,),
            ).fetchall()
        return {int(row["upstream_user_id"]) for row in rows}

    def set_mapping_sync_enabled(self, username: str, enabled: bool) -> None:
        with self.lock:
            with self.connection.transaction():
                self.connection.execute("SELECT pg_advisory_xact_lock(hashtextextended('account-alias-namespace', 0))")
                row = self.connection.execute(
                    "UPDATE account_aliases SET sync_enabled = ? WHERE public_username = ? AND account_kind = 'primary' RETURNING public_username",
                    (enabled, username),
                ).fetchone()
                if row is None:
                    raise BackendError(404, "管理员映射不存在")

    def mapping_data_synced_at(self, public_username: str) -> int | None:
        with self.lock:
            row = self.connection.execute(
                """
                SELECT MAX(snapshots.refreshed_at) AS synced_at
                FROM channel_summary_snapshots AS snapshots
                JOIN account_aliases AS aliases
                  ON aliases.public_username = snapshots.public_username
                 AND aliases.upstream_user_id = snapshots.upstream_user_id
                WHERE aliases.public_username = ? AND snapshots.category = ?
                """,
                (public_username, CHANNEL_SUMMARY_TOTAL_CATEGORY),
            ).fetchone()
        return int(row["synced_at"]) if row and row["synced_at"] is not None else None

    def account_mappings(self) -> list[DbRow]:
        with self.lock:
            rows = self.connection.execute(
                """
                SELECT child.*, parent.upstream_username AS parent_gys_username
                FROM account_aliases AS child
                LEFT JOIN account_aliases AS parent
                  ON parent.upstream_user_id = child.parent_upstream_user_id
                 AND parent.account_kind = 'primary'
                ORDER BY child.account_kind, child.public_username
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
        parent_user_id: int | None = None,
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
                        raise BackendError(409, "用户名或 GYS 用户名已存在")
                    if upstream_user_id is not None:
                        id_conflict = self.connection.execute(
                            """
                            SELECT 1
                            FROM account_aliases
                            WHERE upstream_user_id = ?
                            """,
                            (upstream_user_id,),
                        ).fetchone()
                        if id_conflict is not None:
                            raise BackendError(409, "用户 ID 已绑定其他用户映射")
                    self.connection.execute(
                        "DELETE FROM channel_summary_snapshots WHERE public_username = ?",
                        (public_username,),
                    )
                    row = self.connection.execute(
                        """
                        INSERT INTO account_aliases
                            (public_username, upstream_username, display_name, account_kind,
                             upstream_user_id, active, created_at, updated_at, parent_upstream_user_id)
                        VALUES (?, ?, ?, ?, ?, 1, ?, ?, ?)
                        RETURNING public_username, upstream_username, display_name, account_kind,
                                  upstream_user_id, active, created_at, updated_at, sync_enabled, parent_upstream_user_id
                        """,
                        (
                            public_username,
                            upstream_username,
                            display_name,
                            account_kind,
                            upstream_user_id,
                            now,
                            now,
                            parent_user_id,
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
                raise BackendError(409, "用户名或 GYS 用户名已存在") from error
        if row is None:
            raise BackendError(503, "用户映射保存失败")
        return dict(row)

    def assert_sub_account_username_available(self, username: str) -> None:
        if username.casefold() == SUPER_ADMIN_USERNAME.casefold():
            raise BackendError(409, "超级管理员账号名不可用于子账号")
        with self.lock:
            row = self.connection.execute(
                """
                SELECT 1 FROM account_aliases
                WHERE public_username = ? OR upstream_username = ?
                """,
                (username, username),
            ).fetchone()
        if row is not None:
            raise BackendError(409, "用户名或 GYS 用户名已存在")

    def allocate_sub_account_username(self, parent_id: int, parent_username: str,
                                      children: list[dict[str, Any]]) -> str:
        prefix = f"{parent_username}_sub_"
        pattern = re.compile(re.escape(prefix) + r"([0-9]{1,18})", re.IGNORECASE)
        with self.lock:
            with self.connection.transaction():
                rows = self.connection.execute(
                    "SELECT upstream_username FROM account_aliases WHERE parent_upstream_user_id = ?",
                    (parent_id,),
                ).fetchall()
                names = [str(row["upstream_username"]) for row in rows]
                names.extend(str(child.get("username", "")) for child in children if isinstance(child, dict))
                highest = max((int(match.group(1)) for name in names
                               if (match := pattern.fullmatch(name))), default=0)
                row = self.connection.execute(
                    """
                    INSERT INTO sub_account_sequences (parent_upstream_user_id, last_number)
                    VALUES (?, ?)
                    ON CONFLICT (parent_upstream_user_id) DO UPDATE
                    SET last_number = GREATEST(sub_account_sequences.last_number + 1, excluded.last_number)
                    RETURNING last_number
                    """,
                    (parent_id, highest + 1),
                ).fetchone()
                username = f"{prefix}{row['last_number']}"
                if not re.fullmatch(r"[A-Za-z0-9_.-]{3,64}", username):
                    raise BackendError(400, "创建者的 GYS 用户名过长或格式不支持生成子账号")
                return username

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
                    current_account_kind = str(current["account_kind"])
                    next_account_kind = account_kind or current_account_kind
                    if current_account_kind != next_account_kind:
                        raise BackendError(400, "编辑映射时不能更改账号类型")
                    if account_kind is None:
                        next_upstream_user_id = current["upstream_user_id"]
                    else:
                        next_upstream_user_id = upstream_user_id
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
                        raise BackendError(409, "用户名或 GYS 用户名已存在")
                    if next_upstream_user_id is not None:
                        id_conflict = self.connection.execute(
                            """
                            SELECT 1
                            FROM account_aliases
                            WHERE upstream_user_id = ?
                              AND public_username <> ?
                            """,
                            (next_upstream_user_id, current_public_username),
                        ).fetchone()
                        if id_conflict is not None:
                            raise BackendError(409, "用户 ID 已绑定其他用户映射")
                    row = self.connection.execute(
                        """
                        UPDATE account_aliases
                        SET public_username = ?, upstream_username = ?, display_name = ?,
                            account_kind = ?, upstream_user_id = ?, active = ?, updated_at = ?
                        WHERE public_username = ?
                        RETURNING public_username, upstream_username, display_name, account_kind,
                                  upstream_user_id, active, created_at, updated_at, sync_enabled, parent_upstream_user_id
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
                    identity_changed = (
                        str(current["upstream_username"]).casefold()
                        != upstream_username.casefold()
                        or str(current["account_kind"]) != next_account_kind
                        or current.get("upstream_user_id") != next_upstream_user_id
                    )
                    if identity_changed:
                        self.connection.execute(
                            "DELETE FROM channel_summary_snapshots WHERE public_username = ?",
                            (current_public_username,),
                        )
                    elif current_public_username.casefold() != public_username.casefold():
                        self.connection.execute(
                            """
                            UPDATE channel_summary_snapshots
                            SET public_username = ?
                            WHERE public_username = ?
                            """,
                            (public_username, current_public_username),
                        )
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
                raise BackendError(409, "用户名或用户 ID 已绑定其他用户映射") from error
        if row is None:
            raise BackendError(404, "用户映射不存在")
        return dict(row)

    def delete_account_mapping(self, public_username: str) -> None:
        with self.lock:
            with self.connection.transaction():
                self.connection.execute(
                    "SELECT pg_advisory_xact_lock(hashtextextended('account-alias-namespace', 0))"
                )
                row = self.connection.execute(
                    """
                    SELECT public_username, upstream_username, upstream_user_id
                    FROM account_aliases WHERE public_username = ?
                    FOR UPDATE
                    """,
                    (public_username,),
                ).fetchone()
                if row is None:
                    raise BackendError(404, "用户映射不存在")
                if row["upstream_user_id"] is not None:
                    self.connection.execute(
                        "SELECT pg_advisory_xact_lock(hashtextextended(?, 0))",
                        (f"channel-summary:{int(row['upstream_user_id'])}",),
                    )
                    history = self.connection.execute(
                        """
                        SELECT 1 FROM category_settlement_records
                        WHERE sub_account_user_id = ? LIMIT 1
                        """,
                        (row["upstream_user_id"],),
                    ).fetchone()
                    if history is not None:
                        raise BackendError(409, "该账号存在结算历史，禁止删除")
                self.connection.execute(
                    "DELETE FROM account_aliases WHERE public_username = ?",
                    (row["public_username"],),
                )
                self.connection.execute(
                    "DELETE FROM channel_summary_snapshots WHERE public_username = ?",
                    (row["public_username"],),
                )
                self.connection.execute(
                    """
                    DELETE FROM upstream_sessions
                    WHERE auth_source = 'upstream' AND username::citext IN (?, ?)
                    """,
                    (row["public_username"], row["upstream_username"]),
                )

    def sync_sub_account_mappings(self, data: Any, *, report_duplicate_id: bool = False,
                                 parent_user_id: int | None = None) -> None:
        items = data if isinstance(data, list) else (
            data.get("items") if isinstance(data, dict) else None
        )
        if not isinstance(items, list):
            raise BackendError(502, "子账号列表格式不正确")
        now = int(time.time() * 1000)
        duplicate_found = False
        with self.lock:
            with self.connection.transaction():
                self.connection.execute(
                    "SELECT pg_advisory_xact_lock(hashtextextended('account-alias-namespace', 0))"
                )
                if parent_user_id is not None and not self.admin_sync_enabled(parent_user_id):
                    raise BackendError(403, "该管理员已禁用同步")
                for item in items:
                    if not isinstance(item, dict):
                        raise BackendError(502, "子账号信息格式不正确")
                    username = item.get("username")
                    username = username.strip() if isinstance(username, str) else ""
                    raw_id = item.get("id")
                    if (
                        not re.fullmatch(r"[A-Za-z0-9_.-]{3,64}", username)
                        or isinstance(raw_id, bool)
                        or not isinstance(raw_id, (int, str))
                        or not re.fullmatch(r"[1-9]\d{0,15}", str(raw_id))
                        or int(raw_id) > 9_007_199_254_740_991
                    ):
                        raise BackendError(502, "子账号用户名或 ID 无效")
                    if username.casefold() == SUPER_ADMIN_USERNAME.casefold():
                        continue
                    user_id = int(raw_id)
                    if parent_user_id is not None:
                        self.connection.execute(
                            """
                            UPDATE account_aliases SET parent_upstream_user_id = ?
                            WHERE upstream_user_id = ? AND upstream_username = ?
                              AND account_kind = 'sub' AND parent_upstream_user_id IS NULL
                            """,
                            (parent_user_id, user_id, username),
                        )
                    if report_duplicate_id:
                        duplicate_id = self.connection.execute(
                            "SELECT 1 FROM account_aliases WHERE upstream_user_id = ?",
                            (user_id,),
                        ).fetchone()
                        if duplicate_id is not None:
                            duplicate_found = True
                            continue
                    existing = self.connection.execute(
                        """
                        SELECT 1 FROM account_aliases
                        WHERE upstream_user_id = ? OR public_username = ? OR upstream_username = ?
                        """,
                        (user_id, username, username),
                    ).fetchone()
                    # Preserve custom login names, disabled mappings and identities
                    # already assigned to another account. Never rebind on login.
                    if existing is not None:
                        continue
                    display_name = item.get("display_name")
                    display_name = (
                        display_name.strip() if isinstance(display_name, str) else ""
                    ) or username
                    status = item.get("status", 1)
                    if status not in (0, 1, "0", "1"):
                        raise BackendError(502, "子账号状态无效")
                    self.connection.execute(
                        "DELETE FROM channel_summary_snapshots WHERE public_username = ?",
                        (username,),
                    )
                    self.connection.execute(
                        """
                        INSERT INTO account_aliases
                            (public_username, upstream_username, display_name, account_kind,
                             upstream_user_id, active, created_at, updated_at, parent_upstream_user_id)
                        VALUES (?, ?, ?, 'sub', ?, ?, ?, ?, ?)
                        """,
                        (username, username, display_name[:128], user_id, int(status), now, now, parent_user_id),
                    )
                    self.connection.execute(
                        """
                        DELETE FROM upstream_sessions
                        WHERE auth_source = 'upstream' AND username::citext = ?
                        """,
                        (username,),
                    )

        if duplicate_found:
            raise BackendError(409, "已在表中")

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
                alias = self.connection.execute(
                    """
                    SELECT public_username
                    FROM account_aliases
                    WHERE account_kind = 'sub' AND upstream_user_id = ?
                    """,
                    (upstream_user_id,),
                ).fetchone()
                if alias is not None:
                    self.connection.execute(
                        """
                        DELETE FROM upstream_sessions
                        WHERE auth_source = 'upstream'
                          AND (
                            username = ?
                            OR upstream_user_id = ?
                          )
                        """,
                        (alias["public_username"], upstream_user_id),
                    )
                    self.connection.execute(
                        "DELETE FROM channel_summary_snapshots WHERE public_username = ?",
                        (alias["public_username"],),
                    )
                self.connection.execute(
                    "DELETE FROM account_aliases WHERE account_kind = 'sub' AND upstream_user_id = ?",
                    (upstream_user_id,),
                )

    def mapping_account_id(self, public_username: str) -> int:
        with self.lock:
            row = self.connection.execute(
                "SELECT upstream_user_id FROM account_aliases WHERE public_username = ?",
                (public_username,),
            ).fetchone()
        if row is None:
            raise BackendError(404, "用户映射不存在")
        if row["upstream_user_id"] is None or int(row["upstream_user_id"]) <= 0:
            raise BackendError(409, "请先编辑用户映射并填写账号ID")
        return int(row["upstream_user_id"])

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
                self.connection.execute(
                    "SELECT pg_advisory_xact_lock(hashtextextended(?, 0))",
                    (f"channel-summary:{sub_account_user_id}",),
                )
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

    def allocate_settlement_transaction_id(self) -> str:
        machine_code = os.environ.get("SETTLEMENT_MACHINE_CODE") or str(
            int(hashlib.sha256(socket.gethostname().encode()).hexdigest()[:12], 16) % 1_000_000
        ).zfill(6)
        if not re.fullmatch(r"[0-9]{6}", machine_code):
            raise BackendError(503, "结算机器码须配置为6位数字")
        for _ in range(100):
            transaction_id = f"PK{int(time.time() * 1000)}{machine_code}{secrets.randbelow(200) + 1:03d}"
            row = self.connection.execute(
                """
                INSERT INTO settlement_transaction_ids (transaction_id) VALUES (?)
                ON CONFLICT DO NOTHING RETURNING transaction_id
                """, (transaction_id,),
            ).fetchone()
            if row is not None:
                return str(row["transaction_id"])
        raise BackendError(503, "交易编号生成繁忙，请重试")

    def record_settlement(
        self,
        sub_account_user_id: int,
        category: str,
        consumption_amount: Decimal,
        *, payer: dict[str, Any],
    ) -> dict[str, Any]:
        records = self.record_settlements(
            sub_account_user_id,
            [(category, consumption_amount)],
            payer=payer,
        )
        return records[0]

    def record_settlements(
        self,
        sub_account_user_id: int,
        items: list[tuple[str, Decimal]],
        *, payer: dict[str, Any],
    ) -> list[dict[str, Any]]:
        now = int(time.time() * 1000)
        requested_amounts = dict(items)
        ordered_categories = [
            category
            for category in CHANNEL_USAGE_CATEGORIES
            if category in requested_amounts
        ]
        records: list[dict[str, Any]] = []
        with self.lock:
            with self.connection.transaction():
                payee_row = self.connection.execute(
                    "SELECT public_username, display_name FROM account_aliases WHERE upstream_user_id = ?",
                    (sub_account_user_id,),
                ).fetchone()
                if payee_row is None:
                    raise BackendError(404, "收款账号映射不存在")
                payer_json = json.dumps({
                    "id": payer["user_id"], "source": payer["auth_source"],
                    "username": payer["username"], "displayName": payer["display_name"],
                }, ensure_ascii=False)
                payee_json = json.dumps({
                    "id": sub_account_user_id, "source": "upstream",
                    "username": str(payee_row["public_username"]),
                    "displayName": str(payee_row["display_name"]),
                }, ensure_ascii=False)
                transaction_id = self.allocate_settlement_transaction_id()
                self.connection.execute(
                    "SELECT pg_advisory_xact_lock(hashtextextended(?, 0))",
                    (f"channel-summary:{sub_account_user_id}",),
                )
                snapshot = self.connection.execute(
                    """
                    SELECT snapshot_id
                    FROM channel_summary_snapshots
                    WHERE upstream_user_id = ? AND category = ?
                    LIMIT 1
                    """,
                    (sub_account_user_id, CHANNEL_SUMMARY_TOTAL_CATEGORY),
                ).fetchone()
                if snapshot is None:
                    raise BackendError(409, "请先同步该子账号的渠道分类总消耗")
                snapshot_rows = self.connection.execute(
                    """
                    SELECT category, quota
                    FROM channel_summary_snapshots
                    WHERE upstream_user_id = ? AND snapshot_id = ?
                    """,
                    (sub_account_user_id, snapshot["snapshot_id"]),
                ).fetchall()
                snapshot_quotas = {
                    str(row["category"]): row["quota"]
                    for row in snapshot_rows
                }

                for category in ordered_categories:
                    self.connection.execute(
                        """
                        SELECT pg_advisory_xact_lock(
                            hashtextextended(CAST(? AS text) || ':' || ?, 0)
                        )
                        """,
                        (sub_account_user_id, category),
                    )
                rate_rows = self.connection.execute(
                    """
                    SELECT category, rate_percent, settled_amount
                    FROM category_exchange_rates
                    WHERE sub_account_user_id = ?
                    FOR UPDATE
                    """,
                    (sub_account_user_id,),
                ).fetchall()
                rate_rows_by_category = {
                    str(row["category"]): row
                    for row in rate_rows
                }

                prepared: list[dict[str, Any]] = []
                for category in ordered_categories:
                    try:
                        total_usage_amount = Decimal(
                            quota_dollars(Decimal(str(snapshot_quotas.get(category, 0))))
                        )
                    except (InvalidOperation, TypeError, ValueError) as error:
                        raise BackendError(
                            502,
                            f"{category} 渠道分类消耗数据格式不正确",
                        ) from error
                    row = rate_rows_by_category.get(category)
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
                    consumption_amount = requested_amounts[category]
                    available = max(Decimal(0), total_usage_amount - previous)
                    if consumption_amount <= 0:
                        raise BackendError(400, f"{category} 本次结算消耗额度必须大于 0")
                    if consumption_amount > available:
                        raise BackendError(
                            409,
                            f"{category} 本次结算消耗额度不能超过可结算额度 ${dollar_amount(available)}",
                        )
                    prepared.append(
                        {
                            "category": category,
                            "consumption_amount": consumption_amount,
                            "total_usage_amount": total_usage_amount,
                            "previous": previous,
                            "rate": rate,
                            "settled": previous + consumption_amount,
                            "settlement_amount": consumption_amount * rate / Decimal(100),
                        }
                    )

                for item in prepared:
                    category = str(item["category"])
                    consumption_amount = item["consumption_amount"]
                    total_usage_amount = item["total_usage_amount"]
                    previous = item["previous"]
                    rate = item["rate"]
                    settled = item["settled"]
                    settlement_amount = item["settlement_amount"]
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
                             change_amount, rate_percent, settlement_amount, created_at, transaction_id,
                             payer_json, payee_json)
                        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
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
                            transaction_id,
                            payer_json,
                            payee_json,
                        ),
                    )
                    inserted = cursor.fetchone()
                    if inserted is None:
                        raise BackendError(503, "结算记录保存失败")
                    records.append(
                        {
                            "id": int(inserted["id"]),
                            "transaction_id": transaction_id,
                            "payer_json": payer_json,
                            "payee_json": payee_json,
                            "category": category,
                            "previous_amount": decimal_text(previous),
                            "settled_amount": decimal_text(settled),
                            "change_amount": decimal_text(consumption_amount),
                            "rate_percent": decimal_text(rate),
                            "settlement_amount": decimal_text(settlement_amount),
                            "total_usage_amount": decimal_text(total_usage_amount),
                            "created_at": now,
                        }
                    )
        records.sort(key=lambda record: int(record["id"]), reverse=True)
        return records

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
                       rate_percent, settlement_amount, created_at, transaction_id, payer_json, payee_json
                FROM category_settlement_records
                WHERE sub_account_user_id = ?
                ORDER BY created_at DESC, id DESC
                LIMIT ?
                """,
                (sub_account_user_id, bounded_limit),
            ).fetchall()
        return [dict(row) for row in rows]

    def settlement_transactions(self, user_id: int, limit: int = 100, offset: int = 0) -> list[dict[str, Any]]:
        with self.lock:
            rows = self.connection.execute(
                """
                WITH recent AS (
                    SELECT COALESCE(transaction_id, 'legacy-' || CAST(id AS text)) AS tx_id,
                           MAX(created_at) AS tx_time, MAX(id) AS last_id
                    FROM category_settlement_records
                    WHERE sub_account_user_id = ?
                    GROUP BY COALESCE(transaction_id, 'legacy-' || CAST(id AS text))
                    ORDER BY tx_time DESC, last_id DESC
                    LIMIT ? OFFSET ?
                )
                SELECT records.*,
                       COALESCE(records.transaction_id, 'legacy-' || CAST(records.id AS text)) AS tx_id
                FROM category_settlement_records AS records
                JOIN recent ON recent.tx_id = COALESCE(records.transaction_id, 'legacy-' || CAST(records.id AS text))
                WHERE records.sub_account_user_id = ?
                ORDER BY recent.tx_time DESC, recent.last_id DESC, records.id ASC
                """,
                (user_id, max(1, min(limit, 101)), max(0, offset), user_id),
            ).fetchall()
        grouped: dict[str, dict[str, Any]] = {}
        for row in rows:
            tx_id = str(row["tx_id"])
            if tx_id not in grouped:
                grouped[tx_id] = {
                    "id": tx_id, "createdAt": int(row["created_at"]),
                    "legacy": row["transaction_id"] is None,
                    "payer": json.loads(row["payer_json"]) if row["payer_json"] else None,
                    "payee": json.loads(row["payee_json"]) if row["payee_json"] else None,
                    "items": [], "consumption": Decimal(0), "settlement": Decimal(0),
                }
            transaction = grouped[tx_id]
            item = settlement_record_payload(dict(row))
            item["settlementAmount"] = decimal_text(Decimal(str(row["settlement_amount"])))
            transaction["items"].append(item)
            transaction["consumption"] += Decimal(str(row["change_amount"]))
            transaction["settlement"] += Decimal(str(row["settlement_amount"]))
        return [{
            "id": tx["id"], "createdAt": tx["createdAt"], "legacy": tx["legacy"],
            "items": tx["items"],
            "payer": tx["payer"], "payee": tx["payee"],
            "totalConsumptionAmount": decimal_text(tx["consumption"]),
            "totalSettlementAmount": decimal_text(tx["settlement"]),
        } for tx in grouped.values()]

    def delete_settlement_transaction(self, user_id: int, transaction_id: str) -> None:
        with self.lock:
            with self.connection.transaction():
                # Use the same lock as settlement creation, so rollback and new
                # settlements cannot race or restore the same amount twice.
                self.connection.execute(
                    "SELECT pg_advisory_xact_lock(hashtextextended(?, 0))",
                    (f"channel-summary:{user_id}",),
                )
                records = self.connection.execute(
                    """
                    SELECT id, category, change_amount FROM category_settlement_records
                    WHERE sub_account_user_id = ?
                      AND COALESCE(transaction_id, 'legacy-' || CAST(id AS text)) = ?
                    FOR UPDATE
                    """, (user_id, transaction_id),
                ).fetchall()
                if not records:
                    raise BackendError(404, "结算记录不存在或已删除")
                amounts: dict[str, Decimal] = {}
                for record in records:
                    amount = Decimal(str(record["change_amount"]))
                    if not amount.is_finite() or amount <= 0:
                        raise BackendError(409, "该历史记录无法自动恢复，请核对结算额度")
                    category = str(record["category"])
                    amounts[category] = amounts.get(category, Decimal(0)) + amount
                for category, amount in sorted(amounts.items()):
                    rate = self.connection.execute(
                        """
                        SELECT settled_amount FROM category_exchange_rates
                        WHERE sub_account_user_id = ? AND category = ? FOR UPDATE
                        """, (user_id, category),
                    ).fetchone()
                    current = Decimal(str(rate["settled_amount"])) if rate else Decimal(0)
                    if not current.is_finite() or current < amount:
                        raise BackendError(409, "当前已结算额度与记录不一致，无法自动恢复")
                    self.connection.execute(
                        """
                        UPDATE category_exchange_rates SET settled_amount = ?, updated_at = ?
                        WHERE sub_account_user_id = ? AND category = ?
                        """, (decimal_text(current - amount), int(time.time() * 1000), user_id, category),
                    )
                self.connection.execute(
                    """
                    DELETE FROM category_settlement_records WHERE sub_account_user_id = ?
                      AND COALESCE(transaction_id, 'legacy-' || CAST(id AS text)) = ?
                    """, (user_id, transaction_id),
                )

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
                SELECT id, title, content, title_en, content_en, is_published,
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
        title_en: str,
        content_en: str,
        created_by_user_id: int,
        created_by_username: str,
    ) -> DbRow:
        now = int(time.time() * 1000)
        with self.lock:
            row = self.connection.execute(
                """
                INSERT INTO announcements
                    (title, content, title_en, content_en, is_published, created_by_user_id,
                     created_by_username, created_at, updated_at, published_at)
                VALUES (?, ?, ?, ?, 1, ?, ?, ?, ?, ?)
                RETURNING id, title, content, title_en, content_en, is_published,
                          created_at, updated_at, published_at
                """,
                (
                    title,
                    content,
                    title_en,
                    content_en,
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
                RETURNING id, title, content, title_en, content_en, is_published,
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

    def end_browser_session(self, session: DbRow | None) -> None:
        if session is None:
            return
        replacement_token_hash = self.token_hash(secrets.token_urlsafe(32))
        with self.lock:
            with self.connection.transaction():
                preserved = self.connection.execute(
                    """
                    UPDATE upstream_sessions
                    SET token_hash = ?
                    WHERE token_hash = ?
                      AND auth_source = 'upstream'
                      AND authenticated = 1
                    RETURNING token_hash
                    """,
                    (replacement_token_hash, session["token_hash"]),
                ).fetchone()
                if preserved is None:
                    self.connection.execute(
                        "DELETE FROM upstream_sessions WHERE token_hash = ?",
                        (session["token_hash"],),
                    )

    def delete_expired_sessions(self) -> int:
        now = int(time.time() * 1000)
        with self.lock:
            rows = self.connection.execute(
                """
                DELETE FROM upstream_sessions
                WHERE expires_at <= ? OR created_at + ? <= ?
                RETURNING token_hash
                """,
                (now, 30 * DAY_MS, now),
            ).fetchall()
            self.connection.commit()
        return len(rows)

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

    def renew_shared_cache_refresh(
        self,
        cache_key: str,
        owner: str,
        lease_ms: int,
    ) -> bool:
        with self.lock:
            row = self.connection.execute(
                """
                UPDATE shared_api_cache
                SET refresh_lease_until = ?
                WHERE cache_key = ? AND refresh_owner = ?
                RETURNING cache_key
                """,
                (int(time.time() * 1000) + lease_ms, cache_key, owner),
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


@asynccontextmanager
async def app_lifespan(_: FastAPI):
    refresh_task = asyncio.create_task(channel_summary_refresh_loop())
    try:
        yield
    finally:
        refresh_task.cancel()
        pending_refreshes = list(channel_summary_background_tasks | sub_account_sync_tasks)
        for task in pending_refreshes:
            task.cancel()
        try:
            await refresh_task
        except asyncio.CancelledError:
            pass
        if pending_refreshes:
            await asyncio.gather(*pending_refreshes, return_exceptions=True)


app = FastAPI(
    title="GYS Backend",
    version="1.0.0",
    docs_url="/backend/docs",
    lifespan=app_lifespan,
)


def deserialize_cookies(value: str) -> httpx.Cookies:
    cookies = httpx.Cookies()
    try:
        items = json.loads(unprotect_session_cookies(value))
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
    sync_session = store.active_channel_summary_session_for_mapping(str(row["public_username"]))
    can_sync = False
    if sync_session is not None:
        try:
            can_sync = any(cookie.value for cookie in deserialize_cookies(sync_session["cookies"]).jar)
        except RuntimeError:
            # Unreadable stored credentials cannot be used for synchronization.
            can_sync = False
    return {
        "public_username": str(row["public_username"]),
        "upstream_username": str(row["upstream_username"]),
        "display_name": str(row["display_name"]),
        "account_kind": str(row["account_kind"]),
        "upstream_user_id": int(upstream_user_id) if upstream_user_id is not None else None,
        "active": bool(int(row["active"])),
        "can_sync": bool(can_sync),
        "sync_enabled": bool(row.get("sync_enabled", True)),
        "parent_upstream_user_id": row.get("parent_upstream_user_id"),
        "parent_gys_username": row.get("parent_gys_username"),
        "data_synced_at": store.mapping_data_synced_at(str(row["public_username"])),
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
        raise BackendError(400, "用户名须为3至64位字母、数字、点、横线或下划线")
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

    account_kind = body.get("account_kind", "primary")
    if not isinstance(account_kind, str) or account_kind not in {"primary", "sub"}:
        raise BackendError(400, "账号类型无效")
    raw_upstream_user_id = body.get("upstream_user_id")
    if (
        isinstance(raw_upstream_user_id, bool)
        or not isinstance(raw_upstream_user_id, (int, str))
        or not re.fullmatch(r"[1-9]\d{0,15}", str(raw_upstream_user_id))
    ):
        raise BackendError(400, "账号ID必须为正整数")
    upstream_user_id = int(raw_upstream_user_id)
    if upstream_user_id > 9_007_199_254_740_991:
        raise BackendError(400, "账号ID超出有效范围")
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
    title = str(row["title"])
    content = str(row["content"])
    return {
        "id": int(row["id"]),
        "title": title,
        "content": content,
        "titleZh": title,
        "contentZh": content,
        "titleEn": str(row.get("title_en") or ""),
        "contentEn": str(row.get("content_en") or ""),
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
        "settlementTransactions": store.settlement_transactions(sub_account_user_id),
    }


def settlement_record_payload(record: DbRow) -> dict[str, Any]:
    consumption_amount = Decimal(str(record["change_amount"]))
    return {
        "id": int(record["id"]),
        "transactionId": record.get("transaction_id") or f"legacy-{record['id']}",
        "category": str(record["category"]),
        "previousAmount": dollar_amount(Decimal(str(record["previous_amount"]))),
        "settledAmount": dollar_amount(Decimal(str(record["settled_amount"]))),
        "changeAmount": dollar_amount(consumption_amount),
        "consumptionAmount": dollar_amount(consumption_amount),
        "ratePercent": decimal_text(Decimal(str(record["rate_percent"]))),
        "settlementAmount": dollar_amount(Decimal(str(record["settlement_amount"]))),
        "createdAt": int(record["created_at"]),
    }


async def authorize_account_finance(session: DbRow, target_id: int) -> None:
    if is_super_admin(session):
        return
    if session.get("auth_source") != "upstream" or session.get("role") not in {"supplier", "admin"}:
        raise BackendError(403, "当前账号无权管理子账号财务")
    parent_id = int(session["upstream_user_id"])
    if target_id == parent_id or target_id not in store.managed_mapping_ids(parent_id):
        raise BackendError(404, "子账号不存在或不属于当前账号")
    await ensure_managed_sub_account(session, target_id)


async def authorize_mapping_finance(session: DbRow, public_username: str) -> int:
    if not is_super_admin(session):
        if session.get("auth_source") != "upstream" or session.get("role") not in {"supplier", "admin"}:
            raise BackendError(403, "当前账号无权管理子账号财务")
        with store.lock:
            mapping = store.connection.execute(
                """
                SELECT upstream_user_id FROM account_aliases
                WHERE public_username = ? AND account_kind = 'sub'
                  AND parent_upstream_user_id = ?
                """,
                (public_username, int(session["upstream_user_id"])),
            ).fetchone()
        if mapping is None:
            raise BackendError(404, "子账号不存在或不属于当前账号")
    target_id = store.mapping_account_id(public_username)
    await authorize_account_finance(session, target_id)
    return target_id


async def ensure_managed_sub_account(session: DbRow, target_id: int) -> dict[str, Any]:
    parent_id = int(session["upstream_user_id"])
    if not store.admin_sync_enabled(parent_id) and target_id not in store.managed_mapping_ids(parent_id):
        raise BackendError(404, "子账号不存在或不属于当前管理员的映射")
    children = await authorized_json(session, "/api/sub-accounts")
    child_items = (
        children
        if isinstance(children, list)
        else children.get("items", [])
        if isinstance(children, dict)
        else []
    )
    for item in child_items if isinstance(child_items, list) else []:
        if not isinstance(item, dict):
            continue
        try:
            if int(item.get("id", 0)) == target_id:
                return item
        except (TypeError, ValueError):
            continue
    raise BackendError(404, "子账号不存在")


def sub_account_settlement_summary(
    target_id: int,
    requested_category: str | None = None,
) -> dict[str, Any]:
    category_filter = requested_category.strip().lower() if requested_category else ""
    if category_filter and category_filter not in CHANNEL_USAGE_CATEGORIES:
        raise BackendError(400, "渠道分类无效")
    category_filters = (category_filter,) if category_filter else CHANNEL_USAGE_CATEGORIES
    category_rates = store.category_rates(target_id)
    category_settled_amounts = store.category_settled_amounts(target_id)
    snapshot = store.channel_summary_for_user_id(target_id)
    category_quotas = {
        item["category"]: quota_decimal(item["quota"])
        for item in snapshot["categories"]
        if (
            isinstance(item, dict)
            and item.get("category") in CHANNEL_USAGE_CATEGORIES
            and "quota" in item
        )
    }

    categories: list[dict[str, str]] = []
    for category in category_filters:
        total_amount = Decimal(
            quota_dollars(category_quotas.get(category, Decimal(0)))
        )
        settled_amount = category_settled_amounts[category]
        outstanding_amount = max(Decimal(0), total_amount - settled_amount)
        rate_percent = category_rates[category]
        categories.append(
            {
                "category": category,
                "ratePercent": decimal_text(rate_percent),
                "amount": dollar_amount(total_amount),
                "settledAmount": dollar_amount(settled_amount),
                "payableAmount": dollar_amount(
                    outstanding_amount * rate_percent / Decimal(100)
                ),
            }
        )
    return {
        "available": bool(snapshot["available"]),
        "refreshedAt": snapshot["refreshedAt"],
        "categories": categories,
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
    expected_cookie_updated_at = int(current.get("cookie_updated_at") or 0)
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
            if response.headers.get_list("set-cookie"):
                store.save_cookies(
                    session,
                    serialize_cookies(client.cookies),
                    expected_cookie_updated_at,
                )
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
            store.delete(session)
            raise BackendError(401, "登录状态已失效，请重新登录", error.request_id) from error
        raise
    response, payload = await upstream_raw(session, path, method=method, body=body)
    if is_unauthorized(response, payload):
        store.delete(session)
        raise BackendError(401, "登录状态已失效，请重新登录")
    return unwrap(response, payload)


def persist_channel_summary(
    session: DbRow,
    data: Any,
    observed_at: int | None = None,
) -> int:
    if session.get("auth_source") != "upstream":
        raise BackendError(403, "当前账号无法同步渠道消耗")
    normalized = normalize_channel_summary(data)
    return store.save_channel_summary(session, normalized, observed_at)


async def refresh_channel_summary(session: DbRow) -> int:
    current_session = store.active_channel_summary_session(session)
    if current_session is None:
        raise BackendError(401, "登录状态已失效，请重新登录")
    observed_at = int(time.time() * 1000)
    data = await authorized_json(current_session, "/api/channels/summary")
    return persist_channel_summary(current_session, data, observed_at)


async def refresh_channel_summary_safely(session: DbRow) -> bool:
    try:
        await refresh_channel_summary(session)
        return True
    except BackendError as error:
        if error.status in {401, 403}:
            store.delete(session)
        return False
    except Exception:
        return False


channel_summary_background_tasks: set[asyncio.Task[bool]] = set()
sub_account_sync_tasks: set[asyncio.Task[None]] = set()


async def sync_login_sub_accounts_safely(session: DbRow) -> None:
    try:
        if not store.admin_sync_enabled(int(session["upstream_user_id"])):
            return
        # Login just authenticated these cookies. Optional synchronization must
        # not refresh or delete the successful login session on an upstream error.
        children = await upstream_json(session, "/api/sub-accounts")
        store.sync_sub_account_mappings(children, parent_user_id=int(session["upstream_user_id"]))
    except Exception as error:
        logging.getLogger(__name__).warning(
            "Optional login sub-account sync failed (%s)", type(error).__name__
        )


def schedule_login_sub_account_sync(session: DbRow) -> None:
    if session.get("auth_source") != "upstream" or session.get("role") not in {"admin", "supplier"}:
        return
    task = asyncio.create_task(sync_login_sub_accounts_safely(dict(session)))
    sub_account_sync_tasks.add(task)
    task.add_done_callback(sub_account_sync_tasks.discard)


def schedule_channel_summary_refresh(session: DbRow) -> None:
    task = asyncio.create_task(refresh_channel_summary_safely(dict(session)))
    channel_summary_background_tasks.add(task)
    task.add_done_callback(channel_summary_background_tasks.discard)


async def renew_channel_summary_refresh_lease(owner: str) -> None:
    while True:
        await asyncio.sleep(60)
        if not store.renew_shared_cache_refresh(
            CHANNEL_SUMMARY_REFRESH_CACHE_KEY,
            owner,
            CHANNEL_SUMMARY_REFRESH_LEASE_MS,
        ):
            return


async def refresh_active_channel_summaries_once() -> None:
    now = int(time.time() * 1000)
    owner = store.claim_shared_cache_refresh(
        CHANNEL_SUMMARY_REFRESH_CACHE_KEY,
        now - CHANNEL_SUMMARY_REFRESH_INTERVAL_MS,
        CHANNEL_SUMMARY_REFRESH_LEASE_MS,
    )
    if owner is None:
        return

    lease_task = asyncio.create_task(renew_channel_summary_refresh_lease(owner))
    try:
        store.delete_expired_sessions()
        sessions = store.active_channel_summary_sessions()
        semaphore = asyncio.Semaphore(4)

        async def refresh_one(session: DbRow) -> bool:
            async with semaphore:
                return await refresh_channel_summary_safely(session)

        results = await asyncio.gather(*(refresh_one(session) for session in sessions))
        store.save_shared_cache(
            CHANNEL_SUMMARY_REFRESH_CACHE_KEY,
            owner,
            {
                "activeSessions": len(sessions),
                "refreshed": sum(1 for result in results if result),
                "failed": sum(1 for result in results if not result),
            },
        )
    except asyncio.CancelledError:
        store.release_shared_cache_refresh(CHANNEL_SUMMARY_REFRESH_CACHE_KEY, owner)
        raise
    except Exception:
        store.release_shared_cache_refresh(CHANNEL_SUMMARY_REFRESH_CACHE_KEY, owner)
        raise
    finally:
        lease_task.cancel()
        await asyncio.gather(lease_task, return_exceptions=True)


async def channel_summary_refresh_loop() -> None:
    while True:
        try:
            await refresh_active_channel_summaries_once()
        except asyncio.CancelledError:
            raise
        except Exception:
            pass
        await asyncio.sleep(15)


def sanitize_data(value: Any) -> Any:
    if isinstance(value, list):
        return [sanitize_data(item) for item in value]
    if not isinstance(value, dict):
        return value
    blocked = {
        "key_full",
        "access_token",
        "refresh_token",
        "password",
        "password_hash",
        "cookie",
        "cookies",
        "set-cookie",
        "session_token",
        "authorization",
    }
    return {
        key: sanitize_data(item)
        for key, item in value.items()
        if str(key).casefold() not in blocked
    }


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

        if path == "/api/announcements" and request.method == "GET":
            if not store.within_limit(f"public-announcements:{remote_key}", 120, 60_000):
                raise BackendError(429, "公告请求过于频繁，请稍后重试")
            rows = store.announcements(published_only=True)
            announcement_cookie = (
                (token, store.touch(session))
                if session is not None and session["authenticated"]
                else None
            )
            return success_response(
                request,
                request_id,
                {
                    "items": [announcement_payload(row) for row in rows],
                    "total": len(rows),
                },
                announcement_cookie,
            )

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
            try:
                token, session, parsed = store.create_authenticated_upstream_session(
                    username,
                    upstream_username,
                    profile if isinstance(profile, dict) else None,
                    latest["cookies"],
                )
            finally:
                store.delete(old_session)
            schedule_login_sub_account_sync(session)
            schedule_channel_summary_refresh(session)
            return success_response(request, request_id, parsed, (token, 7 * 86_400))

        if path == "/api/auth/logout" and request.method == "POST":
            store.end_browser_session(session)
            return success_response(request, request_id, {"message": "已退出登录"}, ("", 0))

        if session is None or not session["authenticated"]:
            raise BackendError(401, "请重新登录账号")
        cookie = (token, store.touch(session))

        if path == "/api/settlement-history" and request.method == "GET":
            if session.get("auth_source") == LOCAL_AUTH_SOURCE:
                raise BackendError(403, "当前账号无权查看此结算历史")
            user_id = session.get("upstream_user_id")
            if not user_id:
                raise BackendError(401, "用户身份无效，请重新登录")
            if any(key != "page" for key in request.query_params):
                raise BackendError(400, "不允许指定数据账号或未知参数")
            raw_page = request.query_params.get("page", "1")
            if not re.fullmatch(r"[1-9][0-9]{0,5}", raw_page):
                raise BackendError(400, "页码无效")
            page = int(raw_page)
            transactions = store.settlement_transactions(int(user_id), limit=21, offset=(page - 1) * 20)
            return success_response(request, request_id, {
                "items": transactions[:20], "page": page, "hasMore": len(transactions) > 20,
            }, cookie)

        if path == "/api/auth/profile" and request.method == "GET":
            if session.get("auth_source") == LOCAL_AUTH_SOURCE:
                return success_response(request, request_id, public_profile(session), cookie)
            profile = await authorized_json(session, path)
            data = store.save_profile(session, profile) if isinstance(profile, dict) else public_profile(session)
            return success_response(request, request_id, data, cookie)

        if path == "/api/auth/refresh" and request.method == "POST":
            if session.get("auth_source") == LOCAL_AUTH_SOURCE:
                return success_response(request, request_id, public_profile(session), cookie)
            try:
                await upstream_json(session, path, method="POST", body={})
                profile = await upstream_json(session, "/api/auth/profile")
            except BackendError as error:
                if error.status in {401, 403}:
                    store.delete(session)
                raise
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
            title = body.get("titleZh", body.get("title"))
            content = body.get("contentZh", body.get("content"))
            title_en = body.get("titleEn")
            content_en = body.get("contentEn")
            title = title.strip() if isinstance(title, str) else ""
            content = content.strip() if isinstance(content, str) else ""
            title_en = title_en.strip() if isinstance(title_en, str) else ""
            content_en = content_en.strip() if isinstance(content_en, str) else ""
            if not title or len(title) > 120:
                raise BackendError(400, "中文公告标题须为 1 至 120 个字符")
            if not content or len(content) > 5_000:
                raise BackendError(400, "中文公告内容须为 1 至 5000 个字符")
            if not title_en or len(title_en) > 120:
                raise BackendError(400, "英文公告标题须为 1 至 120 个字符")
            if not content_en or len(content_en) > 5_000:
                raise BackendError(400, "英文公告内容须为 1 至 5000 个字符")
            row = store.create_announcement(
                title,
                content,
                title_en,
                content_en,
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

        sync_setting_match = re.fullmatch(r"/api/user-mappings/([A-Za-z0-9_.-]{3,64})/sync-setting", path)
        if sync_setting_match and request.method == "PUT":
            assert_super_admin(session)
            body = await read_body(request)
            enabled = body.get("enabled")
            if not isinstance(enabled, bool):
                raise BackendError(400, "同步设置无效")
            store.set_mapping_sync_enabled(sync_setting_match.group(1), enabled)
            return success_response(request, request_id, {"sync_enabled": enabled}, cookie)

        mapping_match = re.fullmatch(r"/api/user-mappings/([A-Za-z0-9_.-]{3,64})", path)
        if mapping_match and request.method in {"PUT", "DELETE"}:
            assert_super_admin(session)
            if request.method == "DELETE":
                store.delete_account_mapping(mapping_match.group(1))
                return success_response(request, request_id, {"deleted": True}, cookie)
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

        mapping_usage_match = re.fullmatch(
            r"/api/user-mappings/([A-Za-z0-9_.-]{3,64})/channel-usage",
            path,
        )
        if mapping_usage_match and request.method in {"GET", "POST"}:
            public_username = mapping_usage_match.group(1)
            await authorize_mapping_finance(session, public_username)
            if request.method == "POST":
                current_snapshot = store.channel_summary_for_mapping(public_username)
                if current_snapshot["userId"] is None:
                    raise BackendError(409, "该用户映射尚未记录用户 ID，请先使用该账号登录系统")
                target_session = store.active_channel_summary_session_for_mapping(public_username)
                if target_session is None:
                    raise BackendError(409, "该用户暂无可用登录 Cookie，请先使用该账号登录系统")
                try:
                    await refresh_channel_summary(target_session)
                except BackendError as error:
                    if error.status in {401, 403}:
                        raise BackendError(
                            409,
                            "该用户登录 Cookie 已失效，请重新登录该账号",
                        ) from error
                    raise
            return success_response(
                request,
                request_id,
                store.channel_summary_for_mapping(public_username),
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

        rates_match = re.fullmatch(r"/api/sub-accounts/(\d+)/category-rates", path)
        mapping_rates_match = re.fullmatch(
            r"/api/user-mappings/([A-Za-z0-9_.-]{3,64})/category-rates", path
        )
        if (rates_match or mapping_rates_match) and request.method in {"GET", "PUT"}:
            if mapping_rates_match:
                target_id = await authorize_mapping_finance(session, mapping_rates_match.group(1))
            else:
                if session.get("auth_source") != "upstream" or session["role"] not in {"supplier", "admin"}:
                    raise BackendError(403, "当前账号无权设置子账号汇率")
                target_id = int(rates_match.group(1))
                if target_id <= 0:
                    raise BackendError(400, "子账号 ID 无效")
                await authorize_account_finance(session, target_id)
            if request.method == "GET":
                payload = category_rates_payload(target_id)
                if mapping_rates_match and request.query_params.get("include_settlement") == "1":
                    payload["settlementSummary"] = sub_account_settlement_summary(target_id)
                return success_response(
                    request,
                    request_id,
                    payload,
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

        delete_settlement_match = re.fullmatch(
            r"/api/user-mappings/([A-Za-z0-9_.-]{3,64})/settlements/([A-Za-z0-9-]{1,80})", path
        )
        if delete_settlement_match and request.method == "DELETE":
            target_id = await authorize_mapping_finance(session, delete_settlement_match.group(1))
            store.delete_settlement_transaction(target_id, delete_settlement_match.group(2))
            return success_response(request, request_id, {"message": "结算已删除，额度已恢复"}, cookie)

        mapping_settlement_match = re.fullmatch(
            r"/api/user-mappings/([A-Za-z0-9_.-]{3,64})/settlements", path
        )
        if mapping_settlement_match and request.method == "GET":
            target_id = await authorize_mapping_finance(session, mapping_settlement_match.group(1))
            if any(key != "page" for key in request.query_params):
                raise BackendError(400, "不支持的查询参数")
            raw_page = request.query_params.get("page", "1")
            if not re.fullmatch(r"[1-9][0-9]{0,5}", raw_page):
                raise BackendError(400, "页码无效")
            page = int(raw_page)
            transactions = store.settlement_transactions(target_id, limit=11, offset=(page - 1) * 10)
            return success_response(request, request_id, {
                "items": transactions[:10], "page": page, "pageSize": 10,
                "hasMore": len(transactions) > 10,
            }, cookie)
        if mapping_settlement_match and request.method == "POST":
            target_id = await authorize_mapping_finance(session, mapping_settlement_match.group(1))
            body = await read_body(request)
            if "items" in body:
                raw_items = body.get("items")
                if (
                    not isinstance(raw_items, list)
                    or not raw_items
                    or len(raw_items) > len(CHANNEL_USAGE_CATEGORIES)
                ):
                    raise BackendError(400, "批量结算分类须为 1 至 14 项")
                parsed_items: list[tuple[str, Decimal]] = []
                seen_categories: set[str] = set()
                for raw_item in raw_items:
                    if not isinstance(raw_item, dict):
                        raise BackendError(400, "批量结算项目格式不正确")
                    category = raw_item.get("category")
                    category = category.strip().lower() if isinstance(category, str) else ""
                    if category not in CHANNEL_USAGE_CATEGORIES:
                        raise BackendError(400, "渠道分类无效")
                    if category in seen_categories:
                        raise BackendError(400, f"{category} 渠道分类不能重复结算")
                    seen_categories.add(category)
                    raw_consumption_amount = raw_item.get("consumptionAmount")
                    if (
                        isinstance(raw_consumption_amount, bool)
                        or not isinstance(raw_consumption_amount, (int, float, str))
                    ):
                        raise BackendError(400, f"{category} 本次结算消耗额度格式不正确")
                    try:
                        consumption_amount = Decimal(str(raw_consumption_amount).strip())
                    except (InvalidOperation, ValueError) as error:
                        raise BackendError(
                            400,
                            f"{category} 本次结算消耗额度格式不正确",
                        ) from error
                    if (
                        not consumption_amount.is_finite()
                        or consumption_amount <= 0
                        or consumption_amount > Decimal("1000000000000")
                    ):
                        raise BackendError(400, f"{category} 本次结算消耗额度必须大于 0")
                    if consumption_amount != consumption_amount.to_integral_value():
                        raise BackendError(400, f"{category} 本次结算消耗额度必须为整数")
                    parsed_items.append((category, consumption_amount))

                records = store.record_settlements(target_id, parsed_items, payer=public_profile(session))
                total_settlement_amount = sum(
                    (Decimal(str(record["settlement_amount"])) for record in records),
                    Decimal(0),
                )
                return success_response(
                    request,
                    request_id,
                    {
                        "settlements": [
                            settlement_record_payload(record)
                            for record in records
                        ],
                        "settlementSummary": sub_account_settlement_summary(target_id),
                        "totalSettlementAmount": dollar_amount(total_settlement_amount),
                        "transactionId": records[0]["transaction_id"],
                    },
                    cookie,
                )

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
            if consumption_amount != consumption_amount.to_integral_value():
                raise BackendError(400, "本次结算消耗额度必须为整数")

            record = store.record_settlement(
                target_id,
                category,
                consumption_amount,
                payer=public_profile(session),
            )
            total_usage_amount = Decimal(str(record["total_usage_amount"]))
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

        if session.get("auth_source") == LOCAL_AUTH_SOURCE:
            raise BackendError(403, "超级管理员无权访问此功能")

        mapping_sync_match = re.fullmatch(r"/api/sub-accounts/(\d+)/mapping/sync", path)
        if mapping_sync_match and request.method == "POST":
            if session["role"] not in {"supplier", "admin"}:
                raise BackendError(403, "当前账号无权管理子账号")
            if not store.admin_sync_enabled(int(session["upstream_user_id"])):
                raise BackendError(403, "该管理员已禁用同步")
            child = await ensure_managed_sub_account(session, int(mapping_sync_match.group(1)))
            store.sync_sub_account_mappings([child], report_duplicate_id=True,
                                            parent_user_id=int(session["upstream_user_id"]))
            mapped = store.publicize_sub_account(child)
            if not mapped.get("public_username"):
                raise BackendError(409, "账号 ID 或用户名与已有映射冲突，无法同步")
            return success_response(request, request_id, sanitize_data(mapped), cookie)

        if path == "/api/sub-accounts" and request.method == "GET":
            if session["role"] not in {"supplier", "admin"}:
                raise BackendError(403, "当前账号无权管理子账号")
            data = await authorized_json(session, path)
            sync_enabled = store.admin_sync_enabled(int(session["upstream_user_id"]))
            child_items = data if isinstance(data, list) else data.get("items", []) if isinstance(data, dict) else []
            if not sync_enabled:
                managed_ids = store.managed_mapping_ids(int(session["upstream_user_id"]))
                child_items = [item for item in child_items if isinstance(item, dict) and int(item.get("id", 0)) in managed_ids]
            return success_response(
                request,
                request_id,
                sanitize_data({"items": store.publicize_sub_accounts(child_items), "sync_enabled": sync_enabled}),
                cookie,
            )

        if path == "/api/sub-accounts" and request.method == "POST":
            if session["role"] not in {"supplier", "admin"}:
                raise BackendError(403, "当前账号无权管理子账号")
            body = await read_body(request)
            public_username = body.get("public_username")
            display_name = body.get("display_name")
            password = body.get("password")
            public_username = (
                public_username.strip() if isinstance(public_username, str) else ""
            )
            display_name = display_name.strip() if isinstance(display_name, str) else ""
            password = password if isinstance(password, str) else ""
            if not re.fullmatch(r"[A-Za-z0-9_.-]{3,64}", public_username):
                raise BackendError(400, "本站用户名须为3至64位字母、数字、点、横线或下划线")
            if not display_name or len(display_name) > 128:
                raise BackendError(400, "请输入有效的本站显示名")
            if (
                len(password) < 8
                or len(password) > 4096
                or not re.search(r"[A-Za-z]", password)
                or not re.search(r"\d", password)
                or not re.search(r"[^A-Za-z0-9]", password)
            ):
                raise BackendError(400, "密码至少8位，须含字母、数字和特殊字符")
            store.assert_sub_account_username_available(public_username)
            parent_username = store.resolve_login_username(str(session["username"]))
            children = await authorized_json(session, "/api/sub-accounts")
            child_items = children if isinstance(children, list) else (
                children.get("items") if isinstance(children, dict) else None
            )
            if not isinstance(child_items, list):
                raise BackendError(502, "无法读取 GYS 子账号列表，未创建子账号")
            upstream_username = store.allocate_sub_account_username(
                int(session["upstream_user_id"]), parent_username, child_items,
            )
            store.assert_sub_account_username_available(upstream_username)
            data = await authorized_json(
                session,
                path,
                method="POST",
                body={
                    "username": upstream_username,
                    "display_name": upstream_username,
                    "password": password,
                },
            )
            # Some upstream versions return only a success message on creation.
            # Resolve the new ID from this administrator's own children in that case.
            created = data if isinstance(data, dict) and data.get("id") else None
            if created is None:
                children = await authorized_json(session, "/api/sub-accounts")
                child_items = children if isinstance(children, list) else (
                    children.get("items", []) if isinstance(children, dict) else []
                )
                created = next((
                    item for item in child_items if isinstance(item, dict)
                    and str(item.get("username", "")).casefold() == upstream_username.casefold()
                ), None) if isinstance(child_items, list) else None
            raw_created_id = created.get("id") if created else None
            if (
                isinstance(raw_created_id, bool)
                or not isinstance(raw_created_id, (int, str))
                or not re.fullmatch(r"[1-9]\d{0,15}", str(raw_created_id))
                or int(raw_created_id) > 9_007_199_254_740_991
            ):
                raise BackendError(502, "子账号已在 GYS 创建，但未获取到有效 ID，登录映射未创建")
            try:
                store.create_account_mapping(
                    public_username, upstream_username, display_name,
                    "sub", int(raw_created_id),
                    parent_user_id=int(session["upstream_user_id"]),
                )
            except BackendError as error:
                raise BackendError(
                    error.status, f"子账号已在 GYS 创建，但登录映射创建失败：{error.message}"
                ) from error
            public_data = (
                store.publicize_sub_account({**created, "username": upstream_username})
            )
            return success_response(request, request_id, sanitize_data(public_data), cookie)

        sub_account_match = re.fullmatch(r"/api/sub-accounts/(\d+)", path)
        if sub_account_match and request.method in {"PUT", "DELETE"}:
            if session["role"] not in {"supplier", "admin"}:
                raise BackendError(403, "当前账号无权管理子账号")
            target_id = int(sub_account_match.group(1))
            if target_id <= 0:
                raise BackendError(400, "子账号 ID 无效")
            await ensure_managed_sub_account(session, target_id)
            if request.method == "DELETE":
                if store.settlement_records(target_id, limit=1):
                    raise BackendError(409, "该账号存在结算历史，禁止删除")
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
        summary_observed_at = (
            int(time.time() * 1000)
            if request.method == "GET"
            and path == "/api/channels/summary"
            and not request.url.query
            else None
        )
        full_path = path + (f"?{request.url.query}" if request.url.query else "")
        data = await authorized_json(session, full_path, method=request.method, body=body)

        if (
            request.method == "GET"
            and path == "/api/channels/summary"
            and not request.url.query
        ):
            persist_channel_summary(session, data, summary_observed_at)

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
