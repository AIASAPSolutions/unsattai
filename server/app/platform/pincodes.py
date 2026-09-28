"""PIN code to state or union territory, for display and for state-level service areas.

APPROXIMATE: India Post assigns PIN codes by postal circle, and circles do not follow
state borders exactly (a few districts near borders are served from the next state).
This table maps the leading digits to the state most of that range falls in. It is
good enough to say "Tamil Nadu" on a product page and to match a seller's "TN" area;
it is not an address validator. Longer prefixes override shorter ones.
"""
from __future__ import annotations

import re

STATES = {
    "AN": "Andaman and Nicobar Islands", "AP": "Andhra Pradesh", "AR": "Arunachal Pradesh", "AS": "Assam",
    "BR": "Bihar", "CH": "Chandigarh", "CG": "Chhattisgarh", "DH": "Dadra and Nagar Haveli and Daman and Diu",
    "DL": "Delhi", "GA": "Goa", "GJ": "Gujarat", "HR": "Haryana", "HP": "Himachal Pradesh", "JK": "Jammu and Kashmir",
    "JH": "Jharkhand", "KA": "Karnataka", "KL": "Kerala", "LA": "Ladakh", "LD": "Lakshadweep", "MP": "Madhya Pradesh",
    "MH": "Maharashtra", "MN": "Manipur", "ML": "Meghalaya", "MZ": "Mizoram", "NL": "Nagaland", "OD": "Odisha",
    "PY": "Puducherry", "PB": "Punjab", "RJ": "Rajasthan", "SK": "Sikkim", "TN": "Tamil Nadu", "TS": "Telangana",
    "TR": "Tripura", "UP": "Uttar Pradesh", "UK": "Uttarakhand", "WB": "West Bengal",
}

# Leading digits -> state code. Two-digit entries cover the bulk; three-digit entries
# carve out smaller states and territories inside a range.
PREFIXES = {
    "11": "DL",
    "12": "HR", "13": "HR", "134": "HR", "135": "HR", "136": "HR",
    "14": "PB", "15": "PB", "160": "CH",
    "17": "HP",
    "18": "JK", "19": "JK", "194": "LA",
    "20": "UP", "21": "UP", "22": "UP", "23": "UP", "24": "UP", "25": "UP", "26": "UP", "27": "UP", "28": "UP",
    "244": "UK", "246": "UK", "247": "UK", "248": "UK", "249": "UK", "262": "UK", "263": "UK",
    "30": "RJ", "31": "RJ", "32": "RJ", "33": "RJ", "34": "RJ",
    "36": "GJ", "37": "GJ", "38": "GJ", "39": "GJ", "396": "DH",
    "40": "MH", "41": "MH", "42": "MH", "43": "MH", "44": "MH", "403": "GA",
    "45": "MP", "46": "MP", "47": "MP", "48": "MP",
    "49": "CG",
    "50": "TS",
    "51": "AP", "52": "AP", "53": "AP",
    "56": "KA", "57": "KA", "58": "KA", "59": "KA",
    "60": "TN", "61": "TN", "62": "TN", "63": "TN", "64": "TN", "605": "PY",
    "67": "KL", "68": "KL", "69": "KL",
    "70": "WB", "71": "WB", "72": "WB", "73": "WB", "74": "WB", "737": "SK", "744": "AN",
    "75": "OD", "76": "OD", "77": "OD",
    "78": "AS", "790": "AR", "791": "AR", "792": "AR", "793": "ML", "794": "ML", "795": "MN", "796": "MZ",
    "797": "NL", "798": "NL", "799": "TR",
    "80": "BR", "81": "BR", "82": "JH", "83": "JH", "84": "BR", "85": "BR", "813": "JH", "814": "JH", "815": "JH",
    "816": "JH",
}
# Lakshadweep (682551-682559) sits inside Kerala; Karaikal (6096xx) is Puducherry inside Tamil Nadu.
EXACT_PREFIXES = {"68255": "LD", "6096": "PY"}


def valid(pincode: str) -> bool:
    return bool(re.fullmatch(r"[1-8]\d{5}", pincode or ""))


def state_for(pincode: str) -> str | None:
    """State code for a PIN code, or None when the code is malformed or not in the table."""
    if not valid(pincode):
        return None
    for n in (5, 4, 3, 2):
        code = EXACT_PREFIXES.get(pincode[:n]) or PREFIXES.get(pincode[:n])
        if code:
            return code
    return None


def place(pincode: str) -> dict | None:
    code = state_for(pincode)
    return {"state": code, "state_name": STATES[code]} if code else None
