"use client";

/**
 * Speaking questions with the browser's speech recognition (Chrome on
 * Android, Safari on iPhone/iPad). The browser sends the audio to its own
 * speech service (Google or Apple) and returns text; DayMate receives text
 * only. One question per tap: it stops by itself when the person stops talking.
 */

interface RecognitionAlternative {
  transcript: string;
}
interface RecognitionResult {
  isFinal: boolean;
  0: RecognitionAlternative;
  length: number;
}
interface RecognitionEvent {
  resultIndex: number;
  results: { length: number; [i: number]: RecognitionResult };
}
interface Recognition {
  lang: string;
  interimResults: boolean;
  continuous: boolean;
  maxAlternatives: number;
  onresult: ((e: RecognitionEvent) => void) | null;
  onerror: ((e: { error: string }) => void) | null;
  onend: (() => void) | null;
  start(): void;
  stop(): void;
  abort(): void;
}
type RecognitionCtor = new () => Recognition;

export type ListenError = "nothing-heard" | "blocked" | "no-microphone" | "network" | "unavailable";

function ctor(): RecognitionCtor | null {
  if (typeof window === "undefined") return null;
  const w = window as unknown as { SpeechRecognition?: RecognitionCtor; webkitSpeechRecognition?: RecognitionCtor };
  return w.SpeechRecognition ?? w.webkitSpeechRecognition ?? null;
}

export function canListen(): boolean {
  return ctor() !== null && (typeof window === "undefined" || window.isSecureContext);
}

function englishLang(): string {
  const l = typeof navigator !== "undefined" ? navigator.language : "";
  return /^en(-|$)/i.test(l) ? l : "en-GB";
}

/** Start listening for one question. Returns a function that stops listening. */
export function listenOnce(handlers: { onInterim?: (text: string) => void; onFinal: (text: string) => void; onError: (e: ListenError) => void }): () => void {
  const Ctor = ctor();
  if (!Ctor) {
    handlers.onError("unavailable");
    return () => {};
  }
  const rec = new Ctor();
  rec.lang = englishLang();
  rec.interimResults = true;
  rec.continuous = false;
  rec.maxAlternatives = 1;
  let finalText = "";
  let failed = false;

  rec.onresult = (e) => {
    let interim = "";
    for (let i = e.resultIndex; i < e.results.length; i++) {
      const r = e.results[i]!;
      if (r.isFinal) finalText += r[0].transcript;
      else interim += r[0].transcript;
    }
    handlers.onInterim?.((finalText + interim).trim());
  };
  rec.onerror = (e) => {
    if (e.error === "aborted") return;
    failed = true;
    handlers.onError(
      e.error === "no-speech" ? "nothing-heard" : e.error === "not-allowed" || e.error === "service-not-allowed" ? "blocked" : e.error === "audio-capture" ? "no-microphone" : e.error === "network" ? "network" : "unavailable",
    );
  };
  rec.onend = () => {
    if (failed) return;
    const text = finalText.trim();
    if (text) handlers.onFinal(text);
    else handlers.onError("nothing-heard");
  };
  try {
    rec.start();
  } catch {
    handlers.onError("unavailable");
  }
  return () => {
    try {
      rec.stop();
    } catch {
      // already stopped
    }
  };
}

export const LISTEN_MESSAGES: Record<ListenError, string> = {
  "nothing-heard": "I didn't hear anything. Tap the microphone and try again.",
  blocked: "DayMate isn't allowed to use the microphone. Please ask your family member to check the settings.",
  "no-microphone": "I can't find a microphone on this device. You can tap a question instead.",
  network: "I couldn't hear you just now. Please check the internet and try again.",
  unavailable: "Speaking isn't available on this device. You can tap a question instead.",
};
