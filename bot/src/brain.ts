// Group-chat brain: collects each roommate's workplace, max commute and budget,
// then replies with neighborhoods that work for everyone. Pure logic, no Spectrum.
import { readFileSync } from "node:fs";
import path from "node:path";
import { PLACES, placeById } from "../../web/src/lib/places";
import {
  bedsFor, nearestHex, rankNeighborhoods, scoreHexes,
  type Data, type Person,
} from "../../web/src/lib/score";
import { parseWithGemini } from "./gemini";

const DATA_DIR = path.resolve(import.meta.dir, "../../web/public/data");
const MAP_URL = process.env.MAP_URL ?? "http://localhost:3001";

export function loadData(): Data {
  const read = (f: string) => readFileSync(path.join(DATA_DIR, f));
  return {
    hexes: JSON.parse(read("hexes.json").toString()),
    ntas: JSON.parse(read("ntas.json").toString()),
    matrix: { weekday: new Uint8Array(read("matrix_weekday.bin")), saturday: new Uint8Array(read("matrix_saturday.bin")) },
  };
}

// Extra ways people name places in texts.
const ALIASES: Record<string, string[]> = {
  columbia: ["columbia", "cu", "morningside"],
  nyu: ["nyu", "washington square", "wash sq"],
  "nyu-tandon": ["tandon", "metrotech", "poly"],
  "cuny-hunter": ["hunter"],
  ccny: ["ccny", "city college"],
  baruch: ["baruch"],
  fordham: ["fordham"],
  pratt: ["pratt"],
  "cornell-tech": ["cornell tech", "roosevelt island"],
  fidi: ["fidi", "financial district", "wall st", "wall street"],
  wtc: ["wtc", "world trade", "oculus"],
  soho: ["soho"],
  "union-sq": ["union square", "union sq"],
  flatiron: ["flatiron"],
  chelsea: ["chelsea", "google"],
  "hudson-yards": ["hudson yards"],
  midtown: ["midtown", "times square", "times sq"],
  "grand-central": ["grand central"],
  rockefeller: ["rockefeller", "rock center", "30 rock"],
  "upper-east": ["upper east", "ues"],
  harlem: ["harlem", "125th"],
  "washington-heights": ["washington heights", "presbyterian", "168"],
  chinatown: ["chinatown"],
  "downtown-bk": ["downtown brooklyn", "downtown bk"],
  dumbo: ["dumbo"],
  williamsburg: ["williamsburg"],
  "navy-yard": ["navy yard"],
  "park-slope": ["park slope"],
  bushwick: ["bushwick"],
  "sunset-park": ["sunset park", "industry city"],
  lic: ["lic", "long island city"],
  astoria: ["astoria"],
  "jackson-heights": ["jackson heights"],
  flushing: ["flushing"],
  jamaica: ["jamaica"],
  "bronx-hub": ["the hub", "3rd ave bronx"],
  "yankee-stadium": ["yankee stadium", "yankees"],
};

export type Parsed = { name?: string; place?: string; maxMin?: number; budget?: number };

export function parseRules(text: string): Parsed {
  // Where someone lives now isn't where they work: drop "I live near X" before matching places.
  const t = ` ${text.toLowerCase().replace(/[’']/g, "'")} `
    .replace(/\b(?:live|living|stay|staying)\s+(?:in|near|at|by|around|off)\s+[^,.;!?]+?(?=\s+(?:and|but)\b|[,.;!?]|\s*$)/g, " ");
  const out: Parsed = {};
  // Tolerates typos like "ii am", "im", "its", and "Candy here".
  const name = text.match(/(?:^|[\s,.!])(?:i+\s*'?m|i+\s+am|this is|it'?s|name is|call me)\s+([a-zÀ-ɏ]{2,}|\p{Script=Han}+)/iu)
    ?? text.match(/^\s*([a-zÀ-ɏ]{2,}|\p{Script=Han}+)\s+here\b/iu);
  const notNames = new Set(["at", "in", "from", "a", "an", "the", "working", "studying", "looking", "moving",
    "here", "so", "also", "not", "just", "going", "currently", "living", "me"]);
  if (name && !notNames.has(name[1].toLowerCase())) {
    out.name = name[1][0].toUpperCase() + name[1].slice(1).toLowerCase();
  }
  // longest alias first so "downtown brooklyn" beats "brooklyn"
  const hits = Object.entries(ALIASES)
    .flatMap(([id, as]) => as.map((a) => ({ id, a })))
    .filter(({ a }) => new RegExp(`[^a-z]${a.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}[^a-z]`).test(t))
    .sort((x, y) => y.a.length - x.a.length);
  if (hits.length) out.place = hits[0].id;
  const mins = t.match(/(\d{1,3})\s*(?:min|mins|minutes|m\b)/) ?? t.match(/(?:under|max|within)\s*(\d{1,3})\b(?!\s*k)/);
  if (mins) out.maxMin = Math.min(90, Math.max(10, +mins[1]));
  const money = t.match(/\$\s*(\d[\d,]*(?:\.\d+)?)\s*(k)?/) ?? t.match(/(\d[\d,]*(?:\.\d+)?)\s*(k)?\s*(?:\/\s*mo|a month|per month|budget|rent|dollars)/)
    ?? t.match(/budget\D{0,12}(\d[\d,]*(?:\.\d+)?)\s*(k)?/);
  if (money) {
    let v = parseFloat(money[1].replace(/,/g, ""));
    if (money[2] || v < 20) v *= 1000;
    if (v >= 300 && v <= 20000) out.budget = Math.round(v);
  }
  return out;
}

type Member = Partial<Person> & { name: string };
const groups = new Map<string, Map<string, Member>>();

function roster(spaceId: string) {
  let g = groups.get(spaceId);
  if (!g) groups.set(spaceId, (g = new Map()));
  return g;
}

const money = (n: number) => `$${Math.round(n).toLocaleString()}`;

export function mapLink(people: Person[]): string {
  const q = new URLSearchParams();
  people.forEach((p) => q.append("p", `${p.place},${p.maxMin},${p.budget},${p.name}`));
  return `${MAP_URL}/?${q}`;
}

export function recommend(data: Data, people: Person[]): string {
  const workIdx = people.map((p) => { const pl = placeById(p.place)!; return nearestHex(data.hexes, pl.lat, pl.lng); });
  const ranked = rankNeighborhoods(data, scoreHexes(data, "weekday", people, workIdx), people);
  const beds = bedsFor(people.length).toUpperCase();
  const budget = people.reduce((s, p) => s + p.budget, 0);
  if (!ranked.length) {
    const tight = [...people].sort((a, b) => a.maxMin - b.maxMin)[0];
    return `Nothing fits all of you yet (${beds} under ${money(budget)}). Try a bigger budget, or ${tight.name} allowing a longer commute than ${tight.maxMin} min.\n${mapLink(people)}`;
  }
  const lines = ranked.slice(0, 3).map((r, i) =>
    `${i + 1}. ${r.name}: ~${money(r.rent)} ${beds} · ${r.times.map((t, k) => `${people[k].name} ${t}m`).join(", ")}`);
  return [`${ranked.length} neighborhoods work for ${people.length > 1 ? "all of you" : "you"} (${beds} under ${money(budget)}):`, ...lines,
    `Compare them, see true cost + 20+ public datasets: ${mapLink(people)}`].join("\n");
}

const HELP = "Hi! I'm Rent Radius 🏠 Everyone text me where you work or study, your max commute, and your share of rent. e.g. \"I'm Candy, Columbia, 40 min, $1800\". Say \"map\" anytime for results, \"reset\" to start over.";

export async function handle(data: Data, spaceId: string, senderId: string, text: string): Promise<string | null> {
  const g = roster(spaceId);
  const msg = text.trim();
  const lower = msg.toLowerCase();
  if (/^(hi|hey|hello|help|rent radius|@?rent\s?radius)\b/.test(lower) && msg.length < 40) return HELP;
  if (/^(reset|start over|clear)\b/.test(lower)) { groups.delete(spaceId); return "Cleared. Tell me where everyone works, max commute, and rent share."; }

  let p = parseRules(msg);
  if (!p.place && (p.maxMin || p.budget || /work|study|school|office|job/.test(lower))) {
    const ai = await parseWithGemini(msg, PLACES.map((x) => x.id));
    p = { ...ai, ...Object.fromEntries(Object.entries(p).filter(([, v]) => v !== undefined)) };
  }
  const wantsMap = /\b(map|results?|where should we live|what fits|show)\b/.test(lower);
  if (!p.place && !p.maxMin && !p.budget && !p.name && !wantsMap) return null; // normal chatter: stay quiet

  const cur = g.get(senderId) ?? { name: `Roommate ${g.size + 1}` };
  g.set(senderId, { ...cur, ...Object.fromEntries(Object.entries(p).filter(([, v]) => v !== undefined)) });

  const complete = [...g.values()].filter((m): m is Person => !!(m.place && m.maxMin && m.budget)).slice(0, 3);
  const me = g.get(senderId)!;
  const missing = [!me.place && "where you work/study", !me.maxMin && "max commute (min)", !me.budget && "your rent share ($)"].filter(Boolean);

  if (missing.length && !wantsMap) {
    return `Got it${me.name.startsWith("Roommate") ? "" : `, ${me.name}`}. Still need ${missing.join(", ")}.`;
  }
  if (complete.length === 0) return "No one's fully set yet. Text your workplace, max commute and rent share.";
  const waiting = [...g.values()].filter((m) => !(m.place && m.maxMin && m.budget)).map((m) => m.name);
  const head = complete.length === 1 && !wantsMap
    ? `${me.name} is in. Waiting on roommates, but here's you so far:\n`
    : waiting.length ? `(Still missing info from ${waiting.join(", ")}.)\n` : "";
  return head + recommend(data, complete);
}
