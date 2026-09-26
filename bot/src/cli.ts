// Local chat simulator, no Photon keys needed.
//   "Candy: I work at Columbia, 40 min"   group message
//   "DM Candy: $1800"                      private DM to the bot
//   "Tyler votes: Astoria"                 poll vote
import { handle, loadData, type Action } from "./brain";

const data = loadData();
const GROUP = "demo-group";

function show(a: Action) {
  const where = a.space === GROUP ? "" : `[DM ${a.space.replace("dm-", "")}] `;
  const line = {
    text: () => ("text" in a ? a.text : ""),
    react: () => `(reacts ${"emoji" in a ? a.emoji : ""})`,
    link: () => `[link preview] ${"url" in a ? a.url : ""}`,
    poll: () => `[📊 POLL] ${"title" in a ? a.title : ""} ${"options" in a ? a.options.join(" / ") : ""}`,
    celebrate: () => `[🎊 confetti] ${"text" in a ? a.text : ""}`,
    rename: () => `[group renamed → ${"name" in a ? a.name : ""}]`,
    voice: () => `[🔊 voice note] ${"text" in a ? a.text : ""}`,
  }[a.kind]();
  console.log(`🏠 ${where}${line}`);
}

async function say(line: string) {
  const dm = line.match(/^\s*DM\s+([^:]{1,20}):\s*(.*)$/i);
  const vote = line.match(/^\s*([^:]{1,20}?)\s+votes?:\s*(.*)$/i);
  const msg = line.match(/^\s*([^:]{1,20}):\s*(.*)$/);
  console.log(`\n${line.trim()}`);
  const actions = dm
    ? await handle(data, { spaceId: `dm-${dm[1].trim()}`, isGroup: false, senderId: dm[1].trim(), text: dm[2] })
    : vote
      ? await handle(data, { spaceId: GROUP, isGroup: true, senderId: vote[1].trim(), pollVote: vote[2].trim() })
      : await handle(data, { spaceId: GROUP, isGroup: true, senderId: msg ? msg[1].trim() : "you", text: msg ? msg[2] : line });
  actions.forEach(show);
}

const script = process.argv.slice(2).join(" ");
if (script) {
  for (const l of script.split(" | ")) await say(l);
} else {
  console.log('Chat simulator. "Name: msg" (group), "DM Name: msg" (private), "Name votes: Option". Ctrl+C to quit.');
  for await (const line of console) if (line.trim()) await say(line);
}
