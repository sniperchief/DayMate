import type { Metadata } from "next";
import { ElderPhoto } from "@/components/elder/photo";
import { localNow } from "@/lib/domain/schedule";
import { firstName, friendlyPast } from "@/lib/elder/today";
import { requireElderSession } from "@/server/elder-context";

export const metadata: Metadata = { title: "Memories" };

// Redesign M2: recent memories. M5 adds photos, tabs and a memory of the day.
export default async function ElderMemoriesPage() {
  const { ctx, elder } = await requireElderSession();
  const [memories, family] = await Promise.all([ctx.repo.list("memories", elder.id), ctx.repo.list("family_members", elder.id)]);
  const people = new Map(family.map((f) => [f.id, f]));
  const urls = await ctx.photos.signedUrls(family.map((f) => f.photo_path).filter((p): p is string => Boolean(p)));
  const today = localNow(new Date(), elder.timezone).date;
  const day = (m: (typeof memories)[number]) => m.event_date ?? m.created_at.slice(0, 10);
  const sorted = [...memories].sort((a, b) => day(b).localeCompare(day(a)));

  return (
    <>
      <h1 className="elder-title">Memories</h1>
      {sorted.length === 0 ? (
        <p className="elder-card">Your family hasn&apos;t saved any memories yet.</p>
      ) : (
        <ul className="memory-list">
          {sorted.slice(0, 30).map((m) => {
            const person = m.related_person_id ? people.get(m.related_person_id) : undefined;
            const when = m.event_date ? friendlyPast(m.event_date, today) : null;
            return (
              <li key={m.id} className="elder-card memory-card">
                {person && <ElderPhoto name={person.full_name} url={person.photo_path ? urls[person.photo_path] : null} />}
                <div>
                  <h2 className="memory-title">{m.title}</h2>
                  {when && <p className="memory-when">{when.charAt(0).toUpperCase() + when.slice(1)}</p>}
                  <p className="memory-text">{m.description}</p>
                  {person && (
                    <p className="memory-who">
                      With {firstName(person.full_name)}, your {person.relationship.trim().toLowerCase()}
                    </p>
                  )}
                </div>
              </li>
            );
          })}
        </ul>
      )}
    </>
  );
}
