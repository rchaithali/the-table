import path from "node:path";
import { fileURLToPath } from "node:url";
import http from "node:http";
import express from "express";
import cors from "cors";
import { config as loadEnv } from "dotenv";
import { Server } from "socket.io";
import type {
  ClientToServerEvents,
  ServerToClientEvents,
} from "./types.ts";
import { attachSockets } from "./socket.ts";

loadEnv({ path: path.resolve(process.cwd(), "../.env") });
loadEnv();

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PORT = Number(process.env.PORT ?? 4822);

const app = express();
app.use(cors());
app.use(express.json({ limit: "12mb" }));

app.get("/health", (_req, res) => {
  res.json({ ok: true, service: "the-table" });
});

app.get("/favicon.ico", (_req, res) => {
  res.status(204).end();
});

const clientDist = path.resolve(__dirname, "../../client/dist");
app.use(express.static(clientDist));
app.get("/{*splat}", (req, res, next) => {
  if (req.path.startsWith("/socket.io") || req.path.startsWith("/health")) {
    return next();
  }
  res.sendFile(path.join(clientDist, "index.html"), (err) => {
    if (err) next();
  });
});

const server = http.createServer(app);
const io = new Server<ClientToServerEvents, ServerToClientEvents>(server, {
  cors: { origin: true },
  maxHttpBufferSize: 12e6,
});

attachSockets(io);

if (process.env.THE_TABLE_TEST !== "1") {
  server.listen(PORT, "0.0.0.0", () => {
    console.log(`The Table listening on ${PORT}`);
  });
}

export { app, io, server };
