import type { Language, RoomState } from "@shared/types";
import { ChatComposer } from "../components/ChatComposer";
import { Floor } from "../components/Floor";
import { ModePrompt } from "../components/ModePrompt";
import { Seat } from "../components/Seat";
import { TalkControls } from "../components/TalkControls";
import { Transcript } from "../components/Transcript";
import { peerOf, selfOf } from "../state/roomStore";

export function TableView({
  state,
  onSend,
  onTyping,
  onPropose,
  onRespond,
  onMic,
  onLanguage,
  onError,
  captureReady,
}: {
  state: RoomState;
  onSend: (text: string) => void;
  onTyping: (typing: boolean) => void;
  onPropose: (mode: "chat" | "talk") => void;
  onRespond: (accept: boolean) => void;
  onMic: () => void;
  onLanguage: (language: Language) => void;
  onError: (message: string) => void;
  captureReady: boolean;
}) {
  const self = selfOf(state);
  const peer = peerOf(state);
  const talk = state.mode === "talk";
  const floorLabel = talk
    ? floorCopy(state, captureReady)
    : peer?.typing
      ? `${peer.name} is writing`
      : "Say the thing you mean.";

  return (
    <main className="mx-auto flex min-h-dvh max-w-2xl flex-col px-4 py-6 sm:px-8">
      <header className="flex items-center justify-between gap-3">
        <p className="font-display text-lg">The Table · {state.code}</p>
        <button
          type="button"
          className="text-sm text-ink/60 underline-offset-2 hover:underline"
          onClick={() => onPropose(talk ? "chat" : "talk")}
        >
          {talk ? "Back to Chat" : "Move to Talk"}
        </button>
      </header>

      <div className="mt-6 flex flex-1 flex-col">
        <Seat person={peer} side="far" />
        <Floor mode={state.mode} phase={state.phase} label={floorLabel} />
        <Seat person={self} side="near" you onLanguage={onLanguage} />

        {state.modeProposal ? (
          <div className="mt-4">
            <ModePrompt
              state={state}
              proposal={state.modeProposal}
              onRespond={onRespond}
            />
          </div>
        ) : null}

        <div className="mt-6 min-h-0 flex-1">
          <Transcript state={state} collapsed={talk} />
        </div>
      </div>

      {talk ? (
        <div className="mt-4 space-y-2">
          {!captureReady ? (
            <p className="text-center text-sm text-ink/55">
              Talk listening is not live yet. Stay in Chat to argue in writing.
            </p>
          ) : null}
          <TalkControls
            micEnabled={Boolean(self?.micEnabled)}
            onMic={onMic}
            onLeave={() => onPropose("chat")}
            captureReady={captureReady}
          />
        </div>
      ) : (
        <div
          onFocus={() => onTyping(true)}
          onBlur={() => onTyping(false)}
        >
          <ChatComposer onSend={onSend} onError={onError} />
        </div>
      )}
    </main>
  );
}

function floorCopy(state: RoomState, captureReady: boolean): string {
  if (!captureReady) return "Talk audio arrives next — Chat still works.";
  const mine = state.floorHolderId != null && state.floorHolderId === state.youId;
  if (state.phase === "translating") {
    return mine
      ? "Carrying what you said across the table…"
      : "Carrying what they said across the table…";
  }
  if (state.phase === "playing") {
    return mine ? "They are hearing you." : "You’re hearing them.";
  }
  const speaker = state.participants.find((p) => p.speaking);
  if (speaker) {
    return speaker.id === state.youId ? "You’re speaking." : `${speaker.name} is speaking.`;
  }
  return "Mics start muted. Tap once to keep listening.";
}
