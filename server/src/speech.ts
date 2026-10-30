/** True when a transcript contains real words, not silence or punctuation. */
export function isSpokenText(text: string): boolean {
  return /\p{L}/u.test(text);
}

/** True for a WAV that is too short or too quiet to be a spoken turn. */
export function wavLooksSilent(buffer: Buffer): boolean {
  if (buffer.length < 44 || buffer.toString("ascii", 0, 4) !== "RIFF") return false;
  let offset = 12;
  while (offset + 8 <= buffer.length) {
    const id = buffer.toString("ascii", offset, offset + 4);
    const size = buffer.readUInt32LE(offset + 4);
    if (id === "data") {
      const start = offset + 8;
      const end = Math.min(buffer.length, start + size);
      const samples = Math.floor((end - start) / 2);
      if (samples < 1600) return true;
      let sum = 0;
      for (let i = 0; i < samples; i++) {
        const sample = buffer.readInt16LE(start + i * 2) / 32768;
        sum += sample * sample;
      }
      const db = 20 * Math.log10(Math.sqrt(sum / samples) + 1e-8);
      return db < -50;
    }
    offset += 8 + size + (size % 2);
  }
  return false;
}
