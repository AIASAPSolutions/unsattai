"""Starting configuration. Everything here is editable in the operations app
(Settings) and every change is versioned, so a new install works on day one and a
business can then make it its own. Amounts are in the currency's main unit."""
from __future__ import annotations

PRICE_BOOK = {
    "currency": "INR",
    "garments": {
        "jersey": {"name": "Crew-neck jersey", "base": 499},
        "vneck": {"name": "V-neck jersey", "base": 549},
        "shorts": {"name": "Shorts", "base": 349},
    },
    "fabrics": [
        {"id": "standard", "name": "Dri-fit polyester, 140 GSM", "surcharge": 0, "garments": ["jersey", "vneck", "shorts"]},
        {"id": "premium", "name": "Micro-mesh polyester, 160 GSM", "surcharge": 120, "garments": ["jersey", "vneck", "shorts"]},
        {"id": "pro", "name": "Lycra blend, 180 GSM", "surcharge": 220, "garments": ["jersey", "vneck"]},
    ],
    # Per size, any fit. Sizes not listed cost nothing extra.
    "size_surcharge": {"XS": 0, "S": 0, "M": 0, "L": 0, "XL": 0, "XXL": 60, "3XL": 90,
                       "4Y": 0, "6Y": 0, "8Y": 0, "10Y": 0, "12Y": 0, "14Y": 0},
    # Garment options, per piece. A negative price is a discount. Inactive choices are hidden.
    "options": {
        "sleeves": {
            "short": {"name": "Short sleeves", "price": 0, "active": True},
            "long": {"name": "Long sleeves", "price": 60, "active": True},
            "none": {"name": "Sleeveless", "price": -20, "active": True},
        },
        "collar": {
            "crew": {"name": "Crew neck", "price": 0, "active": True},
            "polo": {"name": "Polo collar with buttons", "price": 90, "active": True},
            "mandarin": {"name": "Mandarin collar", "price": 50, "active": True},
        },
        "fit": {
            "men": {"name": "Men / unisex", "price": 0, "active": True},
            "women": {"name": "Women", "price": 0, "active": True},
            "kids": {"name": "Kids", "price": -60, "active": True},
        },
    },
    "personalisation": {"name": 40, "number": 30},
    "logo_per_piece": 25,
    "quantity_tiers": [
        {"min": 1, "discount": 0.0}, {"min": 10, "discount": 0.05}, {"min": 25, "discount": 0.10},
        {"min": 50, "discount": 0.15}, {"min": 100, "discount": 0.20},
    ],
    "minimum_pieces": 1,
    "rush": {"enabled": True, "fee_rate": 0.25, "label": "Express production"},
    "tax": {"name": "GST", "rate": 0.05, "rate_above": 0.12, "threshold_per_piece": 1000, "inclusive": False},
    "coupons": [
        {"code": "WELCOME10", "kind": "percent", "value": 10, "max_discount": 500, "min_subtotal": 1000,
         "active": True, "expires": None, "note": "First order", "public": True,
         "title": "10% off orders above 1000 (up to 500)"},
    ],
    # Cash on delivery. A seller's service area must also allow it for the PIN code.
    "cod": {"enabled": True, "fee": 49, "max_order_value": 20000},
}

PRODUCTION = {
    "timezone": "Asia/Kolkata",
    "working_days": [0, 1, 2, 3, 4, 5],          # Monday = 0
    "holidays": [],                              # "2026-10-20"
    "daily_cutoff_hour": 14,                     # orders paid after this start planning next working day
    # fixed_days: days that must pass after a stage before the next can start (curing, batching).
    "stages": [
        {"id": "prepress", "name": "Artwork and print files", "capacity_per_day": 2000, "fixed_days": 0},
        {"id": "print", "name": "Sublimation printing", "capacity_per_day": 400, "fixed_days": 0},
        {"id": "press", "name": "Heat press", "capacity_per_day": 400, "fixed_days": 1},
        {"id": "cut", "name": "Cutting", "capacity_per_day": 500, "fixed_days": 0},
        {"id": "stitch", "name": "Stitching", "capacity_per_day": 250, "fixed_days": 1},
        {"id": "qc", "name": "Quality check", "capacity_per_day": 600, "fixed_days": 0},
        {"id": "pack", "name": "Packing", "capacity_per_day": 800, "fixed_days": 0},
    ],
    "rush_priority": True,
}

DELIVERY = {
    "origin": {"city": "Tiruppur", "state": "TN", "pincode": "641601"},
    "dispatch_days": [0, 1, 2, 3, 4, 5],
    "pickup": {"enabled": True, "label": "Collect from our workshop", "fee": 0},
    "zones": [
        {"id": "home", "name": "Tamil Nadu", "states": ["TN"], "pincode_prefixes": ["60", "61", "62", "63", "64"],
         "base": 80, "per_piece": 4, "free_above": 5000, "transit_days": 2},
        {"id": "south", "name": "South India", "states": ["KL", "KA", "AP", "TS", "PY"],
         "pincode_prefixes": ["50", "51", "52", "53", "56", "57", "58", "59", "67", "68", "69"],
         "base": 120, "per_piece": 6, "free_above": 8000, "transit_days": 3},
        {"id": "metro", "name": "Metro cities", "states": ["DL", "MH"], "pincode_prefixes": ["11", "40"],
         "base": 150, "per_piece": 7, "free_above": 10000, "transit_days": 4},
        {"id": "rest", "name": "Rest of India", "states": [], "pincode_prefixes": [],
         "base": 180, "per_piece": 8, "free_above": 12000, "transit_days": 6},
    ],
    "carriers": [
        {"id": "surface", "name": "Surface courier", "tracking_url": "", "active": True},
        {"id": "air", "name": "Air express", "tracking_url": "", "active": True},
    ],
}

COMPANY = {
    "name": "UrJersey",
    "legal_name": "",
    "tax_id": "",
    "email": "",
    "phone": "",
    "address": "",
    "invoice_prefix": "UJ",
    "quote_valid_days": 14,
    "support_hours": "Mon-Sat 9:30-18:30",
}

CRM = {
    "lead_stages": ["new", "contacted", "design_shared", "quoted", "negotiation", "won", "lost"],
    "lead_sources": ["web", "mobile", "whatsapp", "walk_in", "referral", "event", "phone", "other"],
    "organisation_kinds": ["team", "club", "school", "college", "academy", "company", "event", "other"],
    "ticket_categories": ["order_status", "sizing", "quality", "delivery", "payment", "design", "other"],
    "reorder_reminder_days": 300,
    # Custom printed goods: returnable only for these reasons, within this many days of delivery.
    "return_window_days": 7,
    "returnable_reasons": ["damaged", "wrong_item", "print_quality"],
}

from ..engine.sizing import DEFAULT_SIZING as SIZING  # noqa: E402

ALL = {"sizing": SIZING, "price_book": PRICE_BOOK, "production": PRODUCTION, "delivery": DELIVERY, "company": COMPANY, "crm": CRM}
