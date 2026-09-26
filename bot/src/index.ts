// Rent Radius iMessage agent on Photon Spectrum.
// Needs PROJECT_ID and PROJECT_SECRET in bot/.env (from app.photon.codes).
// Optional: GEMINI_API_KEY (parsing + referee phrasing), ELEVENLABS_API_KEY (spoken recap).
import { Spectrum, poll, reaction, rename, richlink, text, voice, type Message, type Space } from "spectrum-ts";
import { effect, imessage } from "spectrum-ts/providers/imessage";
import { handle, loadData, type Action } from "./brain";
import { speak } from "./voice";

const { PROJECT_ID, PROJECT_SECRET } = process.env;
if (!PROJECT_ID || !PROJECT_SECRET) {
  console.error("Missing PROJECT_ID / PROJECT_SECRET in bot/.env. For a local test run: bun run chat");
  process.exit(1);
}

const data = loadData();
const spaces = new Map<string, Space>(); // actions can target another space (DM budget -> group update)
const app = await Spectrum({
  projectId: PROJECT_ID,
  projectSecret: PROJECT_SECRET,
  providers: [imessage.config()],
});
console.log("Rent Radius is listening on iMessage");

// Native iMessage feature first; if the platform rejects it, degrade to plain text.
async function perform(a: Action, trigger: Message) {
  const space = spaces.get(a.space);
  if (!space) return;
  try {
    switch (a.kind) {
      case "text": return void (await space.send(a.text));
      case "react": return void (await space.send(reaction(a.emoji, trigger)));
      case "link": return void (await space.send(richlink(a.url)));
      case "poll": return void (await space.send(poll(a.title, a.options)));
      case "celebrate": return void (await space.send(effect(a.text, "com.apple.messages.effect.CKConfettiEffect")));
      case "rename": return void (await space.send(rename(a.name)));
      case "voice": {
        const audio = await speak(a.text);
        if (!audio) return void (await space.send(`🔊 ${a.text}`));
        return void (await space.send(voice(audio, { mimeType: "audio/mpeg", name: "rent-radius-recap.mp3" })));
      }
    }
  } catch (e) {
    console.error(`${a.kind} failed, falling back to text`, e);
    const fallback: Partial<Record<Action["kind"], string>> = {
      link: a.kind === "link" ? a.url : undefined,
      poll: a.kind === "poll" ? `${a.title}\n${a.options.map((o, i) => `${i + 1}. ${o}`).join("\n")}\nReply 1, 2 or 3 to vote.` : undefined,
      celebrate: a.kind === "celebrate" ? a.text : undefined,
      voice: a.kind === "voice" ? `🔊 ${a.text}` : undefined,
    };
    const t = fallback[a.kind];
    if (t) await space.send(text(t)).catch(() => {});
  }
}

for await (const [space, message] of app.messages) {
  if (message.direction !== "inbound") continue;
  spaces.set(space.id, space);
  const c = message.content;
  const isGroup = (space as unknown as { type?: string }).type === "group";
  const base = { spaceId: space.id, isGroup, senderId: message.sender?.id ?? "unknown" };
  const incoming =
    c.type === "text" ? { ...base, text: c.text }
    : c.type === "poll_option" ? { ...base, pollVote: c.option.title }
    : null;
  if (!incoming) continue;
  try {
    const actions = await space.responding(() => handle(data, incoming));
    for (const a of actions) await perform(a, message);
  } catch (e) {
    console.error("failed to handle message", e);
  }
}
