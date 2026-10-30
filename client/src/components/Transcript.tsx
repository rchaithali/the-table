import type { RoomState, TranscriptItem } from "@shared/types";
import { useState } from "react";

export function Transcript({
  state,
  collapsed,
}: {
  state: RoomState;
  collapsed?: boolean;
}) {
  const [open, setOpen] = useState(!collapsed);
  return (
    <section className="min-h-0 flex-1">
      {collapsed ? (
        <button
          type="button"
          className="mb-2 text-sm text-ink/55 underline-offset-2 hover:underline"
          onClick={() => setOpen((v) => !v)}
        >
          {open ? "Hide history" : "Conversation history"}
        </button>
      ) : null}
      {(!collapsed || open) && (
        <ol className="flex max-h-[42vh] flex-col gap-3 overflow-y-auto pr-1 sm:max-h-[48vh]">
          {state.transcript.length === 0 ? (
            <li className="text-sm text-ink/50">
              Nothing on the table yet. Say what you actually mean.
            </li>
          ) : (
            state.transcript.map((item) => (
              <Line key={item.id} item={item} youId={state.youId} />
            ))
          )}
        </ol>
      )}
    </section>
  );
}

function Line({
  item,
  youId,
}: {
  item: TranscriptItem;
  youId: string | null;
}) {
  const mine = item.authorId === youId;
  const primary = mine
    ? item.sourceText
    : (item.translatedText ?? item.sourceText);
  const original = mine ? item.translatedText : item.sourceText;
  return (
    <li className={mine ? "sm:ml-10" : "sm:mr-10"}>
      <p className="text-xs uppercase tracking-[0.14em] text-ink/40">
        {mine ? "You" : "Them"}
        {item.kind === "talk" ? " · spoken" : ""}
        {item.status === "cut_off" ? " · cut off" : ""}
        {item.status === "translating" ? " · translating" : ""}
        {item.status === "failed" ? " · couldn’t translate" : ""}
      </p>
      <p className="mt-1 font-display text-lg leading-snug">{primary}</p>
      {original && item.status !== "translating" ? (
        <details className="mt-1 text-sm text-ink/55">
          <summary className="cursor-pointer">Original</summary>
          <p className="mt-1">{original}</p>
        </details>
      ) : null}
    </li>
  );
}
