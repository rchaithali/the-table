import assert from "node:assert/strict";
import { test } from "node:test";
import { restoreHindiScript, translateText } from "../src/groq.ts";

test("translation request hides gpt-oss reasoning and keeps only the answer", async () => {
  process.env.GROQ_API_KEY = "test-key";
  process.env.GROQ_TRANSLATE_MODEL = "openai/gpt-oss-20b";
  const original = globalThis.fetch;
  let body: {
    reasoning_format?: string;
    reasoning_effort?: string;
    messages?: { content?: string }[];
  } | null = null;
  globalThis.fetch = async (_input, init) => {
    body = JSON.parse(String(init?.body)) as typeof body;
    return Response.json({
      choices: [
        {
          message: {
            content: "मैं बिल्कुल असहमत हूँ।",
            reasoning: "internal notes that must not be spoken",
          },
        },
      ],
    });
  };
  try {
    const same = await translateText("  hello  ", "en", "en");
    assert.equal(same, "  hello  ");
    const translated = await translateText("I disagree.", "en", "hi");
    assert.equal(translated, "मैं बिल्कुल असहमत हूँ।");
    assert.equal(body?.reasoning_format, "hidden");
    assert.equal(body?.reasoning_effort, "low");
    assert.match(String(body?.messages?.[0]?.content), /Do not soften/);

    globalThis.fetch = async () =>
      Response.json({ error: { message: "Invalid API Key gsk_secretvalue" } }, { status: 401 });
    await assert.rejects(
      () => translateText("hello", "en", "hi"),
      (err: unknown) => {
        assert.ok(err instanceof Error);
        assert.match(err.message, /GROQ_API_KEY/);
        assert.equal(err.message.includes("gsk_"), false);
        return true;
      },
    );
  } finally {
    globalThis.fetch = original;
  }
});

test("a stalled Groq request becomes a retryable timeout", async () => {
  process.env.GROQ_API_KEY = "test-key";
  const original = globalThis.fetch;
  globalThis.fetch = async () => {
    throw Object.assign(new Error("The operation was aborted due to timeout"), { name: "TimeoutError" });
  };
  try {
    await assert.rejects(
      () => translateText("hello", "en", "hi"),
      (err: unknown) => {
        assert.ok(err instanceof Error);
        assert.match(err.message, /took too long/);
        assert.equal((err as { code?: string }).code, "mt");
        return true;
      },
    );
  } finally {
    globalThis.fetch = original;
  }
});

test("Romanized Hindi is restored to Devanagari and English is left alone", async () => {
  process.env.GROQ_API_KEY = "test-key";
  const original = globalThis.fetch;
  globalThis.fetch = async () =>
    Response.json({ choices: [{ message: { content: "HI: अभी आप क्या कर रहे हो?" } }] });
  try {
    const hindi = await restoreHindiScript("Abhi aap kya kar rahe ho?");
    assert.equal(hindi.english, false);
    assert.equal(hindi.text, "अभी आप क्या कर रहे हो?");

    globalThis.fetch = async () => Response.json({ choices: [{ message: { content: "EN" } }] });
    const english = await restoreHindiScript("What are you doing right now?");
    assert.equal(english.english, true);
    assert.equal(english.text, "What are you doing right now?");

    let called = false;
    globalThis.fetch = async () => {
      called = true;
      return Response.json({});
    };
    const script = await restoreHindiScript("अभी आप क्या कर रहे हो?");
    assert.equal(called, false);
    assert.equal(script.text, "अभी आप क्या कर रहे हो?");
    assert.equal(script.english, false);

    globalThis.fetch = async () =>
      Response.json({ choices: [{ message: { content: "What are you doing right now?" } }] });
    const rejected = await restoreHindiScript("Abhi aap kya kar rahe ho?");
    assert.equal(rejected.english, false);
    assert.equal(rejected.text, "Abhi aap kya kar rahe ho?");
  } finally {
    globalThis.fetch = original;
  }
});
