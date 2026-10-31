import type { FloorPhase, Mode } from "@shared/types";

export function Floor({
  mode,
  phase,
  label,
}: {
  mode: Mode;
  phase: FloorPhase;
  label: string;
}) {
  const pulse =
    phase === "translating" || phase === "playing"
      ? "shadow-[0_0_0_6px_rgba(196,92,38,0.12)]"
      : "";
  return (
    <div className="flex flex-col items-center gap-2 py-4">
      <div
        className={`grid h-24 w-24 place-items-center rounded-full border border-ink/20 bg-paper ${pulse}`}
        aria-live="polite"
      >
        <span className="font-display text-sm tracking-wide">
          {mode === "talk" ? talkWord(phase) : "Chat"}
        </span>
      </div>
      {label ? <p className="max-w-xs text-center text-sm text-ink/60">{label}</p> : null}
    </div>
  );
}

function talkWord(phase: FloorPhase): string {
  if (phase === "translating") return "…";
  if (phase === "playing") return "Hear";
  return "Live";
}
