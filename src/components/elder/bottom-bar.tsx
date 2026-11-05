"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { BookIcon, HomeIcon, MicIcon, PeopleIcon } from "./icons";

const ITEMS = [
  { href: "/home", label: "Home", Icon: HomeIcon },
  { href: "/home/ask", label: "Ask", Icon: MicIcon },
  { href: "/home/family", label: "Family", Icon: PeopleIcon },
  { href: "/home/memories", label: "Memories", Icon: BookIcon },
];

/** Fixed bottom bar: always the same four places, current one highlighted. */
export function BottomBar() {
  const pathname = usePathname();
  return (
    <nav className="elder-bar" aria-label="Main">
      <ul>
        {ITEMS.map(({ href, label, Icon }) => {
          const current = href === "/home" ? pathname === "/home" : pathname === href || pathname.startsWith(`${href}/`);
          return (
            <li key={href}>
              <Link href={href} aria-current={current ? "page" : undefined}>
                <Icon />
                <span>{label}</span>
              </Link>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}
