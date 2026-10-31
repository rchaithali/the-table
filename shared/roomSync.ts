import type { RoomState, TranscriptItem } from "./types.ts";

/** Server order wins. Local-only lines are kept so an in-flight message is not dropped. */
export function mergeTranscript(
  local: TranscriptItem[] | undefined,
  incoming: TranscriptItem[] | undefined,
): TranscriptItem[] {
  const server = incoming ?? [];
  const mine = local ?? [];
  const latest = new Map<string, TranscriptItem>();
  for (const item of server) latest.set(item.id, item);
  for (const item of mine) {
    if (!latest.has(item.id)) latest.set(item.id, item);
  }
  const seen = new Set<string>();
  const ordered: TranscriptItem[] = [];
  for (const item of [...server, ...mine]) {
    if (seen.has(item.id)) continue;
    seen.add(item.id);
    const kept = latest.get(item.id);
    if (kept) ordered.push(kept);
  }
  return ordered;
}

/**
 * `notice: "keep"` means the current sentence should stay.
 * A full table never keeps a departure notice.
 */
export function nextPresence(
  awayId: string | null,
  next: Pick<RoomState, "youId" | "participants" | "absent">,
): { awayId: string | null; notice: string | "keep" } {
  if (next.participants.length >= 2) {
    if (!awayId) return { awayId: null, notice: "keep" };
    const other = next.participants.find((person) => person.id !== next.youId);
    return {
      awayId: null,
      notice: other ? `${other.name} is back at the table.` : "keep",
    };
  }
  if (next.absent) {
    return {
      awayId: next.absent.id,
      notice: `${next.absent.name} has left the table.`,
    };
  }
  return { awayId: null, notice: "keep" };
}
