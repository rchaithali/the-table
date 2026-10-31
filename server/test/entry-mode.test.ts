import assert from "node:assert/strict";
import { test } from "node:test";
import { io, type Socket } from "socket.io-client";
import type { ModeProposal, RoomState, TranscriptItem } from "../../shared/types.ts";

process.env.THE_TABLE_TEST = "1";

const { server: httpServer } = await import("../src/index.ts");

type AnyEvent = Record<string, unknown>;

function connect(name: string, url: string) {
  const socket: Socket = io(url, { transports: ["websocket"], forceNew: true });
  const buckets = new Map<string, { items: AnyEvent[]; waiters: Array<(value: AnyEvent) => void> }>();
  for (const event of ["room:created", "room:state", "room:error", "mode:proposed", "mode:changed", "mode:declined", "item:updated"]) {
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

test("a chosen entry mode is shared, and a different choice asks instead of splitting the room", async () => {
  const original = globalThis.fetch;
  globalThis.fetch = async () =>
    Response.json({ choices: [{ message: { content: "मैं असहमत हूँ।" } }] });

  await new Promise<void>((resolve) => httpServer.listen(0, "127.0.0.1", () => resolve()));
  const address = httpServer.address();
  if (!address || typeof address === "string") throw new Error("no port");
  const url = `http://127.0.0.1:${address.port}`;
  const a = connect("A", url);
  const b = connect("B", url);

  try {
    await Promise.all([
      new Promise<void>((resolve) => a.socket.on("connect", () => resolve())),
      new Promise<void>((resolve) => b.socket.on("connect", () => resolve())),
    ]);

    a.socket.emit("room:create", { name: "Asha", language: "en", clientId: "asha", mode: "talk" });
    const created = await a.next<{ code: string }>("room:created");
    const opened = await a.until<RoomState>("room:state", (state) => state.mode === "talk");
    assert.equal(opened.participants.length, 1);
    assert.equal(opened.modeProposal, null);

    b.socket.emit("room:join", {
      code: created.code,
      clientId: "ravi",
      name: "Ravi",
      language: "hi",
      mode: "talk",
    });
    const together = await a.until<RoomState>(
      "room:state",
      (state) => state.participants.length === 2 && state.mode === "talk" && state.modeProposal === null,
    );
    assert.deepEqual(
      together.participants.map((person) => person.id).sort(),
      ["asha", "ravi"],
    );

    const c = connect("C", url);
    await new Promise<void>((resolve) => c.socket.on("connect", () => resolve()));
    c.socket.emit("room:create", { name: "Asha", language: "en", clientId: "asha-2", mode: "chat" });
    const chatRoom = await c.next<{ code: string }>("room:created");
    const d = connect("D", url);
    await new Promise<void>((resolve) => d.socket.on("connect", () => resolve()));
    d.socket.emit("room:join", {
      code: chatRoom.code,
      clientId: "ravi-2",
      name: "Ravi",
      language: "hi",
      mode: "talk",
    });
    const proposed = await c.until<RoomState>(
      "room:state",
      (state) => state.participants.length === 2 && state.mode === "chat" && state.modeProposal?.mode === "talk",
    );
    assert.equal((proposed.modeProposal as ModeProposal).fromId, "ravi-2");
    const asked = await c.next<ModeProposal>("mode:proposed");
    assert.equal(asked.mode, "talk");

    c.socket.emit("chat:send", { clientMsgId: "m1", text: "I disagree." });
    const line = await d.until<TranscriptItem>(
      "item:updated",
      (item) => item.status === "ok" && item.authorId === "asha-2",
    );
    assert.equal(line.translatedText, "मैं असहमत हूँ।");

    c.socket.emit("mode:respond", { accept: true });
    const talking = await d.until<RoomState>(
      "room:state",
      (state) => state.mode === "talk" && state.modeProposal === null,
    );
    assert.equal(talking.transcript.some((item) => item.id === line.id), true);
    assert.equal(talking.participants.length, 2);
    assert.equal(talking.participants.every((person) => person.micEnabled === false), true);

    c.socket.emit("mode:propose", { mode: "chat" });
    await d.next("mode:proposed");
    const declined = c.next<{ name: string; mode: string }>("mode:declined");
    d.socket.emit("mode:respond", { accept: false });
    const notice = await declined;
    assert.equal(notice.name, "Ravi");
    assert.equal(notice.mode, "talk");
    const stayed = await c.until<RoomState>(
      "room:state",
      (state) => state.mode === "talk" && state.modeProposal === null,
    );
    assert.equal(stayed.transcript.length >= 1, true);
    assert.equal(stayed.mode, "talk");
    c.socket.close();
    d.socket.close();
  } finally {
    a.socket.close();
    b.socket.close();
    globalThis.fetch = original;
    await new Promise<void>((resolve) => httpServer.close(() => resolve()));
  }
});
