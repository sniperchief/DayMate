"use client";

import { usePathname, useRouter } from "next/navigation";
import { useEffect } from "react";
import { stopSpeaking } from "./speech";

export const IDLE_RETURN_MS = 3 * 60_000;
const REFRESH_HOME_MS = 5 * 60_000;

/**
 * After 3 minutes without a touch, gently go back to Home. On Home itself,
 * refresh every 5 minutes so an always-on tablet shows the current plan and date.
 */
export function IdleReturn() {
  const router = useRouter();
  const pathname = usePathname();

  useEffect(() => {
    let timer: ReturnType<typeof setTimeout>;
    const onHome = pathname === "/home";
    const arm = () => {
      clearTimeout(timer);
      timer = setTimeout(
        () => {
          if (onHome) {
            router.refresh();
            arm();
          } else {
            stopSpeaking();
            router.push("/home");
          }
        },
        onHome ? REFRESH_HOME_MS : IDLE_RETURN_MS,
      );
    };
    const events = ["pointerdown", "keydown", "scroll", "touchstart"] as const;
    for (const e of events) window.addEventListener(e, arm, { passive: true });
    arm();
    return () => {
      clearTimeout(timer);
      for (const e of events) window.removeEventListener(e, arm);
    };
  }, [pathname, router]);

  return null;
}
