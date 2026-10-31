import { useEffect, useRef, useState } from "react";
import type { Language, Mode, RoomState } from "@shared/types";
import { mergeTranscript, nextPresence } from "@shared/roomSync";
import { TalkSession } from "./audio/talkSession";
import { cancelSpeech, ensureVoices, primeSpeech, speak } from "./audio/tts";
import { Landing } from "./screens/Landing";
import { TableView } from "./screens/Table";
import { Waiting } from "./screens/Waiting";
import { socket } from "./socket";
import { getClientId } from "./state/session";
import {
  clearRoom,
  peerOf,
  rememberProfile,
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
  const [declineNote, setDeclineNote] = useState<string | null>(null);
  const [voiceWarn, setVoiceWarn] = useState<string | null>(null);
  const declineTimer = useRef<number | null>(null);
  const talkRef = useRef<TalkSession | null>(null);
  const stateRef = useRef<RoomState | null>(null);
  const playbackGen = useRef(0);
  const modeRef = useRef<Mode>("chat");
  const roomCodeRef = useRef<string | null>(null);
  const aside = useRef(false);
  const awayId = useRef<string | null>(null);
  const [presence, setPresence] = useState<string | null>(null);
  const [rejoining, setRejoining] = useState(() => Boolean(rememberedRoom()));
  stateRef.current = state;

  useEffect(() => {
    const talk = new TalkSession();
    talkRef.current = talk;

    const onConnect = () => {
      setConn("live");
      const code = rememberedRoom();
      if (code) {
        aside.current = false;
        const profile = rememberedProfile();
        socket.emit("room:join", {
          code,
          clientId: getClientId(),
          name: profile.name || "You",
          language: profile.language,
        });
      } else {
        setRejoining(false);
      }
    };
    const onDisconnect = () => setConn("down");
    socket.on("connect", onConnect);
    socket.on("disconnect", onDisconnect);
    socket.on("connect_error", onDisconnect);
    socket.on("room:state", (next) => {
      if (aside.current) return;
      if (roomCodeRef.current !== next.code) {
        roomCodeRef.current = next.code;
        playbackGen.current = next.floorGen;
        awayId.current = null;
        setPresence(null);
      } else {
        playbackGen.current = Math.max(playbackGen.current, next.floorGen);
      }
      const presenceUpdate = nextPresence(awayId.current, next);
      awayId.current = presenceUpdate.awayId;
      if (presenceUpdate.notice !== "keep") setPresence(presenceUpdate.notice);
      modeRef.current = next.mode;
      setRejoining(false);
      setState((cur) => {
        const sameRoom = cur?.code === next.code;
        return {
          ...next,
          transcript: mergeTranscript(sameRoom ? cur.transcript : [], next.transcript),
        };
      });
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
      setRejoining(false);
      setError(payload.message);
      if (payload.code === "gone") {
        clearRoom();
        roomCodeRef.current = null;
        playbackGen.current = 0;
        modeRef.current = "chat";
        setState(null);
        talk.disable();
        cancelSpeech();
      }
    });
    socket.on("chat:message", (item) => {
      setState((cur) => {
        if (!cur || cur.transcript.some((t) => t.id === item.id)) return cur;
        return { ...cur, transcript: [...cur.transcript, item] };
      });
    });
    socket.on("item:updated", (item) => {
      setState((cur) => {
        if (!cur) return cur;
        const exists = cur.transcript.some((t) => t.id === item.id);
        return {
          ...cur,
          transcript: exists
            ? cur.transcript.map((t) => (t.id === item.id ? item : t))
            : [...cur.transcript, item],
        };
      });
    });
    socket.on("mode:changed", ({ mode }) => {
      modeRef.current = mode;
      setState((cur) => (cur ? { ...cur, mode, modeProposal: null } : cur));
      if (mode !== "talk") {
        talk.disable();
        cancelSpeech();
      }
    });
    const onDeclined = ({ name, mode }: { name: string; mode: Mode }) => {
      const staying = mode === "talk" ? "Talk" : "Chat";
      setDeclineNote(`${name} prefers to stay in ${staying} for now.`);
      if (declineTimer.current) window.clearTimeout(declineTimer.current);
      declineTimer.current = window.setTimeout(() => setDeclineNote(null), 5000);
    };
    socket.on("mode:declined", onDeclined);
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
      playbackGen.current = Math.max(playbackGen.current, floor.floorGen);
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
      if (modeRef.current !== "talk" || payload.floorGen < playbackGen.current) {
        return;
      }
      void (async () => {
        await ensureVoices();
        if (modeRef.current !== "talk" || payload.floorGen < playbackGen.current) {
          return;
        }
        talk.setRemotePlaying(payload.jobId);
        const heard = await speak(payload.text, payload.lang, () => talk.armHearLock());
        if (talk.playingJobId === payload.jobId) talk.setRemotePlaying(null);
        if (heard === "unavailable" || heard === "failed") {
          setVoiceWarn(
            payload.lang === "hi"
              ? "Hindi audio did not play. The words are in the history. Use headphones, and keep the Lekha Hindi voice enabled."
              : "English audio did not play. The words are in the history.",
          );
        } else if (heard === "ended") {
          setVoiceWarn(null);
        }
        if (modeRef.current !== "talk" || payload.floorGen !== playbackGen.current) {
          return;
        }
        socket.emit("talk:play_ended", { jobId: payload.jobId });
      })();
    });
    socket.on("talk:interrupted", (payload) => {
      playbackGen.current = Math.max(playbackGen.current, payload.floorGen);
      cancelSpeech();
      talk.setRemotePlaying(null);
    });
    socket.on("talk:error", (payload) => setError(payload.message));
    socket.on("peer:left", ({ id }) => {
      if (aside.current) return;
      const person = stateRef.current?.participants.find((p) => p.id === id);
      if (!person || awayId.current === id) return;
      awayId.current = id;
      setPresence(`${person.name} has left the table.`);
    });
    socket.on("peer:joined", (person) => {
      if (aside.current || !awayId.current) return;
      awayId.current = null;
      setPresence(`${person.name} is back at the table.`);
    });

    if (socket.connected) onConnect();
    return () => {
      talk.disable();
      cancelSpeech();
      socket.off("connect", onConnect);
      socket.off("disconnect", onDisconnect);
      socket.off("connect_error", onDisconnect);
      socket.off("room:state");
      socket.off("room:error");
      socket.off("chat:message");
      socket.off("item:updated");
      socket.off("mode:changed");
      socket.off("mode:declined", onDeclined);
      if (declineTimer.current) window.clearTimeout(declineTimer.current);
      socket.off("chat:typing");
      socket.off("floor:update");
      socket.off("talk:play");
      socket.off("talk:interrupted");
      socket.off("talk:error");
      socket.off("peer:left");
      socket.off("peer:joined");
    };
  }, []);

  const waiting = Boolean(state && !peerOf(state) && !presence && state.transcript.length === 0);

  function beginSeat() {
    aside.current = false;
  }

  function leaveTable() {
    aside.current = true;
    awayId.current = null;
    setPresence(null);
    talkRef.current?.disable();
    cancelSpeech();
    socket.emit("room:leave");
    clearRoom();
    roomCodeRef.current = null;
    playbackGen.current = 0;
    modeRef.current = "chat";
    setDeclineNote(null);
    setVoiceWarn(null);
    setError(null);
    setState(null);
    const url = new URL(window.location.href);
    url.search = "";
    window.history.replaceState({}, "", `${url.pathname}${url.hash}`);
  }

  async function toggleMic() {
    const talk = talkRef.current;
    const cur = stateRef.current;
    const me = cur ? selfOf(cur) : null;
    if (!talk || !me) return;
    if (me.micEnabled) talk.disable();
    else {
      try {
        primeSpeech();
        await talk.enable();
      } catch (err) {
        const named = err instanceof DOMException ? err.name : "";
        setError(
          named === "NotAllowedError" || named === "NotFoundError"
            ? "Microphone permission is required for Talk."
            : "Talk could not start the microphone.",
        );
      }
    }
  }

  function setLanguage(language: Language) {
    const me = stateRef.current ? selfOf(stateRef.current) : null;
    if (!me) return;
    rememberProfile(me.name, language);
    socket.emit("self:update", { language });
  }

  return (
    <div className="min-h-dvh bg-paper text-ink">
      {!state ? (
        <Landing
          connection={conn}
          error={error}
          suspended={rejoining}
          onArrive={beginSeat}
        />
      ) : waiting ? (
        <Waiting
          state={state}
          onLanguage={setLanguage}
          onCopy={() => {
            const share = `${window.location.origin}/?room=${state.code}`;
            void navigator.clipboard.writeText(share).then(
              () => {
                setCopied(true);
                window.setTimeout(() => setCopied(false), 1500);
              },
              () => setError("Could not copy the link. Copy the code instead."),
            );
          }}
          onLeave={leaveTable}
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
          onRespond={(accept) => {
            if (accept) primeSpeech();
            socket.emit("mode:respond", { accept });
          }}
          onMic={() => void toggleMic()}
          onLanguage={setLanguage}
          onError={setError}
          onLeave={leaveTable}
          presence={presence}
        />
      )}
      {copied ? (
        <p className="fixed bottom-4 left-1/2 -translate-x-1/2 text-sm text-cool">
          Link copied
        </p>
      ) : null}
      {declineNote ? (
        <p
          role="status"
          className="fixed bottom-24 left-1/2 z-10 max-w-sm -translate-x-1/2 rounded-sm border border-ink/15 bg-paper px-3 py-2 text-center text-sm text-ink/80"
        >
          {declineNote}
        </p>
      ) : null}
      {state && conn !== "live" ? (
        <p className="fixed top-12 left-1/2 z-10 -translate-x-1/2 rounded-sm bg-ink px-3 py-1 text-sm text-paper">
          Reconnecting…
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
