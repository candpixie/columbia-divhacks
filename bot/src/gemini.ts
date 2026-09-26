// Optional fallback parser: only used when the rule parser can't find a workplace.
// Structured output keeps Gemini to our fixed list of place ids; any failure returns {}.
import type { Parsed } from "./brain";

const MODEL = process.env.GEMINI_MODEL ?? "gemini-2.5-flash";

export async function parseWithGemini(text: string, placeIds: string[]): Promise<Parsed> {
  const key = process.env.GEMINI_API_KEY;
  if (!key) return {};
  try {
    const res = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${MODEL}:generateContent`, {
      method: "POST",
      headers: { "Content-Type": "application/json", "x-goog-api-key": key },
      signal: AbortSignal.timeout(6000),
      body: JSON.stringify({
        contents: [{ parts: [{ text: `A person in a NYC roommate group chat wrote: """${text}"""\nExtract where they work or study (closest place id, or "none"), their max one-way commute in minutes, their monthly rent share in dollars, and their first name if they gave it.` }] }],
        generationConfig: {
          responseMimeType: "application/json",
          responseSchema: {
            type: "OBJECT",
            properties: {
              place: { type: "STRING", enum: [...placeIds, "none"] },
              maxMin: { type: "INTEGER", nullable: true },
              budget: { type: "INTEGER", nullable: true },
              name: { type: "STRING", nullable: true },
            },
            required: ["place"],
          },
        },
      }),
    });
    if (!res.ok) return {};
    const body = (await res.json()) as { candidates?: { content?: { parts?: { text?: string }[] } }[] };
    const out = JSON.parse(body.candidates?.[0]?.content?.parts?.[0]?.text ?? "{}");
    return {
      place: out.place && out.place !== "none" ? out.place : undefined,
      maxMin: out.maxMin ?? undefined,
      budget: out.budget ?? undefined,
      name: out.name ?? undefined,
    };
  } catch {
    return {};
  }
}
