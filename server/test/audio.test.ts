import assert from "node:assert/strict";
import { test } from "node:test";
import { EnergyVad, defaultVad, type VadEvent } from "../../client/src/audio/vad.ts";
import { floatTo16kWav } from "../../client/src/audio/wav.ts";

test("voice activity starts after sustained speech and ends after a pause", () => {
  const events: VadEvent[] = [];
  const vad = new EnergyVad(16000, defaultVad, (event) => events.push(event));
  const loud = new Float32Array(160).fill(0.1);
  const quiet = new Float32Array(160);
  for (let i = 0; i < 15; i++) vad.push(loud, false, i * 10);
  assert.deepEqual(events, []);
  vad.push(loud, false, 150);
  assert.deepEqual(events, ["start"]);
  for (let i = 0; i < 119; i++) vad.push(quiet, false, 160 + i * 10);
  assert.deepEqual(events, ["start"]);
  vad.push(quiet, false, 160 + 119 * 10);
  assert.deepEqual(events, ["start", "end"]);
});

test("barge-in ignores quieter audio that would start a normal turn", () => {
  const mid = new Float32Array(160).fill(0.02);
  const normal: VadEvent[] = [];
  const plain = new EnergyVad(16000, defaultVad, (event) => normal.push(event));
  for (let i = 0; i < 16; i++) plain.push(mid, false, i * 10);
  assert.deepEqual(normal, ["start"]);

  const events: VadEvent[] = [];
  const vad = new EnergyVad(16000, defaultVad, (event) => events.push(event));
  for (let i = 0; i < 40; i++) vad.push(mid, true, i * 10);
  assert.deepEqual(events, []);
  const loud = new Float32Array(160).fill(0.1);
  for (let i = 0; i < 27; i++) vad.push(loud, true, 400 + i * 10);
  assert.deepEqual(events, []);
  vad.push(loud, true, 400 + 27 * 10);
  assert.deepEqual(events, ["start"]);
});

test("wav header is 16 kHz mono PCM", () => {
  const input = new Float32Array(48000).fill(0.5);
  const wav = floatTo16kWav(input, 48000);
  const view = new DataView(wav);
  const riff = String.fromCharCode(
    view.getUint8(0),
    view.getUint8(1),
    view.getUint8(2),
    view.getUint8(3),
  );
  assert.equal(riff, "RIFF");
  assert.equal(view.getUint16(22, true), 1);
  assert.equal(view.getUint32(24, true), 16000);
  assert.equal(view.getUint16(34, true), 16);
  assert.equal(wav.byteLength, 44 + 16000 * 2);
});
