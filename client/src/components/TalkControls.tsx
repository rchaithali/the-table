export function TalkControls({
  micEnabled,
  onMic,
  onLeave,
  captureReady,
}: {
  micEnabled: boolean;
  onMic: () => void;
  onLeave: () => void;
  captureReady: boolean;
}) {
  return (
    <div className="flex items-center justify-center gap-3">
      <button
        type="button"
        disabled={!captureReady}
        onClick={onMic}
        className={`min-w-40 rounded-full px-6 py-3 font-display text-lg ${
          micEnabled ? "bg-warm text-paper" : "bg-ink text-paper"
        } disabled:opacity-40`}
      >
        {micEnabled ? "Mute" : "Unmute"}
      </button>
      <button
        type="button"
        onClick={onLeave}
        className="rounded-full border border-ink/20 px-4 py-3 text-sm"
      >
        Leave Talk
      </button>
    </div>
  );
}
