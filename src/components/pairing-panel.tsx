"use client";

import { useActionState, useEffect, useState } from "react";
import { createPairingCodeAction, type PairingState } from "@/app/(app)/device/actions";

const IDLE: PairingState = { status: "idle" };

function useMinutesLeft(expiresAt?: string): number | null {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (!expiresAt) return;
    const t = setInterval(() => setNow(Date.now()), 15_000);
    return () => clearInterval(t);
  }, [expiresAt]);
  if (!expiresAt) return null;
  return Math.max(0, Math.ceil((new Date(expiresAt).getTime() - now) / 60_000));
}

/** Create a pairing code and show it as text + QR for the elder's device. */
export function PairingPanel({ elderName }: { elderName: string }) {
  const [state, action, pending] = useActionState(createPairingCodeAction, IDLE);
  const left = useMinutesLeft(state.expiresAt);
  const expired = left === 0;

  return (
    <div className="pairing">
      <form action={action} className="stack">
        <label className="checkbox">
          <input type="checkbox" name="voice" defaultChecked />
          <span>
            <strong>Allow {elderName} to ask questions by speaking</strong>
            <br />
            <span className="muted">
              Spoken questions are turned into text by the device&apos;s speech service (Google on Android, Apple on iPhone and iPad). Answers are always read aloud on the
              device itself.
            </span>
          </span>
        </label>
        <div>
          <button type="submit" className="btn" disabled={pending}>
            {pending ? "Creating code…" : state.status === "ready" ? "Create a new code" : "Pair a device"}
          </button>
        </div>
      </form>

      {state.status === "error" && (
        <p role="alert" className="alert alert-error">
          {state.message}
        </p>
      )}

      {state.status === "ready" && (
        <div className="pairing-code card" aria-live="polite">
          {expired ? (
            <p className="field-error">This code has expired. Create a new one.</p>
          ) : (
            <>
              <ol className="pairing-steps">
                <li>
                  On {elderName}&apos;s tablet or phone, scan this code with the camera, <em>or</em> open <strong>{state.url?.replace(/\?.*$/, "")}</strong> and type the
                  code.
                </li>
                <li>Then choose &ldquo;Add to Home Screen&rdquo; so DayMate opens with one tap.</li>
              </ol>
              <div className="pairing-row">
                {/* SVG generated on our server from our own URL */}
                <div className="qr" aria-hidden="true" dangerouslySetInnerHTML={{ __html: state.qrSvg ?? "" }} />
                <div>
                  <p className="muted" style={{ margin: 0 }}>
                    Pairing code
                  </p>
                  <p className="code-text" aria-label={`Pairing code ${state.code?.split("").join(" ")}`}>
                    {state.code}
                  </p>
                  <p className="muted">
                    Works once. Expires in {left} minute{left === 1 ? "" : "s"}.
                  </p>
                </div>
              </div>
            </>
          )}
        </div>
      )}
    </div>
  );
}
