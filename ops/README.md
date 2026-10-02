# Unsattai Ops

Unsattai Ops is the back office for Unsattai staff. It covers orders, production planning,
delivery, the marketplace (sellers, products, returns, reviews, messages, cash on delivery), CRM
and quotes, settings, staff and reports. Partner sellers use the same app with a seller login
and see only their own work (the "seller portal"). It is a single-page app (React 19,
TypeScript, Vite, React Router) that talks to the Unsattai API under `/api/v1/ops/*`.
It has two runtime dependencies besides React: `react-router-dom`, and `recharts`, which is used
only by Reports and loaded only when that screen opens.

## Run it

```bash
cd ops
npm install
cp .env.example .env.local        # edit if the API is not on 127.0.0.1:8000
npm run dev                       # http://localhost:5173
```

The API must have at least one staff account. On first start, the API creates an admin from
`ADMIN_EMAIL` / `ADMIN_PASSWORD` when no staff exist yet. The password needs at least 10
characters, with upper case, lower case and a digit:

```bash
cd server
ADMIN_EMAIL=admin@example.com ADMIN_PASSWORD='Str0ngPassword' .venv/bin/uvicorn app.main:app --port 8000
```

| Script | What it does |
|---|---|
| `npm run dev` | Dev server with hot reload |
| `npm run build` | Type-checks (`tsc -b`), then builds to `dist/` |
| `npm run preview` | Serves `dist/` locally |
| `npm test` | Unit tests (vitest): error mapping, permissions and seller menu scoping, settings and seller form conversion, seller validation mapping, the service-area editor rules, quote roster parsing, formatting |
| `npm run e2e` | Browser flow against a running API and ops app (see below) |
| `npm run e2e:full` | Starts a throw-away API on :8200 with its own database, builds and serves the app on :5200, runs the flow, then stops both |

### End-to-end test

`e2e/ops-flow.mjs` uses the globally installed Playwright (`NODE_PATH=$(npm root -g)`) and the
Chromium in `PLAYWRIGHT_BROWSERS_PATH` (for example `/opt/pw-browsers`). It seeds data through the
public shop API, then works through the app as an admin, a seller and a production user
(30 steps: the original 18 plus 12 marketplace steps covering sellers, PIN tests, seller logins,
COD, products, returns, reviews, messages and the new settings). Screenshots go to
`e2e/shots/`, which is git-ignored. Environment: `API_URL`, `OPS_URL`, `ADMIN_EMAIL`,
`ADMIN_PASSWORD`. Every run uses unique names, so it can be repeated against the same database.

## Configure

All settings are read at **build time** from `VITE_*` variables (`.env`, `.env.local` or the
shell):

| Variable | Default | Meaning |
|---|---|---|
| `VITE_API_BASE_URL` | `http://127.0.0.1:8000` | API origin, with no trailing slash and no `/api/v1` |
| `VITE_API_KEY` | empty | Sent as `X-API-Key` when set. Only needed if the API sets `API_KEYS`, because design, render and shop calls such as the quote preview require it. It ends up in the browser bundle, so issue a separate key for ops. |
| `VITE_WEB_STORE_URL` | `http://127.0.0.1:3000` | Customer store origin. Quote links are `<store>/quote/<token>`. |

**Sessions.** The staff token is kept in memory and in `sessionStorage`, so it lasts for the tab.
Closing the tab signs you out, and a reload does not. Tokens expire after one day. Any 401 from an
ops endpoint clears the token and returns you to the login page with a message, and after you sign
in again you land back on the page you were on.

## Roles

Roles come from the API. The UI hides or disables what a role cannot do, and the server enforces
it too. If a request still gets a 403, the app says which permission is missing and what the
current role is.

| Role | Can do |
|---|---|
| **admin** | Everything, including Staff (create users, change roles, reset passwords, deactivate) |
| **manager** | Orders, pricing, production, delivery, CRM, all settings, reports |
| **sales** | Orders (notes, payments, priority), CRM, quotes; read everything else |
| **production** | Production board and stage updates; edit production settings; read-only elsewhere |
| **dispatch** | Shipments and labels; edit delivery settings; read-only elsewhere |
| **viewer** | Read-only everywhere |
| **seller** | A partner seller's login, tied to one seller. Sees only that seller's orders, production, delivery, returns, cash on delivery and its own profile (read-only). Every other menu is hidden; opening another screen by URL shows a short notice, and any 403 is explained |

Each settings section is writable with its own permission: price book needs `pricing`,
production needs `production`, delivery needs `delivery`, and company and CRM need `settings`.
The `settings` permission can edit every section.

## Deploy

`npm run build` produces a static site in `dist/`. Host it on any static host or CDN.

1. Set the `VITE_*` variables for the target environment **before** building. Each environment
   needs its own build.
2. Configure the host to serve `index.html` for unknown paths, because the app uses client-side
   routing. For example, nginx `try_files $uri /index.html;`, Netlify `/* /index.html 200`, or a
   rewrite rule on S3/CloudFront.
3. Serve `dist/assets/*` with long cache lifetimes (the file names are content-hashed) and
   `index.html` with `no-cache`.
4. Add the ops origin to the API's `CORS_ORIGINS`. The default `*` works, but a production API
   should list its origins.
5. Serve the app over HTTPS on its own subdomain, for example `ops.unsattai.com`.

## Screens

**Login / Account.** Email and password sign-in. Account shows your role, what it allows, and a
change-password form. The password rules are shown under the field and enforced by the server. Sign out is at the
bottom of the sidebar.

**Dashboard.** Orders and revenue for today, 7 and 30 days, and orders by status. Late orders are
listed with their promised dates. Also shows 7-day stage utilisation with the bottleneck marked,
open leads and pipeline value, open tickets, and tasks due, returns awaiting action, cash on
delivery to collect, and open orders by seller. It refreshes every minute.

**Orders.** A searchable, paged list with status filter chips, a seller filter, hold and rush
flags, the payment method, and CSV export. Order detail shows the design preview, the roster, the
pricing breakdown, payments, production stages and the timeline, plus the seller, the checkout
number with links to the other orders placed in the same checkout, any refunds and returns, and
for cash on delivery whether the cash is collected, with **Mark cash collected**.

Actions on an order:
- Record a payment (method, amount, reference).
- Add a note, marked internal or customer-visible.
- Set priority or rush.
- Put on hold or release, with a reason.
- Cancel, with a reason.
- Mark a production stage done, or undo it.
- Open a printable invoice.
- Download print files (SVG).

The Production, Delivery and Orders screens share a **seller filter**. It lives in the URL
(`?seller=`) and is kept when you move between tabs.

**Production.**
- **Plan** is a Gantt chart of every active order across the configured stages. Late orders are
  highlighted, there is a "late only" filter, and today is marked.
- **Board** is a kanban with one column per stage. **Done** on a card finishes that stage and
  moves the card to its next stage.
- **Capacity** is a heatmap of the planned load on each stage per working day against its
  capacity. Overloaded cells are red, and the bottleneck is called out.
- **Worklist** is a printable list for one stage and day (today by default).

**Delivery.**
- **Dispatch plan** groups orders by the day they should ship.
- **Ready to ship** lets you create a shipment (carrier, service, tracking number, packages) for
  each ready order.
- **Shipments** lists shipments by status. You can move one through planned → packed →
  dispatched → delivered (or returned/cancelled) and print a label.

**Marketplace.**
- **Sellers**: a list with status, a coverage summary, capacity, rating and open orders. The
  editor covers name, legal name, GSTIN, contact and address, active, garments and fabrics, the
  delivery-coverage table (PIN prefix, state code or `*`; transit days; COD), blocked PIN codes,
  capacity factor, holidays, handling days, minimum and maximum pieces and the price adjustment.
  Server validation errors are shown next to the field. The side panel has a **PIN code test**
  (serviceable, matched area, dates), the seller's logins with **Create login**, and its orders.
- **Products**: list and search; create from a brief (with a choice of four generated designs),
  from a past order or from a quote; edit title, description, sport, garment, tags; publish,
  unpublish and feature; a mock-up preview and the computed "from" price.
- **Returns**: a queue with status, seller and search filters. The drawer shows the order, items
  and history, and moves the return along (approve or reject, picked up, resolved) with a resolution
  (replacement or refund, with the refund amount) and notes.
- **Reviews**: filter by product, seller, visibility and a rating range (filtered on the server); hide (with a reason) or show.
- **Messages**: the SMS and email outbox with channel, template, recipient, status and time,
  filtered by channel, status or search.
- **Cash on delivery**: COD orders to collect and collected, by seller, with **Mark collected**.

**Seller portal.** A seller login gets a short menu: Home (its queued and in-production work),
Orders, Production, Delivery, Returns, Cash on delivery and its Seller profile. It downloads the print files for its
own orders from the order screen and picks the carrier from the list when it creates a shipment.

**CRM.**
- **Customers** and **Organisations**: lists, profiles, members, the activity feed, orders and
  lifetime value. Customers show whether the phone and email are verified, and the orders list
  shows each order's checkout and seller.
- **Leads**: a drag-and-drop pipeline board with win rate and pipeline value. Each lead has
  detail, activities and follow-up tasks.
- **Quotes**: the quote editor. Pick a customer and take the design from one of their earlier
  orders, or generate one from a brief. Paste a roster or edit the lines. The price previews
  live from `/shop/quote` and shows when it is out of date. You can apply a sales discount, save,
  send, and copy the customer link. Sending moves the lead to *quoted*.
- **Tickets**: an inbox with search and status filters. You can reply to the
  customer or add an internal note, and change status or owner.
- **Tasks**: open tasks by due date, grouped into overdue, today and upcoming, with *mark done*.
- **Reorders**: customers due for a reorder reminder, with one-click call tasks.

**Settings.** Five sections: Price book, Production, Delivery, Company and CRM. Each is a form
that checks values before saving. Server validation errors (422) are shown next to the field
they belong to. If someone else saved in the meantime (409), you can reload their version.

Each section also has a version history (the last 20 saves). You can view an old version and
load it into the editor, and nothing changes until you save.
The price book has a **Try it** panel that prices a sample order against your unsaved changes,
including a cash-on-delivery example. Marketplace settings: the price book has **Cash on
delivery** (on or off, fee per checkout, largest order total) and each coupon can be **public**
with a title shown in the offers list; CRM lists has **Returns** (the return window in days and
the returnable reasons).
Sections your role can't edit are shown read-only.

**Staff** (admin only). Add staff with a role, change roles, reset passwords, and deactivate or
reactivate accounts. A seller login is created with the seller role and a seller.

**Reports.**
- **Sales**: revenue, orders and pieces per day over a date range, as a chart or a table, with
  breakdowns by garment and channel.
- **Audit log**: every staff, customer and system change, filtered by subject (exact match, with quick chips for the settings sections).

## Layout

```
src/lib/          API client, auth, permissions, error mapping, settings form converters, formatting
src/components/   UI kit (tables, dialogs, toasts, badges), layout, domain widgets
src/pages/        one folder per area
test/             vitest unit tests (+ fixtures/defaults.json, a copy of the server's default settings)
e2e/              Playwright flow and the run script
```

Anything the app would like changed in the API is listed in `BACKEND_REQUESTS.md`.
