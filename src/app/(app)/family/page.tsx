import type { Metadata } from "next";
import Link from "next/link";
import { createFamilyMemberAction, deleteFamilyMemberAction } from "@/app/(app)/actions";
import { PendingRefresher } from "@/components/bits";
import { FamilyForm } from "@/components/entity-forms";
import { Avatar, ConfirmDelete, hasRecentPending, Notice, walrusIndex, WalrusStatus } from "@/components/ui";
import { firstName, requireElder } from "@/server/page-data";

export const metadata: Metadata = { title: "Family" };

export default async function FamilyPage({ searchParams }: { searchParams: Promise<{ notice?: string }> }) {
  const { notice } = await searchParams;
  const { ctx, elder } = await requireElder();
  const [family, records] = await Promise.all([ctx.repo.list("family_members", elder.id), ctx.repo.walrusRecords(elder.id)]);
  const urls = await ctx.photos.signedUrls(family.map((f) => f.photo_path).filter((p): p is string => Boolean(p)));
  const status = walrusIndex(records);
  const now = Date.now();
  const name = firstName(elder.full_name);

  return (
    <>
      <PendingRefresher active={hasRecentPending(records, now)} />
      <div className="page-head">
        <h1>Family &amp; friends</h1>
        <p>The people who matter most to {name}, and how they are related.</p>
      </div>
      <Notice code={notice} />

      {family.length === 0 ? (
        <p className="empty">No one added yet. Use the form below to add the first person.</p>
      ) : (
        <ul className="grid" style={{ listStyle: "none", padding: 0, margin: 0 }}>
          {family.map((f) => (
            <li key={f.id} className="card">
              <div className="item-head">
                <Avatar name={f.full_name} url={f.photo_path ? urls[f.photo_path] : null} />
                <div className="item-body">
                  <h2 className="item-title">{f.full_name}</h2>
                  <p style={{ margin: "0.25rem 0" }}>
                    <span className="pill">
                      {name}&apos;s {f.relationship.toLowerCase()}
                    </span>
                  </p>
                  {f.description && <p>{f.description}</p>}
                </div>
              </div>
              <WalrusStatus record={status.get(f.id)} kind="family_member" sourceId={f.id} now={now} />
              <div className="item-actions">
                <Link href={`/family/${f.id}`} className="btn btn-secondary btn-small">
                  Edit
                </Link>
                <ConfirmDelete action={deleteFamilyMemberAction.bind(null, f.id)} label="Remove" question={`Remove ${f.full_name}?`} />
              </div>
            </li>
          ))}
        </ul>
      )}

      <section className="section card" aria-labelledby="add-h">
        <h2 id="add-h">Add someone</h2>
        <FamilyForm action={createFamilyMemberAction} submitLabel="Add person" />
      </section>
    </>
  );
}
