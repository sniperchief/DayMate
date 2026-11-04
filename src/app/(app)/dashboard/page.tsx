import type { Metadata } from "next";
import Link from "next/link";
import { PendingRefresher } from "@/components/bits";
import { Avatar, hasRecentPending } from "@/components/ui";
import { DayTimeline } from "@/components/timeline";
import { formatDate, localNow, upcomingOccurrences } from "@/lib/domain/schedule";
import { CATEGORY_LABELS } from "@/lib/domain/types";
import { firstName, requireElder } from "@/server/page-data";

export const metadata: Metadata = { title: "Dashboard" };

export default async function DashboardPage() {
  const { ctx, elder } = await requireElder();
  const [family, routines, memories, records] = await Promise.all([
    ctx.repo.list("family_members", elder.id),
    ctx.repo.list("routines", elder.id),
    ctx.repo.list("memories", elder.id),
    ctx.repo.walrusRecords(elder.id),
  ]);
  const now = new Date();
  const today = localNow(now, elder.timezone).date;
  const upcoming = upcomingOccurrences(routines, now, elder.timezone, 3);
  const urls = await ctx.photos.signedUrls([elder.photo_path, ...family.map((f) => f.photo_path)].filter((p): p is string => Boolean(p)));
  const name = firstName(elder.full_name);

  const stored = records.filter((r) => r.status === "stored").length;
  const notStored = records.filter((r) => r.status !== "stored").length;

  return (
    <>
      <PendingRefresher active={hasRecentPending(records, now.getTime())} />
      <div className="page-head profile-hero">
        <Avatar name={elder.full_name} url={elder.photo_path ? urls[elder.photo_path] : null} large />
        <div>
          <p className="muted" style={{ margin: 0 }}>
            {formatDate(today)}
          </p>
          <h1>{elder.full_name}</h1>
          {elder.description && <p>{elder.description}</p>}
        </div>
      </div>

      <div className="dash-grid">
        <section className="card" aria-labelledby="upcoming-h">
          <div className="section-head">
            <h2 id="upcoming-h">Coming up</h2>
            <Link href="/routines">All routines</Link>
          </div>
          {upcoming.length === 0 ? (
            <p className="empty">Nothing planned for today or the next two days. <Link href="/routines">Add a routine</Link>.</p>
          ) : (
            <DayTimeline occurrences={upcoming} today={today} />
          )}
        </section>

        <section className="card" aria-labelledby="family-h">
          <div className="section-head">
            <h2 id="family-h">{name}&apos;s people</h2>
            <Link href="/family">Family</Link>
          </div>
          {family.length === 0 ? (
            <p className="empty">No one added yet. <Link href="/family">Add a family member</Link>.</p>
          ) : (
            <ul className="list" style={{ gap: "0.75rem" }}>
              {family.slice(0, 6).map((f) => (
                <li key={f.id} className="item-head" style={{ alignItems: "center" }}>
                  <Avatar name={f.full_name} url={f.photo_path ? urls[f.photo_path] : null} />
                  <div>
                    <strong>{f.full_name}</strong>
                    <div>
                      <span className="pill">{f.relationship}</span>
                    </div>
                  </div>
                </li>
              ))}
            </ul>
          )}
        </section>
      </div>

      <section className="section card" aria-labelledby="memories-h">
        <div className="section-head">
          <h2 id="memories-h">Recent memories</h2>
          <Link href="/memories">All memories</Link>
        </div>
        {memories.length === 0 ? (
          <p className="empty">No memories saved yet. <Link href="/memories">Save the first one</Link>.</p>
        ) : (
          <ul className="list">
            {memories.slice(0, 5).map((m) => (
              <li key={m.id}>
                <strong>{m.title}</strong>
                <div className="meta">
                  {CATEGORY_LABELS[m.category]}
                  {m.event_date ? ` · ${formatDate(m.event_date)}` : ""}
                </div>
                <p style={{ margin: "0.25rem 0 0" }}>{m.description}</p>
              </li>
            ))}
          </ul>
        )}
      </section>

      <section className="section" aria-labelledby="walrus-h">
        <h2 id="walrus-h" className="visually-hidden">
          Walrus Memory
        </h2>
        <p className="meta">
          Walrus Memory: {stored} {stored === 1 ? "item" : "items"} stored
          {notStored > 0 ? ` · ${notStored} waiting or needing a retry (see each section)` : ""}.
        </p>
      </section>
    </>
  );
}
