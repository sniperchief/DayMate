export default function AuthLayout({ children }: { children: React.ReactNode }) {
  return (
    <main id="main" className="auth-wrap">
      <div className="auth-brand">
        <h1>DayMate</h1>
        <p>A little help remembering what matters.</p>
      </div>
      {children}
    </main>
  );
}
