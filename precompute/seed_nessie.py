"""Seed Capital One Nessie (sandbox bank) with demo roommates and 12 months of paychecks.

Each roommate gets a checking account with biweekly payroll deposits, rent payments and
some everyday purchases, so /api/income can derive yearly income from real transactions.

Writes web/public/data/nessie_demo.json with customer ids (no secrets).
Usage: NESSIE_API_KEY=... .venv/bin/python precompute/seed_nessie.py
"""

import json
import os
import urllib.request
from datetime import date, timedelta
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
OUT = ROOT / "web" / "public" / "data" / "nessie_demo.json"
API = "https://api.nessieisreal.com"
KEY = os.environ["NESSIE_API_KEY"]

# Demo people (fictional). Salaries chosen to show the 40x rule both passing and failing.
PEOPLE = [
    {"first": "Maya", "last": "Chen", "zip": "10027", "salary": 78_000, "rent": 1_600},
    {"first": "Jordan", "last": "Rivera", "zip": "11201", "salary": 62_000, "rent": 1_400},
    {"first": "Sam", "last": "Okafor", "zip": "11101", "salary": 105_000, "rent": 1_900},
]


def call(method, path, body=None):
    req = urllib.request.Request(
        f"{API}{path}{'&' if '?' in path else '?'}key={KEY}",
        data=json.dumps(body).encode() if body is not None else None,
        method=method,
        headers={"Content-Type": "application/json", "Accept": "application/json"},
    )
    with urllib.request.urlopen(req, timeout=30) as r:
        return json.loads(r.read() or "{}")


def created_id(resp):
    return (resp.get("objectCreated") or {}).get("_id")


def main():
    today = date.today()
    people_out = []
    for p in PEOPLE:
        cust = created_id(call("POST", "/customers", {
            "first_name": p["first"], "last_name": p["last"],
            "address": {"street_number": "1", "street_name": "Main St", "city": "New York", "state": "NY", "zip": p["zip"]},
        }))
        acct = created_id(call("POST", f"/customers/{cust}/accounts", {
            "type": "Checking", "nickname": f"{p['first']} checking", "rewards": 0, "balance": 3000,
        }))
        # 26 biweekly paychecks over the last year
        net_check = round(p["salary"] / 26, 2)
        for i in range(26):
            d = today - timedelta(days=14 * i + 3)
            call("POST", f"/accounts/{acct}/deposits", {
                "medium": "balance", "transaction_date": d.isoformat(), "status": "completed",
                "amount": net_check, "description": "PAYROLL DIRECT DEP",
            })
        # monthly rent + a few purchases, so the account looks real
        for m in range(12):
            d = (today.replace(day=1) - timedelta(days=30 * m)).replace(day=1)
            call("POST", f"/accounts/{acct}/withdrawals", {
                "medium": "balance", "transaction_date": d.isoformat(), "status": "completed",
                "amount": p["rent"], "description": "RENT",
            })
        people_out.append({"name": p["first"], "customer_id": cust, "account_id": acct, "salary": p["salary"]})
        print(f"seeded {p['first']}: customer {cust}, account {acct}")

    OUT.write_text(json.dumps({"note": "Fictional demo customers in the Nessie sandbox", "people": people_out}, indent=1))
    print(f"wrote {OUT}")


if __name__ == "__main__":
    main()
