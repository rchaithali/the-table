export type Language = "en" | "hi";
export type Mode = "chat" | "talk";
export type FloorPhase = "idle" | "translating" | "playing";
export type ItemKind = "chat" | "talk";
export type ItemStatus = "ok" | "translating" | "failed" | "cut_off" | "queued";

export interface Participant {
  id: string;
  name: string;
  language: Language;
  typing: boolean;
  micEnabled: boolean;
  speaking: boolean;
}

export interface TranscriptItem {
  id: string;
  kind: ItemKind;
  authorId: string;
  sourceLang: Language;
  targetLang: Language;
  sourceText: string;
  translatedText: string | null;
  status: ItemStatus;
  interruptedBy?: string;
  createdAt: number;
}

export interface ModeProposal {
  fromId: string;
  mode: Mode;
}

export interface RoomState {
  code: string;
  mode: Mode;
  modeProposal: ModeProposal | null;
  floorHolderId: string | null;
  phase: FloorPhase;
  floorGen: number;
  activeJobId: string | null;
  transcript: TranscriptItem[];
  participants: Participant[];
  youId: string | null;
}

export type RoomErrorCode =
  | "full"
  | "gone"
  | "invalid"
  | "busy"
  | "alone"
  | "not_talk"
  | "rate_limit"
  | "stt"
  | "mt"
  | "empty"
  | "mic";

export interface ServerToClientEvents {
  "room:created": (payload: { code: string }) => void;
  "room:state": (payload: RoomState) => void;
  "room:error": (payload: { code: RoomErrorCode; message: string }) => void;
  "peer:joined": (payload: Participant) => void;
  "peer:left": (payload: { id: string }) => void;
  "peer:updated": (payload: Participant) => void;
  "chat:message": (payload: TranscriptItem) => void;
  "chat:typing": (payload: { id: string; typing: boolean }) => void;
  "mode:proposed": (payload: ModeProposal) => void;
  "mode:changed": (payload: { mode: Mode }) => void;
  "floor:update": (payload: {
    floorHolderId: string | null;
    phase: FloorPhase;
    floorGen: number;
    jobId: string | null;
  }) => void;
  "talk:play": (payload: {
    jobId: string;
    text: string;
    lang: Language;
    itemId: string;
    floorGen: number;
  }) => void;
  "talk:interrupted": (payload: {
    jobId: string;
    byId: string;
    itemId: string;
    floorGen: number;
  }) => void;
  "talk:rejected": (payload: { reason: string }) => void;
  "item:updated": (payload: TranscriptItem) => void;
  "talk:error": (payload: {
    jobId: string;
    code: RoomErrorCode;
    message: string;
  }) => void;
}

export interface ClientToServerEvents {
  "room:create": (payload: { name: string; language: Language }) => void;
  "room:join": (payload: {
    code: string;
    clientId: string;
    name: string;
    language: Language;
  }) => void;
  "self:update": (payload: { name?: string; language?: Language }) => void;
  "chat:send": (payload: { clientMsgId: string; text: string }) => void;
  "chat:typing": (payload: { typing: boolean }) => void;
  "mode:propose": (payload: { mode: Mode }) => void;
  "mode:respond": (payload: { accept: boolean }) => void;
  "talk:mic": (payload: { enabled: boolean }) => void;
  "talk:activity": (payload: { speaking: boolean }) => void;
  "talk:barge_begin": (payload: { jobId: string }) => void;
  "talk:utterance": (payload: {
    jobId: string;
    mime: string;
    audio: ArrayBuffer;
  }) => void;
  "talk:play_ended": (payload: { jobId: string }) => void;
}

export const LANGUAGES: { id: Language; label: string; native: string }[] = [
  { id: "en", label: "English", native: "English" },
  { id: "hi", label: "Hindi", native: "हिन्दी" },
];
