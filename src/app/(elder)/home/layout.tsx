import type { Metadata } from "next";
import { BottomBar } from "@/components/elder/bottom-bar";
import { ElderClock } from "@/components/elder/clock";
import { IdleReturn } from "@/components/elder/idle-return";
import { ServiceWorkerRegister } from "@/components/elder/sw-register";
import { buildToday } from "@/lib/elder/today";
import { requireElderSession } from "@/server/elder-context";

export const metadata: Metadata = {
  title: "DayMate",
  appleWebApp: { capable: true, title: "DayMate", statusBarStyle: "default" },
  icons: { apple: "/icons/apple-touch-icon.png" },
};

/** Shell for the paired elder device: date + time on top, the same four big places at the bottom. */
export default async function ElderHomeLayout({ children }: { children: React.ReactNode }) {
  const { elder } = await requireElderSession();
  const now = new Date();
  const today = buildToday({ elder, routines: [], family: [], now });
  const initialTime = new Intl.DateTimeFormat("en-GB", { hour: "numeric", minute: "2-digit", hour12: true, timeZone: elder.timezone }).format(now).toUpperCase();

  return (
    <div className="elder-shell">
      <header className="elder-top">
        <p className="elder-day">
          <strong>{today.weekday}</strong> {today.dateLabel}
        </p>
        <ElderClock timeZone={elder.timezone} initial={initialTime} />
      </header>
      <div className="elder-content">{children}</div>
      <BottomBar />
      <IdleReturn />
      <ServiceWorkerRegister />
    </div>
  );
}
