export type VadEvent = "start" | "end";

export interface VadConfig {
  startMs: number;
  hangoverMs: number;
  minMs: number;
  maxMs: number;
  startDb: number;
  bargeDb: number;
  bargeStartMs: number;
}

export const defaultVad: VadConfig = {
  startMs: 160,
  hangoverMs: 1200,
  minMs: 600,
  maxMs: 14000,
  startDb: -38,
  bargeDb: -24,
  bargeStartMs: 280,
};

export class EnergyVad {
  private speaking = false;
  private voiced = 0;
  private silent = 0;
  private startedAt = 0;
  constructor(
    private readonly sampleRate: number,
    private readonly cfg: VadConfig,
    private readonly onEvent: (e: VadEvent) => void,
  ) {}

  reset(): void {
    this.speaking = false;
    this.voiced = 0;
    this.silent = 0;
    this.startedAt = 0;
  }

  push(frame: Float32Array, barge: boolean, now = performance.now()): void {
    const db = rmsDb(frame);
    const thresh = barge ? this.cfg.bargeDb : this.cfg.startDb;
    const frameMs = (frame.length / this.sampleRate) * 1000;
    if (db > thresh) {
      this.voiced += frameMs;
      this.silent = 0;
    } else {
      this.silent += frameMs;
      this.voiced = Math.max(0, this.voiced - frameMs * 0.4);
    }

    const needed = barge ? this.cfg.bargeStartMs : this.cfg.startMs;
    if (!this.speaking && this.voiced >= needed) {
      this.speaking = true;
      this.startedAt = now;
      this.onEvent("start");
    } else if (this.speaking) {
      const dur = now - this.startedAt;
      if (this.silent >= this.cfg.hangoverMs && dur >= this.cfg.minMs) {
        this.speaking = false;
        this.voiced = 0;
        this.onEvent("end");
      } else if (dur >= this.cfg.maxMs) {
        this.speaking = false;
        this.voiced = 0;
        this.silent = 0;
        this.onEvent("end");
      }
    }
  }

  get active(): boolean {
    return this.speaking;
  }
}

function rmsDb(frame: Float32Array): number {
  let s = 0;
  for (let i = 0; i < frame.length; i++) s += frame[i] * frame[i];
  const rms = Math.sqrt(s / Math.max(1, frame.length));
  return 20 * Math.log10(rms + 1e-8);
}
