# Rent Radius: Devpost draft

**Tagline:** Find where you can afford to live and still get to work, for you and your roommates, from 23 layers of NYC public data.

**Track:** Hack the City
**Also submitting to:** Photon (Agents in iMessage), MLH Best Use of Tiger Data, MLH Best Use of Gemini API, MLH Best .Tech Domain, Capital One (Nessie) if finished

**Try it:** https://rent-radius.vercel.app
**Code:** https://github.com/candpixie/columbia-divhacks

---

## Inspiration

Every New Yorker makes the same tradeoff: rent versus commute. StreetEasy shows you rent. Google Maps shows you commutes. Nobody shows you both, and it gets worse with roommates: three offices, three budgets, one lease, and a group chat that argues for weeks.

We also kept hearing the same thing from each other: "I don't trust the app to get me there on time," and "some trains just don't run on weekends." The cheaper apartment is rarely cheaper once you count the hours.

## What it does

- **Where do we all fit?** Each person adds where they work or study, their max commute, and their share of rent. The map shades every part of NYC where everyone's commute and the combined rent both work, and ranks the neighborhoods.
- **True Cost.** Rent + fares + commute hours, with your time valued at half your hourly pay (US DOT standard). It picks the most dramatic tradeoff automatically: *"Manhattanville costs $2,092/mo more, but gives you all back 6.2 hours a week (worth $427)."*
- **Weekday vs Saturday.** Flip the toggle and watch your reachable city shrink on weekend schedules.
- **Rent since 2010.** Every neighborhood card charts 16 years of median rent, queried live from Tiger Data.
- **23 layers of public data** you can color the map by, each shown as "better than X% of NYC": walk time to supermarkets, pharmacies, clinics, libraries, parks, Citi Bike and accessible subway stations; 311 noise, heat/hot-water and rodent complaints; PM2.5 and NO2 air quality; street trees; income and **rent as a share of local income**; Zillow rent change.
- **Safety, done responsibly.** Crime is opt-in and never part of the ranking. It's per capita, violent felonies only, and shown as a trend vs last year, because raw counts track policing and population as much as danger, and a "safety score" in a housing tool can act like redlining.
- **Roommate group chat agent (Photon Spectrum + iMessage).** Add Rent Radius to your group chat. Everyone texts one line ("I'm Candy, Columbia, 40 min, $1800"). It replies with the neighborhoods that work for all of you and a map link pre-filled with everyone's constraints. It stays quiet during normal chatter.

## What we found

- In **Mott Haven**, a typical 1BR costs **120% of the local median income**. In the Financial District it's **44%**.
- In parts of the South Bronx, 1BR asking rent rose **47% in one year** ($2,195 → $3,219).
- **Greenpoint 2BRs more than doubled** since 2010 ($2,483 → ~$5,700), with the steepest jump in 2022.
- Violent crime is down vs last year in **106 of 197** neighborhoods; citywide murders are down 24% and shootings 13%.

## How we built it

- **Routing:** we built a subway + walking travel-time engine from the MTA's GTFS schedule. Stations × routes form a graph (scheduled ride times, half-headway boarding waits, transfer times), and we precompute hex-to-hex travel times over ~870 H3 cells for weekday 8am and Saturday noon. The browser does all scoring locally, instantly.
- **Data pipeline (Python):** 23 layers from NYC Open Data, NYS open data, MTA, NYPD CompStat (77 weekly precinct reports converted from Excel), IRS income by ZIP, Zillow, StreetEasy, OpenStreetMap, Citi Bike GBFS. Heavy datasets (311, crime) are aggregated server-side with SoQL `snap_to_grid`. Precinct and ZIP data are allocated to neighborhoods by estimated residents.
- **Tiger Data:** 120k monthly rent rows in a TimescaleDB **hypertable**, a **continuous aggregate** for quarterly rent, and a year-over-year view. A Next.js route queries it live, with a static export as fallback so the demo never breaks.
- **Frontend:** Next.js, MapLibre, deck.gl `H3HexagonLayer`, Tailwind. All state lives in the URL, which is what makes the agent's map links work.
- **Agent:** Photon **Spectrum** (`spectrum-ts`) on iMessage. A deterministic parser handles the messy ways people text ("1.5k", "ii am candy", "I live in Park Slope but work at NYU"); **Gemini** with structured output is the fallback for anything it can't read, constrained to our fixed list of places. The agent shares the exact scoring code with the website, so they never disagree.

## Challenges

- Precincts, ZIPs, StreetEasy areas and NYC neighborhoods all have different boundaries. We built resident-weighted crosswalks so every dataset lands on the same 197 neighborhoods.
- Making safety data useful without making it harmful.
- Keeping the demo stable: nothing is computed live except the database query, and that has a fallback.

## Accomplishments

- A real travel-time engine in hours, validated against known commutes (Columbia → Wall St: 35 min weekday, 37 Saturday).
- The rent-burden finding: the neighborhoods that fit a tight budget are often the ones where locals are most rent-burdened.

## What we learned

Public data is rich but scattered across a dozen formats and boundary systems. The hard part isn't getting data, it's making it comparable and honest.

## What's next

- Buses and ferries in the routing engine
- Live service changes (MTA alerts) redrawing commutes in real time
- Rent-stabilized building lookup / overcharge check
- Apartment-level listings

## Built with

nextjs, typescript, python, maplibre, deck.gl, h3, tailwind, tiger-data, timescaledb, postgresql, photon-spectrum, imessage, gemini, vercel, nyc-open-data, mta-gtfs, streeteasy, zillow, irs-soi, openstreetmap

---

### Before submitting, check

- [ ] Team members added on Devpost
- [ ] Photon agent live on iMessage (and screenshots of a real group chat)
- [ ] Nessie finished, or remove it from the tracks list
- [ ] .tech domain registered and linked
- [ ] Screenshots: map, True Cost card, rent chart, Tiger console, iMessage chat
- [ ] Demo video (backup for iMessage)
- [ ] Submitted by **10:30 AM Sunday**
