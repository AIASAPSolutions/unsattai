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
npm test            # vitest: roster parsing, prices, undo history, proxy allow-list and headers, order and checkout
                    # payloads, PIN code choice, cart add/merge, sign-in input, translations
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

It covers (37 steps) the landing page and language switch, the bulk enquiry, an ops-API setup
(a second seller serving Chennai `600…` and a PIN code blocked for the house seller), the
"Deliver to" PIN code (invalid, not serviceable, remembered), shop search, facets, sort and
paging, a product page (delivery date, other sellers, choosing a seller, size, add to cart,
an unserviceable PIN code), brief → confirm → four designs → studio (drag, undo/redo,
keyboard, styles, checks, 3D, PNG and share link, save with OTP sign-in, which merges the
guest cart) → configure (team roster, paste, CSV, duplicates, size chart, bulk nudge, fabric,
delivery date and seller) → cart with a ready-made item and a custom design from two sellers
(one delivery charge per seller) → checkout (address, dates by seller, express, WELCOME10
from "Available offers") → online payment and confirmation with one order per item and an
invoice → idempotent replay → account (orders, order again, profile, saved designs,
support) → wishlist → cash on delivery with the fee, then cancel → an order moved through
production, shipped, dispatched and delivered through the ops API, then tracked, returned
and reviewed → notifications bell → password set, password sign-in on another device and
signing that device out → email sign-in, verifying a mobile number, password lockout → team
collection (organiser link, players, dashboard, Buy now for the team list) → sales quote →
guest on a phone viewport (shared link, configure, Buy now with pickup, checkout
confirmation, tracking, shop, product and cart) → design from a picture → 404. Screenshots
are written to `e2e/shots/`, and every screenshotted screen is checked for horizontal overflow.

## How it fits together

- **Proxy** `src/app/api/uj/[...path]/route.ts` (helpers in `src/lib/proxy.ts`): forwards
  `/api/uj/*` to `${UJ_API_URL}/api/v1/*`, adds `X-API-Key`, turns the httpOnly `uj_session`
  cookie into `Authorization: Bearer`, passes `X-Device-Id` (minting an httpOnly `uj_device`
  cookie when missing), and streams status, body and content type back. Staff endpoints
  (`ops/`, `stats`, `dataset/`, `factory/`, print files) and `auth/otp/verify`, `auth/login`,
  `auth/logout` are not reachable; everything else must match the explicit allow-list
  `ALLOWED` in `src/lib/proxy.ts` (customer, shop, cart, checkout and `me/…` routes). Writes
  from other origins are refused, the browser's User-Agent is passed on (it labels the
  device in "Signed-in devices"), and HTML/SVG responses (invoices) get a locked-down CSP.
- **Session** `src/app/api/session/verify` (one-time code, mobile or email) and
  `src/app/api/session/login` (password) sign in with the API and set the httpOnly cookie
  (`src/lib/server/session.ts`); `…/logout` revokes the token and clears it. The browser
  never sees the token.
- **Shop state** `src/lib/shopStore.ts`: the cart (on the device for guests, `GET/PUT /me/cart`
  when signed in, merged with `POST /me/cart/merge` on sign-in by `ShopSync`), the Buy now
  item, the checkout draft, the wishlist and the "Deliver to" PIN code (the device's choice,
  else the account's default address; `src/lib/pincode.ts`). Serviceability answers are
  cached for five minutes (`src/components/providers/shop.tsx`). Cart and checkout prices
  come from `POST /shop/cart/quote` (`src/lib/useCartQuote.ts`); `src/lib/checkout.ts` builds
  the `POST /checkout` payload, groups items by seller and reads per-item errors.
- **State** `src/lib/flow.ts`: the whole journey (brief, answers, designs, studio history,
  checkout draft) in one small store, saved to IndexedDB so a refresh or a sign-in never
  loses work. The order idempotency key is kept with the draft: the same order retried
  reuses it, a changed order gets a new one.
- **Prices** always come from the API (`POST /shop/cart/quote`, `POST /shop/quote`) (debounced, superseded requests aborted);
  the web app only formats them (`src/lib/price.ts`).
- **Text** `src/i18n`: the mobile app's dictionaries (`app/`, copied, not imported) plus
  web-only strings (`web/`) and marketplace strings (`market/`) in English, Hindi, Telugu and Tamil. A unit test checks every
  key and placeholder exists in all four languages.
- Server SVG (mock-ups, panels, logo ideas) is always drawn through `<img src="data:…">`,
  never inserted as markup.

## Pages

| Path | What |
| --- | --- |
| `/` | Landing: how it works, ready-made designs with delivery dates, garments with "from" prices, quantity tiers, team orders, bulk enquiry |
| `/shop` | Search (header box), facets (sport, garment, colour, price), sort, paging, wishlist hearts, delivery date per design |
| `/shop/[slug]` | Product: mock-up, price from, rating and reviews, size, quantity, fabric, delivery date and seller for the PIN code, other sellers, Add to cart, Buy now, Customise |
| `/design`, `/design/confirm`, `/design/designs` | Brief → confirm → four designs (+ more, ratings) |
| `/design/picture` | Design from a picture: prompt builder, upload, three interpretations |
| `/studio` | Editor: panels, layers, undo/redo, Style/Text/Logos/Ask/Checks/Share, 3D, save, team link |
| `/configure` | Custom design: single or team roster, fabric, live price, delivery date and seller, Add to cart / Buy now |
| `/cart` | Items with seller and delivery date, quantities, edit design, move to wishlist, totals (one delivery charge per seller), offers |
| `/checkout` | Sign in or guest, address book, items and dates by seller, express, offers, online or cash on delivery (`?buy=1` for Buy now) |
| `/checkout/[id]/pay`, `/checkout/[id]` | Demo payment; confirmation with the orders by seller and invoices |
| `/order/[id]/pay`, `/order/[id]` | Team list orders and sales quotes: demo payment, confirmation |
| `/account…` | Orders and detail (timeline, shipment and tracking, cancel, return, review, buy again, invoice), wishlist, notifications, login and security (password, mobile and email, signed-in devices), profile and addresses, saved designs, support, team lists |
| `/signin` | Mobile or email, one-time code or password, "Forgot password? Sign in with a code" |
| `/teams`, `/t/[token]` | Team orders explainer; public player page |
| `/quote/[token]` | Sales quote: lines, pricing, validity, accept |
| `/track` | Guest tracking with order ID and phone |
| `/enquiry` | Bulk enquiry |
| `/d/[id]` | Shared design, open a copy in your studio |

The header has the search box and the "Deliver to" PIN code chip, the notifications bell
with the unread count, and the cart count.

Backend gaps and their workarounds are listed in `BACKEND_REQUESTS.md`.
