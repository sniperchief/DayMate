import Link from "next/link";
import { logoutAction } from "@/app/(auth)/actions";
import { NavLinks } from "@/components/bits";
import { requireCtx } from "@/server/context";

export default async function AppLayout({ children }: { children: React.ReactNode }) {
  // Second line of defence after the proxy: every protected page verifies the session.
  await requireCtx();
  return (
    <>
      <header className="site-header">
        <div className="site-header-inner">
          <Link href="/dashboard" className="brand">
            DayMate
            <small>A little help remembering what matters.</small>
          </Link>
          <nav aria-label="Main">
            <NavLinks />
          </nav>
          <form action={logoutAction}>
            <button type="submit" className="btn btn-secondary btn-small">
              Sign out
            </button>
          </form>
        </div>
      </header>
      <main id="main">{children}</main>
    </>
  );
}
