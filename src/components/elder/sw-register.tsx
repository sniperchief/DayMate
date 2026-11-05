"use client";

import { useEffect } from "react";

/** Registers the tiny service worker that shows an offline page (it caches no personal data). */
export function ServiceWorkerRegister() {
  useEffect(() => {
    if ("serviceWorker" in navigator && process.env.NODE_ENV === "production") {
      navigator.serviceWorker.register("/sw.js").catch(() => {});
    }
  }, []);
  return null;
}
