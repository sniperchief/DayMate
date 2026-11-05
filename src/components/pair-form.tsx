"use client";

import { useActionState } from "react";
import { pairDeviceAction, type PairState } from "@/app/(elder)/pair/actions";

export function PairForm({ code }: { code?: string }) {
  const [state, action, pending] = useActionState<PairState, FormData>(pairDeviceAction, {});
  return (
    <form action={action} className="elder-stack">
      <label htmlFor="code" className="elder-label">
        Pairing code
      </label>
      <input
        id="code"
        name="code"
        className="elder-input code-input"
        defaultValue={code ?? ""}
        placeholder="ABCD-EFGH"
        autoCapitalize="characters"
        autoComplete="off"
        spellCheck={false}
        maxLength={12}
        required
        aria-describedby={state.error ? "code-error" : undefined}
      />
      {state.error && (
        <p id="code-error" role="alert" className="elder-error">
          {state.error}
        </p>
      )}
      <button type="submit" className="elder-btn" disabled={pending}>
        {pending ? "Connecting…" : "Connect this device"}
      </button>
    </form>
  );
}
