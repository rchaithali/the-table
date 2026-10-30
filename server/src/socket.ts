import type { Server } from "socket.io";
import type { ClientToServerEvents, ServerToClientEvents } from "./types.ts";

export function attachSockets(
  io: Server<ClientToServerEvents, ServerToClientEvents>,
): void {
  io.on("connection", (socket) => {
    socket.data.connectedAt = Date.now();
    socket.on("disconnect", () => {
      /* rooms attach in chunk 2 */
    });
  });
}
