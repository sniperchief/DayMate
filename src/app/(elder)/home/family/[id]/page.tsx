import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { AutoSpeak } from "@/components/elder/auto-speak";
import { ElderPhoto } from "@/components/elder/photo";
import { ReadAloudButton } from "@/components/elder/read-aloud";
import { uuid } from "@/lib/domain/validation";
import { buildPerson } from "@/lib/elder/person";
import { firstName } from "@/lib/elder/today";
import { requireElderSession } from "@/server/elder-context";

export const metadata: Metadata = { title: "Family" };

export default async function ElderPersonPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  if (!uuid.safeParse(id).success) notFound();
  const { ctx, elder } = await requireElderSession();
  const member = await ctx.repo.get("family_members", id); // scoped to this device's elder
  if (!member) notFound();
  const [routines, memories] = await Promise.all([ctx.repo.list("routines", elder.id), ctx.repo.list("memories", elder.id)]);
  const view = buildPerson({ member, routines, memories, timezone: elder.timezone });
  const urls = await ctx.photos.signedUrls([member.photo_path, ...view.memories.map((m) => m.photoPath)].filter((p): p is string => Boolean(p)));
  const name = firstName(member.full_name);

  return (
    <>
      <AutoSpeak text={view.speech} />
      <p>
        <Link href="/home/family" className="elder-back">
          ← All my family
        </Link>
      </p>
      <section className="elder-card person-hero">
        <ElderPhoto name={member.full_name} url={member.photo_path ? urls[member.photo_path] : null} size="xl" />
        <div>
          <h1 className="person-intro">{view.intro}</h1>
          {view.about && <p className="person-about">{view.about}</p>}
        </div>
      </section>

      {view.next && (
        <section className="elder-card person-next" aria-labelledby="next-h">
          <h2 id="next-h" className="today-label">
            Next time with {name}
          </h2>
          <p className="today-next-text">
            <strong>{view.next.title}</strong>
            <span>{view.next.when.charAt(0).toUpperCase() + view.next.when.slice(1)}</span>
          </p>
        </section>
      )}

      {view.memories.length > 0 && (
        <section aria-labelledby="mem-h">
          <h2 id="mem-h" className="elder-subtitle">
            Memories with {name}
          </h2>
          <ul className="memory-list">
            {view.memories.map((m) => (
              <li key={m.id} className="elder-card">
                {m.photoPath && urls[m.photoPath] && (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img src={urls[m.photoPath]} alt="" className="memory-photo" />
                )}
                <h3 className="memory-title">{m.title}</h3>
                {m.when && <p className="memory-when">{m.when.charAt(0).toUpperCase() + m.when.slice(1)}</p>}
                <p className="memory-text">{m.text}</p>
              </li>
            ))}
          </ul>
        </section>
      )}

      <div className="elder-tiles">
        <ReadAloudButton text={view.speech} label={`Tell me about ${name}`} />
        <Link href="/home/family" className="elder-tile">
          <span>Back to my family</span>
        </Link>
      </div>
    </>
  );
}
