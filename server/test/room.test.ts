import assert from "node:assert/strict";
import { test } from "node:test";
import { addOrReconnect, createRoom, removeSeat } from "../src/room.ts";

test("a table holds two seats and lets the same person reconnect", () => {
  const room = createRoom();
  const first = addOrReconnect(room, {
    clientId: "asha",
    socketId: "s1",
    name: "Asha",
    language: "en",
  });
  const second = addOrReconnect(room, {
    clientId: "ravi",
    socketId: "s2",
    name: "Ravi",
    language: "hi",
  });
  assert.notEqual(first, "full");
  assert.notEqual(second, "full");
  assert.equal(
    addOrReconnect(room, {
      clientId: "third",
      socketId: "s3",
      name: "Third",
      language: "en",
    }),
    "full",
  );
  const again = addOrReconnect(room, {
    clientId: "asha",
    socketId: "s9",
    name: "Asha",
    language: "hi",
  });
  assert.notEqual(again, "full");
  if (again === "full") return;
  assert.equal(again.socketId, "s9");
  assert.equal(again.language, "hi");
  assert.equal(room.seats.length, 2);
});

test("a person leaving clears a pending mode change", () => {
  const room = createRoom();
  addOrReconnect(room, {
    clientId: "asha",
    socketId: "s1",
    name: "Asha",
    language: "en",
  });
  addOrReconnect(room, {
    clientId: "ravi",
    socketId: "s2",
    name: "Ravi",
    language: "hi",
  });
  room.modeProposal = { fromId: "ravi", mode: "talk" };
  removeSeat(room, "asha");
  assert.equal(room.modeProposal, null);
  assert.equal(room.seats.length, 1);
  assert.equal(room.phase, "idle");
});
