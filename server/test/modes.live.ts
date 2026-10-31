import { config as loadEnv } from "dotenv";
import { readFileSync } from "node:fs";
import { io as ioClient, type Socket } from "socket.io-client";

process.env.THE_TABLE_TEST = "1";
loadEnv({ path: "/Users/chaii/Documents/the-table/.env" });

type AnyEvent = Record<string, unknown> & {
  code?: string;
  id?: string;
  jobId?: string;
  text?: string;
  mode?: string;
};

const { server: httpServer } = await import("../src/index.ts");
const { getRoom } = await import("../src/room.ts");

if (!(process.env.GROQ_API_KEY ?? "").startsWith("gsk_")) {
  console.error("missing groq key");
  process.exit(1);
}

const log = (message: string) => process.stderr.write(`${message}\n`);

function connect(name: string, url: string) {
  const socket: Socket = ioClient(url, { transports: ["websocket"], forceNew: true });
  const events = [
    "room:created",
    "room:state",
    "room:error",
    "chat:message",
    "chat:transcribed",
    "item:updated",
    "mode:proposed",
    "mode:changed",
    "talk:play",
    "talk:interrupted",
    "talk:error",
    "floor:update",
  ];
  const buckets = new Map<string, { items: AnyEvent[]; waiters: Array<(value: AnyEvent) => void> }>();
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
  function cancel(event: string) {
    const slot = buckets.get(event);
    if (slot) slot.waiters.length = 0;
  }
  function next<T>(event: string, ms = 40000): Promise<T> {
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
  async function until<T>(event: string, pred: (value: T) => boolean, ms = 40000): Promise<T> {
    const start = Date.now();
    while (Date.now() - start < ms) {
      const value = await next<T>(event, ms - (Date.now() - start));
      if (pred(value)) return value;
    }
    throw new Error(`${name} no match ${event}`);
  }
  return { socket, arm, cancel, next, until, name };
}

type Side = ReturnType<typeof connect>;
type Item = {
  id: string;
  kind: string;
  authorId: string;
  sourceText: string;
  translatedText: string | null;
  status: string;
  targetLang: string;
};

const problems: string[] = [];
const chatTurns: Array<Record<string, unknown>> = [];
const dictationTurns: Array<Record<string, unknown>> = [];
const talkTurns: Array<Record<string, unknown>> = [];
const switches: Array<Record<string, unknown>> = [];

function devanagari(text: string) {
  return /[\u0900-\u097F]/.test(text);
}
function latin(text: string) {
  return /[A-Za-z]/.test(text);
}
function wav(name: string) {
  return readFileSync(`/tmp/table-turns/${name}`);
}
function silentWav() {
  const data = Buffer.alloc(16000 * 2);
  const buffer = Buffer.alloc(44 + data.length);
  buffer.write("RIFF", 0);
  buffer.writeUInt32LE(36 + data.length, 4);
  buffer.write("WAVEfmt ", 8);
  buffer.writeUInt32LE(16, 16);
  buffer.writeUInt16LE(1, 20);
  buffer.writeUInt16LE(1, 22);
  buffer.writeUInt32LE(16000, 24);
  buffer.writeUInt32LE(32000, 28);
  buffer.writeUInt16LE(2, 32);
  buffer.writeUInt16LE(16, 34);
  buffer.write("data", 36);
  buffer.writeUInt32LE(data.length, 40);
  return buffer;
}

const english = [
  "I completely disagree with that plan.",
  "What time are you coming tomorrow?",
  "That does not answer the question I asked.",
  "I heard you, and I still think you are wrong.",
  "If we wait until Friday, the whole thing falls apart.",
  "You keep changing the subject.",
  "I am not angry, but I am not convinced.",
  "Can you say that again more clearly?",
  "Leaving early would be a mistake.",
  "Tell me the one thing you will not compromise on.",
  "We have talked in circles, and I need a yes or no.",
];
const hindi = [
  "मैं आपसे बिल्कुल सहमत नहीं हूँ।",
  "आप कल कितने बजे आ रहे हैं?",
  "यह मेरे सवाल का जवाब नहीं है।",
  "मैंने आपकी बात सुन ली, फिर भी मैं असहमत हूँ।",
  "शुक्रवार तक इंतज़ार करना ठीक नहीं है।",
  "आप विषय बदल रहे हैं।",
  "मैं नाराज़ नहीं हूँ, पर मैं मानती नहीं हूँ।",
  "क्या आप यह फिर से साफ़ कह सकते हैं?",
  "जल्दी जाना एक गलती होगी।",
  "बताइए कि आप किस बात पर नहीं झुकेंगे।",
  "मुझे हाँ या ना चाहिए।",
];

await new Promise<void>((resolve) => httpServer.listen(0, "127.0.0.1", () => resolve()));
const address = httpServer.address();
if (!address || typeof address === "string") throw new Error("no port");
const url = `http://127.0.0.1:${address.port}`;
const a = connect("Asha", url);
const b = connect("Ravi", url);
const started = Date.now();
let code = "";

function room() {
  const found = getRoom(code);
  if (!found) throw new Error("room gone");
  return found;
}

function membershipOk(mode?: string) {
  const live = room();
  const ids = live.seats.map((s) => s.clientId).sort().join(",");
  if (ids !== "asha,ravi") problems.push(`membership ${ids}`);
  const asha = live.seatByClient("asha");
  const ravi = live.seatByClient("ravi");
  if (asha?.language !== "en" || ravi?.language !== "hi") problems.push("languages changed");
  if (mode && live.mode !== mode) problems.push(`mode ${live.mode} wanted ${mode}`);
  return live;
}

try {
  await Promise.all([
    new Promise<void>((resolve) => a.socket.on("connect", () => resolve())),
    new Promise<void>((resolve) => b.socket.on("connect", () => resolve())),
  ]);
  a.socket.emit("room:create", { name: "Asha", language: "en", clientId: "asha" });
  code = (await a.next<{ code: string }>("room:created")).code;
  b.socket.emit("room:join", { code, clientId: "ravi", name: "Ravi", language: "hi" });
  await a.until<{ participants: unknown[] }>("room:state", (s) => s.participants.length === 2);
  log(`room ${code}`);

  async function typed(index: number) {
    const who = index % 2 === 0 ? "en" : "hi";
    const speaker = who === "en" ? a : b;
    const listener = who === "en" ? b : a;
    const text = who === "en" ? english[Math.floor(index / 2) % english.length] : hindi[Math.floor(index / 2) % hindi.length];
    const author = who === "en" ? "asha" : "ravi";
    const t0 = Date.now();
    speaker.socket.emit("chat:send", { clientMsgId: `chat-${index}`, text });
    const item = await listener.until<Item>(
      "item:updated",
      (row) => row.kind === "chat" && row.authorId === author && row.sourceText === text && row.status === "ok",
    );
    const translated = item.translatedText ?? "";
    const scriptOk = who === "en" ? devanagari(translated) : latin(translated);
    const langOk = item.targetLang === (who === "en" ? "hi" : "en");
    if (!scriptOk || !langOk) problems.push(`chat ${index} bad translation ${translated}`);
    chatTurns.push({ index, who, ok: scriptOk && langOk, ms: Date.now() - t0, text: translated });
    log(`chat ${index + 1} ${who} ${Date.now() - t0}ms`);
  }

  for (let i = 0; i < 10; i++) await typed(i);

  a.socket.emit("mode:propose", { mode: "talk" });
  await b.next("mode:proposed");
  b.socket.emit("mode:respond", { accept: false });
  await a.until<{ mode: string; modeProposal: unknown }>(
    "room:state",
    (s) => s.mode === "chat" && s.modeProposal === null,
  );
  membershipOk("chat");
  switches.push({ action: "decline-talk", mode: room().mode });
  log("declined talk switch");

  for (let i = 10; i < 22; i++) await typed(i);

  async function dictate(who: "en" | "hi", file: string | null) {
    const speaker = who === "en" ? a : b;
    const requestId = `dict-${who}-${file ?? "silence"}`;
    const before = room().transcript.length;
    speaker.socket.emit("chat:transcribe", {
      requestId,
      mime: "audio/wav",
      audio: file ? wav(file) : silentWav(),
    });
    if (!file) {
      const err = await speaker.next<{ code: string }>("room:error", 20000);
      const grew = room().transcript.length !== before;
      if (err.code !== "empty" || grew) problems.push(`silent dictation ${err.code} grew=${grew}`);
      dictationTurns.push({ requestId, ok: err.code === "empty" && !grew, expected: "empty" });
      log(`dictation silence ${err.code}`);
      return;
    }
    const heard = await speaker.next<{ requestId: string; text: string }>("chat:transcribed", 30000);
    const pending = room().transcript.length !== before;
    const speech = (heard.text ?? "").trim();
    const speechOk = who === "en" ? latin(speech) : devanagari(speech);
    if (heard.requestId !== requestId || pending || !speechOk) {
      problems.push(`dictation ${requestId} request=${heard.requestId} pending=${pending} text=${speech}`);
    }
    const author = who === "en" ? "asha" : "ravi";
    speaker.socket.emit("chat:send", { clientMsgId: requestId, text: speech });
    const item = await (who === "en" ? b : a).until<Item>(
      "item:updated",
      (row) => row.kind === "chat" && row.authorId === author && row.sourceText === speech && row.status === "ok",
    );
    const translated = item.translatedText ?? "";
    const translatedOk = who === "en" ? devanagari(translated) : latin(translated);
    if (!translatedOk) problems.push(`dictated send ${requestId} ${translated}`);
    dictationTurns.push({
      requestId,
      ok: heard.requestId === requestId && !pending && speechOk && translatedOk,
      heard: speech,
      translated,
    });
    log(`dictation ${requestId} ok`);
  }

  await dictate("en", "en-01.wav");
  await dictate("hi", "hi-01.wav");
  await dictate("en", null);
  await dictate("en", "en-02.wav");
  await dictate("hi", "hi-02.wav");
  await dictate("en", "en-03.wav");
  await dictate("hi", "hi-03.wav");

  async function switchTo(mode: "chat" | "talk", proposer: Side, accepter: Side) {
    proposer.arm("room:state");
    accepter.arm("room:state");
    proposer.arm("mode:changed");
    accepter.arm("mode:proposed");
    proposer.socket.emit("mode:propose", { mode });
    await accepter.next<{ mode: string }>("mode:proposed");
    accepter.socket.emit("mode:respond", { accept: true });
    const changed = await proposer.next<{ mode: string }>("mode:changed");
    await proposer.until<{ mode: string; modeProposal: null; participants: { micEnabled: boolean }[] }>(
      "room:state",
      (s) => s.mode === mode && s.modeProposal === null && s.participants.length === 2 && s.participants.every((p) => !p.micEnabled),
    );
    const live = membershipOk(mode);
    const micsOff = live.seats.every((s) => !s.micEnabled && !s.speaking);
    const floorClear = live.phase === "idle" && !live.activeJob && live.queued.length === 0;
    if (changed.mode !== mode || !micsOff || !floorClear) {
      problems.push(`switch ${mode} changed=${changed.mode} mics=${micsOff} floor=${live.phase}/${live.activeJob?.id ?? "none"}`);
    }
    switches.push({ mode, ok: changed.mode === mode && micsOff && floorClear, items: live.transcript.length });
    log(`switched to ${mode}`);
  }

  const chatBeforeTalk = room().transcript.filter((item) => item.kind === "chat").length;
  await switchTo("talk", a, b);
  if (room().transcript.filter((item) => item.kind === "chat").length !== chatBeforeTalk) {
    problems.push("chat history lost on entering talk");
  }
  a.socket.emit("talk:mic", { enabled: true });
  b.socket.emit("talk:mic", { enabled: true });
  await a.until<{ participants: { micEnabled: boolean }[] }>(
    "room:state",
    (s) => s.participants.length === 2 && s.participants.every((p) => p.micEnabled),
  );

  let enFile = 1;
  let hiFile = 1;
  let talkDone = 0;

  async function spoken(who: "en" | "hi") {
    const speaker = who === "en" ? a : b;
    const listener = who === "en" ? b : a;
    const n = who === "en" ? enFile++ : hiFile++;
    const jobId = `talk-${talkDone + 1}-${who}`;
    const author = who === "en" ? "asha" : "ravi";
    speaker.arm("floor:update");
    const t0 = Date.now();
    speaker.socket.emit("talk:utterance", {
      jobId,
      mime: "audio/wav",
      audio: wav(`${who}-${String(n).padStart(2, "0")}.wav`),
    });
    const playWait = listener
      .next<{ jobId: string; lang: string; text: string; itemId: string }>("talk:play", 45000)
      .then((v) => ({ kind: "play" as const, v }));
    const errorWait = speaker
      .next<{ code: string; message: string }>("talk:error", 45000)
      .then((v) => ({ kind: "error" as const, v }));
    playWait.catch(() => {});
    errorWait.catch(() => {});
    let outcome: Awaited<typeof playWait> | Awaited<typeof errorWait>;
    try {
      outcome = await Promise.race([playWait, errorWait]);
    } catch (err) {
      speaker.cancel("talk:error");
      listener.cancel("talk:play");
      problems.push(`${jobId} ${err instanceof Error ? err.message : String(err)}`);
      talkTurns.push({ jobId, ok: false });
      return null;
    }
    if (outcome.kind === "error") {
      problems.push(`${jobId} ${outcome.v.code} ${outcome.v.message}`);
      talkTurns.push({ jobId, ok: false });
      return null;
    }
    const scriptOk = outcome.v.lang === (who === "en" ? "hi" : "en") && (who === "en" ? devanagari(outcome.v.text) : latin(outcome.v.text));
    const item = await speaker.until<Item>("item:updated", (row) => row.id === outcome.v.itemId && row.status === "ok");
    if (!scriptOk || item.authorId !== author) problems.push(`${jobId} attribution/script ${item.authorId} ${outcome.v.text}`);
    listener.socket.emit("talk:play_ended", { jobId });
    await speaker.until<{ phase: string; jobId: string | null }>(
      "floor:update",
      (floor) => floor.phase === "idle" && floor.jobId === null,
    );
    talkDone += 1;
    talkTurns.push({ jobId, ok: scriptOk && item.authorId === author, ms: Date.now() - t0, text: outcome.v.text });
    log(`talk ${jobId} ${Date.now() - t0}ms`);
    return outcome.v;
  }

  for (let i = 0; i < 8; i++) await spoken(i % 2 === 0 ? "en" : "hi");

  {
    a.arm("floor:update");
    const jobId = "barge-en";
    a.socket.emit("talk:utterance", { jobId, mime: "audio/wav", audio: wav(`en-${String(enFile++).padStart(2, "0")}.wav`) });
    const first = await b.next<{ jobId: string }>("talk:play", 45000);
    const bargeId = "barge-hi";
    b.socket.emit("talk:utterance", { jobId: bargeId, mime: "audio/wav", audio: wav(`hi-${String(hiFile++).padStart(2, "0")}.wav`) });
    const interrupted = await a.next<{ jobId: string; byId: string }>("talk:interrupted", 10000);
    const leaked = await b.next("talk:play", 700).then(() => "leaked", () => "none");
    const reply = await a.next<{ jobId: string; lang: string; text: string }>("talk:play", 45000);
    if (interrupted.jobId !== jobId || interrupted.byId !== "ravi" || leaked !== "none" || reply.jobId !== bargeId || reply.lang !== "en" || !latin(reply.text)) {
      problems.push(`barge interrupt=${interrupted.jobId}/${interrupted.byId} leaked=${leaked} reply=${reply.jobId} ${reply.text}`);
    }
    a.socket.emit("talk:play_ended", { jobId: bargeId });
    await a.until<{ phase: string; jobId: string | null }>("floor:update", (floor) => floor.phase === "idle" && floor.jobId === null);
    talkDone += 1;
    talkTurns.push({ jobId: bargeId, ok: reply.jobId === bargeId && leaked === "none", interrupted: first.jobId, text: reply.text });
    log("talk barge recovered");
  }

  {
    a.arm("floor:update");
    b.arm("talk:play");
    a.socket.emit("talk:utterance", { jobId: "talk-silence", mime: "audio/wav", audio: silentWav() });
    const err = await a.next<{ code: string }>("talk:error", 10000);
    const leaked = await b.next("talk:play", 500).then(() => "leaked", () => "none");
    if (err.code !== "empty" || leaked !== "none") problems.push(`talk silence ${err.code} ${leaked}`);
    await a.until<{ phase: string; jobId: string | null }>("floor:update", (floor) => floor.phase === "idle" && floor.jobId === null);
    talkTurns.push({ jobId: "talk-silence", ok: err.code === "empty" && leaked === "none", expected: "empty" });
    log("talk silence recovered");
  }
  await spoken("en");

  const playback = await spoken("hi");
  if (playback) {
    const jobId = `talk-${talkDone + 1}-en`;
    a.socket.emit("talk:utterance", { jobId, mime: "audio/wav", audio: wav(`en-${String(enFile++).padStart(2, "0")}.wav`) });
    const playing = await b.next<{ jobId: string }>("talk:play", 45000);
    await switchTo("chat", b, a);
    await new Promise((resolve) => setTimeout(resolve, 300));
    const leaked = await b.next("talk:play", 400).then(() => "leaked", () => "none");
    const live = room();
    if (live.mode !== "chat" || live.phase !== "idle" || live.activeJob || live.seats.some((s) => s.micEnabled) || leaked !== "none") {
      problems.push(`playback survived mode switch phase=${live.phase} job=${live.activeJob?.id ?? "none"} leaked=${leaked}`);
    }
    switches.push({ action: "leave-talk-during-playback", jobId: playing.jobId, ok: live.mode === "chat" && !live.activeJob && leaked === "none" });
    log("left talk during playback");
  }

  await typed(0);
  membershipOk("chat");
  a.socket.emit("talk:mic", { enabled: true });
  await new Promise((resolve) => setTimeout(resolve, 200));
  if (room().seatByClient("asha")?.micEnabled) problems.push("mic enabled while in chat");

  await switchTo("talk", a, b);
  for (let i = 0; i < 8; i++) await spoken(i % 2 === 0 ? "hi" : "en");
  await switchTo("chat", a, b);
  if (room().seats.some((s) => s.micEnabled || s.speaking)) problems.push("mics still on after leaving talk");
  await typed(1);
  await switchTo("talk", b, a);
  a.socket.emit("talk:mic", { enabled: true });
  await a.until<{ participants: { id: string; micEnabled: boolean }[] }>(
    "room:state",
    (state) => state.participants.find((p) => p.id === "asha")?.micEnabled === true && state.participants.find((p) => p.id === "ravi")?.micEnabled === false,
  );
  for (let i = 0; i < 4; i++) await spoken(i % 2 === 0 ? "en" : "hi");

  const live = membershipOk("talk");
  const ids = live.transcript.map((item) => item.id);
  const duplicateIds = ids.filter((id, index) => ids.indexOf(id) !== index);
  if (duplicateIds.length) problems.push(`duplicate items ${duplicateIds.join(",")}`);
  if (live.phase !== "idle" || live.activeJob || live.queued.length) problems.push("floor not idle at end");
  const chatOk = chatTurns.filter((t) => t.ok).length;
  const dictOk = dictationTurns.filter((t) => t.ok).length;
  const talkOk = talkTurns.filter((t) => t.ok && t.jobId !== "talk-silence").length;
  console.log(JSON.stringify({
    room: code,
    elapsedMs: Date.now() - started,
    problems,
    chat: { attempted: chatTurns.length, ok: chatOk },
    dictation: { attempted: dictationTurns.length, ok: dictOk, turns: dictationTurns },
    talk: { completed: talkDone, ok: talkOk, silence: talkTurns.some((t) => t.jobId === "talk-silence" && t.ok) },
    switches,
    history: {
      total: live.transcript.length,
      chat: live.transcript.filter((item) => item.kind === "chat").length,
      talk: live.transcript.filter((item) => item.kind === "talk").length,
    },
    members: live.seats.map((s) => ({ id: s.clientId, language: s.language, mic: s.micEnabled })),
    floor: { phase: live.phase, job: live.activeJob?.id ?? null },
    samples: {
      chat: chatTurns.filter((t) => t.ok).slice(0, 2),
      talk: talkTurns.filter((t) => t.text).slice(0, 2),
    },
  }, null, 2));
} catch (err) {
  console.log(JSON.stringify({
    fatal: err instanceof Error ? err.message : String(err),
    elapsedMs: Date.now() - started,
    problems,
    chatOk: chatTurns.filter((t) => t.ok).length,
    chatAttempted: chatTurns.length,
    dictationOk: dictationTurns.filter((t) => t.ok).length,
    talkOk: talkTurns.filter((t) => t.ok).length,
    switches,
  }, null, 2));
  process.exitCode = 1;
} finally {
  a.socket.close();
  b.socket.close();
  await new Promise<void>((resolve) => httpServer.close(() => resolve()));
}
