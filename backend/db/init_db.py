"""Automatic Database Initializer & Migration Runner.

Connects to PostgreSQL via asyncpg, applies schema.sql and seed_benchmarks.sql
idempotently, and verifies table population without requiring external psql.
"""

from __future__ import annotations

import asyncio
import os
import sys
from pathlib import Path

import asyncpg

DB_DIR = Path(__file__).resolve().parent
SCHEMA_PATH = DB_DIR / "schema.sql"
SEED_PATH = DB_DIR / "seed_benchmarks.sql"
DATABASE_URL = os.environ.get(
    "DATABASE_URL",
    "postgresql://postgres:postgres@127.0.0.1:54322/postgres",
)


async def wait_for_db(dsn: str, max_retries: int = 15, delay: float = 1.0) -> asyncpg.Connection | None:
    """Attempt connecting to the database with a retry backoff."""
    for attempt in range(1, max_retries + 1):
        try:
            conn = await asyncpg.connect(dsn, timeout=5.0)
            return conn
        except (TimeoutError, OSError, asyncpg.PostgresError):
            if attempt < max_retries:
                await asyncio.sleep(delay)
    return None


async def apply_db() -> bool:
    print(f"[DB] Connecting to {DATABASE_URL}...")
    conn = await wait_for_db(DATABASE_URL)
    if conn is None:
        print(f"[DB] Notice: Could not connect to {DATABASE_URL} after retries.")
        print("[DB] Backend will run with remote pooler or offline fallback.")
        return False

    try:
        if SCHEMA_PATH.exists():
            schema_sql = SCHEMA_PATH.read_text(encoding="utf-8")
            await conn.execute(schema_sql)
            print("[DB] ✓ Applied schema.sql")

        if SEED_PATH.exists():
            seed_sql = SEED_PATH.read_text(encoding="utf-8")
            await conn.execute(seed_sql)
            print("[DB] ✓ Applied seed_benchmarks.sql")

        count = await conn.fetchval("SELECT count(*) FROM subjects")
        print(f"[DB] ✓ Database initialized: {count} benchmark subjects verified.")
        return True
    except Exception as exc:  # noqa: BLE001
        print(f"[DB] Warning during SQL execution: {exc}")
        return False
    finally:
        await conn.close()


def main() -> None:
    success = asyncio.run(apply_db())
    if not success and os.getenv("STRICT_DB", "false").lower() == "true":
        sys.exit(1)


if __name__ == "__main__":
    main()
