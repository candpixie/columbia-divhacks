// Group-chat brain: collects each roommate's workplace, max commute and budget,
// then replies with neighborhoods that work for everyone. Pure logic, no Spectrum.
import { readFileSync } from "node:fs";
import path from "node:path";
import { PLACES, placeById } from "../../web/src/lib/places";
import {
  bedsFor, nearestHex, rankNeighborhoods, scoreHexes,
  type Data, type NtaResult, type Person,
} from "../../web/src/lib/score";
import { parseWithGemini, phraseWithGemini } from "./gemini";

const DATA_DIR = path.resolve(import.meta.dir, "../../web/public/data");
const MAP_URL = process.env.MAP_URL ?? "https://rent-radius.vercel.app";

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
    ?? t.match(/budget\D{0,12}(\d[\d,]*(?:\.\d+)?)\s*(k)?/)
    ?? t.match(/(?:^|[^\d.])(\d{1,2}(?:\.\d+)?)\s*(k)\b/) // bare "2k", "1.5k"
    ?? t.match(/(?:^|[^\d$])(\d{1,2},?\d{3})(?!\s*(?:min|m\b|minutes))/); // bare "1800", "2,000"
  if (money) {
    let v = parseFloat(money[1].replace(/,/g, ""));
    if (money[2] || v < 20) v *= 1000;
    if (v >= 300 && v <= 20000) out.budget = Math.round(v);
  }
  // bare two-digit number left over ("columbia 45 1800") is the commute
  if (!out.maxMin) {
    const bare = t.replace(/\d[\d,]*(?:\.\d+)?\s*k\b|\$\s*[\d,.]+|\d{3,}/g, " ").match(/(?<!\b(?:am|im|i'm|age|aged|years?))(?:^|\s)([1-8]\d)(?!\s*(?:yo|years?|y\/o))(?=\s|[,.!?]|$)/);
    if (bare) out.maxMin = +bare[1];
  }
  return out;
}

// ---------------------------------------------------------------------------
// Conversation state + actions. The agent answers with actions, not just text,
// so the Spectrum layer can use native iMessage features (polls, reactions,
// effects, rename, voice) and fall back to text if a platform rejects one.

export type Action =
  | { kind: "text"; space: string; text: string }
  | { kind: "react"; space: string; emoji: string } // on the message being handled
  | { kind: "link"; space: string; url: string } // rich link preview
  | { kind: "poll"; space: string; title: string; options: string[] }
  | { kind: "celebrate"; space: string; text: string } // confetti effect
  | { kind: "rename"; space: string; name: string }
  | { kind: "voice"; space: string; text: string }; // spoken via ElevenLabs

type Member = Partial<Person> & { name: string };
type Group = {
  members: Map<string, Member>;
  asked: Set<string>; // who we've already nudged to DM their budget
  ranked: NtaResult[];
  people: Person[];
  poll?: { options: string[]; votes: Map<string, string> };
  shown?: string; // signature of the last results we posted, to avoid repeating ourselves
  decided?: string;
};

const groups = new Map<string, Group>();
const privateBudgets = new Map<string, number>(); // sender -> budget told to us in a DM
const senderGroups = new Map<string, Set<string>>(); // sender -> group spaces they're in

function group(spaceId: string): Group {
  let g = groups.get(spaceId);
  if (!g) groups.set(spaceId, (g = { members: new Map(), asked: new Set(), ranked: [], people: [] }));
  return g;
}

const money = (n: number) => `$${Math.round(n).toLocaleString()}`;
const short = (name: string) => name.split(/[-(]/)[0].trim();

// Budgets can be private, so links carry an even split of the combined budget, not each person's number.
export function mapLink(people: Person[]): string {
  const even = Math.round(people.reduce((s, p) => s + p.budget, 0) / people.length);
  const q = new URLSearchParams();
  people.forEach((p) => q.append("p", `${p.place},${p.maxMin},${even},${p.name}`));
  return `${MAP_URL}/?${q}`;
}

function rank(data: Data, people: Person[]): NtaResult[] {
  const workIdx = people.map((p) => { const pl = placeById(p.place)!; return nearestHex(data.hexes, pl.lat, pl.lng); });
  return rankNeighborhoods(data, scoreHexes(data, "weekday", people, workIdx), people);
}

// Group results as text. Never reveals an individual's budget, only the combined total.
export function recommend(data: Data, people: Person[], ranked = rank(data, people)): string {
  const beds = bedsFor(people.length).toUpperCase();
  const budget = people.reduce((s, p) => s + p.budget, 0);
  const who = people.length > 1 ? "all of you" : "you";
  if (!ranked.length) {
    const tight = [...people].sort((a, b) => a.maxMin - b.maxMin)[0];
    const longer = people.length > 1 ? `${tight.name} allowing more than ${tight.maxMin} min` : `a commute longer than ${tight.maxMin} min`;
    return `Nothing fits ${who} yet (${beds} under ${money(budget)} combined). Try a bigger budget, or ${longer}.`;
  }
  const lines = ranked.slice(0, 3).map((r, i) =>
    `${i + 1}. ${short(r.name)}: ~${money(r.rent)} ${beds} · ${r.times.map((t, k) => `${people[k].name} ${t}m`).join(", ")}`);
  return [`${ranked.length} neighborhoods work for ${who} (${beds} under ${money(budget)} combined):`, ...lines].join("\n");
}

function withPrivateBudget(senderId: string, m: Member): Member {
  return m.budget || !privateBudgets.has(senderId) ? m : { ...m, budget: privateBudgets.get(senderId) };
}

function completePeople(g: Group): Person[] {
  return [...g.members.entries()]
    .map(([id, m]) => withPrivateBudget(id, m))
    .filter((m): m is Person => !!(m.place && m.maxMin && m.budget))
    .slice(0, 3);
}

// Results + a native poll over the top options (only once 2+ people are in).
function results(data: Data, spaceId: string, g: Group, header = "", force = false): Action[] {
  const people = completePeople(g);
  const sig = JSON.stringify(people);
  if (!people.length || (people.length < 2 && !force) || (sig === g.shown && !force)) return [];
  g.shown = sig;
  g.people = people;
  g.ranked = rank(data, people);
  const out: Action[] = [{ kind: "text", space: spaceId, text: header + recommend(data, people, g.ranked) }];
  if (g.ranked.length) out.push({ kind: "link", space: spaceId, url: mapLink(people) });
  if (people.length >= 2 && g.ranked.length >= 2 && !g.decided) {
    const options = g.ranked.slice(0, 3).map((r) => short(r.name));
    g.poll = { options, votes: new Map() };
    out.push({ kind: "poll", space: spaceId, title: "Where should we live? 🏠", options });
  }
  return out;
}

// Referee: someone objects to an option; answer with the tradeoff in numbers.
async function referee(data: Data, spaceId: string, g: Group, senderId: string, lower: string): Promise<Action[]> {
  if (g.ranked.length < 2 || !g.people.length) return [];
  const me = g.members.get(senderId);
  const k = g.people.findIndex((p) => p.name === me?.name);
  const named = g.ranked.find((r) => lower.includes(short(r.name).toLowerCase())) ?? g.ranked[0];
  const tooFar = /too far|too long|commute|hours?|far away/.test(lower);
  const others = g.ranked.filter((r) => r.nta !== named.nta);
  const alt = tooFar && k >= 0
    ? [...others].sort((a, b) => a.times[k] - b.times[k])[0]
    : [...others].sort((a, b) => a.rent - b.rent)[0];
  if (!alt) return [];
  const rentDiff = named.rent - alt.rent;
  const facts = g.people.map((p, i) => `${p.name} ${named.times[i]}m→${alt.times[i]}m`).join(", ");
  const fallback = `Fair. ${short(alt.name)} vs ${short(named.name)}: ${rentDiff >= 0 ? `${money(rentDiff)}/mo cheaper` : `${money(-rentDiff)}/mo more expensive`}, commutes ${facts}.`;
  const rentPhrase = rentDiff >= 0 ? `${money(rentDiff)}/mo cheaper` : `${money(-rentDiff)}/mo more expensive`;
  const polished = await phraseWithGemini(
    `You are Rent Radius, a bot in a NYC roommate group chat. ${me?.name ?? "Someone"} said: "${lower}". ` +
    `In one or two short, friendly sentences, suggest ${short(alt.name)} instead of ${short(named.name)}. ` +
    `You must include the exact phrase "${rentPhrase}" and these commutes: ${facts}. ` +
    `Do not invent any other facts, places or numbers. Do not speak as a roommate.`,
  );
  // Only trust the model's wording if it kept the money fact exactly right.
  const opposite = rentDiff >= 0 ? /\b(more|pricier|expensive)\b/i : /\b(less|cheaper|save)\b/i;
  const safe = polished && polished.includes(rentPhrase) && !opposite.test(polished.replace(rentPhrase, "")) ? polished : null;
  return [{ kind: "text", space: spaceId, text: safe ?? fallback }];
}

function decide(data: Data, spaceId: string, g: Group, winner: string): Action[] {
  g.decided = winner;
  const r = g.ranked.find((x) => short(x.name) === winner);
  const beds = bedsFor(g.people.length).toUpperCase();
  const detail = r ? ` About ${money(r.rent)} a month for a ${beds}, and ${r.times.map((t, i) => `${g.people[i].name} gets there in ${t} minutes`).join(", ")}.` : "";
  return [
    { kind: "celebrate", space: spaceId, text: `🎉 It's decided: ${winner}!` },
    { kind: "rename", space: spaceId, name: `🏠 ${winner} Hunt` },
    { kind: "voice", space: spaceId, text: `Congrats, you're moving to ${winner}!${detail} Good luck with the apartment hunt.` },
  ];
}

// ---- What's the Catch: an address or StreetEasy link pasted into the chat ----
const STREET = "(?:st|street|ave|avenue|av|blvd|boulevard|pl|place|rd|road|dr|drive|ln|lane|way|pkwy|parkway|ter|terrace|ct|court|sq|square|broadway|bowery)";
export function findAddress(text: string): string | null {
  const se = text.match(/streeteasy\.com\/(?:building|rental|sale)\/([a-z0-9_-]+)/i);
  if (se) {
    // e.g. 106-morningside-drive-new_york -> "106 morningside drive new york"
    return se[1].replace(/_/g, " ").replace(/-/g, " ").replace(/\b(new york|brooklyn|bronx|queens|staten island)\b.*$/i, "$1");
  }
  const m = text.match(new RegExp(`\\b\\d{1,5}(?:-\\d{1,3})?\\s+(?:[nsew]\\.?\\s+|east\\s+|west\\s+|north\\s+|south\\s+)?[a-z0-9 .'-]{2,40}?\\b${STREET}\\b(?:[ ,]+(?:manhattan|brooklyn|bronx|queens|staten island|new york|ny))?`, "i"));
  return m ? m[0].trim() : null;
}

type CatchFlag = { level: "red" | "amber" | "green"; title: string };
export async function catchFor(address: string): Promise<string> {
  try {
    const res = await fetch(`${MAP_URL}/api/catch?address=${encodeURIComponent(address)}`, { signal: AbortSignal.timeout(8000) });
    const d = (await res.json()) as { error?: string; address?: string; units?: number; verdict?: string; flags?: CatchFlag[] };
    if (d.error || !d.flags) return `🔍 Couldn't find a residential building record for "${address}".`;
    const icon = { red: "🔴", amber: "🟡", green: "🟢" } as const;
    const lines = d.flags.slice(0, 5).map((f) => `${icon[f.level]} ${f.title}`);
    return [`🔍 The catch at ${d.address} (${d.units} apts): ${d.verdict}`, ...lines,
      `Full record: ${MAP_URL}/catch?address=${encodeURIComponent(address)}`].join("\n");
  } catch {
    return `🔍 Couldn't check "${address}" right now. Try ${MAP_URL}/catch`;
  }
}

const HELP = "Hi! I'm Rent Radius 🏠 Everyone tell me where you work or study and your max commute, e.g. \"I'm Candy, Columbia, 40 min\". Budgets can stay private: DM me your share and I'll only ever show the group total. Found a place? Paste its address or StreetEasy link and I'll tell you the catch. Say \"map\" for results, \"reset\" to start over.";

export type Incoming = {
  spaceId: string;
  isGroup: boolean;
  senderId: string;
  text?: string;
  pollVote?: string; // option title when the message is a vote on our poll
};

export async function handle(data: Data, m: Incoming): Promise<Action[]> {
  const { spaceId, senderId } = m;

  // ---- poll votes ----
  if (m.pollVote !== undefined) {
    const g = group(spaceId);
    if (!g.poll || g.decided) return [];
    g.poll.votes.set(senderId, m.pollVote);
    const tally = new Map<string, number>();
    for (const v of g.poll.votes.values()) tally.set(v, (tally.get(v) ?? 0) + 1);
    const [top, n] = [...tally.entries()].sort((a, b) => b[1] - a[1])[0];
    const voters = Math.max(2, g.people.length);
    return n > voters / 2 ? decide(data, spaceId, g, top) : [];
  }

  const msg = (m.text ?? "").trim();
  const lower = msg.toLowerCase();

  // ---- private DM: budgets stay out of the group ----
  if (!m.isGroup) {
    const addr = findAddress(msg);
    if (addr) return [{ kind: "text", space: spaceId, text: await catchFor(addr) }];
    const p = parseRules(msg);
    if (p.budget) {
      privateBudgets.set(senderId, p.budget);
      const out: Action[] = [{ kind: "text", space: spaceId, text: `🔒 Got it, ${money(p.budget)}/mo stays between us. Your group only sees the combined total.` }];
      for (const gid of senderGroups.get(senderId) ?? []) out.push(...results(data, gid, group(gid), "Budgets are in (kept private). Updated picks:\n"));
      return out;
    }
    return [{ kind: "text", space: spaceId, text: "DM me your monthly share of rent (e.g. \"$1800\") and I'll keep it private. Add me to your roommate group chat for the rest!" }];
  }

  // ---- group chat ----
  const g = group(spaceId);
  (senderGroups.get(senderId) ?? senderGroups.set(senderId, new Set()).get(senderId)!).add(spaceId);

  if (/^(hi|hey|hello|help|rent radius|@?rent\s?radius)\b/.test(lower) && msg.length < 40) return [{ kind: "text", space: spaceId, text: HELP }];
  if (/^(reset|start over|clear)\b/.test(lower)) { groups.delete(spaceId); return [{ kind: "text", space: spaceId, text: "Cleared. Tell me where everyone works and max commute." }]; }

  // text votes as a fallback when native polls aren't available ("2", "vote 1")
  const textVote = lower.match(/^(?:vote\s*)?([1-3])$/);
  if (textVote && g.poll) return handle(data, { ...m, text: undefined, pollVote: g.poll.options[+textVote[1] - 1] });

  if (/too far|too long|too expensive|too pricey|can'?t afford|hate the commute|not .*(astoria|harlem|bronx|brooklyn|queens)/.test(lower) && g.ranked.length) {
    return referee(data, spaceId, g, senderId, lower);
  }

  const addr = findAddress(msg);
  if (addr) return [{ kind: "react", space: spaceId, emoji: "👀" }, { kind: "text", space: spaceId, text: await catchFor(addr) }];

  let p = parseRules(msg);
  if (!p.place && (p.maxMin || p.budget || /work|study|school|office|job/.test(lower))) {
    const ai = await parseWithGemini(msg, PLACES.map((x) => x.id));
    p = { ...ai, ...Object.fromEntries(Object.entries(p).filter(([, v]) => v !== undefined)) };
  }
  const wantsMap = /\b(map|results?|where should we live|what fits|show)\b/.test(lower);
  if (!p.place && !p.maxMin && !p.budget && !p.name && !wantsMap) return []; // normal chatter: stay quiet

  const cur = g.members.get(senderId) ?? { name: `Roommate ${g.members.size + 1}` };
  g.members.set(senderId, { ...cur, ...Object.fromEntries(Object.entries(p).filter(([, v]) => v !== undefined)) });
  const me = withPrivateBudget(senderId, g.members.get(senderId)!);

  const out: Action[] = [{ kind: "react", space: spaceId, emoji: "👍" }]; // acknowledge without cluttering the chat
  const missing = [!me.place && "where you work/study", !me.maxMin && "max commute"].filter(Boolean);
  if (missing.length && !wantsMap) {
    out.push({ kind: "text", space: spaceId, text: `${me.name.startsWith("Roommate") ? "Got it" : `Got it, ${me.name}`}. Still need ${missing.join(" and ")}.` });
    return out;
  }
  if (!me.budget && !g.asked.has(senderId)) {
    g.asked.add(senderId);
    out.push({ kind: "text", space: spaceId, text: `🔒 ${me.name.startsWith("Roommate") ? "" : `${me.name}, `}DM me your share of rent. I'll keep it private and only use the group total.` });
  }
  const ready = completePeople(g);
  if (!ready.length) return out;
  const waiting = [...g.members.entries()].filter(([id, x]) => !withPrivateBudget(id, x).budget || !x.place || !x.maxMin).map(([, x]) => x.name);
  const header = waiting.length ? `(Waiting on ${waiting.join(", ")}.)\n` : "";
  return [...out, ...results(data, spaceId, g, header, wantsMap)];
}
