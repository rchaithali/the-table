import type {
  FloorPhase,
  Language,
  Mode,
  ModeProposal,
  Participant,
  RoomState,
  TranscriptItem,
} from "./types.ts";
import { roomCode, uid } from "./id.ts";

export interface Seat {
  clientId: string;
  socketId: string | null;
  name: string;
  language: Language;
  typing: boolean;
  micEnabled: boolean;
  speaking: boolean;
  disconnectTimer: ReturnType<typeof setTimeout> | null;
}

export interface TalkJob {
  id: string;
  authorId: string;
  itemId: string;
  floorGen: number;
  stale: boolean;
}

export interface QueuedUtterance {
  job: TalkJob;
  buf: Buffer;
  mime: string;
  sourceLang: Language;
}

export class Room {
  readonly code: string;
  mode: Mode = "chat";
  modeProposal: ModeProposal | null = null;
  floorHolderId: string | null = null;
  phase: FloorPhase = "idle";
  floorGen = 0;
  activeJob: TalkJob | null = null;
  queued: QueuedUtterance[] = [];
  transcript: TranscriptItem[] = [];
  seats: Seat[] = [];

  constructor(code: string) {
    this.code = code;
  }

  seatByClient(clientId: string): Seat | undefined {
    return this.seats.find((s) => s.clientId === clientId);
  }

  seatBySocket(socketId: string): Seat | undefined {
    return this.seats.find((s) => s.socketId === socketId);
  }

  other(clientId: string): Seat | undefined {
    return this.seats.find((s) => s.clientId !== clientId);
  }

  liveCount(): number {
    return this.seats.filter((s) => s.socketId).length;
  }

  bumpFloor(): number {
    this.floorGen += 1;
    return this.floorGen;
  }

  snapshot(youId: string | null): RoomState {
    return {
      code: this.code,
      mode: this.mode,
      modeProposal: this.modeProposal,
      floorHolderId: this.floorHolderId,
      phase: this.phase,
      floorGen: this.floorGen,
      activeJobId: this.activeJob?.id ?? null,
      transcript: this.transcript.slice(-200),
      participants: this.seats.map(toParticipant),
      youId,
    };
  }
}

function toParticipant(s: Seat): Participant {
  return {
    id: s.clientId,
    name: s.name,
    language: s.language,
    typing: s.typing,
    micEnabled: s.micEnabled,
    speaking: s.speaking,
  };
}

const rooms = new Map<string, Room>();

export function createRoom(): Room {
  let code = roomCode();
  while (rooms.has(code)) code = roomCode();
  const room = new Room(code);
  rooms.set(code, room);
  return room;
}

export function getRoom(code: string): Room | undefined {
  return rooms.get(code.trim().toUpperCase());
}

export function dropRoomIfEmpty(room: Room): void {
  if (room.seats.length === 0) rooms.delete(room.code);
}

export function addOrReconnect(
  room: Room,
  input: {
    clientId: string;
    socketId: string;
    name: string;
    language: Language;
  },
): Seat | "full" {
  const existing = room.seatByClient(input.clientId);
  if (existing) {
    if (existing.disconnectTimer) {
      clearTimeout(existing.disconnectTimer);
      existing.disconnectTimer = null;
    }
    existing.socketId = input.socketId;
    existing.name = input.name.trim() || existing.name;
    existing.language = input.language;
    return existing;
  }
  if (room.seats.length >= 2) return "full";
  const seat: Seat = {
    clientId: input.clientId,
    socketId: input.socketId,
    name: input.name.trim() || `Seat ${room.seats.length + 1}`,
    language: input.language,
    typing: false,
    micEnabled: false,
    speaking: false,
    disconnectTimer: null,
  };
  room.seats.push(seat);
  return seat;
}

export function markDisconnected(room: Room, socketId: string): Seat | undefined {
  const seat = room.seatBySocket(socketId);
  if (!seat) return;
  seat.socketId = null;
  seat.typing = false;
  seat.speaking = false;
  seat.micEnabled = false;
  return seat;
}

export function removeSeat(room: Room, clientId: string): void {
  room.seats = room.seats.filter((s) => s.clientId !== clientId);
  if (room.modeProposal?.fromId === clientId) room.modeProposal = null;
  if (room.floorHolderId === clientId) {
    room.floorHolderId = null;
    room.phase = "idle";
    room.activeJob = null;
    room.queued = [];
  }
  dropRoomIfEmpty(room);
}

export function pushItem(
  room: Room,
  partial: Omit<TranscriptItem, "id" | "createdAt">,
): TranscriptItem {
  const item: TranscriptItem = {
    ...partial,
    id: uid(),
    createdAt: Date.now(),
  };
  room.transcript.push(item);
  if (room.transcript.length > 250) {
    room.transcript = room.transcript.slice(-200);
  }
  return item;
}
