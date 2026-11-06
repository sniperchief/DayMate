"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useId, useRef, useState } from "react";
import { logoutAction } from "@/app/(auth)/actions";

/** Wide-screen account menu: who is signed in, Profile and Sign out. */
export function AccountMenu({ email }: { email: string | null }) {
  const pathname = usePathname();
  const [open, setOpen] = useState(false);
  const menuId = useId();
  const root = useRef<HTMLDivElement>(null);
  const initial = (email?.trim()[0] ?? "A").toUpperCase();

  useEffect(() => setOpen(false), [pathname]);
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && setOpen(false);
    const onClick = (e: MouseEvent) => root.current && !root.current.contains(e.target as Node) && setOpen(false);
    window.addEventListener("keydown", onKey);
    document.addEventListener("mousedown", onClick);
    return () => {
      window.removeEventListener("keydown", onKey);
      document.removeEventListener("mousedown", onClick);
    };
  }, [open]);

  return (
    <div className="account" ref={root}>
      <button type="button" className="account-btn" aria-expanded={open} aria-controls={menuId} onClick={() => setOpen((o) => !o)}>
        <span className="account-avatar" aria-hidden="true">
          {initial}
        </span>
        <span>Account</span>
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
          <path d="m6 9 6 6 6-6" />
        </svg>
      </button>
      {open && (
        <div id={menuId} className="account-menu">
          {email && (
            <p className="account-email" title={email}>
              Signed in as
              <br />
              <strong>{email}</strong>
            </p>
          )}
          <Link href="/profile" aria-current={pathname === "/profile" ? "page" : undefined}>
            Elder&apos;s profile
          </Link>
          <form action={logoutAction}>
            <button type="submit">Sign out</button>
          </form>
        </div>
      )}
    </div>
  );
}
