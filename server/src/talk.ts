import type { Server } from "socket.io";
import type {
  ClientToServerEvents,
  Language,
  ServerToClientEvents,
} from "./types.ts";
import { groqCode, transcribeAudio, translateText } from "./groq.ts";
import { isSpokenText, wavLooksSilent } from "./speech.ts";
import {
  pushItem,
  type QueuedUtterance,
  type Room,
  type Seat,
} from "./room.ts";
import type { TranscriptItem } from "./types.ts";
import { uid } from "./id.ts";

type IO = Server<ClientToServerEvents, ServerToClientEvents>;

const MAX_QUEUE = 4;
const playbackTimers = new Map<string, ReturnType<typeof setTimeout>>();

function clearPlaybackTimer(jobId: string): void {
  const timer = playbackTimers.get(jobId);
  if (!timer) return;
  clearTimeout(timer);
  playbackTimers.delete(jobId);
}

function extFor(mime: string): string {
  if (mime.includes("wav")) return "wav";
  if (mime.includes("mp4") || mime.includes("m4a")) return "m4a";
  return "webm";
}

export function handleBargeBegin(io: IO, room: Room, seat: Seat): void {
  if (room.mode !== "talk") return;
  const active = room.activeJob;
  if (active && active.authorId === seat.clientId) return;

  if (active) {
    active.stale = true;
    const item = room.transcript.find((t) => t.id === active.itemId);
    if (item) {
      item.status = "cut_off";
      item.interruptedBy = seat.clientId;
      io.to(room.code).emit("item:updated", item);
    }
    clearPlaybackTimer(active.id);
    io.to(room.code).emit("talk:interrupted", {
      jobId: active.id,
      byId: seat.clientId,
      itemId: active.itemId,
      floorGen: room.floorGen + 1,
    });
  }

  room.queued = [];
  room.activeJob = null;
  room.floorHolderId = seat.clientId;
  room.phase = "idle";
  room.bumpFloor();
  emitFloor(io, room);
}

export function enqueueOrRun(
  io: IO,
  room: Room,
  seat: Seat,
  jobId: string,
  mime: string,
  buf: Buffer,
): void {
  if (room.mode !== "talk") return;
  const peer = room.other(seat.clientId);
  if (!peer) {
    return;
  }

  const queued: QueuedUtterance = {
    job: {
      id: jobId || uid(),
      authorId: seat.clientId,
      itemId: "",
      floorGen: room.floorGen,
      stale: false,
    },
    buf,
    mime,
    sourceLang: seat.language,
  };

  const active = room.activeJob;
  if (!active || active.stale) {
    void runUtterance(io, room, queued);
    return;
  }

  if (active.authorId !== seat.clientId) {
    handleBargeBegin(io, room, seat);
    void runUtterance(io, room, queued);
    return;
  }

  if (room.queued.length >= MAX_QUEUE) room.queued.shift();
  room.queued.push(queued);
}

export function dropFloorFor(io: IO, room: Room): void {
  const job = room.activeJob;
  if (!job) return;
  clearPlaybackTimer(job.id);
  job.stale = true;
  const item = room.transcript.find((t) => t.id === job.itemId);
  if (item && item.status === "translating") {
    item.status = "failed";
    io.to(room.code).emit("item:updated", item);
  }
  room.queued = [];
  room.activeJob = null;
  room.phase = "idle";
  room.floorHolderId = null;
  emitFloor(io, room);
}

function staleNow(room: Room, queued: QueuedUtterance): boolean {
  return queued.job.stale || room.activeJob?.id !== queued.job.id;
}

function abandonIfStale(
  io: IO,
  room: Room,
  queued: QueuedUtterance,
  item: TranscriptItem,
): boolean {
  if (!staleNow(room, queued)) return false;
  if (item.status === "translating") {
    item.status = queued.job.stale ? "cut_off" : "failed";
    io.to(room.code).emit("item:updated", item);
  }
  return true;
}

export function onPlayEnded(io: IO, room: Room, jobId: string): void {
  clearPlaybackTimer(jobId);
  if (room.activeJob?.id !== jobId || room.activeJob.stale) return;
  room.activeJob = null;
  room.phase = "idle";
  room.floorHolderId = null;
  emitFloor(io, room);
  const next = room.queued.shift();
  if (next) void runUtterance(io, room, next);
}

async function runUtterance(io: IO, room: Room, queued: QueuedUtterance): Promise<void> {
  const speaker = room.seatByClient(queued.job.authorId);
  const listener = speaker ? room.other(speaker.clientId) : undefined;
  if (!speaker || !listener) return;

  const gen = room.bumpFloor();
  queued.job.floorGen = gen;
  room.activeJob = queued.job;
  room.floorHolderId = speaker.clientId;
  room.phase = "translating";
  emitFloor(io, room);

  const item = pushItem(room, {
    kind: "talk",
    authorId: speaker.clientId,
    sourceLang: speaker.language,
    targetLang: listener.language,
    sourceText: "…",
    translatedText: null,
    status: "translating",
  });
  queued.job.itemId = item.id;
  io.to(room.code).emit("chat:message", item);

  try {
    if (wavLooksSilent(queued.buf)) {
      item.sourceText = "";
      item.status = "failed";
      io.to(room.code).emit("item:updated", item);
      fail(io, room, queued.job.id, "empty", "We didn’t catch that.");
      return;
    }
    const source = await transcribeAudio(
      queued.buf,
      `talk.${extFor(queued.mime)}`,
      queued.sourceLang as Language,
    );
    if (abandonIfStale(io, room, queued, item)) return;
    if (!isSpokenText(source)) {
      item.sourceText = "";
      item.status = "failed";
      io.to(room.code).emit("item:updated", item);
      fail(io, room, queued.job.id, "empty", "We didn’t catch that.");
      return;
    }
    item.sourceText = source;
    const translated = await translateText(
      source,
      speaker.language,
      listener.language,
    );
    if (abandonIfStale(io, room, queued, item)) return;
    if (!isSpokenText(translated)) {
      item.translatedText = null;
      item.status = "failed";
      io.to(room.code).emit("item:updated", item);
      fail(io, room, queued.job.id, "mt", "Translation came back empty.");
      return;
    }
    item.translatedText = translated;
    item.status = "ok";
    io.to(room.code).emit("item:updated", item);
    if (abandonIfStale(io, room, queued, item)) return;
    room.phase = "playing";
    emitFloor(io, room);
    const listenerNow = room.seatByClient(listener.clientId);
    if (!listenerNow?.socketId) {
      onPlayEnded(io, room, queued.job.id);
      return;
    }
    io.to(listenerNow.socketId).emit("talk:play", {
      jobId: queued.job.id,
      text: translated,
      lang: listenerNow.language,
      itemId: item.id,
      floorGen: queued.job.floorGen,
    });
    const capturedId = queued.job.id;
    const timer = setTimeout(() => {
      playbackTimers.delete(capturedId);
      if (room.activeJob?.id === capturedId && room.phase === "playing") {
        onPlayEnded(io, room, capturedId);
      }
    }, 45000);
    playbackTimers.set(capturedId, timer);
  } catch (err) {
    if (queued.job.stale) return;
    item.status = "failed";
    io.to(room.code).emit("item:updated", item);
    fail(
      io,
      room,
      queued.job.id,
      groqCode(err),
      err instanceof Error ? err.message : "Talk failed",
    );
  }
}

function fail(
  io: IO,
  room: Room,
  jobId: string,
  code: "empty" | "stt" | "mt" | "rate_limit",
  message: string,
): void {
  clearPlaybackTimer(jobId);
  if (room.activeJob?.id === jobId) {
    room.activeJob = null;
    room.phase = "idle";
    room.floorHolderId = null;
    emitFloor(io, room);
  }
  io.to(room.code).emit("talk:error", { jobId, code, message });
  const next = room.queued.shift();
  if (next) void runUtterance(io, room, next);
}

export function emitFloor(io: IO, room: Room): void {
  io.to(room.code).emit("floor:update", {
    floorHolderId: room.floorHolderId,
    phase: room.phase,
    floorGen: room.floorGen,
    jobId: room.activeJob?.id ?? null,
  });
}
