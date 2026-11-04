import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { updateRoutineAction } from "@/app/(app)/actions";
import { RoutineForm } from "@/components/entity-forms";
import { hhmm } from "@/lib/domain/schedule";
import { uuid } from "@/lib/domain/validation";
import { requireElder } from "@/server/page-data";

export const metadata: Metadata = { title: "Edit routine" };

export default async function EditRoutinePage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  if (!uuid.safeParse(id).success) notFound();
  const { ctx } = await requireElder();
  const r = await ctx.repo.get("routines", id);
  if (!r) notFound();

  return (
    <>
      <div className="page-head">
        <p>
          <Link href="/routines">← Back to routines</Link>
        </p>
        <h1>Edit &quot;{r.title}&quot;</h1>
      </div>
      <div className="card">
        <RoutineForm
          action={updateRoutineAction.bind(null, id)}
          submitLabel="Save changes"
          defaults={{
            title: r.title,
            description: r.description,
            recurrence: r.recurrence,
            activity_date: r.activity_date,
            weekday: r.weekday === null ? "" : String(r.weekday),
            time_of_day: hhmm(r.time_of_day),
            is_active: String(r.is_active),
          }}
        />
      </div>
    </>
  );
}
