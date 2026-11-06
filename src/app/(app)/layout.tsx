import Link from "next/link";
import { AccountMenu } from "@/components/account-menu";
import { NavLinks } from "@/components/bits";
import { MobileTabBar } from "@/components/mobile-nav";
import { createClient } from "@/lib/supabase/server";
import { requireCtx } from "@/server/context";

export default async function AppLayout({ children }: { children: React.ReactNode }) {
  // Second line of defence after the proxy: every protected page verifies the session.
  await requireCtx();
  const { data } = await (await createClient()).auth.getClaims();
  const email = typeof data?.claims?.email === "string" ? data.claims.email : null;
  return (
    <>
      <header className="site-header">
        <div className="site-header-inner">
          <Link href="/dashboard" className="brand" title="A little help remembering what matters.">
            <span className="brand-mark" aria-hidden="true">
              D
            </span>
            DayMate
          </Link>
          {/* wide screens: top menu; phones and tablets use the bottom tab bar instead */}
          <nav aria-label="Main" className="desktop-nav">
            <NavLinks />
          </nav>
          <div className="desktop-nav">
            <AccountMenu email={email} />
          </div>
        </div>
      </header>
      <main id="main" className="app-main">
        {children}
      </main>
      <MobileTabBar />
    </>
  );
}
