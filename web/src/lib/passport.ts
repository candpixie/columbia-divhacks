// NYC Passport: which hexes someone has visited, packed into a short shareable code.
// One bit per hex (~870 hexes -> ~110 bytes -> ~150 URL-safe characters). No accounts, no server.

export type Passport = { name: string; visited: Set<number> };

export function encode(visited: Set<number>, total: number): string {
  const bytes = new Uint8Array(Math.ceil(total / 8));
  visited.forEach((i) => { if (i < total) bytes[i >> 3] |= 1 << (i & 7); });
  let s = "";
  bytes.forEach((b) => (s += String.fromCharCode(b)));
  return btoa(s).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

export function decode(code: string, total: number): Set<number> {
  const out = new Set<number>();
  try {
    const b64 = code.replace(/-/g, "+").replace(/_/g, "/");
    const s = atob(b64 + "===".slice((b64.length + 3) % 4));
    for (let i = 0; i < Math.min(total, s.length * 8); i++) {
      if (s.charCodeAt(i >> 3) & (1 << (i & 7))) out.add(i);
    }
  } catch {
    /* bad link: treat as empty */
  }
  return out;
}

export function shareLink(p: Passport, total: number, origin: string): string {
  const q = new URLSearchParams({ friend: encode(p.visited, total), name: p.name || "A friend" });
  return `${origin}/nyc-passport?${q}`;
}

const KEY = "nyc-passport:v1";
type Saved = { name: string; code: string; friends: { name: string; code: string }[] };

export function load(): Saved | null {
  try {
    const raw = localStorage.getItem(KEY);
    return raw ? JSON.parse(raw) : null;
  } catch {
    return null;
  }
}

export function save(s: Saved) {
  try {
    localStorage.setItem(KEY, JSON.stringify(s));
  } catch {
    /* private mode: passport just won't persist */
  }
}

// Deterministic demo passports: a walk through a few neighborhoods, so the friends view isn't empty on stage.
export function demoVisits(hexes: { nta: string }[], ntas: string[], seed: number): Set<number> {
  let x = seed;
  const rand = () => ((x = (x * 1103515245 + 12345) % 2147483648) / 2147483648);
  const out = new Set<number>();
  for (const nta of ntas) {
    const cells = hexes.flatMap((h, i) => (h.nta === nta ? [i] : []));
    cells.forEach((i) => { if (rand() < 0.7) out.add(i); });
  }
  return out;
}
