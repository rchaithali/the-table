import { LANGUAGES, type Language, type Participant } from "@shared/types";

export function Seat({
  person,
  side,
  you,
  onLanguage,
}: {
  person: Participant | null;
  side: "far" | "near";
  you?: boolean;
  onLanguage?: (language: Language) => void;
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
        {you && onLanguage && person ? (
          <select
            aria-label="Your language"
            className="rounded-sm border border-ink/15 bg-paper px-2 py-1"
            value={person.language}
            onChange={(e) => onLanguage(e.target.value as Language)}
          >
            {LANGUAGES.map((l) => (
              <option key={l.id} value={l.id}>
                {l.native}
              </option>
            ))}
          </select>
        ) : lang ? (
          lang.native
        ) : (
          "Waiting"
        )}
        {person?.typing ? " · writing" : ""}
        {person?.speaking ? " · speaking" : ""}
      </p>
    </div>
  );
}
