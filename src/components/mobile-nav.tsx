"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useId, useRef, useState } from "react";
import { logoutAction } from "@/app/(auth)/actions";
import { BookIcon, CalendarIcon, HomeIcon, MoreIcon, PeopleIcon } from "./elder/icons";

const TABS = [
  { href: "/dashboard", label: "Home", Icon: HomeIcon },
  { href: "/memories", label: "Memories", Icon: BookIcon },
  { href: "/family", label: "Family", Icon: PeopleIcon },
  { href: "/routines", label: "Routines", Icon: CalendarIcon },
];

const MORE = [
  { href: "/profile", label: "Profile" },
  { href: "/ask", label: "Ask DayMate" },
  { href: "/device", label: "Elder's device" },
];

const isCurrent = (pathname: string, href: string) => pathname === href || pathname.startsWith(`${href}/`);

/**
 * Caregiver navigation on phones: the four most-used places as a bottom tab
 * bar within thumb reach, everything else under "More". Hidden on wider
 * screens, where the top menu is shown instead.
 */
export function MobileTabBar() {
  const pathname = usePathname();
  const [open, setOpen] = useState(false);
  const sheetId = useId();
  const firstLink = useRef<HTMLAnchorElement>(null);
  const moreActive = MORE.some((m) => isCurrent(pathname, m.href));

  useEffect(() => setOpen(false), [pathname]);
  useEffect(() => {
    if (!open) return;
    firstLink.current?.focus();
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && setOpen(false);
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open]);

  return (
    <>
      {open && <div className="cg-sheet-backdrop" onClick={() => setOpen(false)} aria-hidden="true" />}
      {open && (
        <div id={sheetId} className="cg-sheet" role="dialog" aria-modal="true" aria-label="More">
          <ul>
            {MORE.map((m, i) => (
              <li key={m.href}>
                <Link ref={i === 0 ? firstLink : undefined} href={m.href} aria-current={isCurrent(pathname, m.href) ? "page" : undefined}>
                  {m.label}
                </Link>
              </li>
            ))}
            <li>
              <form action={logoutAction}>
                <button type="submit">Sign out</button>
              </form>
            </li>
          </ul>
        </div>
      )}
      <nav className="cg-tabbar" aria-label="Main">
        <ul>
          {TABS.map(({ href, label, Icon }) => (
            <li key={href}>
              <Link href={href} aria-current={isCurrent(pathname, href) ? "page" : undefined}>
                <Icon />
                <span>{label}</span>
              </Link>
            </li>
          ))}
          <li>
            <button type="button" aria-expanded={open} aria-controls={sheetId} aria-current={moreActive ? "page" : undefined} onClick={() => setOpen((o) => !o)}>
              <MoreIcon />
              <span>More</span>
            </button>
          </li>
        </ul>
      </nav>
    </>
  );
}
