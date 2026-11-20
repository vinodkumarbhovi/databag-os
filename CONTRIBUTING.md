# Contributing

Thanks for helping. databag aims to stay **simple**: one process, one database, plain language in the interface, and small enough to run a whole company on one ordinary machine.

## Get going

```bash
git clone https://github.com/vinodkumarbhovi/databag-os && cd databag-os
npm install
npm run seed      # a demo company in ./.data (see scripts/seed.ts for the sign-in)
npm run dev       # http://localhost:4100
npm run typecheck
```

You need Node 24 or newer, and Ollama with `gemma4:e4b` for the AI features. Instead of Ollama you can set `OPENROUTER_API_KEY`.

## How the code is organised

See [docs/architecture.md](docs/architecture.md). In short:
- **A new app** needs:
  - an entry in `shared/catalog.mjs`
  - its tables as a new module in `lib/schema.ts` (append-only steps)
  - its server functions in `lib/apps/<app>.ts`, registered in `app/api/rpc/route.ts`
  - a component in `components/`, rendered from `components/AppHost.tsx`
- **A new agent tool** is added in `lib/agent/tools.ts`. Give it an honest `risk`:
  - `read` for lookups
  - `change` for changes inside databag
  - `send` for anything that reaches other people
- **Database changes** go in a new step at the end of the module's list in `lib/schema.ts`. Never edit a step that has shipped.

## Guidelines

- Write interface text for a busy small-business owner: short and plain, with no jargon.
- Anything that reaches other people must wait for a person's approval.
- No new runtime services. If something needs a queue, a cache or a second server, find a simpler way.
- Clean-room only: never copy or decompile proprietary products.
- The brand is written in lowercase: **databag**.

Open an issue before large changes, so we can agree on the approach first.
