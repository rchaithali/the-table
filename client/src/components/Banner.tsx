export function Banner({
  children,
  tone = "ink",
}: {
  children: React.ReactNode;
  tone?: "ink" | "cut" | "warm";
}) {
  const color =
    tone === "cut" ? "text-cut" : tone === "warm" ? "text-warm" : "text-ink/70";
  return (
    <div
      role="status"
      className={`rounded-sm border border-rule bg-paper px-3 py-2 text-sm ${color}`}
    >
      {children}
    </div>
  );
}
