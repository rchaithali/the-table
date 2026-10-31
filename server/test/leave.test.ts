import assert from "node:assert/strict";
import { test } from "node:test";
import { io, type Socket } from "socket.io-client";
import type { Participant, RoomState, TranscriptItem } from "../../shared/types.ts";

process.env.THE_TABLE_TEST = "1";

const { server: httpServer } = await import("../src/index.ts");

type AnyEvent = Record<string, unknown>;

function connect(name: string, url: string) {
  const socket: Socket = io(url, { transports: ["websocket"], forceNew: true });
  const buckets = new Map<string, { items: AnyEvent[]; waiters: Array<(value: AnyEvent) => void> }>();
  for (const event of ["room:created", "room:state", "room:error", "peer:left", "peer:joined", "item:updated"]) {
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

test("leaving the table keeps the other person, the mode, and the transcript", async () => {
  const original = globalThis.fetch;
  globalThis.fetch = async () =>
    Response.json({ choices: [{ message: { content: "मैं असहमत हूँ।" } }] });

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
    await ravi.until<RoomState>("room:state", (state) => state.participants.length === 2);

    asha.socket.emit("chat:send", { clientMsgId: "keep", text: "I disagree." });
    const line = await ravi.until<TranscriptItem>(
      "item:updated",
      (item) => item.status === "ok" && item.sourceText === "I disagree.",
    );

    const left = ravi.next<{ id: string }>("peer:left");
    asha.socket.emit("room:leave");
    assert.equal((await left).id, "asha");
    const alone = await ravi.until<RoomState>(
      "room:state",
      (state) => state.participants.length === 1 && state.absent?.name === "Asha",
    );
    assert.equal(alone.mode, "chat");
    assert.equal(alone.participants[0]?.id, "ravi");
    assert.equal(alone.transcript.some((item) => item.id === line.id), true);
    assert.equal(asha.socket.connected, true);
    assert.equal(ravi.socket.connected, true);

    const returned = ravi.next<Participant>("peer:joined");
    asha.socket.emit("room:join", {
      code: created.code,
      clientId: "asha",
      name: "Asha",
      language: "en",
      mode: "chat",
    });
    assert.equal((await returned).name, "Asha");
    const together = await ravi.until<RoomState>(
      "room:state",
      (state) => state.participants.length === 2 && state.absent === null,
    );
    assert.equal(together.mode, "chat");
    assert.equal(together.transcript.some((item) => item.id === line.id), true);
  } finally {
    asha.socket.close();
    ravi.socket.close();
    globalThis.fetch = original;
    await new Promise<void>((resolve) => httpServer.close(() => resolve()));
  }
});
