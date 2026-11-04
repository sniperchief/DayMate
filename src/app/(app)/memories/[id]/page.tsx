import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { updateMemoryAction } from "@/app/(app)/actions";
import { MemoryForm } from "@/components/entity-forms";
import { uuid } from "@/lib/domain/validation";
import { requireElder } from "@/server/page-data";

export const metadata: Metadata = { title: "Edit memory" };

export default async function EditMemoryPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  if (!uuid.safeParse(id).success) notFound();
  const { ctx, elder } = await requireElder();
  const [m, family] = await Promise.all([ctx.repo.get("memories", id), ctx.repo.list("family_members", elder.id)]);
  if (!m) notFound();

  return (
    <>
      <div className="page-head">
        <p>
          <Link href="/memories">← Back to memories</Link>
        </p>
        <h1>Edit memory</h1>
      </div>
      <div className="card">
        <MemoryForm
          action={updateMemoryAction.bind(null, id)}
          submitLabel="Save changes"
          people={family.map((f) => ({ id: f.id, label: `${f.full_name} (${f.relationship})` }))}
          defaults={{ title: m.title, description: m.description, event_date: m.event_date, related_person_id: m.related_person_id, category: m.category }}
        />
      </div>
    </>
  );
}
