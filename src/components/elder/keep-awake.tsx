"use client";

import { useEffect } from "react";

interface WakeLockSentinelLike {
  release(): Promise<void>;
}

/**
 * Keeps the screen on while DayMate is open (for an always-on tablet), using
 * the Screen Wake Lock API where the browser supports it. Re-acquired when the
 * page becomes visible again; released when the elder leaves DayMate.
 */
export function KeepAwake() {
  useEffect(() => {
    const nav = navigator as Navigator & { wakeLock?: { request(type: "screen"): Promise<WakeLockSentinelLike> } };
    if (!nav.wakeLock) return;
    let lock: WakeLockSentinelLike | null = null;
    let cancelled = false;
    const acquire = async () => {
      if (cancelled || document.visibilityState !== "visible") return;
      try {
        lock = await nav.wakeLock!.request("screen");
      } catch {
        lock = null; // e.g. battery saver; the screen may sleep as normal
      }
    };
    const onVisible = () => void acquire();
    document.addEventListener("visibilitychange", onVisible);
    void acquire();
    return () => {
      cancelled = true;
      document.removeEventListener("visibilitychange", onVisible);
      void lock?.release().catch(() => {});
    };
  }, []);
  return null;
}
