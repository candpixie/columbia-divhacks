"""Pressure check: how competitive is each neighborhood's rental market right now?

StreetEasy publishes, per neighborhood per month: rental inventory (active listings) and the share of
listings with a price cut. Days-on-market is not public. Signals (3-month averages, small areas are noisy):
  - price-cut share vs NYC      (few cuts = landlords don't need to budge = hot)
  - inventory vs a year ago     (shrinking supply = hot)
  - 1BR asking rent vs a year ago (from ntas.json trend)
Heat score 0-100 = 0.5 * rank(few cuts) + 0.3 * rank(inventory drop) + 0.2 * rank(rent rise).

Writes web/public/data/competition.json and adds a "competition" layer to layers.json.
"""

import json
from pathlib import Path

import pandas as pd

ROOT = Path(__file__).resolve().parent.parent
SE = ROOT / "raw" / "se"
OUT = ROOT / "web" / "public" / "data"


def months(df):
    return [c for c in df.columns if c[:2] == "20"]


def main():
    disc = pd.read_csv(SE / "discountShare_All.csv").set_index("areaName")
    inv = pd.read_csv(SE / "rentalInventory_All.csv").set_index("areaName")
    dm, im = months(disc), months(inv)
    last3, prev3 = im[-3:], im[-15:-12]

    area = pd.DataFrame({
        "discount": disc[dm[-3:]].mean(axis=1),
        "inventory": inv[last3].mean(axis=1),
        "inv_prev": inv[prev3].mean(axis=1),
    })
    area["inv_yoy"] = area.inventory / area.inv_prev - 1
    city = area.loc["NYC"]

    ntas = json.loads((OUT / "ntas.json").read_text())
    rows = {}
    for code, n in ntas.items():
        names = [a for a in (n.get("se") or []) if a in area.index]
        if not names:
            continue
        a = area.loc[names].dropna(subset=["discount", "inventory"])
        a = a[a.inventory >= 15]  # too few listings to say anything
        if a.empty:
            continue
        w = a.inventory
        rows[code] = {
            "discount": float((a.discount * w).sum() / w.sum()),
            "invYoy": float((a.inv_yoy.fillna(0) * w).sum() / w.sum()),
            "inventory": int(round(w.sum())),
            "rentYoy": n.get("trend"),
        }
    df = pd.DataFrame(rows).T
    df["rentYoy"] = pd.to_numeric(df.rentYoy, errors="coerce").fillna(0)
    score = (0.5 * (1 - df.discount.astype(float).rank(pct=True))
             + 0.3 * (1 - df.invYoy.astype(float).rank(pct=True))
             + 0.2 * df.rentYoy.rank(pct=True))
    df["heat"] = (100 * score.rank(pct=True)).round()

    def label(h):
        return "Very competitive" if h >= 70 else "Competitive" if h >= 40 else "Room to negotiate"

    # citywide seasonality since 2015: when do landlords cut prices?
    series = disc.loc["NYC", [c for c in dm if c >= "2015-01"]]
    by_month = series.groupby(pd.to_datetime(series.index).month).mean()
    inv_city = inv.loc["NYC", [c for c in im if c >= "2015-01"]]
    inv_by_month = inv_city.groupby(pd.to_datetime(inv_city.index).month).mean()

    out = {
        "asOf": im[-1],
        "note": "StreetEasy listings data, 3-month averages. Price-cut share = share of active listings with a price reduction.",
        "city": {
            "discount": round(float(city.discount), 3),
            "invYoy": round(float(city.inv_yoy), 3),
            "byMonth": [{"month": int(m), "discount": round(float(by_month[m]), 3),
                         "inventoryIndex": round(float(inv_by_month[m] / inv_by_month.mean()), 3)} for m in range(1, 13)],
        },
        "ntas": {c: {"heat": int(r.heat), "label": label(r.heat), "discount": round(float(r.discount), 3),
                     "invYoy": round(float(r.invYoy), 3), "rentYoy": float(r.rentYoy), "inventory": int(r.inventory)}
                 for c, r in df.iterrows()},
    }
    (OUT / "competition.json").write_text(json.dumps(out, separators=(",", ":")))

    doc = json.loads((OUT / "layers.json").read_text())
    layer = {"id": "competition", "label": "How competitive renting is", "group": "Housing equity", "unit": "heat (0-100)",
             "better": "low", "source": "StreetEasy (price cuts, inventory, rent)", "year": im[-1], "optional": False,
             "note": "Higher = fewer price cuts, shrinking supply, rising rent.",
             "nta": {c: int(r.heat) for c, r in df.iterrows()}}
    doc["layers"] = [l for l in doc["layers"] if l["id"] != "competition"] + [layer]
    (OUT / "layers.json").write_text(json.dumps(doc, separators=(",", ":")))

    print(f"as of {im[-1]}: {len(df)} NTAs; NYC price cuts {city.discount:.1%}, inventory {city.inv_yoy:+.1%} YoY")
    top = df.sort_values("heat", ascending=False)
    print("hottest:", [(ntas[c]["name"][:22], int(r.heat), f"{r.discount:.0%}") for c, r in top.head(6).iterrows()])
    print("most room:", [(ntas[c]["name"][:22], int(r.heat), f"{r.discount:.0%}") for c, r in top.tail(5).iterrows()])
    print("best months to negotiate:", by_month.sort_values(ascending=False).head(3).round(3).to_dict())


if __name__ == "__main__":
    main()
