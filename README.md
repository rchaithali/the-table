# The Table

Two seats. Two languages. One argument.

A two-person English ↔ Hindi table: **Chat** translates writing (with optional dictation). **Talk** is a connected session — tap once to unmute, speak in turns that are detected automatically, and hear the other person in your language. Cutting in stops their translated playback immediately.

## Demo (Chrome)

1. Open the site. Create a table. Copy the link.
2. Join from a second Chrome window (or phone). Pick the **other** language.
3. Chat: type. Expand **Original** on a line. Both of you can send at once.
4. **Move to Talk** → the other person accepts. Use headphones.
5. Mics start **muted**. Tap **Unmute** once. Speak, pause; they should hear a translation. Speak while it plays to interrupt.

If the first load hangs on Render’s free tier, wait about a minute — the service is waking.

## Local

```bash
cp .env.example .env
# set GROQ_API_KEY
npm install
npm run dev
```

- UI: http://127.0.0.1:4821
- Health: http://127.0.0.1:4822/health

Node 20+. Chrome for Talk recording.

## Production (Render Web Service)

Not a static site. One web service:

- Build: `npm ci && npm run build`
- Start: `npm start`
- Env: `GROQ_API_KEY`, `GROQ_TRANSLATE_MODEL` (default `openai/gpt-oss-20b`), `GROQ_WHISPER_MODEL` (`whisper-large-v3`)

Free instances sleep after 15 minutes idle.

## Stack

React + Vite + Tailwind · Express + Socket.IO · Groq Whisper transcriptions + chat translation · browser `speechSynthesis` · in-memory rooms.

## Limits

English and Hindi only. Talk is consecutive auto-segmented speech, not simultaneous dubbed audio. Browser TTS quality depends on the OS voice pack.
