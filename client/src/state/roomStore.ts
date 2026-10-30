import type { Language, RoomState } from "@shared/types";
import { getClientId } from "./session";

const ROOM_KEY = "the-table.room";
const NAME_KEY = "the-table.name";
const LANG_KEY = "the-table.lang";

export function getClientIdOrCreate(): string {
  return getClientId();
}

export function rememberRoom(code: string): void {
  sessionStorage.setItem(ROOM_KEY, code);
}

export function rememberedRoom(): string | null {
  return sessionStorage.getItem(ROOM_KEY);
}

export function clearRoom(): void {
  sessionStorage.removeItem(ROOM_KEY);
}

export function rememberProfile(name: string, language: Language): void {
  sessionStorage.setItem(NAME_KEY, name);
  sessionStorage.setItem(LANG_KEY, language);
}

export function rememberedProfile(): { name: string; language: Language } {
  const language =
    sessionStorage.getItem(LANG_KEY) === "hi" ? "hi" : "en";
  return {
    name: sessionStorage.getItem(NAME_KEY) || "",
    language,
  };
}

export function peerOf(state: RoomState) {
  return state.participants.find((p) => p.id !== state.youId) ?? null;
}

export function selfOf(state: RoomState) {
  return state.participants.find((p) => p.id === state.youId) ?? null;
}
