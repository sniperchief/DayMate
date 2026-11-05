import { ImageResponse } from "next/og";

/** PNG app icons generated from the DayMate heart mark (same design as src/app/icon.svg). */
const ICONS: Record<string, { size: number; inset: number; radius: number }> = {
  "icon-192.png": { size: 192, inset: 0.18, radius: 0.22 },
  "icon-512.png": { size: 512, inset: 0.18, radius: 0.22 },
  "icon-maskable-512.png": { size: 512, inset: 0.28, radius: 0 }, // extra padding for the safe zone
  "apple-touch-icon.png": { size: 180, inset: 0.18, radius: 0 }, // iOS rounds the corners itself
};

const HEART = "M32 47s-15-8.6-15-19.4C17 22 21 18 26 18c2.9 0 4.9 1.5 6 3.4 1.1-1.9 3.1-3.4 6-3.4 5 0 9 4 9 9.6C47 38.4 32 47 32 47z";

export function generateStaticParams() {
  return Object.keys(ICONS).map((file) => ({ file }));
}

export async function GET(_req: Request, { params }: { params: Promise<{ file: string }> }) {
  const icon = ICONS[(await params).file];
  if (!icon) return new Response("Not found", { status: 404 });
  const heart = Math.round(icon.size * (1 - 2 * icon.inset));
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="16 17 32 31"><path d="${HEART}" fill="#faf7f2"/></svg>`;
  return new ImageResponse(
    (
      <div style={{ width: "100%", height: "100%", display: "flex", alignItems: "center", justifyContent: "center", background: "#1f4e79", borderRadius: icon.radius * icon.size }}>
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img alt="" width={heart} height={heart} src={`data:image/svg+xml;base64,${Buffer.from(svg).toString("base64")}`} />
      </div>
    ),
    { width: icon.size, height: icon.size },
  );
}
