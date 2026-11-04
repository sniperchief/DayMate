"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useActionState, useEffect } from "react";
import { IDLE, type FormState } from "@/lib/domain/types";

const NAV = [
  { href: "/dashboard", label: "Dashboard" },
  { href: "/profile", label: "Profile" },
  { href: "/family", label: "Family" },
  { href: "/routines", label: "Routines" },
  { href: "/memories", label: "Memories" },
];

export function NavLinks() {
  const pathname = usePathname();
  return (
    <ul className="nav">
      {NAV.map((n) => (
        <li key={n.href}>
          <Link href={n.href} aria-current={pathname === n.href || pathname.startsWith(`${n.href}/`) ? "page" : undefined}>
            {n.label}
          </Link>
        </li>
      ))}
    </ul>
  );
}

/** Retry a Walrus write; waits for the SDK result and shows it. */
export function RetryButton({ action, label = "Retry saving to Walrus" }: { action: (prev: FormState) => Promise<FormState>; label?: string }) {
  const [state, formAction, pending] = useActionState(action, IDLE);
  return (
    <form action={formAction} style={{ display: "inline-flex", flexWrap: "wrap", gap: "0.5rem", alignItems: "center" }}>
      <button type="submit" className="btn btn-secondary btn-small" disabled={pending}>
        {pending ? "Saving to Walrus… (this can take a minute)" : label}
      </button>
      <span role="status" className={state.status === "error" ? "field-error" : "muted"}>
        {state.status !== "idle" ? state.message : ""}
      </span>
    </form>
  );
}

/** While Walrus writes are pending, refresh the page every few seconds (up to ~3 minutes). */
export function PendingRefresher({ active }: { active: boolean }) {
  const router = useRouter();
  useEffect(() => {
    if (!active) return;
    let ticks = 0;
    const timer = setInterval(() => {
      ticks += 1;
      router.refresh();
      if (ticks >= 36) clearInterval(timer);
    }, 5000);
    return () => clearInterval(timer);
  }, [active, router]);
  return null;
}
