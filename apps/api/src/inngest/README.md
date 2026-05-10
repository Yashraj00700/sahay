# Inngest

Sahay's background-job layer. Replaces the legacy BullMQ queues
in `src/lib/queues.ts` one queue at a time.

## Why Inngest

We deploy on Vercel. Vercel does not run persistent worker
processes, so a Redis-backed BullMQ worker has nowhere to live.
Inngest solves this by inverting the model:

- The Inngest service holds the queue, retries, scheduling,
  concurrency caps, and the dashboard.
- Our app exposes a single HTTP endpoint (`/api/inngest`).
- We send events with `inngest.send(...)`. Inngest invokes our
  endpoint with the work to do — fully serverless.

We get the same primitives BullMQ gave us (queues, retries, cron,
fan-out, concurrency limits) without owning a worker fleet.

## Layout

```
src/inngest/
  client.ts                — Inngest singleton + typed event map (`SahayEvents`)
  functions/
    index.ts               — barrel that the serve() endpoint registers
    whatsapp-incoming.ts   — real impl (P0.10 example)
    _stub.ts               — registered no-op stubs for the 9 unported events
```

The serve endpoint (TBD: `apps/api/api/inngest.ts` once we adopt
the Vercel API-routes structure) imports `functions` from
`./functions` and hands it to Inngest's `serve({ client, functions })`.

## Adding a new function

1. Create `functions/<name>.ts`. Use `inngest.createFunction(...)`
   from `../client`. Both the event name and any `step.sendEvent`
   payloads are typed by the `SahayEvents` map in `client.ts`.
2. Re-export the function from `functions/index.ts` and add it to
   the `functions` array.
3. If you're replacing a stub, drop the matching entry from the
   `STUBS` list in `functions/_stub.ts` so we don't double-register.
4. Use `concurrency: { limit, key: 'event.data.tenantId' }` for any
   tenant-heavy function so one tenant can't starve the rest.
5. Wrap each side-effect in `step.run('label', async () => ...)` —
   Inngest memoizes successful steps and replays only the failed
   ones on retry.

## Adding a new event

1. Add it to `SahayEvents` in `client.ts` with a strongly-typed
   `data` shape.
2. Producers call `sendEvent({ name, data })` — autocompletion will
   guide the payload.
3. Consumers either get a real function (above) or a stub entry in
   `_stub.ts` so the dashboard reflects the slot.

## Local dev

```
npx inngest-cli dev
```

This boots a local Inngest dev server that:
- Discovers your registered functions by hitting `/api/inngest`.
- Provides a UI at `http://localhost:8288` for sending test events,
  inspecting runs, replaying failed steps.
- Uses an in-process queue — no Redis needed for dev.

Set `INNGEST_EVENT_KEY` and `INNGEST_SIGNING_KEY` in `.env`
(validated by `src/lib/env.ts`). For `inngest-cli dev` the keys
can be any non-empty string.

## Migration plan

Each BullMQ queue in `src/lib/queues.ts` migrates in three steps:

1. Producer flips from `queue.add(...)` to `sendEvent({ name, data })`.
2. The matching stub in `_stub.ts` is replaced by a real function.
3. The BullMQ Queue + Worker for that channel are deleted.

Until all 10 are ported, BullMQ and Inngest run side by side.
