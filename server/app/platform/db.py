"""Storage for the platform: settings with history, people, CRM records, planning and audit.

SQLite by default (one file, no setup), with every table keyed by a text id and the
record kept as JSON next to a few indexed columns used for filtering. Moving to
PostgreSQL later means porting this file, not the business logic.
"""
from __future__ import annotations

import json
import secrets
import sqlite3
from datetime import datetime, timezone
from pathlib import Path

from ..store import Store

PLATFORM_SCHEMA = """
CREATE TABLE IF NOT EXISTS settings (
    key TEXT PRIMARY KEY, value_json TEXT NOT NULL, version INTEGER NOT NULL, updated_at TEXT NOT NULL,
    updated_by TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS settings_history (
    key TEXT NOT NULL, version INTEGER NOT NULL, value_json TEXT NOT NULL, updated_at TEXT NOT NULL,
    updated_by TEXT NOT NULL, PRIMARY KEY (key, version)
);
CREATE TABLE IF NOT EXISTS staff (
    id TEXT PRIMARY KEY, email TEXT NOT NULL UNIQUE, role TEXT NOT NULL, active INTEGER NOT NULL DEFAULT 1,
    password_hash TEXT NOT NULL, data TEXT NOT NULL, created_at TEXT NOT NULL, updated_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS sessions (
    token_hash TEXT PRIMARY KEY, subject_kind TEXT NOT NULL, subject_id TEXT NOT NULL, expires_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS otps (
    phone TEXT PRIMARY KEY, code_hash TEXT NOT NULL, expires_at TEXT NOT NULL, attempts INTEGER NOT NULL DEFAULT 0,
    sent_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS records (
    kind TEXT NOT NULL, id TEXT NOT NULL, status TEXT NOT NULL DEFAULT '', owner TEXT NOT NULL DEFAULT '',
    parent TEXT NOT NULL DEFAULT '', ref TEXT NOT NULL DEFAULT '', search TEXT NOT NULL DEFAULT '',
    data TEXT NOT NULL, created_at TEXT NOT NULL, updated_at TEXT NOT NULL, PRIMARY KEY (kind, id)
);
CREATE INDEX IF NOT EXISTS idx_records_status ON records(kind, status);
CREATE INDEX IF NOT EXISTS idx_records_parent ON records(kind, parent);
CREATE INDEX IF NOT EXISTS idx_records_ref ON records(kind, ref);
CREATE TABLE IF NOT EXISTS counters (name TEXT PRIMARY KEY, value INTEGER NOT NULL);
CREATE TABLE IF NOT EXISTS audit (
    id INTEGER PRIMARY KEY AUTOINCREMENT, at TEXT NOT NULL, actor TEXT NOT NULL, action TEXT NOT NULL,
    subject TEXT NOT NULL, detail TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_audit_subject ON audit(subject);
"""

# Record kinds kept in `records`:
#   customer      status=active|blocked   owner=staff id   parent=organisation id   ref=phone
#   organisation  status=active|archived  owner=staff id
#   lead          status=<lead stage>     owner=staff id   parent=organisation id   ref=customer id
#   activity      status=open|done        owner=staff id   parent=<kind>:<id> it belongs to
#   quote         status=draft|sent|accepted|declined|expired|converted   ref=public token   parent=customer id
#   ticket        status=open|pending|resolved|closed      owner=staff id   parent=customer id   ref=order id
#   collection    status=open|locked|ordered|cancelled     ref=public token parent=customer id
#   entry         status=active|removed    parent=collection id
#   job           status=planned|in_progress|done|cancelled parent=order id
#   shipment      status=planned|packed|dispatched|delivered|returned|cancelled parent=order id ref=tracking no
#                 owner=seller id
#   order_index   status=<order status>  parent=customer id  ref=phone  owner=seller id  (a searchable copy of orders)
#   seller        status=active|inactive
#   product       status=draft|published  ref=slug
#   review        status=visible|hidden   parent=product id (or "")  owner=seller id  ref=order id
#   return        status=requested|approved|picked_up|resolved|rejected  parent=order id  owner=seller id
#   checkout      status=open|paid  parent=customer id  ref=idempotency key
#   cart, wishlist  one per customer, id = customer id
#   notification  status=unread|read  parent=customer id
#   message       status=logged|sent|failed  (the SMS and email outbox)  parent=customer id  ref=order id
#   email_index   id = verified email, data {customer_id}
#   login_guard   id = sign-in identifier, failed password attempts and lock time
#   customer_secret  id = customer id, the password hash (kept out of the customer record)


def now() -> str:
    return datetime.now(timezone.utc).isoformat(timespec="seconds")


def new_id(prefix: str) -> str:
    return f"{prefix}_{secrets.token_hex(6)}"


def sortable_id(prefix: str) -> str:
    """An id that sorts in creation order (for feeds where several rows share a second)."""
    import time
    return f"{prefix}_{time.time_ns():x}{secrets.token_hex(2)}"


# Columns added to `sessions` after the first release. Old databases get them with
# ALTER TABLE on start; existing sessions keep working and get an id.
SESSION_COLUMNS = {"id": "TEXT", "created_at": "TEXT", "last_seen_at": "TEXT", "device_label": "TEXT NOT NULL DEFAULT ''",
                   "auth_method": "TEXT NOT NULL DEFAULT ''"}
LAST_SEEN_EVERY_SECONDS = 60


class PlatformStore(Store):
    def __init__(self, path: Path):
        super().__init__(path)
        with self._conn() as c:
            c.executescript(PLATFORM_SCHEMA)
            self._migrate_sessions(c)

    @staticmethod
    def _migrate_sessions(c) -> None:
        have = {r["name"] for r in c.execute("PRAGMA table_info(sessions)").fetchall()}
        for col, decl in SESSION_COLUMNS.items():
            if col not in have:
                c.execute(f"ALTER TABLE sessions ADD COLUMN {col} {decl}")
        c.execute("UPDATE sessions SET id = 'ses_' || lower(hex(randomblob(6))) WHERE id IS NULL")
        c.execute("UPDATE sessions SET created_at = ? WHERE created_at IS NULL", (now(),))
        c.execute("CREATE INDEX IF NOT EXISTS idx_sessions_subject ON sessions(subject_kind, subject_id)")

    # ------------------------------------------------------------- settings

    def get_setting(self, key: str) -> dict | None:
        with self._conn() as c:
            row = c.execute("SELECT * FROM settings WHERE key = ?", (key,)).fetchone()
        return {"value": json.loads(row["value_json"]), "version": row["version"], "updated_at": row["updated_at"],
                "updated_by": row["updated_by"]} if row else None

    def put_setting(self, key: str, value: dict, actor: str, expected_version: int | None = None) -> dict:
        at = now()
        with self._conn() as c:
            row = c.execute("SELECT version FROM settings WHERE key = ?", (key,)).fetchone()
            current = row["version"] if row else 0
            if expected_version is not None and expected_version != current:
                raise ConflictError(f"{key} was changed by someone else (version {current}). Reload and try again.")
            v = current + 1
            c.execute("INSERT OR REPLACE INTO settings VALUES (?,?,?,?,?)", (key, json.dumps(value), v, at, actor))
            c.execute("INSERT INTO settings_history VALUES (?,?,?,?,?)", (key, v, json.dumps(value), at, actor))
        return {"value": value, "version": v, "updated_at": at, "updated_by": actor}

    def setting_history(self, key: str, limit: int = 20) -> list[dict]:
        with self._conn() as c:
            rows = c.execute("SELECT * FROM settings_history WHERE key = ? ORDER BY version DESC LIMIT ?",
                             (key, limit)).fetchall()
        return [{"version": r["version"], "updated_at": r["updated_at"], "updated_by": r["updated_by"],
                 "value": json.loads(r["value_json"])} for r in rows]

    # ------------------------------------------------------------- staff and sessions

    def add_staff(self, email: str, role: str, password_hash: str, data: dict) -> dict:
        sid, at = new_id("stf"), now()
        with self._conn() as c:
            try:
                c.execute("INSERT INTO staff VALUES (?,?,?,?,?,?,?,?)",
                          (sid, email.lower(), role, 1, password_hash, json.dumps(data), at, at))
            except sqlite3.IntegrityError as e:
                raise ConflictError("A staff member with this email already exists.") from e
        return self.get_staff(sid)

    def _staff_row(self, row) -> dict:
        return {"id": row["id"], "email": row["email"], "role": row["role"], "active": bool(row["active"]),
                "created_at": row["created_at"], **json.loads(row["data"])}

    def get_staff(self, sid: str) -> dict | None:
        with self._conn() as c:
            row = c.execute("SELECT * FROM staff WHERE id = ?", (sid,)).fetchone()
        return self._staff_row(row) if row else None

    def staff_by_email(self, email: str) -> tuple[dict, str] | None:
        with self._conn() as c:
            row = c.execute("SELECT * FROM staff WHERE email = ?", (email.lower(),)).fetchone()
        return (self._staff_row(row), row["password_hash"]) if row else None

    def list_staff(self) -> list[dict]:
        with self._conn() as c:
            rows = c.execute("SELECT * FROM staff ORDER BY created_at").fetchall()
        return [self._staff_row(r) for r in rows]

    def update_staff(self, sid: str, role: str | None = None, active: bool | None = None,
                     password_hash: str | None = None, data: dict | None = None) -> dict | None:
        cur = self.get_staff(sid)
        if cur is None:
            return None
        with self._conn() as c:
            if role is not None:
                c.execute("UPDATE staff SET role = ? WHERE id = ?", (role, sid))
            if active is not None:
                c.execute("UPDATE staff SET active = ? WHERE id = ?", (int(active), sid))
            if password_hash is not None:
                c.execute("UPDATE staff SET password_hash = ? WHERE id = ?", (password_hash, sid))
            if data is not None:
                keep = {k: v for k, v in cur.items() if k not in ("id", "email", "role", "active", "created_at")}
                c.execute("UPDATE staff SET data = ? WHERE id = ?", (json.dumps({**keep, **data}), sid))
            c.execute("UPDATE staff SET updated_at = ? WHERE id = ?", (now(), sid))
        return self.get_staff(sid)

    def staff_count(self) -> int:
        with self._conn() as c:
            return c.execute("SELECT COUNT(*) n FROM staff").fetchone()["n"]

    def add_session(self, token_hash: str, kind: str, subject: str, expires_at: str, device_label: str = "",
                    auth_method: str = "") -> str:
        sid, at = new_id("ses"), now()
        with self._conn() as c:
            c.execute("INSERT INTO sessions (token_hash, subject_kind, subject_id, expires_at, id, created_at, "
                      "last_seen_at, device_label, auth_method) VALUES (?,?,?,?,?,?,?,?,?)",
                      (token_hash, kind, subject, expires_at, sid, at, at, device_label[:80], auth_method))
            c.execute("DELETE FROM sessions WHERE expires_at < ?", (at,))
        return sid

    def get_session(self, token_hash: str) -> dict | None:
        at = now()
        with self._conn() as c:
            row = c.execute("SELECT * FROM sessions WHERE token_hash = ? AND expires_at > ?", (token_hash, at)).fetchone()
            if row and (not row["last_seen_at"] or (datetime.fromisoformat(at) - datetime.fromisoformat(row["last_seen_at"])
                                                    ).total_seconds() > LAST_SEEN_EVERY_SECONDS):
                c.execute("UPDATE sessions SET last_seen_at = ? WHERE token_hash = ?", (at, token_hash))
        return dict(row) if row else None

    def sessions_for(self, kind: str, subject: str) -> list[dict]:
        with self._conn() as c:
            rows = c.execute("SELECT * FROM sessions WHERE subject_kind = ? AND subject_id = ? AND expires_at > ? "
                             "ORDER BY COALESCE(last_seen_at, created_at) DESC", (kind, subject, now())).fetchall()
        return [dict(r) for r in rows]

    def drop_session_id(self, kind: str, subject: str, session_id: str) -> int:
        with self._conn() as c:
            return c.execute("DELETE FROM sessions WHERE subject_kind = ? AND subject_id = ? AND id = ?",
                             (kind, subject, session_id)).rowcount

    def drop_other_sessions(self, kind: str, subject: str, keep_token_hash: str) -> int:
        with self._conn() as c:
            return c.execute("DELETE FROM sessions WHERE subject_kind = ? AND subject_id = ? AND token_hash != ?",
                             (kind, subject, keep_token_hash)).rowcount

    def drop_sessions_for(self, kind: str, subject: str) -> int:
        with self._conn() as c:
            return c.execute("DELETE FROM sessions WHERE subject_kind = ? AND subject_id = ?", (kind, subject)).rowcount

    def drop_session(self, token_hash: str) -> None:
        with self._conn() as c:
            c.execute("DELETE FROM sessions WHERE token_hash = ?", (token_hash,))

    def put_otp(self, phone: str, code_hash: str, expires_at: str) -> None:
        with self._conn() as c:
            c.execute("INSERT OR REPLACE INTO otps VALUES (?,?,?,0,?)", (phone, code_hash, expires_at, now()))

    def get_otp(self, phone: str) -> dict | None:
        with self._conn() as c:
            row = c.execute("SELECT * FROM otps WHERE phone = ?", (phone,)).fetchone()
        return dict(row) if row else None

    def bump_otp(self, phone: str) -> None:
        with self._conn() as c:
            c.execute("UPDATE otps SET attempts = attempts + 1 WHERE phone = ?", (phone,))

    def drop_otp(self, phone: str) -> None:
        with self._conn() as c:
            c.execute("DELETE FROM otps WHERE phone = ?", (phone,))

    # ------------------------------------------------------------- generic records

    def put(self, kind: str, rid: str, data: dict, *, status: str = "", owner: str = "", parent: str = "",
            ref: str = "", search: str = "") -> dict:
        at = now()
        data = {**data, "id": rid}
        with self._conn() as c:
            row = c.execute("SELECT created_at FROM records WHERE kind = ? AND id = ?", (kind, rid)).fetchone()
            created = row["created_at"] if row else data.get("created_at") or at
            data["created_at"], data["updated_at"] = created, at
            c.execute("INSERT OR REPLACE INTO records VALUES (?,?,?,?,?,?,?,?,?,?)",
                      (kind, rid, status, owner, parent, ref, search.lower(), json.dumps(data), created, at))
        return data

    def get(self, kind: str, rid: str) -> dict | None:
        with self._conn() as c:
            row = c.execute("SELECT data FROM records WHERE kind = ? AND id = ?", (kind, rid)).fetchone()
        return json.loads(row["data"]) if row else None

    def find(self, kind: str, *, status: str | list[str] | None = None, owner: str | None = None,
             parent: str | None = None, ref: str | None = None, q: str | None = None,
             order: str = "updated_at DESC", limit: int = 100, offset: int = 0) -> tuple[list[dict], int]:
        where, args = ["kind = ?"], [kind]
        if isinstance(status, list):
            where.append(f"status IN ({','.join('?' * len(status))})")
            args += status
        elif status:
            where.append("status = ?")
            args.append(status)
        for col, v in (("owner", owner), ("parent", parent), ("ref", ref)):
            if v is not None:
                where.append(f"{col} = ?")
                args.append(v)
        if q:
            where.append("search LIKE ?")
            args.append(f"%{q.lower()}%")
        if order not in ("updated_at DESC", "created_at DESC", "created_at ASC", "updated_at ASC", "created_at DESC, id DESC"):
            order = "updated_at DESC"
        sql = " AND ".join(where)
        with self._conn() as c:
            total = c.execute(f"SELECT COUNT(*) n FROM records WHERE {sql}", args).fetchone()["n"]
            rows = c.execute(f"SELECT data FROM records WHERE {sql} ORDER BY {order} LIMIT ? OFFSET ?",
                             (*args, limit, offset)).fetchall()
        return [json.loads(r["data"]) for r in rows], total

    def count_by_status(self, kind: str) -> dict[str, int]:
        with self._conn() as c:
            rows = c.execute("SELECT status, COUNT(*) n FROM records WHERE kind = ? GROUP BY status", (kind,)).fetchall()
        return {r["status"]: r["n"] for r in rows}

    def delete(self, kind: str, rid: str) -> None:
        with self._conn() as c:
            c.execute("DELETE FROM records WHERE kind = ? AND id = ?", (kind, rid))

    def next_number(self, name: str) -> int:
        with self._conn() as c:
            c.execute("INSERT INTO counters VALUES (?, 1) ON CONFLICT(name) DO UPDATE SET value = value + 1", (name,))
            return c.execute("SELECT value FROM counters WHERE name = ?", (name,)).fetchone()["value"]

    # ------------------------------------------------------------- orders (all of them, for operations)

    def all_orders(self) -> list[dict]:
        with self._conn() as c:
            rows = c.execute("SELECT order_json FROM orders ORDER BY created_at DESC").fetchall()
        return [json.loads(r["order_json"]) for r in rows]

    # ------------------------------------------------------------- audit

    def audit(self, actor: str, action: str, subject: str, detail: dict | None = None) -> None:
        with self._conn() as c:
            c.execute("INSERT INTO audit (at, actor, action, subject, detail) VALUES (?,?,?,?,?)",
                      (now(), actor, action, subject, json.dumps(detail or {})))

    def audit_for(self, subject: str | None = None, limit: int = 100) -> list[dict]:
        with self._conn() as c:
            if subject:
                rows = c.execute("SELECT * FROM audit WHERE subject = ? ORDER BY id DESC LIMIT ?", (subject, limit)).fetchall()
            else:
                rows = c.execute("SELECT * FROM audit ORDER BY id DESC LIMIT ?", (limit,)).fetchall()
        return [{**dict(r), "detail": json.loads(r["detail"])} for r in rows]


class ConflictError(Exception):
    pass
