# Rent Radius bot

Photon Spectrum iMessage agent that helps a roommate group chat decide where to live.

What it does in the chat:
- **Group intake:** everyone texts where they work and max commute; the bot reacts 👍 instead of cluttering the chat
- **Private budgets:** people DM their rent share; the group only ever sees the combined total (map links use an even split)
- **Results + link preview** once 2+ people are ready, then a **native iMessage poll** over the top 3 neighborhoods
- **Referee:** "X is too far / too expensive" gets a numbers-based alternative (phrased by Gemini, grounded in our data)
- **Decision:** poll majority → 🎉 confetti effect, group renamed "🏠 <Neighborhood> Hunt", and a **spoken recap voice note** (ElevenLabs)
- Every native feature falls back to plain text if the platform rejects it (e.g. "Reply 1, 2 or 3 to vote")

```sh
bun install
bun run chat      # local simulator: "Name: msg", "DM Name: msg", "Name votes: Option"
bun run start     # live on iMessage via Spectrum
```

`.env` (see `.env.example`): `PROJECT_ID`, `PROJECT_SECRET` (required); `GEMINI_API_KEY`, `ELEVENLABS_API_KEY` (optional); `MAP_URL` (default https://rent-radius.vercel.app).
