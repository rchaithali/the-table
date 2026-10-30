# The Table

Two people, two languages, one table. English ↔ Hindi Chat and Talk.

## Local

```bash
cp .env.example .env   # add GROQ_API_KEY when you have it
npm install
npm run dev
```

- UI: http://127.0.0.1:4821
- API / Socket.IO: http://127.0.0.1:4822
- Health: http://127.0.0.1:4822/health

Requires Node 20+. Talk is Chrome-first; use headphones.

## Production

```bash
npm run build
npm start
```

Set `PORT`, `GROQ_API_KEY`, and `GROQ_TRANSLATE_MODEL` on the host.
