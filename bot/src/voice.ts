// Text -> speech with ElevenLabs, for the spoken recap sent as an iMessage voice note.
// Returns null without a key or on any failure, so the caller falls back to text.
const VOICE_ID = process.env.ELEVENLABS_VOICE_ID ?? "JBFqnCBsd6RMkjVDRZzb";
const MODEL = process.env.ELEVENLABS_MODEL ?? "eleven_flash_v2_5";

export async function speak(text: string): Promise<Buffer | null> {
  const key = process.env.ELEVENLABS_API_KEY;
  if (!key) return null;
  try {
    const res = await fetch(`https://api.elevenlabs.io/v1/text-to-speech/${VOICE_ID}?output_format=mp3_44100_128`, {
      method: "POST",
      headers: { "xi-api-key": key, "Content-Type": "application/json", Accept: "audio/mpeg" },
      signal: AbortSignal.timeout(15000),
      body: JSON.stringify({ text, model_id: MODEL }),
    });
    if (!res.ok) {
      console.error("elevenlabs", res.status, (await res.text()).slice(0, 200));
      return null;
    }
    return Buffer.from(await res.arrayBuffer());
  } catch (e) {
    console.error("elevenlabs failed", e);
    return null;
  }
}
