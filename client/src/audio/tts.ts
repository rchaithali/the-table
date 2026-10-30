import type { Language } from "@shared/types";

let speechToken = 0;
let voicesPromise: Promise<SpeechSynthesisVoice[]> | null = null;

export type SpeakResult = "ended" | "canceled" | "unavailable" | "failed";

export function cancelSpeech(): void {
  speechToken += 1;
  if (typeof window !== "undefined") window.speechSynthesis.cancel();
}

export function primeSpeech(): void {
  if (typeof window === "undefined") return;
  const synth = window.speechSynthesis;
  synth.getVoices();
  const primer = new SpeechSynthesisUtterance(" ");
  primer.volume = 0.01;
  primer.rate = 2;
  synth.resume();
  synth.speak(primer);
}

function matches(lang: Language, voice: SpeechSynthesisVoice): boolean {
  const code = voice.lang.replaceAll("_", "-");
  if (lang === "hi") return /^hi([-_]|$)/i.test(code) || /hindi|lekha/i.test(voice.name);
  return /^en([-_]|$)/i.test(code) || /english/i.test(voice.name);
}

export function loadVoices(): Promise<SpeechSynthesisVoice[]> {
  if (typeof window === "undefined") return Promise.resolve([]);
  const synth = window.speechSynthesis;
  const ready = (list: SpeechSynthesisVoice[]) =>
    list.some((voice) => matches("en", voice)) && list.some((voice) => matches("hi", voice));
  const current = synth.getVoices();
  if (ready(current)) return Promise.resolve(current);
  if (!voicesPromise) {
    voicesPromise = new Promise((resolve) => {
      const finish = () => {
        const list = synth.getVoices();
        if (!ready(list) && list.length === 0) return;
        if (!ready(list)) return;
        synth.removeEventListener("voiceschanged", finish);
        resolve(list);
      };
      synth.addEventListener("voiceschanged", finish);
      synth.getVoices();
      window.setTimeout(() => {
        synth.removeEventListener("voiceschanged", finish);
        resolve(synth.getVoices());
      }, 1500);
    });
  }
  return voicesPromise.then((list) => {
    if (list.length === 0) voicesPromise = null;
    return list;
  });
}

export function ensureVoices(): Promise<void> {
  return loadVoices().then(() => undefined);
}

export function pickVoice(lang: Language, voices = window.speechSynthesis.getVoices()): SpeechSynthesisVoice | null {
  const found = voices.filter((voice) => matches(lang, voice));
  return found.find((voice) => voice.localService) ?? found[0] ?? null;
}

export function hasVoice(lang: Language): boolean {
  return pickVoice(lang) !== null;
}

export async function speak(
  text: string,
  lang: Language,
  onStart?: () => void,
): Promise<SpeakResult> {
  const my = ++speechToken;
  const synth = window.speechSynthesis;
  const wasBusy = synth.speaking || synth.pending;
  if (wasBusy) synth.cancel();
  const voices = await loadVoices();
  if (wasBusy) await new Promise((resolve) => window.setTimeout(resolve, 120));
  if (my !== speechToken) return "canceled";
  const voice = pickVoice(lang, voices.length ? voices : synth.getVoices());
  if (!voice) return "unavailable";

  const say = () =>
    new Promise<SpeakResult>((resolve) => {
      const utterance = new SpeechSynthesisUtterance(text);
      utterance.voice = voice;
      utterance.lang = voice.lang.replaceAll("_", "-") || (lang === "hi" ? "hi-IN" : "en-IN");
      utterance.rate = lang === "hi" ? 0.95 : 1;
      let settled = false;
      let started = false;
      const finish = (result: SpeakResult) => {
        if (settled) return;
        settled = true;
        window.clearTimeout(startTimer);
        window.clearTimeout(endTimer);
        resolve(result);
      };
      const startTimer = window.setTimeout(() => {
        if (!started) finish("failed");
      }, 1500);
      const endTimer = window.setTimeout(
        () => finish(started ? "ended" : "failed"),
        Math.min(20000, Math.max(5000, text.length * 140)),
      );
      utterance.onstart = () => {
        started = true;
        onStart?.();
      };
      utterance.onend = () => finish(my === speechToken ? "ended" : "canceled");
      utterance.onerror = (event) => {
        const reason = event.error;
        if (my !== speechToken || reason === "canceled" || reason === "interrupted") {
          finish("canceled");
          return;
        }
        finish("failed");
      };
      if (synth.paused) synth.resume();
      synth.speak(utterance);
    });

  const first = await say();
  if (first !== "failed" || my !== speechToken) return first;
  synth.cancel();
  await new Promise((resolve) => window.setTimeout(resolve, 120));
  if (my !== speechToken) return "canceled";
  return say();
}
