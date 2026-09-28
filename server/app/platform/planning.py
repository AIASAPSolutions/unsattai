"""Production and delivery planning.

Finite-capacity forward scheduling: every paid order passes through the configured
stages (artwork, printing, pressing, cutting, stitching, QC, packing). Each stage has a
daily capacity in pieces, and orders are loaded in priority order: express first, then
the earliest promised ship date, then payment time. An order can span several days
in a stage, and several orders share a day. A stage's `fixed_days` holds the next
stage back (curing, batching).

The same scheduler answers "when would a new order arrive?" at checkout, by planning
the current workload plus the new order, so promises follow real capacity.
"""
from __future__ import annotations

from datetime import date, datetime, timedelta, timezone
from zoneinfo import ZoneInfo

from . import config
from .db import PlatformStore

ACTIVE = ("queued", "in_production")
HORIZON_DAYS = 400


class Calendar:
    def __init__(self, production: dict):
        self.work = set(production["working_days"])
        self.holidays = set(production["holidays"])
        self.tz = ZoneInfo(production.get("timezone") or "Asia/Kolkata")
        self.cutoff = production["daily_cutoff_hour"]

    def is_working(self, d: date) -> bool:
        return d.weekday() in self.work and d.isoformat() not in self.holidays

    def next_working(self, d: date, include: bool = True) -> date:
        d = d if include else d + timedelta(days=1)
        for _ in range(HORIZON_DAYS):
            if self.is_working(d):
                return d
            d += timedelta(days=1)
        raise ValueError("no working days configured")

    def add_working(self, d: date, n: int) -> date:
        for _ in range(n):
            d = self.next_working(d, include=False)
        return d

    def start_for(self, paid_at: datetime) -> date:
        local = paid_at.astimezone(self.tz)
        d = local.date()
        if local.hour >= self.cutoff or not self.is_working(d):
            return self.next_working(d, include=False)
        return d

    def today(self) -> date:
        return datetime.now(self.tz).date()


def _paid_at(order: dict) -> datetime:
    at = (order.get("fulfilment") or {}).get("paid_at") or order.get("created_at")
    return datetime.fromisoformat(at) if at else datetime.now(timezone.utc)


def _remaining_stages(order: dict, stages: list[dict]) -> list[dict]:
    done = {s["id"] for s in (order.get("fulfilment") or {}).get("stages", []) if s.get("done_at")}
    return [s for s in stages if s["id"] not in done]


def _sort_key(order: dict, rush_first: bool):
    f = order.get("fulfilment") or {}
    return (0 if (rush_first and f.get("rush")) else 1, f.get("promised_ship_date") or "9999", _paid_at(order).isoformat())


def schedule(orders: list[dict], production: dict, delivery: dict, today: date | None = None) -> dict:
    """Plan the given orders. Returns {order_id: plan} and the per-stage daily load."""
    cal = Calendar(production)
    today = cal.next_working(today or cal.today())
    stages = production["stages"]
    load: dict[str, dict[str, int]] = {s["id"]: {} for s in stages}
    dispatch_days = set(delivery["dispatch_days"])
    plans: dict[str, dict] = {}

    queue = [o for o in orders if (o.get("fulfilment") or {}).get("status") in ACTIVE
             and not (o.get("fulfilment") or {}).get("hold")]
    queue.sort(key=lambda o: _sort_key(o, production.get("rush_priority", True)))

    for o in queue:
        pieces = o["total_pieces"]
        earliest = max(today, cal.start_for(_paid_at(o)))
        out = []
        for s in _remaining_stages(o, stages):
            cap = s["capacity_per_day"]
            d, left, first = cal.next_working(earliest), pieces, None
            for _ in range(HORIZON_DAYS):
                used = load[s["id"]].get(d.isoformat(), 0)
                free = cap - used
                if free > 0:
                    take = min(free, left)
                    load[s["id"]][d.isoformat()] = used + take
                    left -= take
                    first = first or d
                    if left == 0:
                        break
                d = cal.next_working(d, include=False)
            out.append({"id": s["id"], "name": s["name"], "start": first.isoformat(), "end": d.isoformat(), "pieces": pieces})
            earliest = cal.add_working(d, s["fixed_days"]) if s["fixed_days"] else d
        ready = date.fromisoformat(out[-1]["end"]) if out else today
        ship = _next_dispatch(ready + timedelta(days=1), dispatch_days, cal)
        transit = ((o.get("delivery") or {}).get("transit_days")) or 0
        arrive = ship + timedelta(days=transit)
        f = o.get("fulfilment") or {}
        promised = f.get("promised_delivery_date")
        plans[o["id"]] = {"order_id": o["id"], "stages": out, "ready_date": ready.isoformat(),
                          "ship_date": ship.isoformat(), "delivery_date": arrive.isoformat(),
                          "promised_delivery_date": promised,
                          "late": bool(promised and arrive.isoformat() > promised),
                          "rush": bool(f.get("rush")), "pieces": pieces}
    return {"today": today.isoformat(), "plans": plans, "load": load}


def _next_dispatch(d: date, dispatch_days: set[int], cal: Calendar) -> date:
    for _ in range(HORIZON_DAYS):
        if d.weekday() in dispatch_days and d.isoformat() not in cal.holidays:
            return d
        d += timedelta(days=1)
    return d


def active_orders(store: PlatformStore) -> list[dict]:
    return [o for o in store.all_orders() if (o.get("fulfilment") or {}).get("status") in ACTIVE]


def plan(store: PlatformStore, today: date | None = None) -> dict:
    production, delivery = config.get(store, "production"), config.get(store, "delivery")
    return schedule(active_orders(store), production, delivery, today)


def promise(store: PlatformStore, pieces: int, rush: bool, transit_days: int, today: date | None = None) -> dict:
    """When would a new order paid now be delivered, given the current workload?"""
    production, delivery = config.get(store, "production"), config.get(store, "delivery")
    probe = {"id": "_new", "total_pieces": pieces, "created_at": datetime.now(timezone.utc).isoformat(),
             "fulfilment": {"status": "queued", "rush": rush, "paid_at": datetime.now(timezone.utc).isoformat(),
                            "promised_ship_date": None, "stages": []},
             "delivery": {"transit_days": transit_days}}
    out = schedule(active_orders(store) + [probe], production, delivery, today)
    p = out["plans"]["_new"]
    return {"ship_date": p["ship_date"], "delivery_date": p["delivery_date"], "ready_date": p["ready_date"],
            "production_days": len({s["start"] for s in p["stages"]} | {s["end"] for s in p["stages"]})}


def utilisation(store: PlatformStore, days: int = 14, today: date | None = None) -> dict:
    """Planned load against capacity per stage for the next `days` working days."""
    production = config.get(store, "production")
    result = plan(store, today)
    cal = Calendar(production)
    d = date.fromisoformat(result["today"])
    dates = []
    for _ in range(days):
        dates.append(d.isoformat())
        d = cal.next_working(d, include=False)
    rows = []
    for s in production["stages"]:
        cap = s["capacity_per_day"]
        cells = [{"date": x, "load": result["load"][s["id"]].get(x, 0), "capacity": cap,
                  "percent": round(100 * result["load"][s["id"]].get(x, 0) / cap)} for x in dates]
        rows.append({"stage": s["id"], "name": s["name"], "days": cells})
    bottleneck = max(rows, key=lambda r: sum(c["load"] for c in r["days"]) / (r["days"][0]["capacity"] or 1))
    return {"dates": dates, "stages": rows, "bottleneck": bottleneck["stage"], "today": result["today"]}
