import type { Language } from "./types.ts";

const TRANSCRIBE_URL = "https://api.groq.com/openai/v1/audio/transcriptions";
const CHAT_URL = "https://api.groq.com/openai/v1/chat/completions";

function apiKey(): string {
  const key = process.env.GROQ_API_KEY?.trim();
  if (!key) {
    throw Object.assign(new Error("GROQ_API_KEY is not set"), {
      code: "mt" as const,
    });
  }
  return key;
}

function translateModel(): string {
  return process.env.GROQ_TRANSLATE_MODEL?.trim() || "openai/gpt-oss-20b";
}

function whisperModel(): string {
  return process.env.GROQ_WHISPER_MODEL?.trim() || "whisper-large-v3";
}

const LANG_NAME: Record<Language, string> = {
  en: "English",
  hi: "Hindi",
};

export async function translateText(
  text: string,
  from: Language,
  to: Language,
): Promise<string> {
  if (from === to) return text;
  const trimmed = text.trim();
  if (!trimmed) return "";

  const res = await fetch(CHAT_URL, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey()}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model: translateModel(),
      temperature: 0.2,
      messages: [
        {
          role: "system",
          content: `You translate arguments between ${LANG_NAME[from]} and ${LANG_NAME[to]}. Preserve tone, interruptions, and meaning. Output only the translation, no quotes or notes.`,
        },
        {
          role: "user",
          content: `From ${LANG_NAME[from]} to ${LANG_NAME[to]}:\n${trimmed}`,
        },
      ],
    }),
  });

  if (res.status === 429) {
    throw Object.assign(new Error("Translation rate limited"), {
      code: "rate_limit" as const,
    });
  }
  if (!res.ok) {
    const body = await res.text();
    throw Object.assign(new Error(`Translation failed (${res.status}) ${body.slice(0, 180)}`), {
      code: "mt" as const,
    });
  }

  const data = (await res.json()) as {
    choices?: { message?: { content?: string } }[];
  };
  const out = data.choices?.[0]?.message?.content?.trim();
  if (!out) {
    throw Object.assign(new Error("Empty translation"), { code: "mt" as const });
  }
  return out;
}

export async function transcribeAudio(
  buffer: Buffer,
  filename: string,
  language: Language,
): Promise<string> {
  const form = new FormData();
  const blob = new Blob([new Uint8Array(buffer)]);
  form.append("file", blob, filename);
  form.append("model", whisperModel());
  form.append("language", language);
  form.append("response_format", "json");
  form.append("temperature", "0");

  const res = await fetch(TRANSCRIBE_URL, {
    method: "POST",
    headers: { Authorization: `Bearer ${apiKey()}` },
    body: form,
  });

  if (res.status === 429) {
    throw Object.assign(new Error("Speech recognition rate limited"), {
      code: "rate_limit" as const,
    });
  }
  if (!res.ok) {
    const body = await res.text();
    throw Object.assign(new Error(`Transcription failed (${res.status}) ${body.slice(0, 180)}`), {
      code: "stt" as const,
    });
  }

  const data = (await res.json()) as { text?: string };
  return (data.text ?? "").trim();
}

export function groqCode(err: unknown): "mt" | "stt" | "rate_limit" | "empty" {
  if (err && typeof err === "object" && "code" in err) {
    const c = (err as { code: string }).code;
    if (c === "mt" || c === "stt" || c === "rate_limit" || c === "empty") return c;
  }
  return "mt";
}
