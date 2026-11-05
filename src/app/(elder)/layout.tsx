/** Elder-device screens: no caregiver menu, larger type. Each page checks the paired-device cookie. */
export default function ElderLayout({ children }: { children: React.ReactNode }) {
  return (
    <main id="main" className="elder">
      {children}
    </main>
  );
}
