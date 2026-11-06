import type { Metadata } from "next";
import Link from "next/link";
import "./landing.css";

// Public landing page. The proxy sends signed-in caregivers straight on to the dashboard.
export const metadata: Metadata = {
  title: { absolute: "DayMate · A little help remembering what matters" },
  description:
    "DayMate is a memory companion for older people and their family caregivers: familiar faces, daily routines and treasured memories on a simple, voice-first screen.",
};

function Heart({ size = 28 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 64 64" aria-hidden="true">
      <rect width="64" height="64" rx="14" fill="currentColor" />
      <path
        d="M32 47s-15-8.6-15-19.4C17 22 21 18 26 18c2.9 0 4.9 1.5 6 3.4 1.1-1.9 3.1-3.4 6-3.4 5 0 9 4 9 9.6C47 38.4 32 47 32 47z"
        fill="#faf7f2"
      />
    </svg>
  );
}

function Check() {
  return (
    <svg className="lp-check" viewBox="0 0 20 20" aria-hidden="true">
      <circle cx="10" cy="10" r="10" />
      <path d="M5.5 10.5l3 3 6-7" fill="none" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

function Mic() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true" width="34" height="34">
      <rect x="9" y="3" width="6" height="11" rx="3" fill="currentColor" />
      <path d="M5.5 11a6.5 6.5 0 0 0 13 0M12 17.5V21" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
    </svg>
  );
}

function Avatar({ initials, tone }: { initials: string; tone: "a" | "b" | "c" | "d" }) {
  return (
    <span className={`lp-avatar lp-avatar-${tone}`} aria-hidden="true">
      {initials}
    </span>
  );
}

/** Mock of the elder's Home (Today) screen on a tablet. */
function ElderHomeMock() {
  return (
    <div className="lp-device lp-device-tablet" role="img" aria-label="DayMate on a tablet: Good morning, Rose. Next: Sarah visits at 2 o'clock.">
      <div className="lp-screen lp-elder">
        <div className="lp-elder-top">
          <strong>Thursday</strong>
          <span>6 November · 9:41</span>
        </div>
        <p className="lp-elder-greet">Good morning, Rose</p>
        <div className="lp-elder-card">
          <span className="lp-eyebrow">Next today</span>
          <div className="lp-elder-next">
            <Avatar initials="S" tone="a" />
            <div>
              <strong>Sarah visits</strong>
              <span>2 o’clock · your daughter</span>
            </div>
          </div>
          <ul className="lp-elder-rest">
            <li>
              <span>4:00</span> Walk in the garden
            </li>
            <li>
              <span>6:30</span> Supper with Tom
            </li>
          </ul>
        </div>
        <div className="lp-elder-tiles">
          <span>Ask me</span>
          <span>My family</span>
          <span>Memories</span>
          <span>Read to me</span>
        </div>
      </div>
    </div>
  );
}

/** Mock of the voice Ask screen on a phone. */
function VoiceAskMock() {
  return (
    <div className="lp-device lp-device-phone" role="img" aria-label="Voice Ask: You asked, who is coming today? Answer: Sarah, your daughter, is coming at 2 o'clock.">
      <div className="lp-screen lp-elder lp-ask">
        <div className="lp-elder-top">
          <strong>Thursday</strong>
          <span>9:42</span>
        </div>
        <span className="lp-mic">
          <Mic />
        </span>
        <p className="lp-ask-heard">
          You asked: <em>“Who is coming today?”</em>
        </p>
        <div className="lp-ask-answer">
          <Avatar initials="S" tone="a" />
          <p>Sarah, your daughter, is coming at 2 o’clock.</p>
        </div>
        <div className="lp-ask-speaking" aria-hidden="true">
          <i />
          <i />
          <i />
          <i />
          <i />
          <span>Reading aloud…</span>
        </div>
        <div className="lp-ask-actions">
          <span>Say it again</span>
          <span>Ask something else</span>
        </div>
      </div>
    </div>
  );
}

/** Mock of the caregiver dashboard. */
function DashboardMock() {
  return (
    <div className="lp-device lp-device-browser" role="img" aria-label="Caregiver dashboard with upcoming activities, memory sync status and the elder's device status.">
      <div className="lp-browser-bar" aria-hidden="true">
        <i />
        <i />
        <i />
        <span>daymate / dashboard</span>
      </div>
      <div className="lp-screen lp-dash">
        <div className="lp-dash-head">
          <strong>Rose’s week</strong>
          <span className="lp-pill lp-pill-ok">Tablet online</span>
        </div>
        <div className="lp-dash-grid">
          <div className="lp-dash-panel">
            <span className="lp-eyebrow">Upcoming</span>
            <ul className="lp-dash-list">
              <li>
                <b>Today 14:00</b> Sarah visits
              </li>
              <li>
                <b>Fri 10:30</b> Hairdresser with Ann
              </li>
              <li>
                <b>Sun 12:00</b> Family lunch
              </li>
            </ul>
          </div>
          <div className="lp-dash-panel">
            <span className="lp-eyebrow">Memories</span>
            <ul className="lp-dash-list">
              <li>
                Wedding in Whitby, 1968 <span className="lp-pill lp-pill-ok">Stored</span>
              </li>
              <li>
                First job at the bakery <span className="lp-pill lp-pill-ok">Stored</span>
              </li>
              <li>
                Holiday in Cornwall <span className="lp-pill lp-pill-wait">Pending</span>
              </li>
            </ul>
          </div>
        </div>
        <div className="lp-dash-family">
          <Avatar initials="S" tone="a" />
          <Avatar initials="T" tone="b" />
          <Avatar initials="A" tone="c" />
          <Avatar initials="J" tone="d" />
          <span>4 people in Rose’s family</span>
        </div>
      </div>
    </div>
  );
}

/** How a memory travels: written by family, kept on Walrus, anchored on Sui, verified by Tatum. */
function TrustDiagram() {
  const steps = [
    { n: "1", title: "Family writes it", body: "“Rose married Jim in Whitby in June 1968.”" },
    { n: "2", title: "Kept on Walrus Memory", body: "Stored on Walrus Mainnet. Only confirmed, current versions are ever recalled." },
    { n: "3", title: "Anchored on Sui", body: "A salted SHA-256 commitment: 32 bytes and a schema number. No personal data." },
    { n: "4", title: "Verified by Tatum", body: "Each transaction is checked independently, so the record can be trusted." },
  ];
  return (
    <ol className="lp-flow">
      {steps.map((s) => (
        <li key={s.n}>
          <span className="lp-flow-n">{s.n}</span>
          <div>
            <strong>{s.title}</strong>
            <p>{s.body}</p>
          </div>
        </li>
      ))}
    </ol>
  );
}

export default function Landing() {
  return (
    <div className="lp">
      <header className="lp-header">
        <div className="lp-wrap lp-header-inner">
          <Link href="/" className="lp-brand">
            <Heart />
            DayMate
          </Link>
          <nav aria-label="Main" className="lp-nav">
            <a href="#elder">For the elder</a>
            <a href="#family">For family</a>
            <a href="#trust">Privacy</a>
          </nav>
          <div className="lp-header-cta">
            <Link href="/login" className="lp-link">
              Sign in
            </Link>
            <Link href="/register" className="lp-btn lp-btn-small">
              Get started
            </Link>
          </div>
        </div>
      </header>

      <main id="main">
        {/* ── Hero 1: the promise ── */}
        <section className="lp-hero lp-hero-main" aria-labelledby="hero-title">
          <div className="lp-wrap lp-split">
            <div className="lp-copy">
              <span className="lp-kicker">A memory companion for families</span>
              <h1 id="hero-title">A little help remembering what matters.</h1>
              <p className="lp-lead">
                DayMate helps someone you love recall familiar faces, daily routines and the moments that made their life. You keep it up to date; they
                see it on a calm, simple screen of their own.
              </p>
              <div className="lp-actions">
                <Link href="/register" className="lp-btn">
                  Create a free caregiver account
                </Link>
                <a href="#elder" className="lp-btn lp-btn-ghost">
                  See how it works
                </a>
              </div>
              <ul className="lp-ticks">
                <li>
                  <Check /> Large text, big buttons
                </li>
                <li>
                  <Check /> Answers read aloud
                </li>
                <li>
                  <Check /> Private by design
                </li>
              </ul>
            </div>
            <div className="lp-visual">
              <ElderHomeMock />
            </div>
          </div>
        </section>

        {/* ── Hero 2: the elder's own screen ── */}
        <section id="elder" className="lp-hero lp-hero-elder" aria-labelledby="elder-title">
          <div className="lp-wrap lp-split lp-split-reverse">
            <div className="lp-copy">
              <span className="lp-kicker">For the elder</span>
              <h2 id="elder-title">Just ask. DayMate answers out loud.</h2>
              <p className="lp-lead">
                A tap on the big microphone is all it takes. “Who is coming today?” “What did I do for work?” The answer appears in large print, with
                photos of the people it mentions, and is read aloud.
              </p>
              <ul className="lp-features">
                <li>
                  <strong>One thing per screen.</strong> Home, Ask, Family and Memories, always in the same place.
                </li>
                <li>
                  <strong>Today, at a glance.</strong> The day, date and time on every screen, and what’s next.
                </li>
                <li>
                  <strong>Nothing to get lost in.</strong> No settings, no sign-out. It gently returns Home after three minutes.
                </li>
              </ul>
            </div>
            <div className="lp-visual">
              <VoiceAskMock />
            </div>
          </div>
        </section>

        {/* ── Hero 3: family caregivers ── */}
        <section id="family" className="lp-hero lp-hero-family" aria-labelledby="family-title">
          <div className="lp-wrap lp-split">
            <div className="lp-copy">
              <span className="lp-kicker">For family caregivers</span>
              <h2 id="family-title">You hold the memories. DayMate keeps them close.</h2>
              <p className="lp-lead">
                From your own phone or laptop, add the people in their life, their routines and planned visits, and the stories worth keeping, with a
                photo if you like.
              </p>
              <div className="lp-cards">
                <div className="lp-card">
                  <strong>Family &amp; faces</strong>
                  <p>Names, relationships and photos, so every face has a story.</p>
                </div>
                <div className="lp-card">
                  <strong>Routines &amp; plans</strong>
                  <p>Daily habits and upcoming visits, shown in their own time zone.</p>
                </div>
                <div className="lp-card">
                  <strong>Memories</strong>
                  <p>Life events in plain words, with a memory of the day to enjoy.</p>
                </div>
                <div className="lp-card">
                  <strong>Ask DayMate</strong>
                  <p>Check exactly what they’ll hear before they ask it.</p>
                </div>
              </div>
            </div>
            <div className="lp-visual">
              <DashboardMock />
            </div>
          </div>
        </section>

        {/* ── Hero 4: trust and privacy ── */}
        <section id="trust" className="lp-hero lp-hero-trust" aria-labelledby="trust-title">
          <div className="lp-wrap lp-split lp-split-reverse">
            <div className="lp-copy">
              <span className="lp-kicker">Built to last, built to be private</span>
              <h2 id="trust-title">Memories that stay safe, and stay theirs.</h2>
              <p className="lp-lead">
                DayMate keeps personal memories on <strong>Walrus Memory on Mainnet</strong>, so they don’t depend on a single server. A tiny,
                tamper-evident fingerprint can be anchored on Sui and verified by Tatum. The story itself never goes on chain.
              </p>
              <ul className="lp-features">
                <li>
                  <strong>Every family is walled off.</strong> Row-level security on every table; photos in a private bucket behind short-lived links.
                </li>
                <li>
                  <strong>Keys stay on the server.</strong> Nothing secret ever reaches a browser.
                </li>
                <li>
                  <strong>No jargon for the elder.</strong> They just see their family and their day.
                </li>
              </ul>
            </div>
            <div className="lp-visual">
              <TrustDiagram />
            </div>
          </div>
        </section>

        {/* ── Hero 5: get started ── */}
        <section className="lp-hero lp-hero-start" aria-labelledby="start-title">
          <div className="lp-wrap lp-start">
            <span className="lp-kicker">Ready in minutes</span>
            <h2 id="start-title">Set up DayMate for someone you love.</h2>
            <ol className="lp-steps">
              <li>
                <span>1</span>
                <strong>Create your account</strong>
                <p>Add their profile, family and a few memories.</p>
              </li>
              <li>
                <span>2</span>
                <strong>Pair their device</strong>
                <p>
                  Scan the QR code or type a code like <code>KQ7M-4XPD</code>.
                </p>
              </li>
              <li>
                <span>3</span>
                <strong>Add it to the home screen</strong>
                <p>It opens full-screen, like any other app.</p>
              </li>
            </ol>
            <div className="lp-actions lp-actions-center">
              <Link href="/register" className="lp-btn lp-btn-light">
                Get started
              </Link>
              <Link href="/pair" className="lp-btn lp-btn-outline">
                Pair an elder’s device
              </Link>
            </div>
          </div>
        </section>
      </main>

      <footer className="lp-footer">
        <div className="lp-wrap lp-footer-inner">
          <span className="lp-brand lp-brand-small">
            <Heart size={22} />
            DayMate
          </span>
          <p>
            Built for the Tatum × Walrus <em>Total Recall</em> hackathon. DayMate is a memory aid, not a medical device.
          </p>
          <nav aria-label="Footer" className="lp-footer-links">
            <Link href="/login">Sign in</Link>
            <Link href="/register">Register</Link>
            <Link href="/pair">Pair a device</Link>
          </nav>
        </div>
      </footer>
    </div>
  );
}
