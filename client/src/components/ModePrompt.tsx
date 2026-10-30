import type { ModeProposal, RoomState } from "@shared/types";
import { LANGUAGES } from "@shared/types";

export function ModePrompt({
  state,
  proposal,
  onRespond,
}: {
  state: RoomState;
  proposal: ModeProposal;
  onRespond: (accept: boolean) => void;
}) {
  const from = state.participants.find((p) => p.id === proposal.fromId);
  const forYou = proposal.fromId !== state.youId;
  if (!forYou) {
    return (
      <p className="text-center text-sm text-ink/55">
        Waiting for them to {proposal.mode === "talk" ? "sit for Talk" : "return to Chat"}
        …
      </p>
    );
  }
  const lang = LANGUAGES.find((l) => l.id === from?.language);
  return (
    <div className="rounded-sm border border-ink/20 bg-paper p-4 text-center">
      <p className="font-display text-xl">
        {from?.name ?? "They"} want to {proposal.mode === "talk" ? "Talk" : "Chat"}
      </p>
      {proposal.mode === "talk" ? (
        <p className="mt-2 text-sm text-ink/65">
          You will hear translated speech
          {lang ? ` from ${lang.native}` : ""}. Headphones first — otherwise the
          table hears itself.
        </p>
      ) : (
        <p className="mt-2 text-sm text-ink/65">Back to written argument.</p>
      )}
      <div className="mt-4 flex justify-center gap-2">
        <button
          type="button"
          className="rounded-sm bg-ink px-4 py-2 text-paper"
          onClick={() => onRespond(true)}
        >
          Sit down
        </button>
        <button
          type="button"
          className="rounded-sm border border-ink/20 px-4 py-2"
          onClick={() => onRespond(false)}
        >
          Not now
        </button>
      </div>
    </div>
  );
}
