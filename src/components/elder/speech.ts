"use client";

/**
 * Read-aloud with the browser's built-in speech synthesis. It runs on the
 * device; no audio or text leaves it. English only, slightly slower than
 * normal for clarity.
 */

export const SPEECH_RATE = 0.9;

export function canSpeak(): boolean {
  return typeof window !== "undefined" && "speechSynthesis" in window && "SpeechSynthesisUtterance" in window;
}

/** The device's default English voice, else any English voice, else the browser default. */
function englishVoice(): SpeechSynthesisVoice | undefined {
  const voices = window.speechSynthesis.getVoices().filter((v) => v.lang.toLowerCase().startsWith("en"));
  return voices.find((v) => v.default) ?? voices.find((v) => v.localService) ?? voices[0];
}

export function speak(text: string, { onEnd }: { onEnd?: () => void } = {}): void {
  if (!canSpeak() || !text.trim()) return onEnd?.();
  const synth = window.speechSynthesis;
  synth.cancel();
  const u = new SpeechSynthesisUtterance(text);
  u.lang = "en";
  u.rate = SPEECH_RATE;
  const voice = englishVoice();
  if (voice) {
    u.voice = voice;
    u.lang = voice.lang;
  }
  u.onend = () => onEnd?.();
  u.onerror = () => onEnd?.();
  synth.speak(u);
}

export function stopSpeaking(): void {
  if (canSpeak()) window.speechSynthesis.cancel();
}
