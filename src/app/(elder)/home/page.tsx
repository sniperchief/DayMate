import type { Metadata } from "next";
import Link from "next/link";
import { BookIcon, MicIcon, PeopleIcon } from "@/components/elder/icons";
import { ElderPhoto } from "@/components/elder/photo";
import { ReadAloudButton } from "@/components/elder/read-aloud";
import { buildToday, firstName } from "@/lib/elder/today";
import { requireElderSession } from "@/server/elder-context";

export const metadata: Metadata = { title: "Today" };

export default async function ElderTodayPage() {
  const { ctx, elder } = await requireElderSession();
  const [routines, family] = await Promise.all([ctx.repo.list("routines", elder.id), ctx.repo.list("family_members", elder.id)]);
  const today = buildToday({ elder, routines, family });
  const shown = [...today.items, ...(today.tomorrow ? [today.tomorrow] : [])];
  const urls = await ctx.photos.signedUrls(shown.flatMap((i) => i.people.map((p) => p.photo_path)).filter((p): p is string => Boolean(p)));
  const [next, ...later] = today.items;

  return (
    <>
      <h1 className="elder-greeting">{today.greeting}</h1>

      <section className="elder-card today-card" aria-labelledby="today-h">
        <h2 id="today-h" className="visually-hidden">
          Today
        </h2>
        {next ? (
          <>
            <p className="today-label">Next</p>
            <div className="today-next">
              {next.people.map((p) => (
                <ElderPhoto key={p.id} name={p.full_name} url={p.photo_path ? urls[p.photo_path] : null} size="lg" />
              ))}
              <p className="today-next-text">
                <strong>{next.title}</strong>
                <span>at {next.time}</span>
              </p>
            </div>
            {later.length > 0 && (
              <>
                <p className="today-label today-later-label">Later today</p>
                <ul className="today-later">
                  {later.slice(0, 3).map((i) => (
                    <li key={i.key}>
                      <span className="today-time">{i.time}</span> {i.title}
                    </li>
                  ))}
                </ul>
              </>
            )}
          </>
        ) : (
          <>
            <p className="today-next-text">
              <strong>Nothing else planned for today.</strong>
            </p>
            {today.tomorrow && (
              <p className="today-tomorrow">
                Tomorrow: {today.tomorrow.title} at {today.tomorrow.time}
                {today.tomorrow.people.length > 0 && <> with {today.tomorrow.people.map((p) => firstName(p.full_name)).join(" and ")}</>}
              </p>
            )}
          </>
        )}
      </section>

      <div className="elder-tiles">
        <Link href="/home/ask" className="elder-tile elder-tile-primary">
          <MicIcon />
          <span>Ask me</span>
        </Link>
        <Link href="/home/family" className="elder-tile">
          <PeopleIcon />
          <span>My family</span>
        </Link>
        <Link href="/home/memories" className="elder-tile">
          <BookIcon />
          <span>Memories</span>
        </Link>
        <ReadAloudButton text={today.speech} />
      </div>
    </>
  );
}
