import type { Metadata } from "next";
import Link from "next/link";
import { ElderPhoto } from "@/components/elder/photo";
import { requireElderSession } from "@/server/elder-context";

export const metadata: Metadata = { title: "My family" };

/** Photo wall: tap a face to see who they are. */
export default async function ElderFamilyPage() {
  const { ctx, elder } = await requireElderSession();
  const family = await ctx.repo.list("family_members", elder.id);
  const urls = await ctx.photos.signedUrls(family.map((f) => f.photo_path).filter((p): p is string => Boolean(p)));

  return (
    <>
      <h1 className="elder-title">My family</h1>
      {family.length === 0 ? (
        <p className="elder-card">Your family hasn&apos;t added anyone yet.</p>
      ) : (
        <ul className="family-wall">
          {family.map((f) => (
            <li key={f.id}>
              <Link href={`/home/family/${f.id}`} className="elder-card family-tile">
                <ElderPhoto name={f.full_name} url={f.photo_path ? urls[f.photo_path] : null} size="lg" />
                <span className="family-name">{f.full_name}</span>
                <span className="family-rel">Your {f.relationship.trim().toLowerCase()}</span>
              </Link>
            </li>
          ))}
        </ul>
      )}
    </>
  );
}
