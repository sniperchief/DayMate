"use client";

import { useEffect } from "react";
import { speak, stopSpeaking } from "./speech";

/**
 * Speaks `text` once when the screen opens (after the elder tapped to get
 * here). Browsers may block speech without a recent tap; then it stays
 * silent and the speaker button still works.
 */
export function AutoSpeak({ text }: { text: string }) {
  useEffect(() => {
    const t = setTimeout(() => speak(text), 300);
    return () => {
      clearTimeout(t);
      stopSpeaking();
    };
  }, [text]);
  return null;
}
