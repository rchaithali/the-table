import { useEffect, useRef, useState } from "react";
import { blobToBuffer, recordUntilStop, requestMicrophone } from "../audio/dictate";
import { socket } from "../socket";

export function ChatComposer({
  disabled,
  onSend,
  onError,
}: {
  disabled?: boolean;
  onSend: (text: string) => void;
  onError?: (message: string) => void;
}) {
  const [text, setText] = useState("");
  const [dictating, setDictating] = useState(false);
  const [busy, setBusy] = useState(false);
  const abort = useRef<AbortController | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const detach = useRef<(() => void) | null>(null);
  const mounted = useRef(true);

  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
      abort.current?.abort();
      streamRef.current?.getTracks().forEach((track) => track.stop());
      streamRef.current = null;
      detach.current?.();
    };
  }, []);

  async function toggleDictate() {
    if (dictating) {
      abort.current?.abort();
      return;
    }
    setDictating(true);
    const ac = new AbortController();
    abort.current = ac;
    try {
      const stream = await requestMicrophone();
      if (!mounted.current) {
        stream.getTracks().forEach((track) => track.stop());
        return;
      }
      streamRef.current = stream;
      const { blob, mime } = await recordUntilStop(stream, ac.signal);
      stopStream();
      if (!mounted.current) return;
      setDictating(false);
      if (blob.size < 800) return;
      setBusy(true);
      const requestId = crypto.randomUUID();
      const audio = await blobToBuffer(blob);
      let timer = 0;
      const finish = () => {
        window.clearTimeout(timer);
        socket.off("chat:transcribed", onText);
        socket.off("room:error", onErr);
        detach.current = null;
        setBusy(false);
      };
      detach.current = finish;
      const onText = (payload: { requestId: string; text: string }) => {
        if (payload.requestId !== requestId) return;
        finish();
        setText((t) => (t ? `${t} ${payload.text}` : payload.text));
      };
      const onErr = (payload: { message: string }) => {
        finish();
        onError?.(payload.message);
      };
      timer = window.setTimeout(() => {
        finish();
        onError?.("Dictation timed out. Try again.");
      }, 20000);
      socket.on("chat:transcribed", onText);
      socket.on("room:error", onErr);
      socket.emit("chat:transcribe", { requestId, mime, audio });
    } catch (err) {
      stopStream();
      setDictating(false);
      setBusy(false);
      const denied = err instanceof DOMException && err.name === "NotAllowedError";
      onError?.(
        denied
          ? "Microphone permission is required for dictation."
          : "Could not use the microphone for dictation.",
      );
    }
  }

  function stopStream() {
    streamRef.current?.getTracks().forEach((t) => t.stop());
    streamRef.current = null;
  }

  function submit() {
    const next = text.trim();
    if (!next || disabled) return;
    onSend(next);
    setText("");
  }

  return (
    <form
      className="border-t border-rule pt-3"
      onSubmit={(e) => {
        e.preventDefault();
        submit();
      }}
    >
      {dictating ? (
        <p className="mb-2 text-sm text-ink/60">
          Recording. Stop the mic, then edit the words. Nothing is sent until you press Send.
        </p>
      ) : null}
      {busy ? (
        <p className="mb-2 text-sm text-ink/60">
          Transcribing. The words will appear here for you to edit, then press Send.
        </p>
      ) : null}
      <div className="flex items-end gap-2">
      <button
        type="button"
        className={`grid h-11 w-11 shrink-0 place-items-center rounded-full border ${
          dictating ? "border-cut bg-cut text-paper" : "border-ink/20 text-ink"
        }`}
        aria-pressed={dictating}
        aria-busy={busy}
        aria-label={busy ? "Transcribing" : dictating ? "Stop recording" : "Start recording"}
        title={busy ? "Transcribing" : dictating ? "Stop recording" : "Start recording"}
        onClick={() => void toggleDictate()}
        disabled={busy || disabled}
      >
        {busy ? <TranscribingMark /> : <MicIcon recording={dictating} />}
      </button>
      <textarea
        className="min-h-11 flex-1 resize-none rounded-sm border border-ink/15 bg-paper px-3 py-2 font-ui outline-none focus:border-ink/40"
        rows={2}
        placeholder="Say it in your language"
        value={text}
        disabled={disabled || busy}
        onChange={(e) => setText(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Enter" && !e.shiftKey) {
            e.preventDefault();
            submit();
          }
        }}
      />
      <button
        type="submit"
        className="h-11 rounded-sm bg-ink px-4 text-paper disabled:opacity-40"
        disabled={disabled || busy || !text.trim()}
      >
        Send
      </button>
      </div>
    </form>
  );
}

function MicIcon({ recording }: { recording: boolean }) {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true" className="h-5 w-5">
      <path
        fill="currentColor"
        d="M12 15a3 3 0 0 0 3-3V6a3 3 0 0 0-6 0v6a3 3 0 0 0 3 3zm-7-3a1 1 0 1 0-2 0 9 9 0 0 0 8 8.94V23h2v-2.06A9 9 0 0 0 21 12a1 1 0 1 0-2 0 7 7 0 0 1-14 0z"
      />
      {recording ? <circle cx="19" cy="5" r="2.2" fill="currentColor" /> : null}
    </svg>
  );
}

function TranscribingMark() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true" className="h-5 w-5 animate-spin">
      <circle cx="12" cy="12" r="7" fill="none" stroke="currentColor" strokeWidth="2" opacity="0.25" />
      <path d="M12 5a7 7 0 0 1 7 7" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
    </svg>
  );
}
