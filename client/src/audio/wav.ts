export function floatTo16kWav(input: Float32Array, inputRate: number): ArrayBuffer {
  const targetRate = 16000;
  const ratio = inputRate / targetRate;
  const outLen = Math.max(1, Math.floor(input.length / ratio));
  const pcm = new Int16Array(outLen);
  for (let i = 0; i < outLen; i++) {
    const x = input[Math.floor(i * ratio)] ?? 0;
    const s = Math.max(-1, Math.min(1, x));
    pcm[i] = s < 0 ? s * 0x8000 : s * 0x7fff;
  }
  const bytes = pcm.byteLength;
  const buffer = new ArrayBuffer(44 + bytes);
  const view = new DataView(buffer);
  write(view, 0, "RIFF");
  view.setUint32(4, 36 + bytes, true);
  write(view, 8, "WAVE");
  write(view, 12, "fmt ");
  view.setUint32(16, 16, true);
  view.setUint16(20, 1, true);
  view.setUint16(22, 1, true);
  view.setUint32(24, targetRate, true);
  view.setUint32(28, targetRate * 2, true);
  view.setUint16(32, 2, true);
  view.setUint16(34, 16, true);
  write(view, 36, "data");
  view.setUint32(40, bytes, true);
  new Uint8Array(buffer, 44).set(new Uint8Array(pcm.buffer));
  return buffer;
}

function write(view: DataView, offset: number, text: string): void {
  for (let i = 0; i < text.length; i++) view.setUint8(offset + i, text.charCodeAt(i));
}
