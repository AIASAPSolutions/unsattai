"""Production and delivery planning.

Finite-capacity forward scheduling: every paid order passes through the configured
stages (artwork, printing, pressing, cutting, stitching, QC, packing). Each stage has a
daily capacity in pieces, and orders are loaded in priority order: express first, then
the earliest promised ship date, then payment time. An order can span several days
in a stage, and several orders share a day. A stage's `fixed_days` holds the next
stage back (curing, batching).

The same scheduler answers "when would a new order arrive?" at checkout, by planning
the current workload plus the new order, so promises follow real capacity.

Each seller is planned on its own: the global stages with capacities multiplied by
the seller's capacity_factor, the seller's holidays on top of the global ones and its
handling days before dispatch, over that seller's orders only.
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


def schedule(orders: list[dict], production: dict, delivery: dict, today: date | None = None,
             handling_days: int = 0) -> dict:
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
        ship = _next_dispatch(cal.add_working(ready, handling_days) + timedelta(days=1), dispatch_days, cal)
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


def active_orders(store: PlatformStore, seller_id: str | None = None) -> list[dict]:
    from .security import seller_id_of
    return [o for o in store.all_orders() if (o.get("fulfilment") or {}).get("status") in ACTIVE
            and (seller_id is None or seller_id_of(o) == seller_id)]


def _sellers(store: PlatformStore, seller_id: str | None) -> dict[str, dict | None]:
    """Sellers to plan: the one asked for, or every seller that has work plus the active ones."""
    from .security import HOUSE_SELLER
    if seller_id:
        return {seller_id: store.get("seller", seller_id)}
    rows, _ = store.find("seller", limit=500, order="created_at ASC")
    out = {s["id"]: s for s in rows}
    out.setdefault(HOUSE_SELLER, None)
    return out


def plan(store: PlatformStore, today: date | None = None, seller_id: str | None = None) -> dict:
    """Plans for every seller (or one), each against its own capacity. `load` is the total over
    the sellers planned; `by_seller` keeps each seller's load and capacities."""
    from . import sellers
    from .security import seller_id_of
    production, delivery = config.get(store, "production"), config.get(store, "delivery")
    groups: dict[str, list[dict]] = {}
    for o in active_orders(store, seller_id):
        groups.setdefault(seller_id_of(o), []).append(o)
    todays, plans, by_seller = [], {}, {}
    load: dict[str, dict[str, int]] = {s["id"]: {} for s in production["stages"]}
    for sid, seller in _sellers(store, seller_id).items():
        if seller is not None and not seller.get("active", True) and sid not in groups:
            continue
        prod = sellers.production_for(production, seller)
        res = schedule(groups.get(sid, []), prod, delivery, today, (seller or {}).get("handling_days", 0))
        todays.append(res["today"])
        plans.update({oid: {**p, "seller_id": sid} for oid, p in res["plans"].items()})
        by_seller[sid] = {"load": res["load"], "capacity": {s["id"]: s["capacity_per_day"] for s in prod["stages"]},
                          "production": prod}
        for st, days in res["load"].items():
            for d, n in days.items():
                load[st][d] = load[st].get(d, 0) + n
    first_day = min(todays) if todays else Calendar(production).next_working(today or Calendar(production).today()).isoformat()
    return {"today": first_day, "plans": plans, "load": load, "by_seller": by_seller}


def promise(store: PlatformStore, pieces: int, rush: bool, transit_days: int, today: date | None = None,
            seller: dict | None = None) -> dict:
    """When would a new order paid now be delivered by this seller (the house seller by default),
    given that seller's current workload?"""
    from . import sellers
    from .security import HOUSE_SELLER
    if seller is None:
        seller = store.get("seller", HOUSE_SELLER)
    sid = (seller or {}).get("id") or HOUSE_SELLER
    production, delivery = config.get(store, "production"), config.get(store, "delivery")
    probe = {"id": "_new", "total_pieces": pieces, "created_at": datetime.now(timezone.utc).isoformat(),
             "fulfilment": {"status": "queued", "rush": rush, "paid_at": datetime.now(timezone.utc).isoformat(),
                            "promised_ship_date": None, "stages": []},
             "delivery": {"transit_days": transit_days}}
    out = schedule(active_orders(store, sid) + [probe], sellers.production_for(production, seller), delivery, today,
                   (seller or {}).get("handling_days", 0))
    p = out["plans"]["_new"]
    return {"ship_date": p["ship_date"], "delivery_date": p["delivery_date"], "ready_date": p["ready_date"],
            "production_days": len({s["start"] for s in p["stages"]} | {s["end"] for s in p["stages"]})}


def utilisation(store: PlatformStore, days: int = 14, today: date | None = None, seller_id: str | None = None) -> dict:
    """Planned load against capacity per stage for the next `days` working days.

    With a seller, that seller's load and capacity; without, all sellers added together."""
    production = config.get(store, "production")
    result = plan(store, today, seller_id)
    cal = Calendar(production)
    d = date.fromisoformat(result["today"])
    dates = []
    for _ in range(days):
        dates.append(d.isoformat())
        d = cal.next_working(d, include=False)
    groups = result["by_seller"].values()
    rows = []
    for s in production["stages"]:
        cells = []
        for x in dates:
            # a seller's capacity counts only on its own working days
            cap = sum(g["capacity"][s["id"]] for g in groups if Calendar(g["production"]).is_working(date.fromisoformat(x)))
            ld = result["load"][s["id"]].get(x, 0)
            cells.append({"date": x, "load": ld, "capacity": cap, "percent": round(100 * ld / cap) if cap else 0})
        rows.append({"stage": s["id"], "name": s["name"], "days": cells})
    bottleneck = max(rows, key=lambda r: sum(c["load"] for c in r["days"]) / (max(c["capacity"] for c in r["days"]) or 1))
    return {"dates": dates, "stages": rows, "bottleneck": bottleneck["stage"], "today": result["today"],
            "seller_id": seller_id}
