# Rent Radius: design

DivHacks 2026 (Columbia), Sep 26-27. Track: **Hack the City** (housing equity / rent trends).

## One-liner

Find where you can afford to live and still get to work. Built for roommates arguing in a group chat.

## Problem

Rent and commute are the biggest tradeoff a New Yorker makes, and no tool shows both on one map. StreetEasy shows rent, Google Maps shows commutes, people juggle tabs and guess. With roommates it gets worse: three workplaces, three budgets, one lease.

## Demo (3 min)

1. **Hook (20s):** three of us are moving in together. FiDi, Columbia, LIC. We've been arguing for weeks.
2. **iMessage live (60s):** agent is in the group chat. Each person texts e.g. "I work at Columbia, max 35 min, $1,400 for my share". Agent replies with the top 3 neighborhoods that work for everyone, each person's minutes, the rent, and a map link.
3. **Web map (60s):** link opens pre-filled. Shaded hexes = where everyone's commute and budget overlap. Tap a neighborhood for its card: rent, per-person commute, lines, a one-line tradeoff summary.
4. **Equity toggle (30s):** "How much city does your rent buy?" Same rent, very different 30-minute reach.
5. **Close (10s):** Rent Radius. Stop arguing in the group chat.

## Stability rules

- All travel times precomputed. No live routing.
- Rent is a static cleaned file.
- LLM does only: text -> `{workplace, max_minutes, budget}` (workplace from a fixed enum), plus neighborhood summaries written ahead of time and checked by a person.
- Ranking is deterministic code. Agent replies are templated.
- Backup screen recording of the iMessage flow. Web app stands alone.

## Out of scope

Live listings, buses, accounts, databases.

## Architecture

### 1. Precompute (Python)

- H3 resolution 8 hexes over NYC (~1.5-2k cells).
- Hex-to-hex travel time matrix, weekday 8-9am, subway + walk.
  - Plan A: r5py + MTA GTFS + NYC OSM extract (needs Java 21).
  - Plan B (switch by 3pm Sat if A stalls): station graph from GTFS `stop_times` (median segment times + transfer penalty), hex-to-station walking at 5 km/h straight-line x 1.3.
- Output `matrix.bin`: uint8 minutes, capped at 90 (255 = unreachable), row-major `[origin][dest]`.
- Rent: StreetEasy median asking rent by neighborhood, joined to NYC NTA 2020 boundaries, assigned per hex.
- Equity metric: per hex, count of hexes reachable in <= 30 min.

### 2. Data contract (lock at 11:00 Sat)

```
public/data/hexes.json   [{ "h3": "882a100d2dfffff", "nta": "QN0151", "rent": {"studio":..,"1br":..,"2br":..,"3br":..}, "reach30": 412 }]
public/data/matrix.bin   Uint8Array, length N*N, index = origin*N + dest (order = hexes.json)
public/data/places.json  [{ "id": "columbia", "name": "Columbia University", "h3": "..." }]   ~60 workplaces, the agent's enum
public/data/cards.json   { "<nta>": { "name": "Astoria", "lines": ["N","W"], "summary": "..." } }
URL state                ?p=columbia,35,1400&p=fidi,30,1400&beds=3
```

### 3. Scoring (shared TS module, `lib/score.ts`)

A hex qualifies if every person's commute <= their max and the rent for `beds = people count` is <= the sum of budgets. Score = worst commute + rent penalty. Aggregate to neighborhoods for the top 3. The web app and the agent both import this one module.

### 4. Web app

Next.js on Vercel. MapLibre + deck.gl `H3HexagonLayer`, static data only. People panel, neighborhood cards, equity toggle. All state in the URL.

### 5. iMessage agent

Bun + `@photon-ai/imessage-kit` on one team Mac (Full Disk Access). `onGroupMessage` -> Gemini structured output -> per-chat, per-sender constraints in memory -> once >= 2 people, score and reply from a template with the map link.

## Sponsors

Photon (group chat flow), Gemini (parsing + summaries), .Tech domain. MongoDB skipped (no need for a DB).

## Team

| Who | Owns |
|---|---|
| Vorld | Precompute pipeline |
| Candy | Web app (map, panels, cards, equity toggle) |
| 逆光 | Photon agent + Gemini parsing |
| Tyler | Rent data + joins, cards, deck, demo script |

## Timeline

- Sat 11:00 data contract locked
- Sat 3pm end-to-end with fake data; Plan A/B routing decision
- Sat 8pm real matrix + rent on map
- Midnight agent replies with real top 3
- Sun 9am feature freeze, polish, record backup, rehearse 3x
- Sun 12pm judging
