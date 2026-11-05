import { formatTime, relativeDay, type Occurrence } from "@/lib/domain/schedule";

/** Upcoming activities grouped under a heading per day. */
export function DayTimeline({ occurrences, today, headingLevel = 3 }: { occurrences: Occurrence[]; today: string; headingLevel?: 3 | 4 }) {
  const days = new Map<string, Occurrence[]>();
  for (const o of occurrences) days.set(o.date, [...(days.get(o.date) ?? []), o]);
  const H = `h${headingLevel}` as const;

  return (
    <div className="days">
      {[...days.entries()].map(([date, items]) => (
        <section key={date} className="day">
          <H className="day-title">{relativeDay(date, today)}</H>
          <ol className="timeline">
            {items.map((o) => (
              <li key={`${o.routine.id}-${o.date}`}>
                <span className="when">{formatTime(o.time)}</span>
                <span>
                  <strong>{o.routine.title}</strong>
                  {o.routine.recurrence === "none" && <span className="pill pill-plan">Planned</span>}
                </span>
              </li>
            ))}
          </ol>
        </section>
      ))}
    </div>
  );
}
