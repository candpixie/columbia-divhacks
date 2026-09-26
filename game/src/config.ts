// Every tuning knob lives here so balance changes need no code changes (PRD: Technical Spec).
// Title and chaser are placeholders: "Pac-Man" is a Bandai Namco trademark, so the chaser is an original design.
export const CONFIG = {
  title: 'Manhattan Haunt',
  tagline: 'You are the ghost. Something is hungry. Find the secret place before it finds you.',
  chaserName: 'the Chomper',

  // speeds in game meters per second (the island is ~20 km long)
  ghostSpeed: 58,
  chaserStartSpeed: 44,
  chaserMaxSpeed: 68,
  chaserSpeedGainPerSec: 0.12,
  chaserReactionMs: 550, // it chases where you were this long ago
  chaserReplanMs: 400,
  chaserSpawnMinM: 1300,
  chaserSpawnMaxM: 1900,

  catchRadiusM: 16,
  landmarkRadiusM: 55,
  targetRadiusM: 50,
  warnRadiusM: 420, // proximity warning starts here

  zoom: 16.2,
  minZoom: 15.2,
  maxZoom: 17.2,

  maxHints: 4,
  targetBonusBase: 500,
  targetBonusPerUnusedHint: 250,
  pointsPerSecond: 1,
} as const
