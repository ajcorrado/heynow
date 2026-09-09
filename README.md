# HeyNow

HeyNow is a hyperlocal event discovery system launching in El Paso.

## Current phase

The immediate engineering focus is:

1. persistent source registry
2. event ingestion
3. source performance measurement
4. editorial review
5. product experience over real data

## Architecture

- Next.js 16
- TypeScript/React
- Supabase/Postgres
- Supabase Auth
- Supabase Edge Functions
- Vercel
- GitHub as source of truth

## Live backend

The production Supabase project currently contains:

- canonical events and venues
- event/source provenance
- source runs
- editorial review state
- persistent source registry
- source relationships
- source priority history
- source performance/health views
- Visit El Paso ingestion adapter

See `docs/ENGINEERING.md` for the living engineering brief.

## Local app

```bash
npm install
npm run dev
```

Required environment variables:

```
NEXT_PUBLIC_SUPABASE_URL=
NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY=
```

The publishable key is safe for browser use; RLS protects private data.

## Internal registry

`/admin/sources`

The registry is intentionally separate from adapters: a source can exist and be prioritized without an automated scraper.

## Morning review

`/admin/review`

The private review surface runs and inspects the Morning Editorial Sweep. Approval
marks an event as editorially eligible; it never publishes the event.
