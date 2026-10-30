import type { Language } from "@shared/types";

let speechToken = 0;
let voicesPromise: Promise<void> | null = null;

export function cancelSpeech(): void {
  speechToken += 1;
  if (typeof window !== "undefined") window.speechSynthesis.cancel();
}

export function primeSpeech(): void {
  if (typeof window === "undefined") return;
  window.speechSynthesis.getVoices();
}

export function ensureVoices(): Promise<void> {
  if (typeof window === "undefined") return Promise.resolve();
  const synth = window.speechSynthesis;
  if (synth.getVoices().length) return Promise.resolve();
  if (!voicesPromise) {
    voicesPromise = new Promise((resolve) => {
      const finish = () => {
        if (!synth.getVoices().length) return;
        synth.removeEventListener("voiceschanged", finish);
        resolve();
      };
      synth.addEventListener("voiceschanged", finish);
      synth.getVoices();
      window.setTimeout(() => {
        synth.removeEventListener("voiceschanged", finish);
        resolve();
      }, 1200);
    });
  }
  return voicesPromise;
}

export function pickVoice(lang: Language): SpeechSynthesisVoice | null {
  const voices = window.speechSynthesis.getVoices();
  const want = lang === "hi" ? /^hi/i : /^en/i;
  return (
    voices.find((v) => want.test(v.lang)) ??
    voices.find((v) =>
      lang === "hi" ? /hindi/i.test(v.name) : /english/i.test(v.name),
    ) ??
    null
  );
}

export function hasVoice(lang: Language): boolean {
  return pickVoice(lang) !== null;
}

export async function speak(
  text: string,
  lang: Language,
): Promise<"ended" | "canceled"> {
  const my = ++speechToken;
  window.speechSynthesis.cancel();
  await ensureVoices();
  await new Promise((resolve) => window.setTimeout(resolve, 40));
  if (my !== speechToken) return "canceled";
  const voice = pickVoice(lang);
  const utterance = new SpeechSynthesisUtterance(text);
  utterance.lang = lang === "hi" ? "hi-IN" : "en-IN";
  if (voice) utterance.voice = voice;
  utterance.rate = 1;
  return new Promise((resolve) => {
    let settled = false;
    const finish = (result: "ended" | "canceled") => {
      if (settled) return;
      settled = true;
      resolve(result);
    };
    utterance.onend = () => finish(my === speechToken ? "ended" : "canceled");
    utterance.onerror = () => finish("canceled");
    if (window.speechSynthesis.paused) window.speechSynthesis.resume();
    window.speechSynthesis.speak(utterance);
  });
}
