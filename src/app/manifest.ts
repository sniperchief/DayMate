import type { MetadataRoute } from "next";

/** Installable "Add to Home Screen" app for the elder's paired device. */
export default function manifest(): MetadataRoute.Manifest {
  return {
    name: "DayMate",
    short_name: "DayMate",
    description: "A little help remembering what matters.",
    start_url: "/home",
    scope: "/",
    display: "standalone",
    orientation: "any",
    background_color: "#faf7f2",
    theme_color: "#faf7f2",
    icons: [
      { src: "/icons/icon-192.png", sizes: "192x192", type: "image/png", purpose: "any" },
      { src: "/icons/icon-512.png", sizes: "512x512", type: "image/png", purpose: "any" },
      { src: "/icons/icon-maskable-512.png", sizes: "512x512", type: "image/png", purpose: "maskable" },
    ],
  };
}
