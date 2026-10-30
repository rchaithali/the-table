import type { Participant } from "@shared/types";
import { LANGUAGES } from "@shared/types";

export function Seat({
  person,
  side,
  you,
}: {
  person: Participant | null;
  side: "far" | "near";
  you?: boolean;
}) {
  const accent = side === "far" ? "text-cool" : "text-warm";
  const lang = LANGUAGES.find((l) => l.id === person?.language);
  return (
    <div className={side === "far" ? "text-center" : "text-center sm:text-left"}>
      <p className="text-xs uppercase tracking-[0.16em] text-ink/45">
        {you ? "You" : "Across the table"}
      </p>
      <p className={`mt-1 font-display text-2xl ${accent}`}>
        {person?.name ?? "Empty seat"}
      </p>
      <p className="text-sm text-ink/60">
        {lang ? `${lang.native}` : "Waiting"}
        {person?.typing ? " · writing" : ""}
        {person?.speaking ? " · speaking" : ""}
      </p>
    </div>
  );
}
