# UrJersey web store

The customer web store for UrJersey custom sportswear (jerseys, V-necks, shorts), built with
Next.js (App Router), React 19, strict TypeScript and CSS modules. It talks to the UrJersey
API in `../server` through its own server-side proxy, so the API key and the customer's
session token never reach the browser.

## Run it

```bash
cp .env.example .env.local      # set UJ_API_URL (and UJ_API_KEY if the API sets API_KEYS)
npm install                     # .npmrc sets legacy-peer-deps
npm run dev                     # http://localhost:3000
npm run build && npm start      # production (PORT=3000 by default)
```

| Variable | Default | What it is |
| --- | --- | --- |
| `UJ_API_URL` | `http://127.0.0.1:8000` | Where the API listens. Only the web server calls it. |
| `UJ_API_KEY` | – | Channel key sent as `X-API-Key` by the proxy. Server-side only. |
| `NEXT_PUBLIC_SITE_URL` | `http://localhost:3000` | Public address, for metadata, sitemap and share links. |

## Checks

```bash
npm run typecheck   # tsc --noEmit (strict)
npm run lint        # eslint (next core-web-vitals + typescript)
npm test            # vitest: roster parsing, prices, undo history, proxy headers, order payloads, translations
npm run e2e         # Playwright walk-through (needs the app and an API running, see below)
```

### End-to-end test

`e2e/store-flow.mjs` uses the globally installed Playwright (`NODE_PATH=$(npm root -g)`)
and Chromium from `PLAYWRIGHT_BROWSERS_PATH`. Run an API with its own database and the store
against it:

```bash
cd ../server && DB_PATH=/tmp/uj-web-e2e.db DESIGN_PROVIDER=rule AI_EDITS=off \
  ADMIN_EMAIL=admin@urjersey.test ADMIN_PASSWORD='Adm1nPassword!' .venv/bin/uvicorn app.main:app --port 8100 &
cd ../web && npm run build && UJ_API_URL=http://127.0.0.1:8100 npx next start -p 3100 &
npm run e2e        # WEB_URL / API_URL / ADMIN_EMAIL / ADMIN_PASSWORD can be overridden
```

It covers the landing page and language switch, the bulk enquiry, brief → confirm (conflict
and sport questions) → four designs, rating, more designs → studio (drag, undo/redo,
keyboard, styles, checks, 3D, PNG and share link, save with OTP sign-in) → checkout (team
roster, paste, CSV, duplicates, size chart, bulk nudge above 50 pieces, fabric, express
dates, coupon, address, live price) → order (idempotent replay) → demo payment →
confirmation and invoice → account (orders, detail, order again, profile and addresses,
saved designs, support ticket and reply) → team collection (organiser link, two players on
the public page, taken numbers, edit via stored key, dashboard remove/lock/reopen/checkout)
→ a sales quote made through the ops API and accepted on the web → guest flow on a phone
viewport (shared link, pickup, tracking) → design from a picture → 404. Screenshots are
written to `e2e/shots/`, and every screenshotted screen is checked for horizontal overflow.

## How it fits together

- **Proxy** `src/app/api/uj/[...path]/route.ts` (helpers in `src/lib/proxy.ts`): forwards
  `/api/uj/*` to `${UJ_API_URL}/api/v1/*`, adds `X-API-Key`, turns the httpOnly `uj_session`
  cookie into `Authorization: Bearer`, passes `X-Device-Id` (minting an httpOnly `uj_device`
  cookie when missing), and streams status, body and content type back. Staff endpoints
  (`ops/`, `stats`, `dataset/`, `factory/`) and `auth/otp/verify` are not reachable, writes
  from other origins are refused, and HTML/SVG responses (invoices) get a locked-down CSP.
- **Session** `src/app/api/session/verify` verifies the OTP with the API and sets the cookie;
  `…/logout` revokes the token and clears it. The browser never sees the token.
- **State** `src/lib/flow.ts`: the whole journey (brief, answers, designs, studio history,
  checkout draft) in one small store, saved to IndexedDB so a refresh or a sign-in never
  loses work. The order idempotency key is kept with the draft: the same order retried
  reuses it, a changed order gets a new one.
- **Prices** always come from `POST /shop/quote` (debounced, superseded requests aborted);
  the web app only formats them (`src/lib/price.ts`).
- **Text** `src/i18n`: the mobile app's dictionaries (`app/`, copied, not imported) plus
  web-only strings (`web/`) in English, Hindi, Telugu and Tamil. A unit test checks every
  key and placeholder exists in all four languages.
- Server SVG (mock-ups, panels, logo ideas) is always drawn through `<img src="data:…">`,
  never inserted as markup.

## Pages

| Path | What |
| --- | --- |
| `/` | Landing: how it works, garments with "from" prices, quantity tiers, team orders, bulk enquiry, contact |
| `/design`, `/design/confirm`, `/design/designs` | Brief → confirm → four designs (+ more, ratings) |
| `/design/picture` | Design from a picture: prompt builder, upload, three interpretations |
| `/studio` | Editor: panels, layers, undo/redo, Style/Text/Logos/Ask/Checks/Share, 3D, save, team link |
| `/checkout` | Single or team roster, fabric, express, coupon, ship/pickup, live price, sign-in or guest |
| `/order/[id]/pay`, `/order/[id]` | Demo payment, confirmation with promised date and invoice |
| `/account…` | Orders and detail (timeline, progress, reorder), profile and addresses, saved designs, support, team lists |
| `/teams`, `/t/[token]` | Team orders explainer; public player page |
| `/quote/[token]` | Sales quote: lines, pricing, validity, accept |
| `/track` | Guest tracking with order ID and phone |
| `/enquiry` | Bulk enquiry |
| `/d/[id]` | Shared design, open a copy in your studio |

Backend gaps and their workarounds are listed in `BACKEND_REQUESTS.md`.
