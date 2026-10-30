export function requestMicrophone(): Promise<MediaStream> {
  const requested = navigator.mediaDevices.getUserMedia({
    audio: { echoCancellation: true, noiseSuppression: true },
  });
  let settled = false;
  const timeout = new Promise<MediaStream>((_, reject) => {
    window.setTimeout(() => {
      if (settled) return;
      reject(new DOMException("Microphone permission timed out", "NotAllowedError"));
    }, 15000);
  });
  return Promise.race([requested, timeout]).then(
    (stream) => {
      settled = true;
      return stream;
    },
    (err: unknown) => {
      settled = true;
      void requested.then((late) => late.getTracks().forEach((track) => track.stop())).catch(() => {});
      throw err;
    },
  );
}

export async function recordUntilStop(
  stream: MediaStream,
  signal: AbortSignal,
): Promise<{ blob: Blob; mime: string }> {
  const mime = MediaRecorder.isTypeSupported("audio/webm;codecs=opus")
    ? "audio/webm;codecs=opus"
    : MediaRecorder.isTypeSupported("audio/webm")
      ? "audio/webm"
      : "";
  if (!mime) {
    throw new Error("This browser cannot record audio for dictation. Use Chrome.");
  }
  const rec = new MediaRecorder(stream, { mimeType: mime });
  const chunks: BlobPart[] = [];
  rec.ondataavailable = (e) => {
    if (e.data.size) chunks.push(e.data);
  };
  const done = new Promise<Blob>((resolve, reject) => {
    rec.onstop = () => resolve(new Blob(chunks, { type: mime }));
    rec.onerror = () => reject(new Error("Recording failed"));
  });
  rec.start();
  await new Promise<void>((resolve, reject) => {
    if (signal.aborted) {
      rec.stop();
      resolve();
      return;
    }
    const onAbort = () => {
      try {
        rec.stop();
      } catch {
        reject(new Error("Recording failed"));
      }
      resolve();
    };
    signal.addEventListener("abort", onAbort, { once: true });
  });
  const blob = await done;
  return { blob, mime };
}

export async function blobToBuffer(blob: Blob): Promise<ArrayBuffer> {
  return blob.arrayBuffer();
}
