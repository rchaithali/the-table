import assert from "node:assert/strict";
import { test } from "node:test";
import { io, type Socket } from "socket.io-client";
import type { RoomState, TranscriptItem } from "../../shared/types.ts";

process.env.THE_TABLE_TEST = "1";

const { server: httpServer } = await import("../src/index.ts");

type AnyEvent = Record<string, unknown> & { code?: string };

function connect(name: string, url: string) {
  const socket: Socket = io(url, { transports: ["websocket"], forceNew: true });
  const buckets = new Map<string, { items: AnyEvent[]; waiters: Array<(value: AnyEvent) => void> }>();
  const events = [
    "room:created",
    "room:state",
    "room:error",
    "chat:message",
    "item:updated",
    "mode:proposed",
    "mode:changed",
    "talk:play",
    "talk:interrupted",
    "talk:error",
    "talk:rejected",
    "floor:update",
  ];
  for (const event of events) {
    const slot = { items: [] as AnyEvent[], waiters: [] as Array<(value: AnyEvent) => void> };
    buckets.set(event, slot);
    socket.on(event, (payload: AnyEvent) => {
      const waiter = slot.waiters.shift();
      if (waiter) waiter(payload);
      else slot.items.push(payload);
    });
  }
  function arm(event: string) {
    const slot = buckets.get(event);
    if (slot) slot.items.length = 0;
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
  return { socket, arm, next, until };
}

test("two people chat, switch modes, and an interruption drops stale speech", { timeout: 20000 }, async () => {
  let seenAudio = 0;
  let hold = false;
  let lastPrompt = "";
  const nextTranscripts: string[] = [];
  const release: Array<() => void> = [];
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async (input, init) => {
    const url = String(input);
    if (url.includes("/audio/transcriptions")) {
      if (init?.body instanceof FormData) {
        const file = init.body.get("file");
        seenAudio = file instanceof Blob ? file.size : -1;
        lastPrompt = String(init.body.get("prompt") ?? "");
      }
      if (hold) {
        hold = false;
        await new Promise<void>((resolve) => release.push(resolve));
      }
      return Response.json({
        text: nextTranscripts.shift() ?? "I completely disagree with that.",
      });
    }
    if (url.includes("/chat/completions")) {
      const raw = JSON.parse(String(init?.body ?? "{}")) as {
        messages?: { content?: string }[];
      };
      const user = String(raw.messages?.at(-1)?.content ?? "");
      const toHi = user.includes("to Hindi");
      let content = toHi ? "मैं बिल्कुल असहमत हूँ।" : "I completely disagree.";
      if (user.includes("TIME")) content = "समय";
      if (user.includes("PLACE")) content = "जगह";
      if (user.includes("DONE")) content = "हो गया";
      if (user.includes("AFTER")) content = "बाद में";
      if (user.includes("EMPTYOUT")) content = ".";
      return Response.json({
        choices: [{ message: { content } }],
      });
    }
    throw new Error(`unexpected fetch ${url}`);
  };

  await new Promise<void>((resolve) => {
    httpServer.listen(0, "127.0.0.1", () => resolve());
  });
  const address = httpServer.address();
  if (!address || typeof address === "string") throw new Error("test server has no port");
  const url = `http://127.0.0.1:${address.port}`;
  const a = connect("A", url);
  const b = connect("B", url);
  const c = connect("C", url);
  const audio = new Uint8Array(32);
  audio[0] = 1;

  try {
    await Promise.all([
      new Promise<void>((resolve) => a.socket.on("connect", () => resolve())),
      new Promise<void>((resolve) => b.socket.on("connect", () => resolve())),
      new Promise<void>((resolve) => c.socket.on("connect", () => resolve())),
    ]);

    a.socket.emit("room:create", { name: "Asha", language: "en", clientId: "asha" });
    const created = await a.next<{ code: string }>("room:created");
    assert.match(created.code, /^[A-Z0-9]{6}$/);
    a.socket.emit("mode:propose", { mode: "talk" });
    const alone = await a.next<{ code: string }>("room:error");
    assert.equal(alone.code, "alone");

    b.socket.emit("room:join", {
      code: created.code,
      clientId: "ravi",
      name: "Ravi",
      language: "hi",
    });
    const seated = await a.until<RoomState>(
      "room:state",
      (state) => state.participants.length === 2,
    );
    assert.deepEqual(
      seated.participants.map((person) => person.language).sort(),
      ["en", "hi"],
    );

    b.socket.emit("self:update", { language: "en" });
    await a.until<RoomState>(
      "room:state",
      (state) => state.participants.find((person) => person.id === "ravi")?.language === "en",
    );
    b.socket.emit("self:update", { language: "hi" });
    await a.until<RoomState>(
      "room:state",
      (state) => state.participants.find((person) => person.id === "ravi")?.language === "hi",
    );

    a.socket.emit("chat:send", {
      clientMsgId: "m1",
      text: "I disagree with you completely.",
    });
    const toHindi = await b.until<TranscriptItem>(
      "item:updated",
      (item) => item.authorId === "asha" && item.status === "ok",
    );
    assert.equal(toHindi.translatedText, "मैं बिल्कुल असहमत हूँ।");
    assert.equal(toHindi.targetLang, "hi");

    b.socket.emit("chat:send", { clientMsgId: "m2", text: "यह गलत है।" });
    const toEnglish = await a.until<TranscriptItem>(
      "item:updated",
      (item) => item.authorId === "ravi" && item.status === "ok",
    );
    assert.equal(toEnglish.translatedText, "I completely disagree.");

    c.socket.emit("room:join", {
      code: created.code,
      clientId: "third",
      name: "Third",
      language: "en",
    });
    assert.equal((await c.next<{ code: string }>("room:error")).code, "full");
    c.socket.emit("room:join", {
      code: "ZZZZZZ",
      clientId: "third",
      name: "Third",
      language: "en",
    });
    assert.equal((await c.next<{ code: string }>("room:error")).code, "gone");

    a.arm("room:state");
    a.socket.emit("mode:propose", { mode: "talk" });
    await b.next("mode:proposed");
    b.socket.emit("mode:respond", { accept: false });
    const declined = await a.until<RoomState>(
      "room:state",
      (state) => state.mode === "chat" && state.modeProposal === null,
    );
    assert.equal(declined.mode, "chat");

    a.arm("room:state");
    a.socket.emit("mode:propose", { mode: "talk" });
    await b.next("mode:proposed");
    b.socket.emit("mode:respond", { accept: true });
    const talking = await a.until<RoomState>(
      "room:state",
      (state) => state.mode === "talk" && state.modeProposal === null,
    );
    assert.equal(
      talking.participants.every((person) => person.micEnabled === false),
      true,
    );

    a.socket.emit("talk:utterance", {
      jobId: "job-1",
      mime: "audio/wav",
      audio: audio.buffer,
    });
    const play = await b.next<{ text: string; lang: string; jobId: string }>("talk:play");
    assert.equal(play.jobId, "job-1");
    assert.equal(play.lang, "hi");
    assert.equal(play.text, "मैं बिल्कुल असहमत हूँ।");
    assert.ok(seenAudio > 0);
    b.socket.emit("talk:play_ended", { jobId: "job-1" });
    await a.until<{ phase: string; jobId: string | null }>(
      "floor:update",
      (floor) => floor.phase === "idle" && floor.jobId === null,
    );

    hold = true;
    b.arm("talk:play");
    a.socket.emit("talk:utterance", {
      jobId: "job-2",
      mime: "audio/wav",
      audio: audio.buffer,
    });
    await b.until<{ phase: string; jobId: string }>(
      "floor:update",
      (floor) => floor.phase === "translating" && floor.jobId === "job-2",
    );
    b.socket.emit("talk:barge_begin", { jobId: "barge" });
    const interrupted = await a.next<{ byId: string; jobId: string }>("talk:interrupted");
    assert.equal(interrupted.jobId, "job-2");
    assert.equal(interrupted.byId, "ravi");
    release.splice(0).forEach((fn) => fn());
    const leaked = await b.next("talk:play", 500).then(
      () => "leaked",
      () => "none",
    );
    assert.equal(leaked, "none");
    const cut = await a.until<TranscriptItem>(
      "item:updated",
      (item) => item.status === "cut_off",
    );
    assert.equal(cut.interruptedBy, "ravi");

    nextTranscripts.push("TIME one", "PLACE two", "DONE three");
    for (const [jobId, text] of [
      ["job-3", "समय"],
      ["job-4", "जगह"],
      ["job-5", "हो गया"],
    ] as const) {
      a.socket.emit("talk:utterance", { jobId, mime: "audio/wav", audio: audio.buffer });
      const turn = await b.next<{ text: string; jobId: string }>("talk:play");
      assert.equal(turn.jobId, jobId);
      assert.equal(turn.text, text);
      b.socket.emit("talk:play_ended", { jobId });
      await a.until<{ phase: string; jobId: string | null }>(
        "floor:update",
        (floor) => floor.phase === "idle" && floor.jobId === null,
      );
    }
    assert.match(lastPrompt, /English/);

    b.arm("talk:play");
    nextTranscripts.push(".");
    a.socket.emit("talk:utterance", { jobId: "job-dot", mime: "audio/wav", audio: audio.buffer });
    const missed = await a.next<{ code: string }>("talk:error");
    assert.equal(missed.code, "empty");
    const missedItem = await a.until<TranscriptItem>(
      "item:updated",
      (item) => item.status === "failed" && item.sourceText === "",
    );
    assert.equal(missedItem.sourceText, "");
    assert.equal(await b.next("talk:play", 400).then(() => "leaked", () => "none"), "none");

    nextTranscripts.push("EMPTYOUT now");
    b.arm("talk:play");
    a.socket.emit("talk:utterance", { jobId: "job-empty", mime: "audio/wav", audio: audio.buffer });
    const emptyTranslation = await a.next<{ code: string }>("talk:error");
    assert.equal(emptyTranslation.code, "mt");
    assert.equal(await b.next("talk:play", 400).then(() => "leaked", () => "none"), "none");

    nextTranscripts.push("AFTER the miss");
    a.socket.emit("talk:utterance", { jobId: "job-6", mime: "audio/wav", audio: audio.buffer });
    const recovered = await b.next<{ text: string; jobId: string }>("talk:play");
    assert.equal(recovered.jobId, "job-6");
    assert.equal(recovered.text, "बाद में");
    b.socket.emit("talk:play_ended", { jobId: "job-6" });

    a.socket.emit("talk:utterance", { jobId: "job-q1", mime: "audio/wav", audio: audio.buffer });
    a.socket.emit("talk:utterance", { jobId: "job-q2", mime: "audio/wav", audio: audio.buffer });
    const queuedFirst = await b.next<{ jobId: string }>("talk:play");
    assert.equal(queuedFirst.jobId, "job-q1");
    assert.equal(await b.next("talk:play", 300).then(() => "early", () => "held"), "held");
    b.socket.emit("talk:play_ended", { jobId: "job-q1" });
    const queuedSecond = await b.next<{ jobId: string }>("talk:play");
    assert.equal(queuedSecond.jobId, "job-q2");
    b.socket.emit("talk:play_ended", { jobId: "job-q2" });

    a.arm("room:state");
    a.socket.emit("mode:propose", { mode: "chat" });
    await b.next("mode:proposed");
    b.socket.emit("mode:respond", { accept: true });
    const chatting = await a.until<RoomState>("room:state", (state) => state.mode === "chat");
    assert.equal(chatting.modeProposal, null);
  } finally {
    a.socket.close();
    b.socket.close();
    c.socket.close();
    globalThis.fetch = originalFetch;
    await new Promise<void>((resolve) => httpServer.close(() => resolve()));
  }
});
