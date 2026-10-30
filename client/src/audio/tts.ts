import type { Language } from "@shared/types";

export function cancelSpeech(): void {
  window.speechSynthesis.cancel();
}

export function pickVoice(lang: Language): SpeechSynthesisVoice | null {
  const voices = window.speechSynthesis.getVoices();
  const want = lang === "hi" ? /^hi/i : /^en/i;
  return (
    voices.find((v) => want.test(v.lang)) ??
    voices.find((v) =>
      lang === "hi"
        ? /hindi/i.test(v.name)
        : /english/i.test(v.name),
    ) ??
    null
  );
}

export function speak(text: string, lang: Language): Promise<"ended" | "canceled"> {
  cancelSpeech();
  const voice = pickVoice(lang);
  const u = new SpeechSynthesisUtterance(text);
  u.lang = lang === "hi" ? "hi-IN" : "en-IN";
  if (voice) u.voice = voice;
  u.rate = 1;
  return new Promise((resolve) => {
    u.onend = () => resolve("ended");
    u.onerror = () => resolve("canceled");
    window.speechSynthesis.speak(u);
  });
}

export function hasVoice(lang: Language): boolean {
  return pickVoice(lang) !== null;
}
