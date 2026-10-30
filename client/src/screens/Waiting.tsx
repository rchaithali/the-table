import type { RoomState } from "@shared/types";
import { LANGUAGES } from "@shared/types";
import { selfOf } from "../state/roomStore";

export function Waiting({
  state,
  onCopy,
}: {
  state: RoomState;
  onCopy: () => void;
}) {
  const self = selfOf(state);
  const lang = LANGUAGES.find((l) => l.id === self?.language);
  const share = `${window.location.origin}/?room=${state.code}`;
  return (
    <main className="mx-auto flex min-h-dvh max-w-lg flex-col justify-center px-6 py-16 text-center">
      <p className="font-display text-xl">The Table</p>
      <h1 className="mt-8 font-display text-4xl">One empty chair.</h1>
      <p className="mt-4 text-ink/70">
        {self?.name} · {lang?.native}. Send the code. Don’t start the argument
        without them.
      </p>
      <p className="mt-10 font-display text-5xl tracking-[0.28em]">{state.code}</p>
      <p className="mt-4 break-all text-sm text-ink/55">{share}</p>
      <button
        type="button"
        className="mx-auto mt-8 rounded-sm bg-ink px-5 py-3 text-paper"
        onClick={onCopy}
      >
        Copy link
      </button>
    </main>
  );
}
