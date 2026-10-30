import { useEffect, useState } from "react";
import { Landing } from "./screens/Landing";
import { socket } from "./socket";

type Conn = "connecting" | "live" | "down";

export function App() {
  const [conn, setConn] = useState<Conn>("connecting");

  useEffect(() => {
    const onConnect = () => setConn("live");
    const onDisconnect = () => setConn("down");
    const onError = () => setConn("down");
    socket.on("connect", onConnect);
    socket.on("disconnect", onDisconnect);
    socket.on("connect_error", onError);
    if (socket.connected) setConn("live");
    return () => {
      socket.off("connect", onConnect);
      socket.off("disconnect", onDisconnect);
      socket.off("connect_error", onError);
    };
  }, []);

  return (
    <div className="min-h-dvh bg-paper text-ink">
      <Landing connection={conn} />
    </div>
  );
}
