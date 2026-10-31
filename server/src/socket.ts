import type { Server, Socket } from "socket.io";
import type {
  ClientToServerEvents,
  Language,
  Mode,
  ServerToClientEvents,
} from "./types.ts";
import {
  addOrReconnect,
  createRoom,
  getRoom,
  markDisconnected,
  pushItem,
  removeSeat,
  type Room,
  type Seat,
} from "./room.ts";
import { groqCode, transcribeAudio, translateText } from "./groq.ts";
import { isSpokenText, wavLooksSilent } from "./speech.ts";
import { dropFloorFor, enqueueOrRun, handleBargeBegin, onPlayEnded } from "./talk.ts";

type IO = Server<ClientToServerEvents, ServerToClientEvents>;
type Sock = Socket<ClientToServerEvents, ServerToClientEvents>;

const GRACE_MS = 8000;

function extFor(mime: string): string {
  if (mime.includes("wav")) return "wav";
  if (mime.includes("mp4") || mime.includes("m4a")) return "m4a";
  if (mime.includes("mpeg")) return "mp3";
  return "webm";
}

function bufferFrom(audio: unknown): Buffer {
  if (Buffer.isBuffer(audio)) return audio;
  if (audio instanceof ArrayBuffer) return Buffer.from(audio);
  if (ArrayBuffer.isView(audio)) {
    return Buffer.from(audio.buffer, audio.byteOffset, audio.byteLength);
  }
  return Buffer.alloc(0);
}

export function attachSockets(io: IO): void {
  io.on("connection", (socket) => {
    socket.data.roomCode = null as string | null;
    socket.data.clientId = null as string | null;

    socket.on("room:create", ({ name, language, clientId, mode }) => {
      const room = createRoom(mode === "talk" ? "talk" : "chat");
      seatJoin(io, socket, room, {
        clientId,
        name,
        language,
      });
      socket.emit("room:created", { code: room.code });
    });

    socket.on("room:join", ({ code, clientId, name, language, mode }) => {
      const room = getRoom(code);
      if (!room) {
        socket.emit("room:error", {
          code: "gone",
          message: "That table is gone. Create a new one.",
        });
        return;
      }
      const existing = room.seatByClient(clientId);
      const result = addOrReconnect(room, {
        clientId,
        socketId: socket.id,
        name,
        language,
      });
      if (result === "full") {
        socket.emit("room:error", {
          code: "full",
          message: "This table already has two seats.",
        });
        return;
      }
      bindSocket(socket, room, result);
      if (!existing) preferRoomMode(io, room, result, mode);
      broadcastState(io, room);
    });

    socket.on("self:update", (payload) => {
      const ctx = context(socket);
      if (!ctx) return;
      if (payload.name) ctx.seat.name = payload.name.trim() || ctx.seat.name;
      if (payload.language) ctx.seat.language = payload.language;
      broadcastState(io, ctx.room);
    });

    socket.on("chat:typing", ({ typing }) => {
      const ctx = context(socket);
      if (!ctx) return;
      ctx.seat.typing = typing;
      ctx.socket.to(ctx.room.code).emit("chat:typing", {
        id: ctx.seat.clientId,
        typing,
      });
    });

    socket.on("chat:send", async ({ text }) => {
      const ctx = context(socket);
      if (!ctx) return;
      const trimmed = text.trim();
      if (!trimmed) return;
      const peer = ctx.room.other(ctx.seat.clientId);
      const targetLang: Language = peer?.language ?? opposite(ctx.seat.language);
      const item = pushItem(ctx.room, {
        kind: "chat",
        authorId: ctx.seat.clientId,
        sourceLang: ctx.seat.language,
        targetLang,
        sourceText: trimmed,
        translatedText: null,
        status: "translating",
      });
      io.to(ctx.room.code).emit("chat:message", item);
      try {
        const translated = await translateText(
          trimmed,
          ctx.seat.language,
          targetLang,
        );
        item.translatedText = translated;
        item.status = "ok";
      } catch (err) {
        item.status = "failed";
        const code = groqCode(err);
        socket.emit("room:error", {
          code,
          message: err instanceof Error ? err.message : "Translation failed",
        });
      }
      io.to(ctx.room.code).emit("item:updated", item);
    });

    socket.on("chat:transcribe", async ({ requestId, mime, audio }) => {
      const ctx = context(socket);
      if (!ctx) return;
      const audioBytes = bufferFrom(audio);
      if (!audioBytes.length || wavLooksSilent(audioBytes)) {
        socket.emit("room:error", {
          code: "empty",
          message: "We didn’t catch that. Try dictating again.",
        });
        return;
      }
      try {
        const text = await transcribeAudio(
          audioBytes,
          `dictate.${extFor(mime)}`,
          ctx.seat.language,
        );
        if (!isSpokenText(text)) {
          socket.emit("room:error", {
            code: "empty",
            message: "We didn’t catch that. Try dictating again.",
          });
          return;
        }
        socket.emit("chat:transcribed", { requestId, text });
      } catch (err) {
        socket.emit("room:error", {
          code: groqCode(err),
          message: err instanceof Error ? err.message : "Dictation failed",
        });
      }
    });

    socket.on("mode:propose", ({ mode }) => {
      const ctx = context(socket);
      if (!ctx) return;
      if (!ctx.room.other(ctx.seat.clientId)) {
        socket.emit("room:error", {
          code: "alone",
          message: "Wait for the other seat before switching modes.",
        });
        return;
      }
      ctx.room.modeProposal = { fromId: ctx.seat.clientId, mode };
      io.to(ctx.room.code).emit("mode:proposed", ctx.room.modeProposal);
      broadcastState(io, ctx.room);
    });

    socket.on("mode:respond", ({ accept }) => {
      const ctx = context(socket);
      if (!ctx || !ctx.room.modeProposal) return;
      if (ctx.room.modeProposal.fromId === ctx.seat.clientId) return;
      if (!accept) {
        const proposer = ctx.room.seatByClient(ctx.room.modeProposal.fromId);
        ctx.room.modeProposal = null;
        if (proposer?.socketId) {
          io.to(proposer.socketId).emit("mode:declined", {
            name: ctx.seat.name,
            mode: ctx.room.mode,
          });
        }
        broadcastState(io, ctx.room);
        return;
      }
      ctx.room.mode = ctx.room.modeProposal.mode;
      ctx.room.modeProposal = null;
      ctx.room.phase = "idle";
      ctx.room.floorHolderId = null;
      ctx.room.activeJob = null;
      ctx.room.queued = [];
      for (const s of ctx.room.seats) {
        s.micEnabled = false;
        s.speaking = false;
      }
      io.to(ctx.room.code).emit("mode:changed", { mode: ctx.room.mode });
      broadcastState(io, ctx.room);
    });

    socket.on("talk:mic", ({ enabled }) => {
      const ctx = context(socket);
      if (!ctx || ctx.room.mode !== "talk") return;
      ctx.seat.micEnabled = enabled;
      if (!enabled) ctx.seat.speaking = false;
      broadcastState(io, ctx.room);
    });

    socket.on("talk:activity", ({ speaking }) => {
      const ctx = context(socket);
      if (!ctx || ctx.room.mode !== "talk") return;
      ctx.seat.speaking = speaking;
      broadcastState(io, ctx.room);
    });

    socket.on("talk:barge_begin", () => {
      const ctx = context(socket);
      if (!ctx) return;
      handleBargeBegin(io, ctx.room, ctx.seat);
    });

    socket.on("talk:utterance", ({ jobId, mime, audio }) => {
      const ctx = context(socket);
      if (!ctx) return;
      if (ctx.room.mode !== "talk") {
        socket.emit("talk:rejected", { reason: "not_talk" });
        return;
      }
      const buf = bufferFrom(audio);
      if (!buf.length) {
        socket.emit("talk:error", {
          jobId,
          code: "stt",
          message: "Could not read that audio.",
        });
        return;
      }
      enqueueOrRun(io, ctx.room, ctx.seat, jobId, mime, buf);
    });

    socket.on("talk:play_ended", ({ jobId }) => {
      const ctx = context(socket);
      if (!ctx) return;
      onPlayEnded(io, ctx.room, jobId);
    });

    socket.on("disconnect", () => {
      const code = socket.data.roomCode as string | null;
      if (!code) return;
      const room = getRoom(code);
      if (!room) return;
      const seat = markDisconnected(room, socket.id);
      if (!seat) return;
      dropFloorFor(io, room);
      broadcastState(io, room);
      seat.disconnectTimer = setTimeout(() => {
        if (seat.socketId) return;
        removeSeat(room, seat.clientId);
        if (getRoom(room.code)) broadcastState(io, room);
      }, GRACE_MS);
    });
  });
}

function preferRoomMode(io: IO, room: Room, seat: Seat, mode: Mode | undefined): void {
  if (mode !== "chat" && mode !== "talk") return;
  if (mode === room.mode || room.modeProposal) return;
  const other = room.other(seat.clientId);
  if (!other) {
    room.mode = mode;
    return;
  }
  room.modeProposal = { fromId: seat.clientId, mode };
  io.to(room.code).emit("mode:proposed", room.modeProposal);
}

function opposite(language: Language): Language {
  return language === "en" ? "hi" : "en";
}

function context(socket: Sock): { room: Room; seat: Seat; socket: Sock } | null {
  const code = socket.data.roomCode as string | null;
  if (!code) return null;
  const room = getRoom(code);
  const seat = room?.seatBySocket(socket.id);
  if (!room || !seat) return null;
  return { room, seat, socket };
}

function seatJoin(
  io: IO,
  socket: Sock,
  room: Room,
  input: { clientId: string; name: string; language: Language },
): void {
  const result = addOrReconnect(room, {
    ...input,
    socketId: socket.id,
  });
  if (result === "full") {
    socket.emit("room:error", {
      code: "full",
      message: "This table already has two seats.",
    });
    return;
  }
  bindSocket(socket, room, result);
  broadcastState(io, room);
}

function bindSocket(socket: Sock, room: Room, seat: Seat): void {
  const prev = socket.data.roomCode as string | null;
  if (prev && prev !== room.code) socket.leave(prev);
  socket.data.roomCode = room.code;
  socket.data.clientId = seat.clientId;
  socket.join(room.code);
}

function broadcastState(io: IO, room: Room): void {
  for (const seat of room.seats) {
    if (!seat.socketId) continue;
    io.to(seat.socketId).emit("room:state", room.snapshot(seat.clientId));
  }
}
