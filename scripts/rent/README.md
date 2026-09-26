# Rent by ZIP (Zillow ZORI)

`build_zip_rent.py` turns Zillow's ZIP-level rent index into typical rent per NYC ZIP, plus expected rent by move-in month.

## Input

`data/raw/Zip_zori_uc_sfrcondomfr_sm_month.csv`. This is the Zillow Observed Rent Index (ZORI) for all home types, smoothed but **not** seasonally adjusted. It has one row per ZIP and monthly columns from `2015-01-31` on.
Download: https://files.zillowstatic.com/research/public_csvs/zori/Zip_zori_uc_sfrcondomfr_sm_month.csv

NYC means `State == "NY"` and `CountyName` is one of New York, Kings, Queens, Bronx or Richmond County. That gives 149 ZIPs as of the Aug 2026 file. `City` isn't used for filtering.

## Rerun

```sh
python -m venv .venv && .venv/bin/pip install pandas   # once
.venv/bin/python scripts/rent/build_zip_rent.py          # or pass another CSV path as the first argument
```

Sanity checks print at the end. The script exits non-zero if any of them fail:
- exactly 149 ZIPs, all 5 digits, all five boroughs present
- 10025 and 10027 within 10% of about $4,700 and about $3,900
- every `season_idx` between 0.9 and 1.1

It also prints the citywide seasonal curve, with a warning if summer isn't above winter.

## Outputs

| File | Contents |
|---|---|
| `data/processed/zip_rent_monthly.csv` | `zip, month (1-12), avg_rent, season_idx, n_years` |
| `data/processed/zip_rent.csv` | `zip, county, rent_12mo, rent_yoy, jan..dec, cheapest_month, priciest_month, season_swing, first_month_with_data, months_in_12mo` |
| `web/public/data/zip_rent.json` | Same fields as `zip_rent.csv`, keyed by ZIP. Read it with `web/src/lib/rent.ts`. |

## Method

- **`rent_12mo`**: the mean of the last 12 calendar months in the file. Some ZIPs have gaps, so this averages the months that exist; `months_in_12mo` gives the count.
- **`rent_yoy`**: `rent_12mo` divided by the mean of the 12 months before, minus 1. It is empty when that earlier year has no data.
- **`season_idx`**: first, compute each ZIP's centered 12-month rolling mean (`min_periods=9`). This runs on a gap-free calendar index, so missing months don't shift the window. Next, divide rent by that trend. Then average the ratio by calendar month, skipping 2020–2021 (COVID).
  - `n_years` is how many observations went into each month's average.
  - When `n_years < 3`, the citywide median `season_idx` for that month is used instead.
  - The 12 values aren't renormalized to average exactly 1. Per-ZIP means range from about 0.997 to 1.007.
- **`avg_rent`** (and `jan..dec`): `rent_12mo * season_idx`, rounded.
- **`cheapest_month` / `priciest_month` / `season_swing`**: the lowest and highest of the 12 monthly values, and the dollar gap between them.

Not yet included: an ACS fallback for NYC ZIPs with no ZORI row (there's a TODO in the script), StreetEasy data, and joins to neighborhoods.
