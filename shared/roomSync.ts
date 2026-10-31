import type { ModeProposal, RoomState, TranscriptItem } from "./types.ts";

/** Insert or replace one line without dropping the others. */
export function upsertTranscript(
  lines: TranscriptItem[] | undefined,
  item: TranscriptItem,
): TranscriptItem[] {
  const list = Array.isArray(lines) ? lines : [];
  const index = list.findIndex((entry) => entry?.id === item.id);
  if (index < 0) return [...list, item];
  const next = list.slice();
  next[index] = item;
  return next;
}

/**
 * Server order wins for ids the server still has.
 * An empty snapshot does not erase lines the page already has.
 * Local-only lines stay so an in-flight message is not dropped.
 */
export function mergeTranscript(
  local: TranscriptItem[] | undefined,
  incoming: TranscriptItem[] | undefined,
): TranscriptItem[] {
  const server = Array.isArray(incoming) ? incoming : [];
  const mine = Array.isArray(local) ? local : [];
  if (server.length === 0) return mine;
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

/** A switch request is only real while the person who asked is still seated. */
export function seatedProposal(
  proposal: ModeProposal | null,
  participants: { id: string }[],
): ModeProposal | null {
  if (!proposal) return null;
  return participants.some((person) => person.id === proposal.fromId) ? proposal : null;
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
