import type { Metadata } from "next";
import { saveElderAction } from "@/app/(app)/actions";
import { PendingRefresher } from "@/components/bits";
import { ProfileForm } from "@/components/entity-forms";
import { Avatar, hasRecentPending, Notice, WalrusStatus } from "@/components/ui";
import { requireCtx } from "@/server/context";

export const metadata: Metadata = { title: "Profile" };

export default async function ProfilePage({ searchParams }: { searchParams: Promise<{ notice?: string }> }) {
  const { notice } = await searchParams;
  const ctx = await requireCtx();
  const elder = await ctx.repo.getElder();
  const records = elder ? await ctx.repo.walrusRecords(elder.id) : [];
  const profileRecord = records.find((r) => r.kind === "profile");
  const photoUrl = elder?.photo_path ? (await ctx.photos.signedUrls([elder.photo_path]))[elder.photo_path] : null;
  const now = Date.now();

  return (
    <>
      <PendingRefresher active={hasRecentPending(records, now)} />
      <div className="page-head">
        <h1>{elder ? `${elder.full_name}'s profile` : "Who are you caring for?"}</h1>
        <p>{elder ? "Keep these details up to date. Changes to the description are saved to Walrus Memory." : "Create a simple profile for the person you look after. You can change it at any time."}</p>
      </div>
      <Notice code={notice} />
      <div className="card stack">
        {elder && (
          <div className="profile-hero">
            <Avatar name={elder.full_name} url={photoUrl} large />
            <WalrusStatus record={profileRecord} kind="profile" sourceId="profile" now={now} />
          </div>
        )}
        <ProfileForm
          action={saveElderAction}
          isNew={!elder}
          hasPhoto={Boolean(elder?.photo_path)}
          defaults={{
            full_name: elder?.full_name,
            description: elder?.description,
            date_of_birth: elder?.date_of_birth,
            notes: elder?.notes,
            timezone: elder?.timezone,
          }}
        />
      </div>
    </>
  );
}
