import type { Metadata } from "next";
import Link from "next/link";
import { createMemoryAction, deleteMemoryAction } from "@/app/(app)/actions";
import { PendingRefresher } from "@/components/bits";
import { MemoryForm } from "@/components/entity-forms";
import { anchorIndex, ConfirmDelete, hasRecentPending, Notice, SuiStatus, walrusIndex, WalrusStatus } from "@/components/ui";
import { formatDate } from "@/lib/domain/schedule";
import { CATEGORY_LABELS } from "@/lib/domain/types";
import { firstName, requireElder } from "@/server/page-data";

export const metadata: Metadata = { title: "Memories" };

export default async function MemoriesPage({ searchParams }: { searchParams: Promise<{ notice?: string }> }) {
  const { notice } = await searchParams;
  const { ctx, elder } = await requireElder();
  const [memories, family, records, anchors] = await Promise.all([
    ctx.repo.list("memories", elder.id),
    ctx.repo.list("family_members", elder.id),
    ctx.repo.walrusRecords(elder.id),
    // Sui status is optional: if the Phase 3B table is unavailable, show "Not anchored".
    ctx.repo.memoryAnchors(elder.id).catch(() => []),
  ]);
  const people = new Map(family.map((f) => [f.id, f]));
  const status = walrusIndex(records);
  const sui = anchorIndex(anchors, status);
  const photoUrls = await ctx.photos.signedUrls(memories.map((m) => m.photo_path).filter((p): p is string => Boolean(p)));
  const anchoring = ctx.anchor?.enabled ?? false;
  const now = Date.now();
  const name = firstName(elder.full_name);

  return (
    <>
      <PendingRefresher active={hasRecentPending(records, now)} />
      <div className="page-head">
        <h1>Memories &amp; events</h1>
        <p>Moments worth remembering in {name}&apos;s life. Each memory is also saved to Walrus Memory.</p>
      </div>
      <Notice code={notice} />

      <section className="card" aria-labelledby="add-h">
        <h2 id="add-h">Save a memory</h2>
        <MemoryForm action={createMemoryAction} submitLabel="Save memory" people={family.map((f) => ({ id: f.id, label: `${f.full_name} (${f.relationship})` }))} />
      </section>

      <section className="section" aria-labelledby="list-h">
        <h2 id="list-h">Saved memories</h2>
        {memories.length === 0 ? (
          <p className="empty">No memories yet.</p>
        ) : (
          <ul className="list">
            {memories.map((m) => {
              const person = m.related_person_id ? people.get(m.related_person_id) : undefined;
              return (
                <li key={m.id} className="card">
                  <h3 className="item-title">{m.title}</h3>
                  <p className="meta">
                    <span className="pill">{CATEGORY_LABELS[m.category]}</span>
                    {m.event_date ? ` ${formatDate(m.event_date)}` : ""}
                    {person ? ` · with ${person.full_name} (${person.relationship})` : ""}
                  </p>
                  <p>{m.description}</p>
                  {m.photo_path && photoUrls[m.photo_path] && (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img src={photoUrls[m.photo_path]} alt={`Photo for “${m.title}”`} className="memory-thumb" />
                  )}
                  <WalrusStatus record={status.get(m.id)} kind="memory" sourceId={m.id} now={now} />
                  <SuiStatus anchor={sui.get(m.id)} memoryId={m.id} walrus={status.get(m.id)} enabled={anchoring} />
                  <div className="item-actions">
                    <Link href={`/memories/${m.id}`} className="btn btn-secondary btn-small">
                      Edit
                    </Link>
                    <ConfirmDelete action={deleteMemoryAction.bind(null, m.id)} label="Delete" question="Delete this memory from DayMate?" />
                  </div>
                </li>
              );
            })}
          </ul>
        )}
      </section>
    </>
  );
}
