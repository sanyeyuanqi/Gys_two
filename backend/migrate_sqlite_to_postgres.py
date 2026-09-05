from __future__ import annotations

import os
import sqlite3
import time
from decimal import Decimal, InvalidOperation
from pathlib import Path
from typing import Any

from backend.main import DAY_MS, decimal_text, protect_session_cookies, store


PROJECT_ROOT = Path(__file__).resolve().parent.parent
DEFAULT_SQLITE_PATH = PROJECT_ROOT / ".gys-backend" / "sessions.sqlite3"


def source_rows(connection: sqlite3.Connection, table: str) -> list[dict[str, Any]]:
    exists = connection.execute(
        "SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = ?",
        (table,),
    ).fetchone()
    if exists is None:
        return []
    return [dict(row) for row in connection.execute(f'SELECT * FROM "{table}"').fetchall()]


def settlement_amount(record: dict[str, Any]) -> str:
    stored = record.get("settlement_amount")
    if stored not in {None, ""}:
        return str(stored)
    try:
        consumption = Decimal(str(record.get("change_amount", "0")))
        rate = Decimal(str(record.get("rate_percent", "100")))
    except (InvalidOperation, TypeError, ValueError):
        return "0"
    if not consumption.is_finite() or not rate.is_finite():
        return "0"
    return decimal_text(consumption * rate / Decimal(100))


def migrate() -> None:
    migration_started_at = int(time.time() * 1000)
    source_path = Path(
        os.environ.get("GYS_LEGACY_SQLITE_PATH", str(DEFAULT_SQLITE_PATH))
    ).resolve()
    if not source_path.is_file():
        print(f"未发现旧 SQLite 数据库：{source_path}")
        return

    source = sqlite3.connect(source_path)
    source.row_factory = sqlite3.Row
    sessions = source_rows(source, "upstream_sessions")
    aliases = source_rows(source, "account_aliases")
    rates = source_rows(source, "category_exchange_rates")
    settlements = source_rows(source, "category_settlement_records")
    source.close()

    migrated = {
        "upstream_sessions": 0,
        "account_aliases": 0,
        "category_exchange_rates": 0,
        "category_settlement_records": 0,
    }
    with store.lock:
        with store.connection.transaction():
            completed = store.connection.execute(
                "SELECT 1 FROM app_metadata WHERE key = ?",
                ("legacy_sqlite_migration_v1",),
            ).fetchone()
            if completed is not None:
                print("SQLite 数据已经迁移，无需重复执行。")
                return
            for row in sessions:
                try:
                    created_at = int(row.get("created_at", 0))
                    expires_at = int(row.get("expires_at", 0))
                    authenticated = int(row.get("authenticated", 0))
                    cookie_updated_at = int(row.get("cookie_updated_at") or created_at)
                except (TypeError, ValueError):
                    continue
                if (
                    not authenticated
                    or str(row.get("auth_source", "upstream")) != "upstream"
                    or expires_at <= migration_started_at
                    or created_at + 30 * DAY_MS <= migration_started_at
                ):
                    continue
                store.connection.execute(
                    """
                    INSERT INTO upstream_sessions
                        (token_hash, upstream_user_id, username, display_name, role,
                         cookies, cookie_updated_at, auth_source, authenticated,
                         created_at, expires_at)
                    VALUES (?, ?, ?, ?, ?, ?, ?, 'upstream', ?, ?, ?)
                    ON CONFLICT(token_hash) DO UPDATE SET
                        upstream_user_id = excluded.upstream_user_id,
                        username = excluded.username,
                        display_name = excluded.display_name,
                        role = excluded.role,
                        cookies = excluded.cookies,
                        cookie_updated_at = excluded.cookie_updated_at,
                        auth_source = excluded.auth_source,
                        authenticated = excluded.authenticated,
                        created_at = excluded.created_at,
                        expires_at = excluded.expires_at
                    """,
                    (
                        row.get("token_hash"),
                        row.get("upstream_user_id"),
                        row.get("username"),
                        row.get("display_name"),
                        row.get("role"),
                        protect_session_cookies(str(row.get("cookies", "[]"))),
                        cookie_updated_at,
                        authenticated,
                        created_at,
                        expires_at,
                    ),
                )
                migrated["upstream_sessions"] += 1

            for row in aliases:
                store.connection.execute(
                    """
                    INSERT INTO account_aliases
                        (public_username, upstream_username, display_name, account_kind,
                         upstream_user_id, active, created_at, updated_at)
                    VALUES (?, ?, ?, ?, ?, ?, ?, ?)
                    ON CONFLICT(public_username) DO UPDATE SET
                        upstream_username = excluded.upstream_username,
                        display_name = excluded.display_name,
                        account_kind = excluded.account_kind,
                        upstream_user_id = excluded.upstream_user_id,
                        active = excluded.active,
                        created_at = excluded.created_at,
                        updated_at = excluded.updated_at
                    """,
                    (
                        row.get("public_username"),
                        row.get("upstream_username"),
                        row.get("display_name") or row.get("public_username"),
                        row.get("account_kind", "primary"),
                        row.get("upstream_user_id"),
                        row.get("active", 1),
                        row.get("created_at", 0),
                        row.get("updated_at", 0),
                    ),
                )
                migrated["account_aliases"] += 1

            latest_rates: dict[tuple[int, str], dict[str, Any]] = {}
            for row in sorted(rates, key=lambda item: int(item.get("updated_at", 0))):
                try:
                    key = (int(row["sub_account_user_id"]), str(row["category"]))
                except (KeyError, TypeError, ValueError):
                    continue
                latest_rates[key] = row
            for (sub_account_user_id, category), row in latest_rates.items():
                store.connection.execute(
                    """
                    INSERT INTO category_exchange_rates
                        (sub_account_user_id, category, rate_percent, settled_amount, updated_at)
                    VALUES (?, ?, ?, ?, ?)
                    ON CONFLICT(sub_account_user_id, category) DO UPDATE SET
                        rate_percent = excluded.rate_percent,
                        settled_amount = excluded.settled_amount,
                        updated_at = excluded.updated_at
                    """,
                    (
                        sub_account_user_id,
                        category,
                        str(row.get("rate_percent", "100")),
                        str(row.get("settled_amount", "0")),
                        row.get("updated_at", 0),
                    ),
                )
                migrated["category_exchange_rates"] += 1

            for row in settlements:
                try:
                    record_id = int(row["id"])
                    sub_account_user_id = int(row["sub_account_user_id"])
                except (KeyError, TypeError, ValueError):
                    continue
                store.connection.execute(
                    """
                    INSERT INTO category_settlement_records
                        (id, sub_account_user_id, category, previous_amount, settled_amount,
                         change_amount, rate_percent, settlement_amount, created_at)
                    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
                    ON CONFLICT(id) DO UPDATE SET
                        sub_account_user_id = excluded.sub_account_user_id,
                        category = excluded.category,
                        previous_amount = excluded.previous_amount,
                        settled_amount = excluded.settled_amount,
                        change_amount = excluded.change_amount,
                        rate_percent = excluded.rate_percent,
                        settlement_amount = excluded.settlement_amount,
                        created_at = excluded.created_at
                    """,
                    (
                        record_id,
                        sub_account_user_id,
                        str(row.get("category", "")),
                        str(row.get("previous_amount", "0")),
                        str(row.get("settled_amount", "0")),
                        str(row.get("change_amount", "0")),
                        str(row.get("rate_percent", "100")),
                        settlement_amount(row),
                        row.get("created_at", 0),
                    ),
                )
                migrated["category_settlement_records"] += 1

            store.connection.execute(
                """
                SELECT setval(
                    pg_get_serial_sequence('category_settlement_records', 'id'),
                    COALESCE((SELECT MAX(id) FROM category_settlement_records), 1),
                    EXISTS(SELECT 1 FROM category_settlement_records)
                )
                """
            )
            store.connection.execute(
                """
                INSERT INTO app_metadata (key, value)
                VALUES (?, ?)
                ON CONFLICT(key) DO UPDATE SET value = excluded.value
                """,
                ("legacy_sqlite_migration_v1", str(int(time.time() * 1000))),
            )

    print("SQLite 数据已迁移到 PostgreSQL：")
    for table, count in migrated.items():
        print(f"- {table}: {count}")
    print(
        "旧 SQLite 文件仍可能包含明文会话 Cookie；确认迁移结果后，"
        "请将其删除或转移到加密备份。"
    )


if __name__ == "__main__":
    migrate()
