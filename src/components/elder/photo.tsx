/** Round photo, or large initials when there is no photo. Decorative: the name is always shown as text. */
export function ElderPhoto({ name, url, size = "md" }: { name: string; url?: string | null; size?: "sm" | "md" | "lg" | "xl" }) {
  const initials = name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((p) => p[0]!.toUpperCase())
    .join("");
  // eslint-disable-next-line @next/next/no-img-element
  if (url) return <img src={url} alt="" className={`elder-photo elder-photo-${size}`} />;
  return (
    <span className={`elder-photo elder-photo-${size} elder-photo-initials`} aria-hidden="true">
      {initials || "?"}
    </span>
  );
}
