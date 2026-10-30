import { useEffect, useState } from "react";
import type { RoomState } from "@shared/types";
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
} from "./state/roomStore";

type Conn = "connecting" | "live" | "down";

export function App() {
  const [conn, setConn] = useState<Conn>("connecting");
  const [state, setState] = useState<RoomState | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    const onConnect = () => {
      setConn("live");
      const code = rememberedRoom();
      if (code && !state) {
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
    });
    socket.on("room:error", (payload) => {
      setError(payload.message);
      if (payload.code === "gone" || payload.code === "full") {
        if (payload.code === "gone") clearRoom();
      }
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
    if (socket.connected) onConnect();
    return () => {
      socket.off("connect", onConnect);
      socket.off("disconnect", onDisconnect);
      socket.off("connect_error", onDisconnect);
      socket.off("room:state");
      socket.off("room:error");
      socket.off("chat:message");
      socket.off("item:updated");
      socket.off("mode:changed");
      socket.off("chat:typing");
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const waiting = state && !peerOf(state);

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
          captureReady={false}
          onSend={(text) => socket.emit("chat:send", { clientMsgId: crypto.randomUUID(), text })}
          onTyping={(typing) => socket.emit("chat:typing", { typing })}
          onPropose={(mode) => socket.emit("mode:propose", { mode })}
          onRespond={(accept) => socket.emit("mode:respond", { accept })}
          onMic={() => undefined}
        />
      )}
      {copied ? (
        <p className="fixed bottom-4 left-1/2 -translate-x-1/2 text-sm text-cool">
          Link copied
        </p>
      ) : null}
      {state && error ? (
        <p className="fixed top-3 left-1/2 -translate-x-1/2 rounded-sm bg-cut px-3 py-1 text-sm text-paper">
          {error}
        </p>
      ) : null}
    </div>
  );
}
