import type { Metadata } from "next";
import Link from "next/link";
import { ElderPhoto } from "@/components/elder/photo";
import { ReadAloudButton } from "@/components/elder/read-aloud";
import { localNow } from "@/lib/domain/schedule";
import type { FamilyMember, Memory } from "@/lib/domain/types";
import { MEMORY_TABS, memoriesForTab, memoryOfTheDay, memorySpeech, parseTab, whenLabel } from "@/lib/elder/memories";
import { firstName } from "@/lib/elder/today";
import { requireElderSession } from "@/server/elder-context";

export const metadata: Metadata = { title: "Memories" };

const EMPTY: Record<string, string> = {
  recent: "Your family hasn't saved any memories yet.",
  family: "There are no memories with your family saved yet.",
  enjoy: "Nothing saved here yet about the things you enjoy.",
};

function MemoryCard({ m, person, urls, today, featured = false }: { m: Memory; person?: FamilyMember; urls: Record<string, string>; today: string; featured?: boolean }) {
  const photo = m.photo_path ? urls[m.photo_path] : null;
  const when = whenLabel(m, today);
  return (
    <article className={`elder-card memory-card${featured ? " memory-featured" : ""}`}>
      {photo ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img src={photo} alt="" className="memory-photo" />
      ) : (
        person && <ElderPhoto name={person.full_name} url={person.photo_path ? urls[person.photo_path] : null} />
      )}
      <div className="memory-body">
        {featured && <p className="today-label">Memory of the day</p>}
        <h2 className="memory-title">{m.title}</h2>
        {when && <p className="memory-when">{when}</p>}
        <p className="memory-text">{m.description}</p>
        {person && (
          <p className="memory-who">
            With {firstName(person.full_name)}, your {person.relationship.trim().toLowerCase()}
          </p>
        )}
        <ReadAloudButton text={memorySpeech(m, person, today)} label="Read this to me" className="elder-speak" />
      </div>
    </article>
  );
}

export default async function ElderMemoriesPage({ searchParams }: { searchParams: Promise<{ tab?: string }> }) {
  const tab = parseTab((await searchParams).tab);
  const { ctx, elder } = await requireElderSession();
  const [memories, family] = await Promise.all([ctx.repo.list("memories", elder.id), ctx.repo.list("family_members", elder.id)]);
  const people = new Map(family.map((f) => [f.id, f]));
  const today = localNow(new Date(), elder.timezone).date;
  const shown = memoriesForTab(memories, tab, today).slice(0, 30);
  const featured = tab === "recent" ? memoryOfTheDay(memories, today, elder.id) : null;
  const list = featured ? shown.filter((m) => m.id !== featured.id) : shown;
  const urls = await ctx.photos.signedUrls(
    [...(featured ? [featured] : []), ...list].flatMap((m) => [m.photo_path, m.related_person_id ? people.get(m.related_person_id)?.photo_path : null]).filter((p): p is string => Boolean(p)),
  );
  const personOf = (m: Memory) => (m.related_person_id ? people.get(m.related_person_id) : undefined);

  return (
    <>
      <h1 className="elder-title">Memories</h1>
      <nav aria-label="Kinds of memories" className="memory-tabs">
        {MEMORY_TABS.map((t) => (
          <Link key={t.id} href={t.id === "recent" ? "/home/memories" : `/home/memories?tab=${t.id}`} aria-current={t.id === tab ? "page" : undefined}>
            {t.label}
          </Link>
        ))}
      </nav>

      {featured && <MemoryCard m={featured} person={personOf(featured)} urls={urls} today={today} featured />}

      {list.length === 0 && !featured ? (
        <p className="elder-card">{EMPTY[tab]}</p>
      ) : (
        <ul className="memory-list">
          {list.map((m) => (
            <li key={m.id}>
              <MemoryCard m={m} person={personOf(m)} urls={urls} today={today} />
            </li>
          ))}
        </ul>
      )}
    </>
  );
}
