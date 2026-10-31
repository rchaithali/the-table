import assert from "node:assert/strict";
import { test } from "node:test";
import { io, type Socket } from "socket.io-client";
import type { RoomState, TranscriptItem } from "../../shared/types.ts";
import { mergeTranscript, nextPresence, seatedProposal, upsertTranscript } from "../../shared/roomSync.ts";

process.env.THE_TABLE_TEST = "1";
process.env.THE_TABLE_GRACE_MS = "500";

const { server: httpServer } = await import("../src/index.ts");
const { getRoom } = await import("../src/room.ts");

type AnyEvent = Record<string, unknown>;

function connect(name: string, url: string) {
  const socket: Socket = io(url, { transports: ["websocket"], forceNew: true });
  const buckets = new Map<string, { items: AnyEvent[]; waiters: Array<(value: AnyEvent) => void> }>();
  for (const event of ["room:created", "room:state", "room:error", "item:updated", "peer:left", "peer:joined"]) {
    const slot = { items: [] as AnyEvent[], waiters: [] as Array<(value: AnyEvent) => void> };
    buckets.set(event, slot);
    socket.on(event, (payload: AnyEvent) => {
      const waiter = slot.waiters.shift();
      if (waiter) waiter(payload);
      else slot.items.push(payload);
    });
  }
  function reset(event: string) {
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
  return { socket, next, until, reset };
}

function ids(items: { id: string }[]): string[] {
  return items.map((item) => item.id);
}

test("presence follows a leave or a dropped connection, and history comes back with the seat", async () => {
  const original = globalThis.fetch;
  let translations = 0;
  globalThis.fetch = async (_input, init) => {
    translations += 1;
    const body = JSON.parse(String(init?.body)) as { messages?: { content?: string }[] };
    const user = body.messages?.at(-1)?.content ?? "";
    const text = user.includes("यह गलत है।")
      ? "This is wrong."
      : user.includes("I disagree.")
        ? "मैं असहमत हूँ।"
        : "Say it again.";
    return Response.json({ choices: [{ message: { content: text } }] });
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

    asha.socket.emit("chat:send", { clientMsgId: "m1", text: "I disagree." });
    const first = await ravi.until<TranscriptItem>(
      "item:updated",
      (item) => item.status === "ok" && item.sourceText === "I disagree.",
    );
    ravi.socket.emit("chat:send", { clientMsgId: "m2", text: "यह गलत है।" });
    const second = await asha.until<TranscriptItem>(
      "item:updated",
      (item) => item.status === "ok" && item.authorId === "ravi",
    );
    const room = getRoom(created.code);
    assert.ok(room);
    room.transcript.push({
      id: "talk-1",
      kind: "talk",
      authorId: "asha",
      sourceLang: "en",
      targetLang: "hi",
      sourceText: "Stop.",
      translatedText: "रुको।",
      status: "ok",
      createdAt: Date.now(),
    });

    const beforeRejoin = translations;
    ravi.reset("room:state");
    ravi.socket.emit("room:leave");
    const left = await asha.until<RoomState>(
      "room:state",
      (state) => state.participants.length === 1 && state.absent?.id === "ravi",
    );
    assert.equal(left.absent?.name, "Ravi");
    assert.equal(left.transcript.some((item) => item.id === first.id), true);
    assert.equal(left.transcript.some((item) => item.id === second.id), true);
    assert.equal(translations, beforeRejoin);

    ravi.reset("room:state");
    ravi.socket.emit("room:join", {
      code: created.code,
      clientId: "ravi",
      name: "Ravi",
      language: "hi",
      mode: "chat",
    });
    const returned = await ravi.next<RoomState>("room:state");
    assert.equal(returned.youId, "ravi");
    assert.equal(returned.absent, null);
    assert.deepEqual(ids(returned.transcript).sort(), [first.id, second.id, "talk-1"].sort());
    const talk = returned.transcript.find((item) => item.id === "talk-1");
    assert.equal(talk?.kind, "talk");
    assert.equal(talk?.translatedText, "रुको।");
    const ashaSeesReturn = await asha.until<RoomState>(
      "room:state",
      (state) => state.participants.length === 2 && state.absent === null,
    );
    assert.equal(ashaSeesReturn.participants.filter((person) => person.id === "ravi").length, 1);
    assert.equal(translations, beforeRejoin);

    asha.reset("item:updated");
    ravi.reset("item:updated");
    asha.socket.emit("chat:send", { clientMsgId: "m3", text: "I disagree." });
    const thirdForRavi = await ravi.until<TranscriptItem>(
      "item:updated",
      (item) => item.status === "ok" && item.id !== first.id && item.authorId === "asha",
    );
    const thirdForAsha = await asha.until<TranscriptItem>(
      "item:updated",
      (item) => item.id === thirdForRavi.id && item.status === "ok",
    );
    assert.equal(thirdForAsha.translatedText, thirdForRavi.translatedText);
    assert.equal(translations, beforeRejoin + 1);

    ravi.socket.disconnect();
    await new Promise((resolve) => setTimeout(resolve, 40));
    const intruder = connect("Intruder", url);
    await new Promise<void>((resolve) => intruder.socket.on("connect", () => resolve()));
    intruder.socket.emit("room:join", {
      code: created.code,
      clientId: "ravi-new",
      name: "Ravi",
      language: "hi",
      mode: "chat",
    });
    assert.equal((await intruder.next<{ code: string }>("room:error")).code, "full");
    intruder.socket.close();

    await new Promise<void>((resolve) => {
      ravi.socket.once("connect", () => resolve());
      ravi.socket.connect();
    });
    ravi.reset("room:state");
    ravi.socket.emit("room:join", {
      code: created.code,
      clientId: "ravi",
      name: "Ravi",
      language: "hi",
      mode: "chat",
    });
    const reclaimed = await ravi.next<RoomState>("room:state");
    assert.equal(reclaimed.transcript.some((item) => item.id === first.id), true);
    assert.equal(reclaimed.transcript.some((item) => item.id === thirdForRavi.id), true);
    assert.equal(reclaimed.transcript.some((item) => item.id === "talk-1"), true);
    assert.equal(new Set(ids(reclaimed.transcript)).size, reclaimed.transcript.length);
    assert.equal(reclaimed.participants.filter((person) => person.id === "ravi").length, 1);

    asha.reset("room:state");
    ravi.socket.disconnect();
    await asha.until<RoomState>(
      "room:state",
      (state) => state.participants.length === 1 && state.absent?.name === "Ravi",
    );
    const newbie = connect("Newbie", url);
    await new Promise<void>((resolve) => newbie.socket.on("connect", () => resolve()));
    newbie.socket.emit("room:join", {
      code: created.code,
      clientId: "ravi-new",
      name: "Ravi",
      language: "hi",
      mode: "chat",
    });
    const broughtBack = await newbie.next<RoomState>("room:state");
    assert.equal(broughtBack.youId, "ravi-new");
    assert.equal(broughtBack.absent, null);
    assert.equal(broughtBack.transcript.some((item) => item.id === first.id), true);
    assert.equal(broughtBack.transcript.some((item) => item.id === second.id), true);
    assert.equal(broughtBack.transcript.some((item) => item.id === "talk-1"), true);
    assert.equal(broughtBack.transcript.some((item) => item.id === thirdForRavi.id), true);
    assert.equal(new Set(ids(broughtBack.transcript)).size, broughtBack.transcript.length);
    const ashaAfter = await asha.until<RoomState>(
      "room:state",
      (state) => state.participants.length === 2 && state.absent === null,
    );
    assert.equal(ashaAfter.participants.some((person) => person.id === "ravi-new"), true);
    assert.equal(ashaAfter.participants.some((person) => person.id === "ravi"), false);
    newbie.socket.close();
  } finally {
    asha.socket.close();
    ravi.socket.close();
    globalThis.fetch = original;
    await new Promise<void>((resolve) => httpServer.close(() => resolve()));
  }
});

test("a full table clears a departure, and an empty one keeps it", () => {
  const base = {
    youId: "asha",
    participants: [
      { id: "asha", name: "Asha", language: "en" as const, typing: false, micEnabled: false, speaking: false },
    ],
    absent: { id: "ravi", name: "Ravi" },
  };
  assert.deepEqual(nextPresence(null, base), {
    awayId: "ravi",
    notice: "Ravi has left the table.",
  });
  const full = {
    ...base,
    participants: [
      ...base.participants,
      { id: "ravi-new", name: "Ravi", language: "hi" as const, typing: false, micEnabled: false, speaking: false },
    ],
    absent: null,
  };
  assert.deepEqual(nextPresence("ravi", full), {
    awayId: null,
    notice: "Ravi is back at the table.",
  });
  assert.deepEqual(nextPresence(null, full), { awayId: null, notice: "keep" });

  const older: TranscriptItem = {
    id: "a",
    kind: "chat",
    authorId: "asha",
    sourceLang: "en",
    targetLang: "hi",
    sourceText: "I disagree.",
    translatedText: "old",
    status: "ok",
    createdAt: 1,
  };
  const newer = { ...older, translatedText: "मैं असहमत हूँ।" };
  const extra: TranscriptItem = { ...older, id: "b", sourceText: "local" };
  const merged = mergeTranscript([older, extra], [newer]);
  assert.deepEqual(ids(merged), ["a", "b"]);
  assert.equal(merged[0]?.translatedText, "मैं असहमत हूँ।");
  assert.deepEqual(ids(mergeTranscript([], [newer, extra])), ["a", "b"]);
  assert.deepEqual(ids(mergeTranscript([older, extra], [])), ["a", "b"]);
  assert.equal(
    seatedProposal({ fromId: "ravi", mode: "chat" }, [{ id: "asha" }]),
    null,
  );
  assert.deepEqual(
    seatedProposal({ fromId: "ravi", mode: "chat" }, [{ id: "asha" }, { id: "ravi" }]),
    { fromId: "ravi", mode: "chat" },
  );
  assert.deepEqual(ids(upsertTranscript([older], extra)), ["a", "b"]);
  assert.equal(upsertTranscript([older], newer)[0]?.translatedText, "मैं असहमत हूँ।");
  assert.equal(upsertTranscript(undefined, older).length, 1);
});
