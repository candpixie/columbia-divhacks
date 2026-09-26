# Tenant protections by building and ZIP (nycdb + JustFix)

`build_buildings.py` reads a local [nycdb](https://github.com/nycdb/nycdb) Postgres database. For every residential lot it computes rent-stabilized units, open HPD violations and a Good Cause Eviction "likely covered" flag, then rolls the results up to ZIP.

## Setup (once)

```sh
brew install postgresql@16 && brew services start postgresql@16
export PATH="/opt/homebrew/opt/postgresql@16/bin:$PATH"
createdb nycdb
psql -d nycdb -c "create role nycdb login password 'nycdb'; alter database nycdb owner to nycdb; grant all on schema public to nycdb;"
.venv/bin/pip install nycdb pandas psycopg
for d in pluto_latest rentstab_v2 hpd_registrations hpd_violations; do
  .venv/bin/nycdb --root-dir raw/nycdb --download $d && .venv/bin/nycdb --root-dir raw/nycdb --load $d
done
```

Two workarounds as of Sep 2026:
- **The PyPI release is behind the current PLUTO release.** nycdb 0.4.1 on PyPI rejects the current Open Data PLUTO because of new columns such as `affresfar`, `mihopt*` and `transitzone`. Load `pluto_latest` with the GitHub version instead: `pip install "git+https://github.com/nycdb/nycdb.git#subdirectory=src"`.
- **nycdb's PLUTO post-load SQL needs PostGIS.** It adds a geometry column, and the whole file fails without PostGIS, including the `postcode` → `zipcode` rename. If you don't have PostGIS, apply the file without its geometry lines:
  ```sh
  grep -v -i -E "geom|ST_Point" $(python -c "import nycdb,os;print(os.path.dirname(nycdb.__file__))")/sql/pluto_latest.sql | psql -d nycdb
  ```

`hpd_violations` is several GB, and Socrata downloads run at about 1 MB/s. nycdb skips any file that already exists and isn't empty, so if a download is interrupted, delete the partial CSV in `raw/nycdb/` before retrying.

## Rerun

```sh
.venv/bin/python scripts/justfix/build_buildings.py   # NYCDB_URL overrides the default connection
```

The script needs `data/processed/zip_rent.csv` from `scripts/rent/` for the ZIP-overlap check.

## Outputs

| File | Contents |
|---|---|
| `data/processed/buildings.csv.gz` (gzipped; `pd.read_csv` reads it directly) | `bbl, address, zip, lat, lon, res_units, year_built, stab_units, open_hpd_violations, violations_per_unit, good_cause_likely, good_cause_reason`, plus `bldgclass, portfolio_units` |
| `data/processed/zip_protections.csv` | `zip, stab_units, res_units, stab_share, stab_buildings, median_violations_per_unit`, plus `buildings, open_hpd_violations, good_cause_likely_units, good_cause_likely_share` |

## Where each column comes from

- **Buildings**: every `pluto_latest` lot with `unitsres > 0`. The ZIP is PLUTO `postcode`, zero-padded to 5 digits.
- **`stab_units`**: `rentstab_v2.uc2023`, the rent-stabilized unit count from 2023 DOF tax bills and the latest year in nycdb. Lots missing from the table count as 0.
- **`open_hpd_violations`**: rows in `hpd_violations` with `violationstatus = 'Open'` and `class` B or C.
- **`median_violations_per_unit`**: the median over buildings with 3 or more units in the ZIP. Across all lots it would be 0 almost everywhere, because most lots are 1–2 family homes.
- **`portfolio_units`**: an estimate of how many units the landlord owns. Lots whose HPD registration shares an owner-type contact's business address (CorporateOwner, IndividualOwner, JointOwner or HeadOfficer) are grouped together, and their PLUTO units are summed. This is a rough version of Who Owns What's grouping, and it can overcount when many owners use the same management-company address.

## Good Cause "likely" flag

This mirrors the building-level checks in [JustFixNYC/gce-screener](https://github.com/JustFixNYC/gce-screener) (`src/hooks/useCriteriaResults.tsx`). The flag says only "likely" and never "covered". Rent, bedroom count, whether this particular unit is stabilized, owner occupancy and subsidies all depend on the tenant, and those are for [goodcausenyc.org](https://goodcausenyc.org/en) to answer.

A lot is **not** likely covered if any of these apply:
- It's the manufactured-housing lot (5013920002).
- The owner name contains "HOUSING AUTHORITY" (NYCHA).
- The building is a co-op (C6, C8, CC, D0, DC, D4), a condo (R\*), or another excluded class: educational (W\*), hotel (H\*), religious (M\*) or health facility (I\*).
- Every unit is rent-stabilized. Those tenants already have stronger protections.
- It was built in 2009 or later. The screener checks the latest certificate of occupancy; year built is the closest proxy in PLUTO.

Otherwise, it's likely covered when:
- the building has more than 10 units, or
- it has 10 or fewer units but `portfolio_units` is over 10. The small-landlord and owner-occupied exemptions could still apply.
