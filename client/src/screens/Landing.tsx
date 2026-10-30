type Conn = "connecting" | "live" | "down";

export function Landing({ connection }: { connection: Conn }) {
  const status =
    connection === "live"
      ? "Table is set."
      : connection === "connecting"
        ? "Pulling up a chair…"
        : "The table went quiet. Retrying…";

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

      <section className="py-16 sm:py-24">
        <p className="font-ui text-sm uppercase tracking-[0.18em] text-warm">
          English ↔ हिन्दी
        </p>
        <h1 className="mt-4 max-w-xl font-display text-4xl leading-[1.1] font-medium tracking-tight sm:text-6xl">
          Two seats. Two languages. One argument.
        </h1>
        <p className="mt-6 max-w-lg text-lg leading-relaxed text-ink/75">
          Sit across from someone you do not share a language with. Type, or
          talk. Each of you hears and reads in your own tongue — including when
          you cut each other off.
        </p>

        <div className="mt-12 grid gap-3 sm:grid-cols-2">
          <button
            type="button"
            disabled
            className="rounded-sm bg-ink px-5 py-4 text-left text-paper opacity-50"
          >
            <span className="block font-display text-2xl">Create a table</span>
            <span className="mt-1 block text-sm text-paper/70">
              Rooms arrive next.
            </span>
          </button>
          <button
            type="button"
            disabled
            className="rounded-sm border border-ink/20 bg-paper px-5 py-4 text-left opacity-50"
          >
            <span className="block font-display text-2xl">Join a table</span>
            <span className="mt-1 block text-sm text-ink/60">
              Code or link — next.
            </span>
          </button>
        </div>
      </section>

      <footer className="flex flex-col gap-2 border-t border-rule pt-6 text-sm text-ink/55 sm:flex-row sm:justify-between">
        <p>Chat in text. Talk in a live, interpreted session.</p>
        <p>Chrome · headphones for Talk</p>
      </footer>
    </main>
  );
}
