import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { updateFamilyMemberAction } from "@/app/(app)/actions";
import { FamilyForm } from "@/components/entity-forms";
import { uuid } from "@/lib/domain/validation";
import { requireElder } from "@/server/page-data";

export const metadata: Metadata = { title: "Edit family member" };

export default async function EditFamilyMemberPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  if (!uuid.safeParse(id).success) notFound();
  const { ctx } = await requireElder();
  const member = await ctx.repo.get("family_members", id);
  if (!member) notFound();

  return (
    <>
      <div className="page-head">
        <p>
          <Link href="/family">← Back to family</Link>
        </p>
        <h1>Edit {member.full_name}</h1>
      </div>
      <div className="card">
        <FamilyForm
          action={updateFamilyMemberAction.bind(null, id)}
          submitLabel="Save changes"
          hasPhoto={Boolean(member.photo_path)}
          defaults={{ full_name: member.full_name, relationship: member.relationship, description: member.description }}
        />
      </div>
    </>
  );
}
