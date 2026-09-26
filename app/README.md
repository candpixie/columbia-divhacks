# Rentdezvous

Onboarding (budget, places, priorities) and a hex map of NYC colored green / yellow / gray by how well each area fits.

## Run

```sh
cp .env.example .env.local   # TravelTime + Supabase keys; run supabase.sql once in Supabase
npm install
npm run dev
```

The dev server proxies `/api/traveltime` and adds the TravelTime credentials, so the key never reaches the browser. A deployed build needs its own server-side proxy for this.

## Data

- Commute: TravelTime API, public transit, arriving 9 AM on the next weekday (live, one request per place).
- Addresses: NYC GeoSearch (no key).
- Group rooms: Supabase tables `room_people` and `room_times` with live updates (`supabase.sql`).
- Rent (StreetEasy, by neighborhood) and safety (NYPD CompStat): snapshots in `data-src/`.

`node scripts/build-data.mjs` rebuilds `public/data/` (the H3 hex grid and per-neighborhood rent and safety) from `data-src/`.
