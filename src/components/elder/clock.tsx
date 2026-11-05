"use client";

import { useEffect, useState } from "react";

/** Current time in the elder's time zone, updated every 20 seconds. */
export function ElderClock({ timeZone, initial }: { timeZone: string; initial: string }) {
  const [now, setNow] = useState<Date | null>(null);
  useEffect(() => {
    setNow(new Date());
    const t = setInterval(() => setNow(new Date()), 20_000);
    return () => clearInterval(t);
  }, []);
  const text = now ? new Intl.DateTimeFormat("en-GB", { hour: "numeric", minute: "2-digit", hour12: true, timeZone }).format(now).toUpperCase() : initial;
  return <time className="elder-clock">{text}</time>;
}
