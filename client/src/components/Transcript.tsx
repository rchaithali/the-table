import type { RoomState, TranscriptItem } from "@shared/types";
import { useEffect, useRef, useState } from "react";

function hasWords(text: string | null): boolean {
  return Boolean(text && /\p{L}/u.test(text));
}

export function Transcript({
  state,
  collapsed,
}: {
  state: RoomState;
  collapsed?: boolean;
}) {
  const [open, setOpen] = useState(() => !collapsed || state.transcript.length > 0);
  const hadLines = useRef(state.transcript.length > 0);
  useEffect(() => {
    if (!hadLines.current && state.transcript.length > 0) setOpen(true);
    hadLines.current = state.transcript.length > 0;
  }, [state.transcript.length]);
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
  // The other person should see the translation arrive whole. The in-flight
  // line still carries the source text, and showing that fallback flashes it.
  if (!mine && item.status === "translating" && !hasWords(item.translatedText)) {
    return null;
  }
  const missed = item.status === "failed" && !hasWords(item.sourceText);
  const primary = missed
    ? "Didn’t catch that."
    : mine
      ? item.sourceText
      : (item.translatedText ?? item.sourceText);
  const original = missed
    ? null
    : mine
      ? item.kind === "chat"
        ? null
        : item.translatedText
      : item.sourceText;
  return (
    <li className={mine ? "sm:ml-10" : "sm:mr-10"}>
      <p className="text-xs uppercase tracking-[0.14em] text-ink/40">
        {mine ? "You" : "Them"}
        {item.kind === "talk" ? " · spoken" : ""}
        {item.status === "cut_off" ? " · cut off" : ""}
        {item.status === "translating" ? " · translating" : ""}
        {missed ? " · didn’t catch that" : ""}
        {item.status === "failed" && !missed ? " · couldn’t translate" : ""}
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
