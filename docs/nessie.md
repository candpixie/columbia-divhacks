# Capital One Nessie: handoff

**What it does:** a roommate "links a bank" (a fictional Nessie sandbox customer). We read their payroll deposits, get yearly income, and use it for:
1. **Landlord 40x rule:** max monthly rent they'd be approved for = income / 40
2. **True Cost:** their hourly pay values their commute time (`Person.income`, already supported in `TrueCost.tsx`)

## Setup (once)
1. Get a key at https://nessieisreal.com, then add `NESSIE_API_KEY=...` to `web/.env.local` (and to Vercel env).
2. Seed demo roommates: `NESSIE_API_KEY=... .venv/bin/python precompute/seed_nessie.py`
   → writes `web/public/data/nessie_demo.json` (names + customer ids, no secrets)

## API
`GET /api/income?customer=<id>` →
`{ source: "nessie", annualIncome, paychecks, maxRent40x, hourlyPay }`

## Frontend hook (for whoever owns page.tsx)
Per person, a small "Link bank (demo)" select filled from `/data/nessie_demo.json`. On pick:
```ts
const r = await fetch(`/api/income?customer=${id}`).then((r) => r.json());
update(k, { income: r.annualIncome, budget: Math.min(p.budget, r.maxRent40x) });
```
Show a badge: `✓ Approved up to $X/mo (40x rule)` or `✗ Needs a guarantor above $X/mo`.
