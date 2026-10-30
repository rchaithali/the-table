import assert from "node:assert/strict";
import { test } from "node:test";
import { isSpokenText, wavLooksSilent } from "../src/speech.ts";

function wav(samples: number, amplitude: number): Buffer {
  const data = Buffer.alloc(samples * 2);
  for (let i = 0; i < samples; i++) data.writeInt16LE(Math.round(amplitude * 32767), i * 2);
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
  data.copy(buffer, 44);
  return buffer;
}

test("punctuation and silence are not speech", () => {
  assert.equal(isSpokenText(""), false);
  assert.equal(isSpokenText("   "), false);
  assert.equal(isSpokenText("."), false);
  assert.equal(isSpokenText("..."), false);
  assert.equal(isSpokenText("।"), false);
  assert.equal(isSpokenText("? !"), false);
  assert.equal(isSpokenText("I haven't decided yet."), true);
  assert.equal(isSpokenText("आप कल कितने बजे आ रहे हैं?"), true);
});

test("silent wavs are dropped before transcription", () => {
  assert.equal(wavLooksSilent(wav(16000, 0)), true);
  assert.equal(wavLooksSilent(wav(800, 0.2)), true);
  assert.equal(wavLooksSilent(wav(16000, 0.1)), false);
  assert.equal(wavLooksSilent(Buffer.from("not-a-wav")), false);
});
