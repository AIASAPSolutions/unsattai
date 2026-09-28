"""SQLite persistence. Every generation, rating and edit is kept because this log
is the training set for the in-house model."""
from __future__ import annotations

import json
import sqlite3
import uuid
from contextlib import contextmanager
from datetime import datetime, timezone
from pathlib import Path

from .schemas import DesignSpec

SCHEMA = """
CREATE TABLE IF NOT EXISTS generations (
    id TEXT PRIMARY KEY, created_at TEXT NOT NULL, request_json TEXT NOT NULL,
    provider TEXT NOT NULL, fallback_reason TEXT
);
CREATE TABLE IF NOT EXISTS designs (
    id TEXT PRIMARY KEY, generation_id TEXT NOT NULL REFERENCES generations(id),
    variant_index INTEGER NOT NULL, created_at TEXT NOT NULL,
    original_spec_json TEXT NOT NULL, spec_json TEXT NOT NULL,
    rating INTEGER, selected INTEGER NOT NULL DEFAULT 0, edited INTEGER NOT NULL DEFAULT 0, comment TEXT
);
CREATE INDEX IF NOT EXISTS idx_designs_generation ON designs(generation_id);
CREATE TABLE IF NOT EXISTS orders (
    id TEXT PRIMARY KEY, idempotency_key TEXT NOT NULL UNIQUE, request_hash TEXT NOT NULL,
    created_at TEXT NOT NULL, status TEXT NOT NULL, order_json TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS factory_jobs (
    job_id TEXT PRIMARY KEY, order_id TEXT NOT NULL UNIQUE, queue TEXT NOT NULL,
    accepted_at TEXT NOT NULL, receipt_json TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS ai_usage (
    device TEXT NOT NULL, day TEXT NOT NULL, count INTEGER NOT NULL DEFAULT 0, PRIMARY KEY (device, day)
);
CREATE TABLE IF NOT EXISTS ai_calls (device TEXT NOT NULL, at REAL NOT NULL);
CREATE INDEX IF NOT EXISTS idx_ai_calls ON ai_calls(device, at);
CREATE TABLE IF NOT EXISTS ai_cache (
    key TEXT PRIMARY KEY, created_at TEXT NOT NULL, hits INTEGER NOT NULL DEFAULT 0, result_json TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS device_orders (
    order_id TEXT PRIMARY KEY, device TEXT NOT NULL, created_at TEXT NOT NULL
);
"""


RESTORED_GENERATION = "gen_restored"


def _now() -> str:
    return datetime.now(timezone.utc).isoformat(timespec="seconds")


class Store:
    def __init__(self, path: Path):
        self.path = path
        path.parent.mkdir(parents=True, exist_ok=True)
        with self._conn() as c:
            c.executescript(SCHEMA)

    @contextmanager
    def _conn(self):
        conn = sqlite3.connect(self.path)
        conn.row_factory = sqlite3.Row
        try:
            yield conn
            conn.commit()
        finally:
            conn.close()

    def save_generation(self, request: dict, provider: str, fallback_reason: str | None,
                        specs: list[DesignSpec]) -> tuple[str, list[str]]:
        gid = "gen_" + uuid.uuid4().hex[:12]
        ids = ["dsn_" + uuid.uuid4().hex[:12] for _ in specs]
        now = _now()
        with self._conn() as c:
            c.execute("INSERT INTO generations VALUES (?,?,?,?,?)",
                      (gid, now, json.dumps(request), provider, fallback_reason))
            c.executemany(
                "INSERT INTO designs (id, generation_id, variant_index, created_at, original_spec_json, spec_json) "
                "VALUES (?,?,?,?,?,?)",
                [(did, gid, i, now, s.model_dump_json(), s.model_dump_json()) for i, (did, s) in enumerate(zip(ids, specs))])
        return gid, ids

    def get_design(self, design_id: str) -> dict | None:
        with self._conn() as c:
            row = c.execute(
                "SELECT d.*, g.request_json, g.provider, g.fallback_reason FROM designs d "
                "JOIN generations g ON g.id = d.generation_id WHERE d.id = ?", (design_id,)).fetchone()
        return dict(row) if row else None

    def restore_design(self, design_id: str, spec: DesignSpec) -> None:
        """Re-create a design this instance never saw (serverless instances don't share /tmp).
        Restored rows lack the original brief, so they are excluded from training exports."""
        now, j = _now(), spec.model_dump_json()
        with self._conn() as c:
            c.execute("INSERT OR IGNORE INTO generations VALUES (?,?,?,?,?)",
                      (RESTORED_GENERATION, now, "{}", "unknown", "restored from client"))
            c.execute("INSERT OR IGNORE INTO designs (id, generation_id, variant_index, created_at, "
                      "original_spec_json, spec_json) VALUES (?,?,?,?,?,?)",
                      (design_id, RESTORED_GENERATION, 0, now, j, j))

    def update_feedback(self, design_id: str, rating: int | None, selected: bool | None,
                        edited_spec: DesignSpec | None, comment: str) -> None:
        sets, args = [], []
        if rating is not None:
            sets.append("rating = ?"), args.append(rating)
        if selected is not None:
            sets.append("selected = ?"), args.append(int(selected))
        if edited_spec is not None:
            sets += ["spec_json = ?", "edited = 1"]
            args.append(edited_spec.model_dump_json())
        if comment:
            sets.append("comment = ?"), args.append(comment)
        if not sets:
            return
        with self._conn() as c:
            c.execute(f"UPDATE designs SET {', '.join(sets)} WHERE id = ?", (*args, design_id))

    def training_rows(self, min_rating: int) -> list[dict]:
        """Designs a human endorsed: rated >= min_rating, selected, or hand-edited."""
        with self._conn() as c:
            rows = c.execute(
                "SELECT d.*, g.request_json, g.provider FROM designs d JOIN generations g ON g.id = d.generation_id "
                "WHERE (d.rating >= ? OR d.selected = 1 OR d.edited = 1) AND g.id != ? ORDER BY d.created_at",
                (min_rating, RESTORED_GENERATION)).fetchall()
        return [dict(r) for r in rows]

    # ------------------------------------------------------------- orders

    def create_order(self, key: str, request_hash: str, order: dict) -> tuple[dict, bool]:
        """Insert unless the idempotency key exists. Returns (order, created)."""
        with self._conn() as c:
            row = c.execute("SELECT * FROM orders WHERE idempotency_key = ?", (key,)).fetchone()
            if row:
                if row["request_hash"] != request_hash:
                    raise KeyError("idempotency key reused with a different order")
                return json.loads(row["order_json"]), False
            try:
                c.execute("INSERT INTO orders VALUES (?,?,?,?,?,?)",
                          (order["id"], key, request_hash, order["created_at"], order["status"], json.dumps(order)))
            except sqlite3.IntegrityError:   # a concurrent retry won the race; return its order
                row = c.execute("SELECT * FROM orders WHERE idempotency_key = ?", (key,)).fetchone()
                if row["request_hash"] != request_hash:
                    raise KeyError("idempotency key reused with a different order") from None
                return json.loads(row["order_json"]), False
        return order, True

    def get_order(self, order_id: str) -> dict | None:
        with self._conn() as c:
            row = c.execute("SELECT order_json FROM orders WHERE id = ?", (order_id,)).fetchone()
        return json.loads(row["order_json"]) if row else None

    def save_order(self, order: dict) -> None:
        with self._conn() as c:
            c.execute("UPDATE orders SET status = ?, order_json = ? WHERE id = ?",
                      (order["status"], json.dumps(order), order["id"]))

    def factory_job_for(self, order_id: str) -> dict | None:
        with self._conn() as c:
            row = c.execute("SELECT receipt_json FROM factory_jobs WHERE order_id = ?", (order_id,)).fetchone()
        return json.loads(row["receipt_json"]) if row else None

    def add_factory_job(self, receipt: dict) -> None:
        with self._conn() as c:
            c.execute("INSERT OR IGNORE INTO factory_jobs VALUES (?,?,?,?,?)",
                      (receipt["job_id"], receipt["order_id"], receipt["queue"], receipt["accepted_at"], json.dumps(receipt)))

    def factory_jobs(self, limit: int = 100) -> list[dict]:
        with self._conn() as c:
            rows = c.execute("SELECT receipt_json FROM factory_jobs ORDER BY accepted_at DESC LIMIT ?", (limit,)).fetchall()
        return [json.loads(r["receipt_json"]) for r in rows]

    def stats(self) -> dict:
        with self._conn() as c:
            gens = c.execute("SELECT provider, COUNT(*) n FROM generations GROUP BY provider").fetchall()
            d = c.execute("SELECT COUNT(*) total, SUM(rating IS NOT NULL) rated, SUM(selected) selected, "
                          "SUM(edited) edited, AVG(rating) avg_rating FROM designs").fetchone()
        return {"generations_by_provider": {r["provider"]: r["n"] for r in gens}, **dict(d)}

    # ------------------------------------------------------------- AI edit allowance and cache

    def ai_used(self, device: str, day: str) -> int:
        with self._conn() as c:
            row = c.execute("SELECT count FROM ai_usage WHERE device = ? AND day = ?", (device, day)).fetchone()
        return row["count"] if row else 0

    def ai_used_total(self, day: str) -> int:
        with self._conn() as c:
            row = c.execute("SELECT COALESCE(SUM(count), 0) AS n FROM ai_usage WHERE day = ?", (day,)).fetchone()
        return row["n"]

    def ai_record_call(self, device: str, day: str, at: float) -> None:
        with self._conn() as c:
            c.execute("INSERT INTO ai_usage (device, day, count) VALUES (?, ?, 1) "
                      "ON CONFLICT(device, day) DO UPDATE SET count = count + 1", (device, day))
            c.execute("INSERT INTO ai_calls VALUES (?, ?)", (device, at))
            c.execute("DELETE FROM ai_calls WHERE at < ?", (at - 3600,))

    def ai_calls_since(self, device: str, since: float) -> list[float]:
        with self._conn() as c:
            rows = c.execute("SELECT at FROM ai_calls WHERE device = ? AND at >= ? ORDER BY at",
                             (device, since)).fetchall()
        return [r["at"] for r in rows]

    def ai_cache_get(self, key: str) -> dict | None:
        with self._conn() as c:
            row = c.execute("SELECT result_json FROM ai_cache WHERE key = ?", (key,)).fetchone()
            if row:
                c.execute("UPDATE ai_cache SET hits = hits + 1 WHERE key = ?", (key,))
        return json.loads(row["result_json"]) if row else None

    def ai_cache_put(self, key: str, result: dict) -> None:
        with self._conn() as c:
            c.execute("INSERT OR REPLACE INTO ai_cache (key, created_at, hits, result_json) VALUES (?, ?, 0, ?)",
                      (key, _now(), json.dumps(result)))

    def link_order_device(self, order_id: str, device: str) -> None:
        with self._conn() as c:
            c.execute("INSERT OR IGNORE INTO device_orders VALUES (?, ?, ?)", (order_id, device, _now()))

    def order_device(self, order_id: str) -> str | None:
        with self._conn() as c:
            row = c.execute("SELECT device FROM device_orders WHERE order_id = ?", (order_id,)).fetchone()
            return row["device"] if row else None

    def device_paid_orders(self, device: str) -> int:
        with self._conn() as c:
            # Only paid orders earn extra AI edits, so creating unpaid orders gains nothing.
            return c.execute("SELECT COUNT(*) AS n FROM device_orders d JOIN orders o ON o.id = d.order_id "
                             "WHERE d.device = ? AND o.status != 'awaiting_payment'", (device,)).fetchone()["n"]
