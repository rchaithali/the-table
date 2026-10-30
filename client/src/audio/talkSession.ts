import { socket } from "../socket";
import { requestMicrophone } from "./dictate";
import { EnergyVad, defaultVad } from "./vad";
import { floatTo16kWav } from "./wav";
import { cancelSpeech } from "./tts";

const workletSource = `
class CaptureProcessor extends AudioWorkletProcessor {
  process(inputs) {
    const ch = inputs[0] && inputs[0][0];
    if (ch) this.port.postMessage(ch);
    return true;
  }
}
registerProcessor('table-capture', CaptureProcessor);
`;

export class TalkSession {
  private ctx: AudioContext | null = null;
  private stream: MediaStream | null = null;
  private source: MediaStreamAudioSourceNode | null = null;
  private node: AudioWorkletNode | null = null;
  private vad: EnergyVad | null = null;
  private chunks: Float32Array[] = [];
  private enabled = false;
  private remotePlaying = false;
  private bargeLockUntil = 0;
  playingJobId: string | null = null;

  async enable(): Promise<void> {
    if (this.enabled) return;
    this.stream = await requestMicrophone();
    this.ctx = new AudioContext();
    await this.ctx.resume();
    const blob = new Blob([workletSource], { type: "text/javascript" });
    const url = URL.createObjectURL(blob);
    await this.ctx.audioWorklet.addModule(url);
    URL.revokeObjectURL(url);
    this.source = this.ctx.createMediaStreamSource(this.stream);
    this.node = new AudioWorkletNode(this.ctx, "table-capture");
    this.vad = new EnergyVad(this.ctx.sampleRate, defaultVad, (ev) => {
      if (ev === "start") this.onStart();
      else this.onEnd();
    });
    this.node.port.onmessage = (e: MessageEvent<Float32Array>) => {
      if (!this.enabled || !this.vad || !this.ctx) return;
      if (performance.now() < this.bargeLockUntil) return;
      const frame = new Float32Array(e.data);
      this.chunks.push(frame);
      this.vad.push(frame, this.remotePlaying);
      if (!this.vad.active) {
        const maxFrames = Math.max(
          1,
          Math.ceil((this.ctx.sampleRate * 0.35) / Math.max(1, frame.length)),
        );
        while (this.chunks.length > maxFrames) this.chunks.shift();
      }
    };
    this.source.connect(this.node);
    const mute = this.ctx.createGain();
    mute.gain.value = 0;
    this.node.connect(mute);
    mute.connect(this.ctx.destination);
    this.enabled = true;
    socket.emit("talk:mic", { enabled: true });
  }

  disable(): void {
    const was = this.enabled;
    this.enabled = false;
    this.remotePlaying = false;
    this.playingJobId = null;
    this.vad?.reset();
    this.chunks = [];
    this.node?.disconnect();
    this.source?.disconnect();
    this.stream?.getTracks().forEach((t) => t.stop());
    void this.ctx?.close();
    this.node = null;
    this.source = null;
    this.stream = null;
    this.ctx = null;
    if (!was) return;
    socket.emit("talk:mic", { enabled: false });
    socket.emit("talk:activity", { speaking: false });
  }

  setRemotePlaying(jobId: string | null): void {
    this.remotePlaying = Boolean(jobId);
    this.playingJobId = jobId;
  }

  private onStart(): void {
    socket.emit("talk:activity", { speaking: true });
    if (this.remotePlaying) {
      cancelSpeech();
      socket.emit("talk:barge_begin", { jobId: crypto.randomUUID() });
      this.remotePlaying = false;
      this.bargeLockUntil = performance.now() + 250;
      this.chunks = [];
    }
  }

  private onEnd(): void {
    socket.emit("talk:activity", { speaking: false });
    const ctx = this.ctx;
    if (!ctx) return;
    const total = this.chunks.reduce((n, c) => n + c.length, 0);
    const merged = new Float32Array(total);
    let o = 0;
    for (const c of this.chunks) {
      merged.set(c, o);
      o += c.length;
    }
    this.chunks = [];
    if (total < ctx.sampleRate * 0.25) return;
    const wav = floatTo16kWav(merged, ctx.sampleRate);
    socket.emit("talk:utterance", {
      jobId: crypto.randomUUID(),
      mime: "audio/wav",
      audio: wav,
    });
  }
}
