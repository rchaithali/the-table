import assert from "node:assert/strict";
import { test } from "node:test";
import { translateText } from "../src/groq.ts";

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
