# Rent Radius bot

Photon Spectrum iMessage agent. Roommates text where they work, max commute and rent share; it replies with neighborhoods that fit everyone plus a pre-filled map link.

```sh
bun install
bun run chat      # local group-chat simulator, no keys needed
bun run start     # iMessage via Spectrum (needs PROJECT_ID, PROJECT_SECRET in .env)
```

Optional: `GEMINI_API_KEY` (fallback parser), `MAP_URL` (deployed site, default http://localhost:3001).
