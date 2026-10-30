import { useMemo, useState } from "react";
import { LANGUAGES, type Language } from "@shared/types";
import { getClientId } from "../state/session";
import {
  rememberProfile,
  rememberedProfile,
} from "../state/roomStore";
import { socket } from "../socket";

type Conn = "connecting" | "live" | "down";

export function Landing({
  connection,
  error,
}: {
  connection: Conn;
  error: string | null;
}) {
  const preset = useMemo(() => rememberedProfile(), []);
  const [name, setName] = useState(preset.name);
  const [language, setLanguage] = useState<Language>(preset.language);
  const [code, setCode] = useState(
    () => new URLSearchParams(window.location.search).get("room") ?? "",
  );

  const status =
    connection === "live"
      ? "Table is set."
      : connection === "connecting"
        ? "Pulling up a chair…"
        : "The table went quiet. Retrying…";

  function persist() {
    rememberProfile(name.trim() || "You", language);
  }

  function create() {
    persist();
    socket.emit("room:create", {
      clientId: getClientId(),
      name: name.trim() || "You",
      language,
    });
  }

  function join() {
    persist();
    const trimmed = code.trim().toUpperCase();
    if (!trimmed) return;
    socket.emit("room:join", {
      code: trimmed,
      clientId: getClientId(),
      name: name.trim() || "You",
      language,
    });
  }

  return (
    <main className="mx-auto flex min-h-dvh max-w-3xl flex-col justify-between px-6 py-10 sm:px-10 sm:py-16">
      <header className="flex items-baseline justify-between gap-4">
        <p className="font-display text-xl tracking-tight">The Table</p>
        <p
          className={`text-sm ${connection === "live" ? "text-cool" : "text-ink/50"}`}
        >
          {status}
        </p>
      </header>

      <section className="py-12 sm:py-16">
        <p className="font-ui text-sm uppercase tracking-[0.18em] text-warm">
          English ↔ हिन्दी
        </p>
        <h1 className="mt-4 max-w-xl font-display text-4xl leading-[1.1] font-medium tracking-tight sm:text-6xl">
          Two seats. Two languages. One argument.
        </h1>
        <p className="mt-6 max-w-lg text-lg leading-relaxed text-ink/75">
          Sit across from someone you do not share a language with. Type, or
          talk. Each of you reads and hears in your own tongue — including when
          you cut each other off.
        </p>

        {error ? (
          <p className="mt-6 text-sm text-cut" role="alert">
            {error}
          </p>
        ) : null}

        <div className="mt-10 grid gap-4 sm:grid-cols-2">
          <label className="block text-sm">
            What should they call you
            <input
              className="mt-1 w-full rounded-sm border border-ink/15 bg-paper px-3 py-2 outline-none focus:border-ink/40"
              value={name}
              onChange={(e) => setName(e.target.value)}
              maxLength={24}
            />
          </label>
          <label className="block text-sm">
            Your language
            <select
              className="mt-1 w-full rounded-sm border border-ink/15 bg-paper px-3 py-2 outline-none"
              value={language}
              onChange={(e) => setLanguage(e.target.value as Language)}
            >
              {LANGUAGES.map((l) => (
                <option key={l.id} value={l.id}>
                  {l.native}
                </option>
              ))}
            </select>
          </label>
        </div>

        <div className="mt-8 grid gap-3 sm:grid-cols-2">
          <button
            type="button"
            onClick={create}
            disabled={connection !== "live"}
            className="rounded-sm bg-ink px-5 py-4 text-left text-paper disabled:opacity-40"
          >
            <span className="block font-display text-2xl">Create a table</span>
            <span className="mt-1 block text-sm text-paper/70">
              You’ll get a code to share.
            </span>
          </button>
          <div className="rounded-sm border border-ink/20 bg-paper px-5 py-4">
            <span className="block font-display text-2xl">Join a table</span>
            <div className="mt-2 flex gap-2">
              <input
                className="w-full rounded-sm border border-ink/15 px-2 py-2 uppercase tracking-[0.2em] outline-none"
                placeholder="CODE"
                value={code}
                onChange={(e) => setCode(e.target.value.toUpperCase())}
                maxLength={8}
              />
              <button
                type="button"
                className="rounded-sm bg-ink px-3 text-paper disabled:opacity-40"
                disabled={connection !== "live" || !code.trim()}
                onClick={join}
              >
                Sit
              </button>
            </div>
          </div>
        </div>
      </section>

      <footer className="flex flex-col gap-2 border-t border-rule pt-6 text-sm text-ink/55 sm:flex-row sm:justify-between">
        <p>Chat in text. Talk in a live, interpreted session.</p>
        <p>Chrome · headphones for Talk</p>
      </footer>
    </main>
  );
}
