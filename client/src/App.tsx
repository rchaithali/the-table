import { useEffect, useRef, useState } from "react";
import type { RoomState } from "@shared/types";
import { TalkSession } from "./audio/talkSession";
import { cancelSpeech, hasVoice, speak } from "./audio/tts";
import { Landing } from "./screens/Landing";
import { TableView } from "./screens/Table";
import { Waiting } from "./screens/Waiting";
import { socket } from "./socket";
import { getClientId } from "./state/session";
import {
  clearRoom,
  peerOf,
  rememberRoom,
  rememberedProfile,
  rememberedRoom,
  selfOf,
} from "./state/roomStore";

type Conn = "connecting" | "live" | "down";

export function App() {
  const [conn, setConn] = useState<Conn>("connecting");
  const [state, setState] = useState<RoomState | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const [voiceWarn, setVoiceWarn] = useState<string | null>(null);
  const talkRef = useRef<TalkSession | null>(null);
  const stateRef = useRef<RoomState | null>(null);
  stateRef.current = state;

  useEffect(() => {
    const talk = new TalkSession();
    talkRef.current = talk;

    const onConnect = () => {
      setConn("live");
      const code = rememberedRoom();
      if (code) {
        const profile = rememberedProfile();
        socket.emit("room:join", {
          code,
          clientId: getClientId(),
          name: profile.name || "You",
          language: profile.language,
        });
      }
    };
    const onDisconnect = () => setConn("down");
    socket.on("connect", onConnect);
    socket.on("disconnect", onDisconnect);
    socket.on("connect_error", onDisconnect);
    socket.on("room:state", (next) => {
      setState(next);
      setError(null);
      rememberRoom(next.code);
      const url = new URL(window.location.href);
      url.searchParams.set("room", next.code);
      window.history.replaceState({}, "", url);
      if (next.mode !== "talk") {
        talk.disable();
        cancelSpeech();
      }
    });
    socket.on("room:error", (payload) => {
      setError(payload.message);
      if (payload.code === "gone") clearRoom();
    });
    socket.on("chat:message", (item) => {
      setState((cur) =>
        cur ? { ...cur, transcript: [...cur.transcript, item] } : cur,
      );
    });
    socket.on("item:updated", (item) => {
      setState((cur) =>
        cur
          ? {
              ...cur,
              transcript: cur.transcript.map((t) =>
                t.id === item.id ? item : t,
              ),
            }
          : cur,
      );
    });
    socket.on("mode:changed", ({ mode }) => {
      setState((cur) => (cur ? { ...cur, mode, modeProposal: null } : cur));
      if (mode !== "talk") {
        talk.disable();
        cancelSpeech();
      }
    });
    socket.on("chat:typing", ({ id, typing }) => {
      setState((cur) =>
        cur
          ? {
              ...cur,
              participants: cur.participants.map((p) =>
                p.id === id ? { ...p, typing } : p,
              ),
            }
          : cur,
      );
    });
    socket.on("floor:update", (floor) => {
      setState((cur) =>
        cur
          ? {
              ...cur,
              floorHolderId: floor.floorHolderId,
              phase: floor.phase,
              floorGen: floor.floorGen,
              activeJobId: floor.jobId,
            }
          : cur,
      );
    });
    socket.on("talk:play", (payload) => {
      const me = stateRef.current ? selfOf(stateRef.current) : null;
      if (me && !hasVoice(me.language)) {
        setVoiceWarn(
          me.language === "hi"
            ? "This device has no Hindi voice. The words are in history."
            : "This device has no English voice. The words are in history.",
        );
      } else {
        setVoiceWarn(null);
      }
      talk.setRemotePlaying(payload.jobId);
      void speak(payload.text, payload.lang).then((result) => {
        talk.setRemotePlaying(null);
        if (result === "ended") {
          socket.emit("talk:play_ended", { jobId: payload.jobId });
        }
      });
    });
    socket.on("talk:interrupted", () => {
      cancelSpeech();
      talk.setRemotePlaying(null);
    });
    socket.on("talk:error", (payload) => setError(payload.message));

    if (socket.connected) onConnect();
    return () => {
      talk.disable();
      socket.off("connect", onConnect);
      socket.off("disconnect", onDisconnect);
      socket.off("connect_error", onDisconnect);
      socket.off("room:state");
      socket.off("room:error");
      socket.off("chat:message");
      socket.off("item:updated");
      socket.off("mode:changed");
      socket.off("chat:typing");
      socket.off("floor:update");
      socket.off("talk:play");
      socket.off("talk:interrupted");
      socket.off("talk:error");
    };
  }, []);

  const waiting = state && !peerOf(state);

  async function toggleMic() {
    const talk = talkRef.current;
    const cur = stateRef.current;
    const me = cur ? selfOf(cur) : null;
    if (!talk || !me) return;
    if (me.micEnabled) talk.disable();
    else {
      try {
        await talk.enable();
      } catch {
        setError("Microphone permission is required for Talk.");
      }
    }
  }

  return (
    <div className="min-h-dvh bg-paper text-ink">
      {!state ? (
        <Landing connection={conn} error={error} />
      ) : waiting ? (
        <Waiting
          state={state}
          onCopy={() => {
            const share = `${window.location.origin}/?room=${state.code}`;
            void navigator.clipboard.writeText(share);
            setCopied(true);
            window.setTimeout(() => setCopied(false), 1500);
          }}
        />
      ) : (
        <TableView
          state={state}
          captureReady
          onSend={(text) =>
            socket.emit("chat:send", {
              clientMsgId: crypto.randomUUID(),
              text,
            })
          }
          onTyping={(typing) => socket.emit("chat:typing", { typing })}
          onPropose={(mode) => socket.emit("mode:propose", { mode })}
          onRespond={(accept) => socket.emit("mode:respond", { accept })}
          onMic={() => void toggleMic()}
        />
      )}
      {copied ? (
        <p className="fixed bottom-4 left-1/2 -translate-x-1/2 text-sm text-cool">
          Link copied
        </p>
      ) : null}
      {(state && error) || voiceWarn ? (
        <p className="fixed top-3 left-1/2 z-10 -translate-x-1/2 rounded-sm bg-cut px-3 py-1 text-sm text-paper">
          {error ?? voiceWarn}
        </p>
      ) : null}
    </div>
  );
}
