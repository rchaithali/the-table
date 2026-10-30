import { useRef, useState } from "react";
import { blobToBuffer, recordUntilStop } from "../audio/dictate";
import { socket } from "../socket";

export function ChatComposer({
  disabled,
  onSend,
}: {
  disabled?: boolean;
  onSend: (text: string) => void;
}) {
  const [text, setText] = useState("");
  const [dictating, setDictating] = useState(false);
  const [busy, setBusy] = useState(false);
  const abort = useRef<AbortController | null>(null);
  const streamRef = useRef<MediaStream | null>(null);

  async function toggleDictate() {
    if (dictating) {
      abort.current?.abort();
      return;
    }
    setDictating(true);
    const ac = new AbortController();
    abort.current = ac;
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      streamRef.current = stream;
      const { blob, mime } = await recordUntilStop(stream, ac.signal);
      stopStream();
      setDictating(false);
      if (blob.size < 800) return;
      setBusy(true);
      const requestId = crypto.randomUUID();
      const audio = await blobToBuffer(blob);
      const onText = (payload: { requestId: string; text: string }) => {
        if (payload.requestId !== requestId) return;
        socket.off("chat:transcribed", onText);
        setText((t) => (t ? `${t} ${payload.text}` : payload.text));
        setBusy(false);
      };
      socket.on("chat:transcribed", onText);
      socket.emit("chat:transcribe", { requestId, mime, audio });
    } catch (err) {
      stopStream();
      setDictating(false);
      setBusy(false);
      console.error(err);
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
      className="flex items-end gap-2 border-t border-rule pt-3"
      onSubmit={(e) => {
        e.preventDefault();
        submit();
      }}
    >
      <button
        type="button"
        className={`h-11 w-11 shrink-0 rounded-full border ${
          dictating ? "border-cut bg-cut text-paper" : "border-ink/20"
        }`}
        aria-pressed={dictating}
        aria-label={dictating ? "Stop dictation" : "Dictate"}
        onClick={() => void toggleDictate()}
        disabled={busy || disabled}
      >
        {busy ? "…" : dictating ? "■" : "mic"}
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
    </form>
  );
}
