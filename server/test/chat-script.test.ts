import assert from "node:assert/strict";
import { test } from "node:test";
import { io, type Socket } from "socket.io-client";
import type { RoomState, TranscriptItem } from "../../shared/types.ts";

process.env.THE_TABLE_TEST = "1";

const { server: httpServer } = await import("../src/index.ts");

type AnyEvent = Record<string, unknown>;

function connect(name: string, url: string) {
  const socket: Socket = io(url, { transports: ["websocket"], forceNew: true });
  const buckets = new Map<string, { items: AnyEvent[]; waiters: Array<(value: AnyEvent) => void> }>();
  for (const event of ["room:created", "room:state", "room:error", "item:updated", "chat:transcribed"]) {
    const slot = { items: [] as AnyEvent[], waiters: [] as Array<(value: AnyEvent) => void> };
    buckets.set(event, slot);
    socket.on(event, (payload: AnyEvent) => {
      const waiter = slot.waiters.shift();
      if (waiter) waiter(payload);
      else slot.items.push(payload);
    });
  }
  function next<T>(event: string, ms = 4000): Promise<T> {
    const slot = buckets.get(event);
    if (!slot) return Promise.reject(new Error(`unknown ${event}`));
    const queued = slot.items.shift();
    if (queued) return Promise.resolve(queued as T);
    return new Promise((resolve, reject) => {
      const onValue = (value: AnyEvent) => {
        clearTimeout(timer);
        resolve(value as T);
      };
      const timer = setTimeout(() => {
        const index = slot.waiters.indexOf(onValue);
        if (index >= 0) slot.waiters.splice(index, 1);
        reject(new Error(`${name} timeout ${event}`));
      }, ms);
      slot.waiters.push(onValue);
    });
  }
  async function until<T>(event: string, pred: (value: T) => boolean, ms = 4000): Promise<T> {
    const start = Date.now();
    while (Date.now() - start < ms) {
      const value = await next<T>(event, ms - (Date.now() - start));
      if (pred(value)) return value;
    }
    throw new Error(`${name} no match ${event}`);
  }
  return { socket, next, until };
}

test("Hindi chat stays in Hindi for the sender and English for the other person", async () => {
  const original = globalThis.fetch;
  globalThis.fetch = async (input, init) => {
    const url = String(input);
    if (url.includes("/audio/")) {
      return Response.json({ text: "Abhi aap kya kar rahe ho?" });
    }
    const body = JSON.parse(String(init?.body)) as { messages?: { content?: string }[] };
    const system = body.messages?.[0]?.content ?? "";
    const user = body.messages?.at(-1)?.content ?? "";
    if (system.includes("Latin letters")) {
      if (user.includes("Abhi aap")) {
        return Response.json({ choices: [{ message: { content: "HI: अभी आप क्या कर रहे हो?" } }] });
      }
      if (user.startsWith("What are you doing")) {
        return Response.json({ choices: [{ message: { content: "EN" } }] });
      }
      return Response.json({ choices: [{ message: { content: "EN" } }] });
    }
    if (user.includes("अभी आप क्या कर रहे हो?")) {
      return Response.json({ choices: [{ message: { content: "What are you doing right now?" } }] });
    }
    if (user.includes("I disagree.")) {
      return Response.json({ choices: [{ message: { content: "मैं असहमत हूँ।" } }] });
    }
    return Response.json({ choices: [{ message: { content: "translated" } }] });
  };

  await new Promise<void>((resolve) => httpServer.listen(0, "127.0.0.1", () => resolve()));
  const address = httpServer.address();
  if (!address || typeof address === "string") throw new Error("no port");
  const url = `http://127.0.0.1:${address.port}`;
  const asha = connect("Asha", url);
  const ravi = connect("Ravi", url);

  try {
    await Promise.all([
      new Promise<void>((resolve) => asha.socket.on("connect", () => resolve())),
      new Promise<void>((resolve) => ravi.socket.on("connect", () => resolve())),
    ]);
    asha.socket.emit("room:create", {
      name: "Asha",
      language: "en",
      clientId: "asha",
      mode: "chat",
    });
    const created = await asha.next<{ code: string }>("room:created");
    ravi.socket.emit("room:join", {
      code: created.code,
      clientId: "ravi",
      name: "Ravi",
      language: "hi",
      mode: "chat",
    });
    await asha.until<RoomState>("room:state", (state) => state.participants.length === 2);

    ravi.socket.emit("chat:transcribe", {
      requestId: "said",
      mime: "audio/webm",
      audio: Buffer.from("spoken-hindi"),
    });
    const dictated = await ravi.next<{ requestId: string; text: string }>("chat:transcribed");
    assert.equal(dictated.text, "अभी आप क्या कर रहे हो?");

    ravi.socket.emit("chat:send", { clientMsgId: "roman", text: "Abhi aap kya kar rahe ho?" });
    const roman = await asha.until<TranscriptItem>(
      "item:updated",
      (item) => item.authorId === "ravi" && item.status === "ok" && item.sourceText.includes("अभी"),
    );
    assert.equal(roman.sourceText, "अभी आप क्या कर रहे हो?");
    assert.equal(roman.translatedText, "What are you doing right now?");
    assert.equal(roman.sourceLang, "hi");
    assert.equal(roman.targetLang, "en");

    ravi.socket.emit("chat:send", {
      clientMsgId: "english",
      text: "What are you doing right now?",
    });
    const kept = await asha.until<TranscriptItem>(
      "item:updated",
      (item) => item.authorId === "ravi" && item.sourceText === "What are you doing right now?" && item.status === "ok",
    );
    assert.equal(kept.translatedText, "What are you doing right now?");

    ravi.socket.emit("chat:send", { clientMsgId: "script", text: "अभी आप क्या कर रहे हो?" });
    const typed = await asha.until<TranscriptItem>(
      "item:updated",
      (item) => item.id !== roman.id && item.id !== kept.id && item.authorId === "ravi" && item.status === "ok",
    );
    assert.equal(typed.sourceText, "अभी आप क्या कर रहे हो?");
    assert.equal(typed.translatedText, "What are you doing right now?");

    asha.socket.emit("chat:send", { clientMsgId: "en", text: "I disagree." });
    const fromEnglish = await ravi.until<TranscriptItem>(
      "item:updated",
      (item) => item.authorId === "asha" && item.status === "ok",
    );
    assert.equal(fromEnglish.sourceText, "I disagree.");
    assert.equal(fromEnglish.translatedText, "मैं असहमत हूँ।");
    assert.equal(
      [roman, kept, typed, fromEnglish].map((item) => item.id).length,
      new Set([roman.id, kept.id, typed.id, fromEnglish.id]).size,
    );
  } finally {
    asha.socket.close();
    ravi.socket.close();
    globalThis.fetch = original;
    await new Promise<void>((resolve) => httpServer.close(() => resolve()));
  }
});
