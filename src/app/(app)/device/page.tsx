import type { Metadata } from "next";
import { revokeDeviceAction, setDeviceVoiceAction } from "@/app/(app)/device/actions";
import { PairingPanel } from "@/components/pairing-panel";
import { ConfirmDelete } from "@/components/ui";
import { deviceAdmin } from "@/lib/devices/supabase-store";
import { adminClient } from "@/lib/supabase/admin";
import { firstName, requireElder } from "@/server/page-data";

export const metadata: Metadata = { title: "Elder's device" };

function when(iso: string | null): string {
  if (!iso) return "not yet";
  const mins = Math.round((Date.now() - new Date(iso).getTime()) / 60_000);
  if (mins < 2) return "just now";
  if (mins < 60) return `${mins} minutes ago`;
  const hours = Math.round(mins / 60);
  if (hours < 24) return `${hours} hour${hours === 1 ? "" : "s"} ago`;
  const days = Math.round(hours / 24);
  return `${days} day${days === 1 ? "" : "s"} ago`;
}

export default async function DevicePage() {
  const { ctx, elder } = await requireElder();
  const devices = await deviceAdmin(adminClient(), ctx.userId).list();
  const name = firstName(elder.full_name);

  return (
    <>
      <div className="page-head">
        <h1>{name}&apos;s device</h1>
        <p>
          Pair {name}&apos;s tablet or phone once. After that, DayMate opens straight to {name}&apos;s own simple screens: no password, no editing, nothing to get lost in.
        </p>
      </div>

      <section className="card" aria-labelledby="pair-h">
        <h2 id="pair-h">Pair a device</h2>
        <PairingPanel elderName={name} />
      </section>

      <section className="section" aria-labelledby="devices-h">
        <h2 id="devices-h">Paired devices</h2>
        {devices.length === 0 ? (
          <p className="empty">No devices paired yet.</p>
        ) : (
          <ul className="list">
            {devices.map((d) => (
              <li key={d.id} className="card">
                <h3 className="item-title">{d.name}</h3>
                <p className="meta">
                  Paired {when(d.paired_at)} · Last used {when(d.last_seen_at)}
                </p>
                <p>
                  Speaking questions: <strong>{d.voice_enabled ? "On" : "Off"}</strong>
                </p>
                <div className="item-actions">
                  <form action={setDeviceVoiceAction.bind(null, d.id, !d.voice_enabled)}>
                    <button type="submit" className="btn btn-secondary btn-small">
                      {d.voice_enabled ? "Turn speaking off" : "Turn speaking on"}
                    </button>
                  </form>
                  <ConfirmDelete action={revokeDeviceAction.bind(null, d.id)} label="Unpair" question={`Unpair this device? It will stop showing ${name}'s information straight away.`} />
                </div>
              </li>
            ))}
          </ul>
        )}
      </section>
    </>
  );
}
