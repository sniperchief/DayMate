import type { Metadata } from "next";
import Link from "next/link";
import { createRoutineAction, deleteRoutineAction, setRoutineActiveAction } from "@/app/(app)/actions";
import { PendingRefresher } from "@/components/bits";
import { RoutineForm } from "@/components/entity-forms";
import { ConfirmDelete, hasRecentPending, Notice, walrusIndex, WalrusStatus } from "@/components/ui";
import { DayTimeline } from "@/components/timeline";
import { describeSchedule, localNow, upcomingOccurrences } from "@/lib/domain/schedule";
import { firstName, requireElder } from "@/server/page-data";

export const metadata: Metadata = { title: "Routines" };

export default async function RoutinesPage({ searchParams }: { searchParams: Promise<{ notice?: string }> }) {
  const { notice } = await searchParams;
  const { ctx, elder } = await requireElder();
  const [routines, records] = await Promise.all([ctx.repo.list("routines", elder.id), ctx.repo.walrusRecords(elder.id)]);
  const now = new Date();
  const today = localNow(now, elder.timezone).date;
  const upcoming = upcomingOccurrences(routines, now, elder.timezone, 7);
  const status = walrusIndex(records);
  const name = firstName(elder.full_name);

  return (
    <>
      <PendingRefresher active={hasRecentPending(records, now.getTime())} />
      <div className="page-head">
        <h1>Routines &amp; plans</h1>
        <p>
          {name}&apos;s daily rhythm and planned activities. Times use the {elder.timezone} time zone.
        </p>
      </div>
      <Notice code={notice} />

      <section className="card" aria-labelledby="week-h">
        <h2 id="week-h">Next 7 days</h2>
        {upcoming.length === 0 ? (
          <p className="empty">Nothing planned for the next 7 days.</p>
        ) : (
          <DayTimeline occurrences={upcoming} today={today} />
        )}
      </section>

      <section className="section" aria-labelledby="all-h">
        <h2 id="all-h">All activities</h2>
        {routines.length === 0 ? (
          <p className="empty">No routines yet. Add one below — for example &quot;Morning tea at 7:00 AM&quot;.</p>
        ) : (
          <ul className="list">
            {routines.map((r) => (
              <li key={r.id} className="card">
                <h3 className="item-title">
                  {r.title} {!r.is_active && <span className="pill">Paused</span>}
                </h3>
                <p className="meta">{describeSchedule(r)}</p>
                {r.description && <p>{r.description}</p>}
                <WalrusStatus record={status.get(r.id)} kind="routine" sourceId={r.id} expected={r.is_active} now={now.getTime()} />
                <div className="item-actions">
                  <Link href={`/routines/${r.id}`} className="btn btn-secondary btn-small">
                    Edit
                  </Link>
                  <form action={setRoutineActiveAction.bind(null, r.id, !r.is_active)}>
                    <button type="submit" className="btn btn-secondary btn-small">
                      {r.is_active ? "Pause" : "Turn on"}
                    </button>
                  </form>
                  <ConfirmDelete action={deleteRoutineAction.bind(null, r.id)} label="Remove" question={`Remove "${r.title}"?`} />
                </div>
              </li>
            ))}
          </ul>
        )}
      </section>

      <section className="section card" aria-labelledby="add-h">
        <h2 id="add-h">Add a routine or plan</h2>
        <RoutineForm action={createRoutineAction} submitLabel="Add activity" defaults={{ recurrence: "daily", is_active: "true" }} />
      </section>
    </>
  );
}
