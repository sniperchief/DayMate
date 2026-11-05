import Link from "next/link";

/** Gentle dead-end replacement inside the elder screens: always a way home. */
export default function ElderNotFound() {
  return (
    <div className="elder-card">
      <h1 className="elder-title">I can&apos;t find that</h1>
      <p className="elder-text">It may have been changed by your family.</p>
      <Link href="/home" className="elder-btn" style={{ display: "inline-flex", alignItems: "center", textDecoration: "none" }}>
        Go to Home
      </Link>
    </div>
  );
}
