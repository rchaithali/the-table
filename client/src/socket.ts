import { io, type Socket } from "socket.io-client";
import type {
  ClientToServerEvents,
  ServerToClientEvents,
} from "@shared/types";

export type TableSocket = Socket<ServerToClientEvents, ClientToServerEvents>;

export const socket: TableSocket = io({
  autoConnect: true,
  transports: ["websocket", "polling"],
});
