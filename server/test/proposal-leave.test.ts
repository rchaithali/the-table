import assert from "node:assert/strict";
import { test } from "node:test";
import { io, type Socket } from "socket.io-client";
import type { RoomState } from "../../shared/types.ts";

process.env.THE_TABLE_TEST = "1";
process.env.THE_TABLE_GRACE_MS = "400";

const { server: httpServer } = await import("../src/index.ts");

function connect(url: string) {
  const socket: Socket = io(url, { transports: ["websocket"], forceNew: true, reconnection: false });
  const items: RoomState[] = [];
  const waiters: Array<(state: RoomState) => void> = [];
  socket.on("room:state", (state: RoomState) => {
    const waiter = waiters.shift();
    if (waiter) waiter(state);
    else items.push(state);
  });
  function next(ms = 4000): Promise<RoomState> {
    const queued = items.shift();
    if (queued) return Promise.resolve(queued);
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        const index = waiters.indexOf(onValue);
        if (index >= 0) waiters.splice(index, 1);
        reject(new Error("timeout room:state"));
      }, ms);
      const onValue = (state: RoomState) => {
        clearTimeout(timer);
        resolve(state);
      };
      waiters.push(onValue);
    });
  }
  async function until(pred: (state: RoomState) => boolean, ms = 4000): Promise<RoomState> {
    const start = Date.now();
    while (Date.now() - start < ms) {
      const state = await next(ms - (Date.now() - start));
      if (pred(state)) return state;
    }
    throw new Error("no matching room:state");
  }
  function reset() {
    items.length = 0;
  }
  return { socket, until, reset };
}

test("leaving or dropping cancels a pending mode invitation and keeps the transcript", async () => {
  const original = globalThis.fetch;
  globalThis.fetch = async () =>
    Response.json({ choices: [{ message: { content: "ठीक है।" } }] });
  await new Promise<void>((resolve) => httpServer.listen(0, "127.0.0.1", () => resolve()));
  const address = httpServer.address();
  if (!address || typeof address === "string") throw new Error("no port");
  const url = `http://127.0.0.1:${address.port}`;
  const asha = connect(url);
  const ravi = connect(url);
  try {
    await Promise.all([
      new Promise<void>((resolve) => asha.socket.on("connect", () => resolve())),
      new Promise<void>((resolve) => ravi.socket.on("connect", () => resolve())),
    ]);
    asha.socket.emit("room:create", {
      name: "Asha",
      language: "en",
      clientId: "asha",
      mode: "talk",
    });
    const created = await asha.until((state) => state.participants.length === 1);
    ravi.socket.emit("room:join", {
      code: created.code,
      clientId: "ravi",
      name: "Ravi",
      language: "hi",
      mode: "talk",
    });
    await asha.until((state) => state.participants.length === 2);
    asha.socket.emit("chat:send", { clientMsgId: "m1", text: "I disagree." });
    await ravi.until((state) => state.transcript.some((item) => item.sourceText === "I disagree."));
    ravi.socket.emit("mode:propose", { mode: "chat" });
    const asked = await asha.until(
      (state) => state.modeProposal?.fromId === "ravi" && state.modeProposal.mode === "chat",
    );
    assert.equal(asked.transcript.some((item) => item.sourceText === "I disagree."), true);

    ravi.socket.emit("room:leave");
    const left = await asha.until(
      (state) => state.participants.length === 1 && state.modeProposal === null,
    );
    assert.equal(left.absent?.name, "Ravi");
    assert.equal(left.transcript.some((item) => item.sourceText === "I disagree."), true);
    assert.equal(left.mode, "talk");

    ravi.reset();
    ravi.socket.emit("room:join", {
      code: created.code,
      clientId: "ravi",
      name: "Ravi",
      language: "hi",
      mode: "chat",
    });
    const back = await ravi.until(
      (state) =>
        state.youId === "ravi" &&
        state.participants.length === 2 &&
        state.transcript.some((item) => item.sourceText === "I disagree."),
    );
    assert.equal(back.transcript.some((item) => item.sourceText === "I disagree."), true);
    assert.equal(back.mode, "talk");
    assert.equal(back.modeProposal, null);

    asha.socket.emit("mode:propose", { mode: "chat" });
    await ravi.until((state) => state.modeProposal?.fromId === "asha");
    ravi.reset();
    asha.socket.disconnect();
    const dropped = await ravi.until(
      (state) => state.modeProposal === null && state.participants.length === 2,
    );
    assert.equal(dropped.transcript.some((item) => item.sourceText === "I disagree."), true);
    const gone = await ravi.until(
      (state) => state.participants.length === 1 && state.absent?.name === "Asha",
    );
    assert.equal(gone.modeProposal, null);
    assert.equal(gone.transcript.some((item) => item.sourceText === "I disagree."), true);
  } finally {
    asha.socket.close();
    ravi.socket.close();
    globalThis.fetch = original;
    await new Promise<void>((resolve) => httpServer.close(() => resolve()));
  }
});
