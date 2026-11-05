"use client";

import { useEffect, useState } from "react";
import { SpeakerIcon } from "./icons";
import { canSpeak, speak, stopSpeaking } from "./speech";

/** Big "Read to me" button. Hidden when the device cannot speak. */
export function ReadAloudButton({ text, label = "Read to me", className = "elder-tile" }: { text: string; label?: string; className?: string }) {
  const [supported, setSupported] = useState(false);
  const [speaking, setSpeaking] = useState(false);
  useEffect(() => {
    setSupported(canSpeak());
    return () => stopSpeaking();
  }, []);
  if (!supported) return null;
  return (
    <button
      type="button"
      className={className}
      aria-pressed={speaking}
      onClick={() => {
        if (speaking) {
          stopSpeaking();
          setSpeaking(false);
          return;
        }
        setSpeaking(true);
        speak(text, { onEnd: () => setSpeaking(false) });
      }}
    >
      <SpeakerIcon />
      <span>{speaking ? "Stop" : label}</span>
    </button>
  );
}
