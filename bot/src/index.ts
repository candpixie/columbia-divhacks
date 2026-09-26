// Rent Radius iMessage agent on Photon Spectrum.
// Needs PROJECT_ID and PROJECT_SECRET in bot/.env (from app.photon.codes). GEMINI_API_KEY is optional.
import { Spectrum } from "spectrum-ts";
import { imessage } from "spectrum-ts/providers/imessage";
import { handle, loadData } from "./brain";

const { PROJECT_ID, PROJECT_SECRET } = process.env;
if (!PROJECT_ID || !PROJECT_SECRET) {
  console.error("Missing PROJECT_ID / PROJECT_SECRET in bot/.env. For a local test run: bun run chat");
  process.exit(1);
}

const data = loadData();
const app = await Spectrum({
  projectId: PROJECT_ID,
  projectSecret: PROJECT_SECRET,
  providers: [imessage.config()],
});
console.log("Rent Radius is listening on iMessage");

for await (const [space, message] of app.messages) {
  if (message.direction !== "inbound" || message.content.type !== "text") continue;
  const text = message.content.text;
  try {
    const reply = await space.responding(() =>
      handle(data, space.id, message.sender?.id ?? "unknown", text));
    if (reply) await space.send(reply);
  } catch (e) {
    console.error("failed to handle message", e);
  }
}
