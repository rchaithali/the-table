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

function messageText(content: unknown): string {
  if (typeof content === "string") return content.trim();
  if (!Array.isArray(content)) return "";
  return content
    .map((part) => {
      if (typeof part === "string") return part;
      if (part && typeof part === "object" && "text" in part) {
        const text = (part as { text?: unknown }).text;
        return typeof text === "string" ? text : "";
      }
      return "";
    })
    .join("")
    .trim();
}

async function callGroq(
  url: string,
  init: RequestInit,
  kind: "mt" | "stt",
  label: string,
): Promise<Response> {
  const request = fetch(url, { ...init, signal: AbortSignal.timeout(30_000) });
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timed = new Promise<never>((_, reject) => {
    timer = setTimeout(() => {
      reject(Object.assign(new Error(`${label} took too long. Try again.`), { code: kind, name: "TimeoutError" }));
    }, 30_000);
  });
  request.catch(() => {});
  timed.catch(() => {});
  try {
    return await Promise.race([request, timed]);
  } catch (err) {
    const name = err instanceof Error ? err.name : "";
    const timedOut = name === "TimeoutError" || name === "AbortError";
    throw Object.assign(
      new Error(timedOut ? `${label} took too long. Try again.` : `${label} could not reach Groq. Try again.`),
      { code: kind },
    );
  } finally {
    if (timer) clearTimeout(timer);
  }
}

async function failHttp(
  res: Response,
  kind: "mt" | "stt",
  label: string,
): Promise<never> {
  if (res.status === 429) {
    throw Object.assign(new Error(`${label} is rate limited. Wait a moment and try again.`), {
      code: "rate_limit" as const,
    });
  }
  if (res.status === 401 || res.status === 403) {
    console.error(`${label} rejected the API key`, res.status);
    throw Object.assign(
      new Error("Groq rejected the API key. Set a valid GROQ_API_KEY and restart."),
      { code: kind },
    );
  }
  const body = await res.text();
  console.error(`${label} failed`, res.status, body.slice(0, 180));
  throw Object.assign(new Error(`${label} failed (${res.status}).`), {
    code: kind,
  });
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

  const model = translateModel();
  const messages = [
    {
      role: "system",
      content: `You translate arguments between ${LANG_NAME[from]} and ${LANG_NAME[to]}. Preserve tone, disagreement, and emotional intensity. Do not soften or rewrite the speaker. Output only the translation, no quotes or notes.`,
    },
    {
      role: "user",
      content: `From ${LANG_NAME[from]} to ${LANG_NAME[to]}:\n${trimmed}`,
    },
  ];
  const payload: Record<string, unknown> = {
    model,
    temperature: 0.2,
    messages,
  };
  if (model.includes("gpt-oss")) {
    payload.reasoning_effort = "low";
    payload.reasoning_format = "hidden";
  }

  const res = await callGroq(
    CHAT_URL,
    {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey()}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(payload),
    },
    "mt",
    "Translation",
  );

  if (!res.ok) await failHttp(res, "mt", "Translation");

  const data = (await res.json()) as {
    choices?: { message?: { content?: unknown } }[];
  };
  const out = messageText(data.choices?.[0]?.message?.content);
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
  const type = filename.endsWith(".wav")
    ? "audio/wav"
    : filename.endsWith(".mp3")
      ? "audio/mpeg"
      : filename.endsWith(".m4a")
        ? "audio/mp4"
        : "audio/webm";
  const blob = new Blob([new Uint8Array(buffer)], { type });
  form.append("file", blob, filename);
  form.append("model", whisperModel());
  form.append("language", language);
  form.append("response_format", "json");
  form.append("temperature", "0");
  form.append("prompt", language === "hi" ? "हिंदी बातचीत।" : "English conversation.");

  const res = await callGroq(
    TRANSCRIBE_URL,
    { method: "POST", headers: { Authorization: `Bearer ${apiKey()}` }, body: form },
    "stt",
    "Transcription",
  );

  if (!res.ok) await failHttp(res, "stt", "Transcription");

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
