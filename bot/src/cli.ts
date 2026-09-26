// Local group-chat simulator, no Photon keys needed.
// Type lines like "Candy: I work at Columbia, 40 min, $1800". Blank sender = "you".
import { handle, loadData } from "./brain";

const data = loadData();
const script = process.argv.slice(2).join(" ");
const lines = script ? script.split(" | ") : null;

async function say(line: string) {
  const m = line.match(/^\s*([^:]{1,20}):\s*(.*)$/);
  const [sender, text] = m ? [m[1].trim(), m[2]] : ["you", line];
  console.log(`\n${sender}: ${text}`);
  const reply = await handle(data, "demo-chat", sender, text);
  if (reply) console.log(`🏠 Rent Radius: ${reply}`);
}

if (lines) {
  for (const l of lines) await say(l);
} else {
  console.log('Group chat simulator. Format: "Name: message". Ctrl+C to quit.');
  for await (const line of console) if (line.trim()) await say(line);
}
