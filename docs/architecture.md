# UrJersey architecture review

A decision document for the business owner and the engineering team that will take UrJersey to production.

**Scope.** UrJersey is meant to become a production platform: customer mobile app, customer web store, AI design generation, CRM, order management, payment, inventory, a production partner app, shipping and notifications. This review covers the single-server architecture as it stands on branch `main` (September 2026). It then sets out what should change, in what order and where in the code.

**How to read it.** Sections 1 to 11 each say where things are today, what changes and in what order. Section 12 lists what stays on the server and what moves out from day one. Sections 13 and 14 give the MVP and scale-up architectures, and section 15 is the phased checklist.

**Conventions.**

- **Today** marks a description of the current code. Each one was checked against the source; file paths are given.
- **Recommendation** marks advice, not something that exists.
- Prices are rough ranges as of late 2026. They change often, so confirm them with each provider before committing.

---

## Summary of decisions

| Topic | Decision |
|---|---|
| Database at launch | **Start production on managed PostgreSQL.** Do not take real money on SQLite. The port is contained (all SQL is in two files), and it is far cheaper to do before live payments than after. |
| Server shape at MVP | One application VM running API, web store, operations app, and a **separate worker process**. Everything stateful or security-critical lives off the VM. |
| Externalized from day one | Payment gateway (Razorpay), SMS/email providers, managed Postgres with point-in-time recovery, object storage (Cloudflare R2), off-site backups, error tracking (Sentry), uptime monitoring, DNS/CDN (Cloudflare), the Claude API. |
| Background work | A Postgres-backed jobs table plus a transactional outbox. No Redis at MVP. |
| Payments | Hosted checkout. The server prices the order; a signed webhook is the only thing that marks it paid. Demo payment is switched off in production. |
| Orders | An explicit state machine with separate payment and fulfilment states, optimistic locking and an append-only event log. |
| Biggest blocker found | The customer-facing demo-payment endpoints work in production today, so a customer could mark their own order paid (section 5). **Fixed:** demo payment is now off when `APP_ENV=production` unless `DEMO_PAYMENTS=1`. |

---

## 1. The current single-server architecture

### What exists today

```
                        Internet (HTTPS)
                              │
                    ┌─────────▼──────────┐   one VM, docker compose (deploy/docker-compose.yml)
                    │  Caddy (TLS, gzip) │   deploy/Caddyfile
                    └──┬───────┬──────┬──┘
          shop domain  │       │      │ ops domain (static files)
                ┌──────▼───┐   │   ┌──▼──────────────┐
                │ web      │   │   │ ops (React SPA) │  staff + seller logins
                │ Next.js  │   │   └─────────────────┘
                │ proxy    │   │ api domain (mobile app, ops)
                └────┬─────┘   │
                     │ http://api:8000 (private network)
                ┌────▼─────────▼─────────────────────────────────────┐
                │ api: FastAPI, ONE uvicorn process (server/Dockerfile)│
                │  engine/  providers/  ai_edit.py  from_image.py      │
                │  orders.py  platform/* (lifecycle, commerce, crm,    │
                │  planning, pricing, sellers, notify, security)       │
                │         │ sync HTTP calls inside the request:        │
                │         ├─► Claude API (generate, edit, vision)      │
                │         ├─► SMS / email providers (notify.py)        │
                │         └─► FACTORY_URL or TEST queue (orders.py)    │
                │  SQLite file on a volume: /data/urjersey.db          │
                └──────────────────────────────────────────────────────┘
       cron: deploy/backup.sh (daily, 14 copies on the same disk; rclone to R2 documented, not scripted)
```

Verified facts:

| Area | Today | Where |
|---|---|---|
| Process model | One uvicorn process with no `--workers`. Sync route handlers run in FastAPI's thread pool. | `server/Dockerfile` |
| Database | One SQLite file. `Store` opens a new connection per call and commits on exit. No WAL pragma is set, so SQLite uses its default rollback journal. | `server/app/store.py` |
| Design data | `generations` and `designs` tables. Every generation is logged as training data for a future in-house model. | `store.py`, `GET /api/v1/dataset/export` in `main.py` |
| Orders | An `orders` table holding the whole order as `order_json`, plus `factory_jobs`, `device_orders`, `ai_usage`, `ai_calls` and `ai_cache`. | `store.py` |
| Platform data | `settings` and `settings_history` (versioned, with optimistic locking), `staff`, `sessions`, `otps`, `counters`, `audit`, and one generic `records` table keyed by `(kind, id)`. That table has indexed `status/owner/parent/ref/search` columns and a JSON `data` column. About 20 record kinds are listed at the top of the file. | `server/app/platform/db.py` |
| Order search | `order_index` records are a denormalised copy of each order, rewritten on every change. | `lifecycle.index_order` |
| Customer auth | Phone or email OTP, with an optional password. Tokens are random and stored as SHA-256. Passwords use PBKDF2-SHA256 with 240k rounds. Five wrong passwords lock the account for 15 minutes. | `platform/security.py` |
| Staff auth | Email and password. Roles are `admin, manager, sales, production, dispatch, viewer, seller`, with coarse permissions. A `seller` login is scoped to its own `seller_id`. Staff sessions last 1 day. There is no 2FA. | `platform/security.py` |
| Order states | `order["status"]` records payment and factory hand-off (`awaiting_payment`, `released_to_factory`, `released_to_test_queue`, `paid_release_failed`). `order["fulfilment"]["status"]` holds `awaiting_payment → queued → in_production → ready → dispatched → delivered`, plus `cancelled`. Hold is a flag. | `orders.py`, `platform/lifecycle.py` |
| Payment | Demo payment, cash on delivery, or staff recording cash/UPI/bank transfer. `confirm_payment` refuses anything with `demo=False`. There is no gateway and no webhook. | `orders.confirm_payment`, `POST /api/v1/orders/{id}/payment-confirmed`, `POST /checkouts/{id}/pay`, `POST /ops/orders/{id}/payments` |
| Refunds | Recorded, never sent. The note says to refund by hand. | `lifecycle._record_refund` |
| Factory hand-off | Synchronous `httpx.post` to `FACTORY_URL/jobs` (20 s timeout) inside payment confirmation. Without it, a `TEST-…` receipt is written. | `orders._send_to_factory` |
| Print files | Rendered as SVG on every request, never stored. | `orders.production_file`, `/ops/orders/{id}/print-files/{name}` |
| Logos | Base64 data URLs (up to 4, each up to 1.5 MB) embedded in the design spec. They are stored inside `designs.spec_json` and `orders.order_json`. | `schemas.py` (`MAX_LOGO_BYTES`, `MAX_LOGOS`) |
| AI | Claude calls are synchronous inside the request: design generation (`providers/claude.py`, `max_tokens=16000`), "Ask" edits (`ai_edit.py`) and picture recognition (`from_image.py`). Cost controls: a result cache, a per-device daily allowance, a per-minute limit and a global `AI_DAILY_BUDGET`. | `ai_edit.py`, `config.py` |
| Notifications | SMS (MSG91, Twilio, webhook) and email (SMTP, Resend, webhook) are sent synchronously. The `message` records are a **log of attempts**, written after sending, and are never retried. | `platform/notify.py` |
| Planner | Finite-capacity forward scheduler per seller. It loads **every order's full JSON** (`store.all_orders()`) on each plan or promise. | `platform/planning.py` |
| Web store | Next.js proxies an allow-list of API paths from its own server. The session sits in an httpOnly cookie, and the token never reaches browser JavaScript. | `web/src/lib/proxy.ts` |
| Ops app | React SPA. The staff token is kept in `sessionStorage`. | `ops/src/lib/api.ts` |
| Mobile app | Expo. The token is kept in SecureStore (Keychain/Keystore). | `app/src/api/session.ts` |
| Backups | `sqlite3.backup()` online copy, gzipped, 14 kept in `deploy/backups/` on the same server. Off-site copy with rclone is described in `docs/deploy.md` but is only a comment in `backup.sh`. `restore.sh` checks integrity and saves the current database first. | `deploy/backup.sh`, `deploy/restore.sh` |
| Monitoring | `GET /api/v1/health` reports configuration (providers, messaging) but does not query the database. Logs are plain text via `logging.basicConfig`. There is no error tracking or metrics. | `main.py` |
| Missing modules | Inventory, real shipping integration (carriers are configured by hand with tracking URL templates), a partner app separate from ops, and a payment gateway. | none |

### Strengths

- **Clean domain logic.** Pricing, planning, lifecycle, sellers and CRM are separate modules with clear docstrings. All SQL lives in two files (`store.py`, `platform/db.py`), and the other roughly 280 call sites use a small store API (`put/get/find/save_order/audit…`). That keeps the Postgres port contained.
- **Idempotency is already a habit.** Orders and checkouts take an idempotency key with a request hash, and the concurrent-retry race is handled (`Store.create_order`). Factory release is deduplicated through `factory_jobs.order_id UNIQUE`.
- **Careful security basics.** Tokens are hashed, passwords are hashed with PBKDF2, and OTP attempts, resends and password lockout are limited. The web proxy uses an allow-list, and order and checkout lookups return 404 rather than 403, so ids can't be probed. `OTP_DEV_ECHO` is forced off when `APP_ENV=production`.
- **A deterministic design engine.** Print sheets can be re-rendered exactly from the spec, which reduces the need to store print files, though it does not remove it (section 3).
- **Cheap and simple to run.** One `docker compose up`, automatic HTTPS and documented restore. That is the right shape for a pilot.

### Limits

| Limit | Why it matters in production |
|---|---|
| SQLite and a single process | No second API instance, no zero-downtime deploy and no managed failover. A disk loss costs up to 24 h of orders (daily backup). |
| Read-modify-write of whole order JSON with no version check | `get_order → mutate → save_order` in `lifecycle.py` and `orders.py`. A payment webhook and a staff action on the same order can silently overwrite each other. Settings already have `expected_version`; orders do not. |
| Slow external calls inside requests | A Claude generation (16k tokens), a 10 s SMS timeout or a 20 s factory call each hold a thread-pool thread. A few slow providers can make the whole API unresponsive. |
| Payment and fulfilment mixed in `order["status"]` | `paid_release_failed` means "money taken, factory failed". It is visible only as a status. Staff can't re-release through `/ops/orders/{id}/payments` because that route returns 409 once `payment` is set. This needs checking with a test; it appears to leave such orders stuck. |
| Large binary data in rows | Logos as base64 inside every order and design row make the database, backups and `all_orders()` scans grow fast. |
| Whole-table scans | The planner, `sellers._adopt_old_orders`, and several ops reports call `find("order_index", limit=100000)` or `all_orders()`. This is fine at hundreds of orders and slow at tens of thousands. |
| Messages sent before being recorded | If the process dies between the send and the write, there is no record. If the provider is down, the message is lost; there is no retry. |

---

## 2. SQLite to PostgreSQL

### Code that touches the database today

| File | What it owns | SQLite-specific constructs to port |
|---|---|---|
| `server/app/store.py` (`Store`) | generations, designs, orders, factory_jobs, ai_usage, ai_calls, ai_cache, device_orders | `?` placeholders, `INSERT OR IGNORE/REPLACE`, `json_extract` in `device_paid_orders`, `executescript`, `sqlite3.IntegrityError`, a connection per call |
| `server/app/platform/db.py` (`PlatformStore(Store)`) | settings, staff, sessions, otps, records, counters, audit | `PRAGMA table_info`-based migration, `randomblob`, `AUTOINCREMENT`, `LIKE` search, `INSERT … ON CONFLICT` (portable) |
| All other modules (`lifecycle`, `commerce`, `crm`, `sellers`, `catalog`, `planning`, `accounts`, `notify`, `security`, `config`, `api_*.py`, `main.py`, `orders.py`) | business logic | None directly. They call `store.put/get/find/...` about 280 times. |
| `server/tests/*` | tests use a temporary SQLite path | These need a Postgres fixture (testcontainers or a CI service). |

### Target schema (recommendation)

Turn the generic `records` table into real tables. Keep `jsonb` for data that is naturally a document and is never filtered on individually.

| Table | Key columns | `jsonb` columns | Replaces |
|---|---|---|---|
| `customers` | id, phone (unique, verified flag), email (unique where verified), name, status, organisation_id, owner_staff_id, marketing_opt_in, created_at | `profile` (tags, notes) | `records kind=customer`, `email_index`, `customer_secret` (the hash moves to a `customer_credentials` table) |
| `customer_addresses` | id, customer_id, pincode, state, city, is_default | `lines` | addresses inside the customer JSON |
| `staff_users` | id, email, role, active, password_hash, totp_secret_enc, last_login_at | `profile` | `staff` |
| `partners` | id, name, status, gstin, capacity_factor, cod_enabled | `service_areas`, `production_overrides` | `records kind=seller` |
| `partner_users` | id, partner_id, email, role (`partner_admin`, `partner_operator`), password_hash, totp | none | `staff` rows with `role=seller` |
| `sessions`, `otps` | as today, plus `ip`, `user_agent_hash` | none | same tables |
| `settings`, `settings_history` | as today | `value` | same tables |
| `generations`, `designs` | as today, plus customer_id, device_id | `request`, `spec`, `original_spec` (logos become file ids, section 3) | same tables |
| `checkouts` | id, number, customer_id, idempotency_key (unique), request_hash, payment_method, status, total_paise, currency | `totals` | `records kind=checkout` |
| `orders` | id, number (unique), checkout_id, customer_id, partner_id, **payment_state**, **fulfilment_state**, release_state, hold, rush, total_paise, currency, promised_ship_date, promised_delivery_date, **version**, idempotency_key (unique), request_hash | `spec_snapshot`, `pricing_snapshot`, `delivery_snapshot`, `checks` | `orders.order_json` and `order_index` (the search copy disappears; use indexes) |
| `order_lines` | order_id, line_no, size, quantity, player_name, number, unit_price_paise | none | `order["lines"]` |
| `order_events` | id, order_id, at, actor, code, public, from_state, to_state | `params` | `order["events"]` |
| `stage_progress` | order_id, stage_id, done_at, done_by | none | `fulfilment["stages"]` |
| `payments` | id, order_or_checkout_id, provider, provider_order_id, provider_payment_id (unique), method, status, amount_paise | `raw_last` | `order["payment"]` |
| `payment_events` (webhook inbox) | provider, event_id (unique), received_at, signature_ok, processed_at, error | `payload` | new |
| `refunds` | id, payment_id, amount_paise, provider_refund_id, status, reason, requested_by | none | `order["refunds"]` |
| `shipments`, `shipment_events` | id, order_id, partner_id, courier, awb (unique), status, label_file_id | `address_snapshot`, `raw` | `records kind=shipment` |
| `returns`, `reviews`, `products`, `quotes`, `leads`, `organisations`, `activities`, `tickets`, `collections`, `collection_entries`, `wishlists`, `carts` | real columns for everything filtered or sorted | small `jsonb` for the rest | matching `records` kinds |
| `notifications`, `messages` | id, customer_id, order_id, channel, status, attempts, provider_message_id | none | `records kind=notification/message` |
| `files` | id, bucket, key, kind, owner, sha256, bytes, content_type, created_at | none | new (section 3) |
| `jobs`, `outbox` | section 4 | `payload` | new |
| `ai_usage`, `ai_calls`, `ai_cache` | as today | `result` | same tables |
| `audit_log` | id bigserial, at, actor_kind, actor_id, action, subject, ip, request_id | `detail` | `audit` |
| Inventory tables | section 16 | none | new |

Design rules (recommendations):

- **Store money as integer paise** (`bigint`). Today prices are floats rounded to 2 decimals (`round(..., 2)` in `lifecycle.py` and `pricing.py`). The gateways also work in paise.
- **Use `timestamptz` for times.** Today they are ISO strings compared as text.
- **Add a `version integer` column to `orders`, `checkouts`, `shipments` and `returns`**, and update with `WHERE id=$1 AND version=$2` (optimistic locking).
- **Replace number counters with Postgres sequences.** Order numbers stay `PREFIX-00001`.
- **Search** uses `pg_trgm` GIN indexes on name, phone, email and order number, instead of the `search LIKE '%q%'` column.
- **Keep the store API as a seam.** Introduce `server/app/db/` using SQLAlchemy Core (not the ORM) and psycopg 3 with a connection pool. Re-implement `Store`/`PlatformStore` methods on top of it first, so the business logic keeps working. Then move modules to typed repositories one at a time (`orders_repo.py`, `customers_repo.py`, …).

### Migration tool

**Recommendation: Alembic**, in `server/alembic/` with `server/alembic.ini`.

- Migration 0001 creates the full target schema.
- Migrations run as a one-off step during deploy (`alembic upgrade head` in a release container), never at API start-up.
- Retire the start-up `CREATE TABLE IF NOT EXISTS` and `_migrate_sessions` code paths once Postgres is live.

### Data migration script plan

The script goes in `server/scripts/sqlite_to_postgres.py` (recommendation).

1. **Read** the SQLite file read-only, through the existing `Store`/`PlatformStore` classes, so the JSON is parsed the same way the app parses it.
2. **Transform** each kind into the new tables:
   - order JSON is split into `orders`, `order_lines`, `order_events`, `stage_progress`, `payments` and `refunds`;
   - `order["status"]` and `fulfilment.status` are mapped to the new states (see section 6's mapping table);
   - logos are extracted from specs, uploaded to object storage, and replaced by file ids (section 3);
   - floats become paise;
   - seller staff rows become `partner_users`.
3. **Load** with `COPY` or batched inserts in one transaction per table group. Then set sequences to `max(number)+1`.
4. **Verify** automatically. The script fails loudly if any check fails:
   - row counts per kind and per status;
   - sums of order totals and of refunds;
   - every order's `payment_state` and `fulfilment_state` matches the mapping;
   - a random 5% of orders are re-rendered to JSON through the new repositories and compared field by field with the SQLite JSON;
   - the SHA-256 of every uploaded logo matches the original.
5. **Idempotent and re-runnable.** It truncates the target and reloads, so it can be run many times against copies.

### Dual-run

A recommendation, sized for this system. Dual-writing to both databases is more complexity than the order volume justifies. Instead:

- Run a **staging environment on Postgres** and load it nightly from a copy of the production SQLite backup with the migration script.
- Run a **replay/compare suite**: the existing test suites plus a script that calls about 30 read endpoints (order views, ops lists, plan, quotes) on both the SQLite production copy and the Postgres staging copy, then diffs the JSON responses after normalising ids and timestamps.
- Keep the migration script in CI and run it on every change to schema or repositories.

### Cut-over (if production already has real data)

1. Announce a maintenance window of 30 to 60 minutes at the quietest hour.
2. Turn on maintenance mode: Caddy returns 503 with a friendly page for write routes, and the web store shows a banner.
3. Run `deploy/backup.sh` and copy the file off the server.
4. Run the migration script against production Postgres. Verification must pass.
5. Deploy the Postgres build with `DATABASE_URL` set. Smoke test: sign in, place a COD order, pay with a test key, open ops, and check the plan.
6. Reopen. Watch error rates and business alerts for 2 hours.

### Rollback

- Keep the SQLite file and the old image tag unchanged.
- **Before reopening:** roll back by redeploying the old tag against the untouched SQLite file. Nothing is lost.
- **After reopening:** new orders exist only in Postgres. Set a go/no-go deadline (for example 24 h). Before it, a small reverse-export script for orders, payments and customers created after the cut-over allows rollback. After it, fix forward.

If the cut-over happens **before launch** (recommended), none of this ceremony is needed: migrate the pilot data once and start.

### Managed Postgres choices (India region preferred for latency)

| Option | Fits | Notes (confirm prices) |
|---|---|---|
| **DigitalOcean Managed PostgreSQL, Bangalore** | MVP | Simple, daily backups plus PITR (about 7 days), standby node optional. Roughly $15–30/month for a small node, about double with a standby. |
| **AWS RDS for PostgreSQL, Mumbai** (or Aurora) | MVP to scale-up | Multi-AZ, PITR up to 35 days, read replicas. db.t4g.small single-AZ is roughly $30–50/month with storage; Multi-AZ about double. The natural home if you move to AWS later. |
| **Neon / Supabase** (India region availability varies) | MVP | Cheap, branching for staging, PITR on paid plans. Check region and connection limits. |
| Self-hosted Postgres on the same VM | Not recommended | You would own PITR, upgrades and failover. That removes the main reason for moving. |

**Recommendation:** DigitalOcean Bangalore if the app VM is on DigitalOcean; RDS Mumbai if you expect to be on AWS within a year. In both cases turn on PITR from day one.

---

## 3. Object storage

### Today

- Logos travel as base64 data URLs inside the design spec and are stored inside `designs.spec_json` and `orders.order_json`.
- Uploaded pictures for "from image" are processed in memory, and the result is cached by key in `ai_cache`.
- Print files, mockups and invoices (`lifecycle.invoice_html`) are generated per request and not stored.
- Backups sit on the same disk.

### What changes (recommendation)

Use **Cloudflare R2** (S3-compatible, no egress fees, free tier) or S3 Mumbai, with separate buckets:

| Bucket | Contents | Access | Retention |
|---|---|---|---|
| `uj-uploads` | customer logos, reference pictures | private. Uploads through presigned PUT URLs (5-minute expiry, content-type and size bound); reads through presigned GET URLs (15 min) | while the design or order exists, plus the legal retention period |
| `uj-production` | frozen print files (SVG, and PDF later) per order line and panel, shipping labels | private. Partners get presigned GET URLs issued only after a scoped permission check | at least 3 years (disputes, reprints) |
| `uj-documents` | tax invoices (PDF), credit notes | private. Presigned GET for the customer or staff | at least 8 years (GST record keeping; confirm with your accountant) |
| `uj-backups` | database dumps, config snapshots | write-only credentials on the server; object lock or versioning on | 35 days daily, 12 monthly |
| `uj-public` (via CDN) | product images, marketing assets | public through Cloudflare CDN | as needed |

Rules:

- **The database stores only metadata** in a `files` row: bucket, key, sha256, bytes, content type, owner and kind. Specs reference logos as `file:<id>`, not data URLs. The renderer resolves file ids to bytes through a small cache when it draws.
- **Freeze print files when an order is paid.** Rendering is deterministic, but the engine code changes over time (`engine/` is being edited right now). The file a factory printed must be the file you can show in a dispute. The worker renders all files after payment (section 4), stores them, and records their hashes on the order.
- **Freeze invoices as PDF** when issued. A tax invoice must not change if the template does.
- **Validate uploads server-side** after upload: MIME sniffing, pixel limits (`background.py` already caps at 4096²), strip EXIF, and run an optional malware scan.
- **Turn on bucket versioning** for `uj-production` and `uj-documents`, and object lock for `uj-backups`.

Code changes:

- A new `server/app/files.py` handles presign, verify and fetch.
- `schemas.py` accepts `file:` references alongside data URLs during the transition.
- `engine/renderer.py` needs a logo resolver.
- `orders.production_file` reads the frozen file when one exists.

---

## 4. Background and async jobs

### Today

Everything runs inside the HTTP request:

| Work | Where | Typical duration |
|---|---|---|
| AI generation (Claude, up to 16k output tokens) | `service.generate` → `providers/claude.py` | seconds to tens of seconds |
| AI edit (Haiku) | `ai_edit.refine_with_ai` | 1–5 s |
| Picture recognition (vision) | `from_image.from_image` | 2–10 s |
| Print file rendering | `orders.production_file`, on each download | CPU, under 1 s per panel |
| Notifications | `notify.order_event` → `send_sms` / `send_email` | up to 10 s timeout each |
| Factory hand-off | `orders._send_to_factory` | up to 20 s timeout |

### Queue choice

**Recommendation: a Postgres-backed jobs table with `SELECT … FOR UPDATE SKIP LOCKED`, in the same database, plus a transactional outbox.**

Reasons:

- it adds no infrastructure;
- a job can be enqueued **in the same transaction** as the order change that caused it, so a crash can never lose it;
- it gives enough throughput for thousands of jobs per minute, far above the need.

Implement it as a small in-house module (`server/app/jobs/`, about 200 lines), or adopt **Procrastinate**, which does the same thing on Postgres, if the team prefers a library.

Alternatives:

- **RQ/Celery with Redis:** consider it only if job volume or scheduling needs outgrow Postgres. It adds a stateful service and loses transactional enqueue.
- **A cloud queue (SQS, Cloud Tasks):** a scale-up option, fed from the outbox table by a relay.

Suggested `jobs` table: `id, kind, payload jsonb, status (queued|running|succeeded|failed|dead), attempts, max_attempts, run_after, locked_by, locked_until, idempotency_key unique, last_error, created_at, finished_at`.

Worker: `python -m app.worker` as its own container in compose, with the same image as the API. It runs N threads per kind group: `ai` limited to 2–4 concurrent, `render`, `notify`, `integrations`.

### Job kinds

| Job | Trigger | Idempotency key | Retries |
|---|---|---|---|
| `ai.generate` | `POST /designs/generate` returns `202 {job_id}` | client request id | 2, then fall back to the rule provider (as `service.generate` already does) |
| `ai.edit` | refine when the rules did not understand | the existing `_cache_key` | 1 |
| `ai.from_image` | upload completes | image sha256 plus options | 1 |
| `render.print_files` | order paid | `order_id:spec_hash` | 5 |
| `render.invoice_pdf` | order paid or refund issued | `invoice_number` | 5 |
| `notify.send` | outbox event | `message_id` | 6 over about 1 h, exponential |
| `factory.release` | order paid **and** files rendered | `order_id` (the factory must accept it as its own idempotency key) | 10 over about 6 h, then dead and alert |
| `shipping.create_awb` | order ready | `order_id:shipment_no` | 5 |
| `payments.reconcile` | cron every 15 min | window | n/a |
| `orders.stuck_check` | cron hourly | window | n/a |

### Status: polling or push

- **MVP: polling.** The client gets a `job_id` and calls `GET /api/v1/jobs/{id}` every 1–2 s. The response gives status, progress text and the result once done, and the endpoint is scoped to the owner (device or customer).
- **Later:** Server-Sent Events from the API for the web and ops apps. Push notifications (Expo push) are for long jobs only.
- Keep the **rules-first fast path synchronous.** `refine.py` answers most edits instantly for free, and only the AI fallback becomes a job.
- Generation can return the rule-engine variants immediately and add Claude variants when the job finishes. That is a good product experience and hides latency.

### Retries and dead letters

- Exponential back-off with jitter.
- Distinguish retryable failures (timeouts, 5xx, 429 with `Retry-After`) from permanent ones (4xx validation, refusal).
- After `max_attempts` a job becomes `dead` and stays in the table. The ops app gets a **"Failed jobs" page** with retry and cancel, and an alert fires for `factory.release`, `notify.send` (OTP excepted) and payment jobs.
- This also fixes today's `paid_release_failed` dead end.

### AI cost caps

The existing controls in `ai_edit.py` are good; keep them and extend:

- **Per-job budget:** set `max_tokens` per kind (generation 16k today, which is high for a JSON spec; measure and lower it). Record `usage.input_tokens/output_tokens` and the cost on each job.
- **A daily and monthly spend cap in money, not calls.** `AI_DAILY_BUDGET` counts calls across devices; add a rupee or dollar budget computed from token usage. When 80% is reached, alert. At 100%, fall back to the rule engine (already the fallback path).
- **Per-customer and per-device caps** as today, with signed-in customers getting their allowance by account rather than device (device ids are client-supplied).
- **Concurrency cap** in the worker: the AI pool size bounds the burn rate even under attack.
- Keep the **result cache** (`ai_cache`); consider prompt caching for the long system prompt.
- Set a **hard monthly spend limit in the Anthropic console** as the last line of defence.

---

## 5. Payment webhooks

### Today

- `confirm_payment` accepts only `demo=True` (or staff-recorded manual methods).
- **Two customer-reachable routes marked orders paid with a demo payment, and nothing disabled them in production.** (Now fixed, see below.) They are `POST /api/v1/orders/{id}/payment-confirmed` (`main.py`) and `POST /api/v1/checkouts/{id}/pay` (`platform/api_market.py` → `commerce.pay`). Both are on the web proxy allow-list (`web/src/lib/proxy.ts`).
- Anyone who passes `check_order_access` can call them: the customer, the placing device, or, for checkouts, someone who knows the checkout id and phone number. They release the order to production and the factory without any money.
- **Phase 0 fix (done):** `orders.confirm_payment` refuses demo payments with 403 when `APP_ENV=production`, unless `DEMO_PAYMENTS=1` is set for a pilot. `/api/v1/health` reports `demo_payments`. Still to do: remove both paths from the proxy allow-list once the gateway lands.

### Target flow (recommendation, Razorpay as the India default; Cashfree is equivalent)

```
App/Web             API                          Razorpay                 Worker
  │ place checkout   │                               │                       │
  ├─────────────────►│ price server-side, create     │                       │
  │                  │ checkout + orders (unpaid)    │                       │
  │                  ├──── create order (amount in paise, receipt=checkout id,
  │                  │     notes.checkout_id) ──────►│                       │
  │◄─ razorpay_order_id, key_id ──────────────────── │                       │
  │ open hosted Checkout (card/UPI/netbanking) ─────►│                       │
  │◄──────── handler: payment_id, order_id, signature│                       │
  ├─ POST /payments/razorpay/verify ─►│ verify HMAC; mark "pending_confirmation"
  │   (UI shows "confirming…")        │  (NOT paid yet)                      │
  │                  │◄── webhook payment.captured / order.paid (signed) ────│
  │                  │ verify signature on RAW body, store in payment_events │
  │                  │ (unique event id), in ONE transaction:                │
  │                  │   payments row → captured; orders → paid; outbox rows │
  │                  │   (render files, notify, factory release) ───────────►│
  │  poll /checkouts/{id} → paid ◄────────────────────────────────────────────
```

### Rules

- **Never trust the client.**
  - The amount always comes from server pricing (`pricing.quote`, then the checkout total).
  - The client's handler response only moves the UI to "confirming".
  - Only a verified webhook, or a server-side fetch of the payment from the gateway API, marks an order paid.
  - Check that the captured amount and currency equal the checkout total, and that `notes.checkout_id` matches.
- **Signature verification.**
  - Razorpay signs the webhook body with HMAC-SHA256 using the webhook secret, in the `X-Razorpay-Signature` header. Checkout callbacks sign `order_id|payment_id` with the key secret.
  - Cashfree signs `timestamp + raw body` (headers `x-webhook-signature` and `x-webhook-timestamp`).
  - Verify on the **raw bytes**, compare in constant time, and reject stale timestamps.
  - Confirm the exact header names and algorithms in the current gateway docs when you implement.
- **Idempotency.**
  - `payment_events.event_id` is unique (Razorpay sends an event id header), and so is `payments.provider_payment_id`.
  - Handlers are "insert the event, and if it is new, apply the transition". Webhooks are delivered at least once and out of order, so a `payment.failed` after `captured` must not undo the capture.
  - Respond `200` fast. Heavy work goes to jobs.
- **Webhook endpoint.**
  - `POST /api/v1/webhooks/razorpay` in a new `server/app/platform/payments.py`.
  - No auth header and no API key, since the signature is the auth.
  - Excluded from CORS. Rate limited by IP only loosely.
  - Optionally check the gateway's published IP ranges at Caddy.
- **Reconciliation.**
  - A `payments.reconcile` job every 15 minutes fetches payments for recent open checkouts from the gateway API and repairs missed webhooks.
  - A daily job compares gateway settlements with `payments` and flags mismatches in ops.
  - Auto-capture should be on in the gateway. A job voids or refunds authorised-but-orphaned payments.
- **Refunds.**
  - `POST /ops/orders/{id}/refunds` needs the `refunds.issue` permission and calls the gateway refund API with an idempotency key (`refund_id`).
  - It stores the `refunds` row as `pending`, and the refund webhook moves it to `processed` or `failed`.
  - Cancellation today (`lifecycle.cancel`) only records a refund. It becomes: cancel, then enqueue the refund, then notify.
  - Partial refunds are supported, with total refunds capped at the captured amount.
- **Cash on delivery.**
  - Keep it as a payment method with its own states: `cod_pending → cod_collected` or `cod_refused`.
  - With a courier aggregator, COD money arrives by **remittance**. Record the remittance id and match it per AWB; a missing remittance after N days raises an alert.
  - Keep the existing COD eligibility rules in `pricing.py` and `sellers.py`.
  - Consider a small prepaid token or OTP confirmation for high-value COD to reduce return-to-origin (RTO) losses.
- **PCI scope:** see section 11. Hosted checkout keeps card data off UrJersey servers entirely.

---

## 6. Order state management

### Today

- `order["status"]` (in `orders.py`) mixes payment and factory release.
- `order["fulfilment"]["status"]` (in `lifecycle.py`) tracks production and delivery.
- Transitions are enforced by scattered `if f.get("status") in (...)` checks in `complete_stage`, `set_hold`, `cancel`, `create_shipment`, `update_shipment` and `collect_cod`.
- Events are appended to `order["events"]` inside the JSON, and `store.audit` is written for most staff actions.
- `notify.order_event` is called directly after saving.
- There is no version check.

### Target (recommendation): three separate states on the order

| State | Values |
|---|---|
| `payment_state` | `unpaid → pending → paid → partially_refunded → refunded`; `failed` (can retry to `pending`); COD: `cod_pending → cod_collected`, or `cod_refused` |
| `fulfilment_state` | `awaiting_payment → queued → in_production → ready → dispatched → delivered`; `cancelled`; `rto` (returned to origin); `returned` (customer return completed) |
| `release_state` (factory hand-off) | `not_released → releasing → released`, or `release_failed` (retryable) |

Hold stays a **flag** (`hold`, `hold_reason`) that blocks forward fulfilment transitions without changing the state, as today.

### Allowed fulfilment transitions

| From | To | Who | Guard |
|---|---|---|---|
| awaiting_payment | queued | system (payment webhook, COD confirmation, staff manual payment) | `payment_state ∈ {paid, cod_pending}`; manufacturing checks pass |
| awaiting_payment | cancelled | customer, staff with `orders.write`, system (checkout expiry) | none |
| queued | in_production | production staff, partner operator (own orders) | first stage done; not on hold |
| queued | cancelled | customer (no stage done), staff | triggers a refund if paid |
| in_production | ready | production staff, partner operator | all stages done; not on hold |
| in_production | queued | production staff | undoing the only done stage (today's `undo`) |
| in_production | cancelled | staff with `orders.cancel_in_production` | refund or partial refund decision recorded |
| ready | dispatched | dispatch staff, partner operator, courier webhook (`picked up`) | shipment with AWB exists; not on hold |
| dispatched | delivered | courier webhook, dispatch staff | none |
| dispatched | rto | courier webhook, dispatch staff | none |
| rto | ready | dispatch staff | goods received back |
| rto | cancelled | staff | refund decision |
| delivered | returned | staff (return resolved) | within the return window |

Payment transitions are driven only by gateway events or permission-checked staff actions. Refunds never move the fulfilment state by themselves.

### Implementation (recommendation)

- A new `server/app/platform/state.py` holds the transition tables as data and one function: `transition(conn, order_id, machine, to, actor, expected_version, **params)`. In **one transaction** it:
  1. loads the order `FOR UPDATE` (or checks `version`);
  2. checks the table and guards;
  3. updates the state columns and `version = version + 1`;
  4. inserts an `order_events` row (from, to, actor, public, params);
  5. inserts an `audit_log` row;
  6. inserts **outbox** rows (`order.paid`, `order.dispatched`, …).
- **Outbox pattern.** `outbox(id, aggregate, aggregate_id, event, payload, created_at, dispatched_at)`. A relay in the worker reads undispatched rows and creates jobs such as `notify.send`, `factory.release`, `render.print_files`, `inventory.consume` and later webhooks to partners. Because the outbox row commits with the state change, an event is never lost and never sent for a change that rolled back. Today's `message` records become real outbox-driven deliveries with attempts and a provider message id.
- **Mapping from today's `lifecycle.py`:**

| Today | Target |
|---|---|
| `on_paid` | `transition(payment → paid)` plus `transition(fulfilment → queued)` plus outbox `order.paid` |
| `complete_stage` | updates `stage_progress` and, when the first or last stage changes, calls `transition` |
| `set_hold` | a flag update plus an event |
| `cancel` | `transition(→ cancelled)` plus a refund job |
| `update_shipment('dispatched' / 'delivered' / 'returned')` | `transition` driven by shipment status (and later by courier webhooks) |
| `collect_cod` | `transition(payment → cod_collected)` |
| `order["status"] = released_*`, `paid_release_failed` | `release_state` |
| `order["events"]` | the `order_events` table. `public_view` reads the public ones. |
| `index_order` / `order_index` | deleted; ops lists query `orders` directly |

---

## 7. RBAC

### Today

Six staff roles plus `seller`, each mapped to a permission set in `platform/security.py`:

| Role | Permissions |
|---|---|
| admin | `*` |
| manager | `read, orders, pricing, production, delivery, crm, settings` |
| sales | `read, orders, crm, quotes` |
| production | `read, production` |
| dispatch | `read, delivery` |
| viewer | `read` |
| seller | `seller` |

- Routes use `Depends(need("perm"))`. A seller login is refused everywhere except routes that opt in with `need(..., seller=True)`. Those routes must then scope with `seller_scope` / `check_seller_order`, which return 404 for another seller's order.
- Customers are a separate subject kind, and the order is also visible to the placing device and to anyone who knows the phone number (`check_order_access`).
- API access is gated by an optional shared `X-API-Key` (`API_KEYS`), which the mobile app stores in SecureStore.

This is a sound start. The risk is that partner scoping depends on **each route remembering** to scope.

### Target (recommendation)

**Three identity types, three token audiences:**

| Identity | Table | Sign-in | Client | Audience |
|---|---|---|---|---|
| Customer | `customers` | OTP (SMS or email), optional password | mobile app, web store | `customer` |
| Staff | `staff_users` | email, password and **TOTP 2FA (mandatory)**; SSO later | ops app | `staff` |
| Partner user | `partner_users` (belongs to exactly one `partner_id`) | email or phone, password and 2FA for `partner_admin` | partner app (first a section of ops, later its own client) | `partner` |

**Finer permissions** (split today's coarse ones):

| Permission | admin | manager | sales | production | dispatch | viewer | partner_admin | partner_operator |
|---|---|---|---|---|---|---|---|---|
| orders.read | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | own | own |
| orders.write (notes, priority) | ✓ | ✓ | ✓ | | | | | |
| orders.cancel | ✓ | ✓ | ✓ | | | | | |
| payments.record_manual | ✓ | ✓ | | | | | | |
| refunds.issue | ✓ | ✓ (≤ limit) | | | | | | |
| production.stage | ✓ | ✓ | | ✓ | | | own | own |
| print_files.download | ✓ | ✓ | | ✓ | | | own | own |
| shipping.manage | ✓ | ✓ | | | ✓ | | own | own |
| inventory.adjust | ✓ | ✓ | | ✓ | | | own stock | |
| crm.* | ✓ | ✓ | ✓ | | | | | |
| pricing.write / settings.write | ✓ | ✓ | | | | | | |
| partners.manage | ✓ | ✓ | | | | | own users | |
| staff.manage | ✓ | | | | | | | |
| pii.export / customer.erase | ✓ | | | | | | | |
| audit.read | ✓ | ✓ | | | | | own | |

**Tenant scoping for partners:**

- Every partner-facing query goes through repository functions that take a `Principal` and **always** add `partner_id = principal.partner_id`, rather than individual routes adding the filter.
- Partner users see only what production needs from customer PII: first name, shipping address when they ship, and phone masked unless they handle the delivery.
- **At scale-up**, add Postgres Row-Level Security on partner-scoped tables as a second barrier, setting `app.partner_id` per transaction.
- Keep the 404-not-403 behaviour.
- Write a test that calls every partner route with another partner's ids.

**The partner app as its own client (later).** Today the seller role lives inside `ops/`. At MVP keep that, but give partner users their own token audience and a separate `/api/v1/partner/*` router, so the ops API and the partner API can diverge. Phase 2 builds a small Expo app for the shop floor, reusing `app/` tooling. Its features: today's jobs, scan a QR on the job ticket to complete a stage, download frozen print files, create shipments and print labels, and adjust stock.

**Service-to-service auth and API keys:**

- **Web store → API:** the Next.js server proxies with `UJ_API_KEY` (`deploy/docker-compose.yml`). That is a genuine secret because it never reaches browsers. Keep it; give it a scope (`client=web`).
- **Mobile app → API:** a key embedded in a public app is **not a secret**. Treat it as a client identifier for analytics and rate limits only. Security comes from customer tokens and server-side checks. Consider Play Integrity / App Attest later to slow down scripted abuse of AI and OTP routes.
- **API → factory / partners:** today a bearer `FACTORY_TOKEN`. Target: a per-partner API credential, with an HMAC-signed body and timestamp for outbound webhooks to partners.
- **Partners/factory → API** (status callbacks): per-partner API keys stored hashed in an `api_keys` table (`prefix, hash, partner_id, scopes, created_by, last_used_at, expires_at, revoked_at`). They are shown once, rotatable, and scoped (e.g. `production:write`).
- **Gateways and couriers → API:** signature-verified webhooks, with no API key.
- **Internal worker → DB:** a separate Postgres role with only the needed grants. Migrations run under an owner role that the app does not use.

---

## 8. Backups and disaster recovery

### Today

- A daily `sqlite3.backup()` at 02:30 via cron, gzipped, 14 copies **on the same server**.
- The off-site copy to R2 with rclone is documented in `docs/deploy.md` but not in the script.
- `restore.sh` refuses a damaged file and saves the current database before restoring.
- That means an **RPO of up to 24 h**, or total loss if the disk dies and the rclone step was never set up.
- Caddy's certificates and `.env` are not backed up.

### Targets (recommendation)

| | MVP | Scale-up |
|---|---|---|
| RPO (data you can lose) | ≤ 5 minutes (managed PITR) | ≤ 1 minute (Multi-AZ synchronous standby plus PITR) |
| RTO (time to be back) | ≤ 4 hours (rebuild the VM from compose; database is managed) | ≤ 30–60 minutes (standby failover automatic; app instances stateless) |
| Retention | PITR 7 days, daily logical dump 35 days, monthly 12 months | PITR 14–35 days, plus the same dumps in another region/account |

### What to do

1. **Database:** turn on managed PITR from day one. In addition, a nightly `pg_dump -Fc` to `uj-backups` (R2, object lock, a separate account or token that can only write), so you are not dependent on one vendor's backups.
2. **Object storage:** versioning on `uj-production` and `uj-documents`, and lifecycle rules for old versions. For scale-up, replicate the critical buckets to a second provider or region.
3. **Configuration:** `.env` lives in a secrets manager (section 11), and compose files and Caddyfile are in git. The server should be rebuildable from git plus secrets in under an hour, so write that runbook (`docs/runbook-restore.md`).
4. **Restore drills:** monthly at MVP, as a scripted drill that:
   - restores the latest PITR point into a scratch database;
   - runs the verification queries (counts, sums, latest order time);
   - boots the app against it in staging;
   - records the timing.

   The drill is not done until someone has seen a restored order in the ops app. A quarterly "lose the VM" game day at scale-up.
5. **Until Postgres lands (Phase 0):**
   - add the rclone step to `deploy/backup.sh` behind an env var;
   - run it hourly rather than daily;
   - enable WAL mode;
   - consider **Litestream** to R2 for near-continuous SQLite replication (RPO in seconds, very low effort).

---

## 9. Monitoring and observability

### Today

- `/api/v1/health` returns configuration without touching the database.
- The Docker HEALTHCHECK calls it.
- `docs/deploy.md` recommends a free UptimeRobot or Better Stack check.
- Logs are unstructured text.
- There is no error tracking and there are no metrics.

### Target (recommendation)

| Layer | MVP | Scale-up |
|---|---|---|
| Health checks | `/health/live` (process up) and `/health/ready` (database `SELECT 1`, pending migrations = 0, worker heartbeat < 2 min). Remove provider details from the public health response or restrict them to staff. | the same, used by the load balancer |
| Uptime | Better Stack or UptimeRobot on shop, API ready, ops, and a synthetic "quote a jersey" check every 5 min; alerts by SMS or phone | the same, plus multi-region checks and a status page |
| Structured logs | JSON logs (`structlog` or a logging JSON formatter) with `request_id`, route, status, duration, principal kind/id (never tokens, OTPs, full phone numbers or addresses). Ship them to Better Stack Logs, Grafana Cloud or Axiom (free or low tiers). | the same with retention policies; the audit log stays in the database |
| Errors | **Sentry** for API, worker, web (Next.js) and ops, plus the Expo app, with release tracking and PII scrubbing | the same |
| Metrics | request rate, latency, error rate per route; job queue depth, age of the oldest job and failures per kind; AI tokens and cost per day; DB connections. Prometheus endpoint or OpenTelemetry to Grafana Cloud free tier. | full OpenTelemetry tracing across API, worker and gateway calls |
| Business alerts | see below | the same, with on-call rotation |

Business alerts should come from a scheduled job that queries the database and posts to email, Slack or WhatsApp:

- payment captured but order not `queued` after 5 minutes;
- checkout `pending` for more than 30 minutes with a captured payment at the gateway (reconciliation mismatch);
- failed payment rate above X% in the last hour;
- `release_state = release_failed` or a `factory.release` job dead;
- orders `queued` past the promised ship date minus 1 day, or on hold for more than 48 h;
- shipments `dispatched` with no courier update for 72 h; RTO rate above a threshold;
- OTP send volume more than 3× baseline (SMS pumping), or OTP failure spikes;
- AI spend above 80% of the daily budget;
- a dead `notify.send` for order confirmations;
- a backup job missing, or a restore drill overdue.

The ops dashboard should show these counts at the top.

---

## 10. Scaling

### Order of events (recommendation)

1. **Nothing scales horizontally until Postgres is in.** SQLite on a local volume ties the API to one process on one machine (the Dockerfile says so).
2. **Move slow work out of requests** (section 4). This is the biggest capacity gain on the same hardware, because thread-pool threads stop waiting on Claude, SMS and the factory.
3. **Fix the whole-table scans:**
   - `planning.plan` and `planning.promise` should load only active orders' scheduling columns, not `all_orders()` JSON with embedded logos;
   - ops reports should use SQL aggregates instead of `find(..., limit=100000)`;
   - cache the plan per partner for 30–60 s and invalidate it on order transitions.
4. **Run 2–4 uvicorn workers or gunicorn with uvicorn workers** on one VM once on Postgres. Add a pooler (built-in pool or PgBouncer) when connections grow.
5. **Stateless API behind a load balancer** (2+ instances). Sessions, rate limits, AI usage and caches are already in the database, so no sticky sessions are needed.
6. **Scale workers separately.** The AI pool is bounded by budget, not CPU; the render pool is CPU-bound.
7. **Caching.**
   - HTTP caching and a CDN for `/meta`, catalogue, product pages and product mockups (Cloudflare in front of the shop and API).
   - Next.js ISR for product pages.
   - An in-process LRU for settings (`config.get` reads settings often).
   - Redis only if a measured hot spot needs it.
8. **CDN** for the ops SPA, web static assets, product images (`uj-public`) and presigned downloads of large print files.
9. **Read replicas** only when reporting or ops dashboards measurably load the primary. Route read-only report endpoints to a replica. For typical volumes this is Phase 3, not before.

### What scales first

- AI workers are bounded by money.
- Then the web store (SSR), which is easy to scale or move to Vercel or Cloudflare.
- Then API instances.
- The database is scaled last, vertically, for a long time.

---

## 11. Security

### Verified gaps today (fix in Phase 0 unless noted)

| # | Finding | Where | Fix |
|---|---|---|---|
| 1 | Customer-reachable demo payment marks orders paid in production | `main.py payment_confirmed`, `api_market.py pay_checkout`, `orders.confirm_payment` | **Done:** refused when `is_production()` unless `DEMO_PAYMENTS=1`. Remove from the proxy allow-list once the gateway is live |
| 2 | OTP abuse: only a 30 s per-identifier resend limit and 5 attempts per code. No per-IP, per-prefix or global caps. Each new code resets attempts. | `security.request_code` | Rate limits (below), a daily cap per identifier, a CAPTCHA (Cloudflare Turnstile) on the web after 2 requests, and an alert on volume |
| 3 | No general rate limiting | entire API | Caddy `rate_limit` module or Cloudflare rules at the edge, and app-level limits per principal for AI, OTP, login and checkout |
| 4 | Staff and seller logins have no 2FA; the ops token is in `sessionStorage` (readable by any XSS on the ops origin) | `security.py`, `ops/src/lib/api.ts` | TOTP 2FA for all staff and partner admins. Move ops to an httpOnly cookie via a same-site BFF like the web store's, or keep bearer tokens with a strict CSP and short sessions (1 day today). |
| 5 | `CORS_ORIGINS` defaults to `*` when unset (compose sets it correctly) | `config.py` | Fail start-up in production if CORS is `*` |
| 6 | Python dependencies unpinned (`>=`) with no lockfile | `server/requirements.txt` | Pin with `uv` or `pip-tools` lock and hashes; Dependabot or Renovate for server, web, ops and app; `pip-audit` and `npm audit` in CI |
| 7 | `--forwarded-allow-ips '*'` trusts any `X-Forwarded-For` | `server/Dockerfile` | Safe only while the API is reachable solely through Caddy (it is `expose`d, not published). Restrict it to the proxy network if the topology changes. It matters because the device key falls back to the client IP for AI limits. |
| 8 | Health endpoint discloses providers and messaging configuration publicly | `main.py health` | Minimal public response; details for staff only |
| 9 | Customer design briefs and uploads are logged as model-training data | `store.py` docstring, `/dataset/export` | Consent and notice (DPDP, below) and a retention limit; strip personal names and numbers from exports |

### Secrets management

**Today:** `.env` on the server (`deploy/docker-compose.yml`, `env_file: .env`), documented in `docs/configuration.md`.

**Recommendation:**

- **MVP:** keep env injection, but source values from a secrets manager: Doppler or Infisical (free tiers), 1Password Secrets Automation, or AWS Secrets Manager on AWS.
  - `.env` is never in git and has mode 600.
  - Separate keys for staging and production.
  - Gateway, webhook, R2, SMS, Anthropic and DB passwords are rotated at least yearly and on staff departure.
  - Use gateway test keys everywhere except production.
- **Scale-up:** workload identity (IAM roles) instead of static cloud keys where the platform allows.

### OWASP basics

- Input validation is already strong with Pydantic and the body size limit.
- Keep HTML escaping in `invoice_html`.
- Add a CSP, `X-Content-Type-Options`, `Referrer-Policy` and `frame-ancestors` headers in Caddy.
- SVG output: the renderer builds SVG from user text (team names, player names). `engine/renderer.py` uses `xml.sax.saxutils.escape` for the text it writes; keep a test that feeds `<script>` and quotes through every text field. Serve SVG downloads with `Content-Disposition: attachment` (print files already do) so an SVG can't run script on the API origin. Logo data URLs embedded in SVG should be limited to PNG/JPEG, or sanitised SVG.
- Uploaded images: re-encode server-side (Pillow already decodes them) and never serve user uploads from the app origin; use presigned R2 URLs.
- SSRF: `FACTORY_URL` and webhook URLs are admin-set environment variables; keep them out of the settings UI.
- Authorisation tests for every route: customer A vs B, partner X vs Y.

### Rate limiting (recommendation)

| Route | Limit (starting point) |
|---|---|
| `/auth/otp/request` | 3/10 min per identifier, 10/hour per IP, 20/day per identifier, a global circuit breaker at N/min |
| `/auth/otp/verify`, `/auth/login`, ops login | 10/10 min per IP plus the existing lockouts |
| AI routes | existing allowance plus 30/min per IP |
| `/checkout`, `/orders` | 10/min per principal |
| Webhooks | loose per-IP cap; the signature does the real work |

Implement coarse limits at Cloudflare or Caddy and fine limits in the app, stored in Postgres (or Redis later).

### OTP abuse specifically

- Use MSG91 or another DLT-registered sender with an approved OTP template (Indian TRAI DLT rules).
- Block premium-rate and non-Indian prefixes unless needed.
- Monitor cost per day.
- Prefer WhatsApp or email OTP where possible.
- Never log codes in production (already the case when a provider is set).

### PII and the DPDP Act 2023 (India)

The DPDP Rules were notified in November 2025, with most obligations phasing in over about 18 months. Confirm the current dates with counsel.

| Obligation | What it means for UrJersey |
|---|---|
| Notice and consent | A clear notice at sign-up and checkout covering what is collected (name, phone, email, addresses, uploaded images, designs), why, and with whom it is shared (partners, couriers, gateway, SMS/email providers, Anthropic for AI). Separate, optional consent for marketing (`marketing_opt_in` exists) and for using designs and briefs as **AI training data**. |
| Purpose limitation and minimisation | Partners get only what production and shipping need. Don't send customer phone or name to the Claude API; today only design briefs and images go there, so check that uploads don't carry personal data and strip EXIF. |
| Retention | Define it per data type: orders and invoices per tax law (about 8 years); OTP and session data days; AI cache and uploads for abandoned designs about 90 days; marketing data until withdrawal. Implement purge jobs. |
| Data principal rights | Access, correction and erasure through `/me` endpoints and an admin `customer.erase` (anonymise; keep invoices as legally required). Grievance officer contact in the app. |
| Security safeguards and breach notice | Encryption in transit (Caddy) and at rest (managed PG, R2), access control, audit logs, and a breach response runbook: notify the Data Protection Board and affected users. |
| Processors | Data processing terms with every vendor. Cross-border transfer is permitted except to countries the government restricts, so check the list. |
| Children | Youth teams are likely customers. Verifiable parental consent applies to users under 18 who sign up themselves; team orders placed by an adult organiser are the safer design. |

### PCI scope

Use hosted or standard Checkout (Razorpay Checkout, Cashfree hosted or drop-in) so **card data never touches UrJersey servers or apps**. That keeps you at the lightest self-assessment level (SAQ A for redirect/iframe on web; confirm the SDK's classification for mobile). Never log gateway payloads containing card or VPA details beyond what is needed; store only ids, method type and last 4 if provided.

### Admin 2FA and audit

- TOTP for all staff (with recovery codes), and re-authentication for sensitive actions: refunds, role changes, data export and erasure.
- Every state transition and permission-checked action writes to `audit_log` with actor, IP and request id. It is append-only: the app role has no `UPDATE`/`DELETE` grant on it.
- Staff sessions are listed and revocable (already supported for customers through `sessions_for`, `drop_session_id`).

---

## 12. Keep on the single server versus externalize from day one

**Position on the database: start the production MVP directly on managed PostgreSQL.** Reasons:

1. Real payments and webhooks need transactional state changes, an outbox and point-in-time recovery. Managed Postgres gives PITR and standby with no work; SQLite gives a daily file copy.
2. The port is contained: two storage files, one store API. It is roughly **2–4 engineer-weeks**, including the schema redesign, Alembic, the migration script and tests. Doing it later means migrating live money data under a maintenance window, with a rollback problem after reopening.
3. It unlocks a separate worker process and zero-downtime deploys, which the async-jobs design needs anyway.
4. The cost is small: about $15–50/month.

The only case for staying on SQLite at launch is a closed pilot with manual payments. If so, turn on WAL and Litestream, and schedule the move before the gateway goes live.

| Component | Where at MVP | Reason |
|---|---|---|
| API (FastAPI) | **On the server** | Stateless once on Postgres; one VM is enough for early volume; simple deploys |
| Web store (Next.js) | **On the server** (Vercel or Cloudflare later if SEO or traffic needs it) | Talks to the API over the private network, which keeps `UJ_API_KEY` off the internet |
| Ops app (static SPA) | **On the server** via Caddy, CDN in front | Static files; trivial |
| Queue worker | **On the server**, separate container | Same image; the queue lives in Postgres, so nothing new to run |
| Caddy (TLS, reverse proxy) | **On the server** | Automatic HTTPS works well; Cloudflare in front |
| PostgreSQL | **Externalized: managed** | PITR, backups, patching and failover belong to the provider; the VM becomes disposable |
| Payment gateway (Razorpay or Cashfree hosted checkout) | **Externalized** | PCI scope, UPI, card, netbanking and refunds; never build this |
| SMS / email / WhatsApp (MSG91, Resend or SES) | **Externalized** (already provider-based in `notify.py`) | DLT compliance and deliverability |
| Object storage (R2) for uploads, print files, invoices, labels | **Externalized** | Keeps binaries out of the database; survives VM loss; signed URLs for partners |
| Off-site backups (R2 bucket with object lock, separate credentials) | **Externalized** | A backup on the same disk is not a backup |
| Error tracking (Sentry) and uptime monitoring (Better Stack or UptimeRobot) | **Externalized** | Must keep working when the server is down |
| DNS and CDN (Cloudflare) | **Externalized** | DDoS protection, caching, WAF and rate rules at the edge, fast DNS changes during incidents |
| AI (Claude API) | **Externalized** (already) | Called from the worker with budget caps; the rule engine is the fallback |
| Courier aggregator (Shiprocket or similar) | **Externalized** (Phase 1–2) | AWB, labels, tracking webhooks and COD remittance |
| Secrets | **Externalized** (Doppler, Infisical or a cloud secrets manager) | Rotation and audit; the server can be rebuilt from git plus secrets |
| Logs | **Externalized** (a low-cost log service) | Searchable during incidents; survive the VM |

---

## 13. Recommended MVP architecture

```
                    Customers (Expo app, browsers)          Staff / partner users (ops)
                                   │                                     │
                     ┌─────────────▼─────────────────────────────────────▼─────────────┐
                     │ Cloudflare: DNS, CDN, WAF, edge rate limits, Turnstile on OTP   │
                     └─────────────┬───────────────────────────────────────────────────┘
                                   │ HTTPS
  ┌────────────────────────────────▼──────────────────────────────────────────────────┐
  │ App VM (India region, 4 vCPU / 8 GB), docker compose                              │
  │  Caddy ─► web (Next.js, BFF with httpOnly cookie) ──┐                             │
  │        ─► ops (static SPA)                           │ private network             │
  │        ─► api (FastAPI, 2–4 workers) ◄───────────────┘                            │
  │               │  writes state + outbox in one transaction                          │
  │           worker (same image): outbox relay, jobs: ai.*, render.*, notify.*,       │
  │                  factory.release, shipping.*, payments.reconcile, alerts           │
  └──────┬──────────────┬──────────────┬───────────────┬──────────────┬───────────────┘
         │              │              │               │              │
   ┌─────▼─────┐  ┌─────▼──────┐  ┌────▼─────┐  ┌──────▼──────┐  ┌────▼────────────────┐
   │ Managed   │  │ R2 buckets │  │ Razorpay │  │ MSG91 /     │  │ Claude API          │
   │ Postgres  │  │ uploads,   │  │ hosted   │  │ Resend      │  │ (budget-capped)     │
   │ PITR 7d   │  │ production,│  │ checkout │  │ SMS, email  │  └─────────────────────┘
   │ (standby  │  │ documents, │  │ webhooks │  │ WhatsApp    │  ┌─────────────────────┐
   │ optional) │  │ backups    │  │ ─► API   │  └─────────────┘  │ Shiprocket (Phase   │
   └───────────┘  └────────────┘  └──────────┘                   │ 1–2): AWB, webhooks │
   Sentry · Better Stack uptime + logs · Doppler/Infisical secrets └─────────────────────┘
```

### Components and responsibilities

- **API:** all business logic. Payment webhooks at `/api/v1/webhooks/*`. Job status at `/api/v1/jobs/{id}`. The partner router at `/api/v1/partner/*`.
- **Worker:** everything slow or external, enqueued through the outbox.
- **Postgres:** the single source of truth, holding the jobs, outbox, audit and payment inbox.
- **R2:** every binary; the database stores metadata only.

### Monthly cost range (rough, late 2026; confirm prices)

| Item | Range |
|---|---|
| App VM (Hetzner, DigitalOcean Bangalore, Lightsail Mumbai; 4 vCPU / 8 GB) | $15–50 |
| Managed Postgres (small; add about 2× for a standby) | $15–60 |
| R2 storage and operations (tens of GB, no egress fees) | $0–10 |
| Cloudflare (Free or Pro) | $0–25 |
| Sentry (Developer free or Team) | $0–30 |
| Uptime and logs (Better Stack or UptimeRobot plus a log tier) | $0–30 |
| Secrets manager | $0–20 |
| **Fixed infrastructure subtotal** | **about $30–225 (roughly ₹2,500–19,000)** |
| Usage-based: Razorpay about 2% per online transaction (standard plan; UPI pricing differs); SMS about ₹0.15–0.30 per message plus DLT; email roughly free to $20; Claude API set by your budget cap (e.g. $50–300); Shiprocket per shipment | variable |

### What launch needs (MVP go-live criteria)

- [ ] Postgres live with PITR; restore drill done once with timings recorded.
- [ ] Razorpay live keys, webhooks verified, reconciliation job running, refunds through the API, demo payment disabled.
- [ ] Order state machine with versioning; outbox-driven notifications and factory release; a failed-jobs page in ops.
- [ ] Logos and print files in R2; print files frozen at payment.
- [ ] Staff and partner-admin 2FA; partner users separated from staff; the partner cross-tenant test suite passes.
- [ ] Rate limits and Turnstile on OTP; SMS spend alert.
- [ ] Sentry, uptime checks, JSON logs, business alerts wired to a phone.
- [ ] Privacy notice and consent (including AI training use), a grievance contact, and a retention policy written down.
- [ ] Pinned dependencies, CI running tests and audits, a staging environment with test gateway keys.
- [ ] Runbooks: deploy, rollback, restore, a payment incident, and a "site down" checklist.

---

## 14. Scale-up architecture

```
                       Cloudflare (DNS, CDN, WAF, bot management)
                                       │
                 ┌─────────────────────┴──────────────────────┐
                 │   Load balancer (ALB / DO LB), health-checked
                 └──────┬───────────────┬───────────────┬─────┘
             ┌──────────▼───┐   ┌───────▼──────┐  ┌─────▼────────┐
             │ api × 2..N   │   │ web × 2..N   │  │ partner API  │ (same codebase,
             │ (containers) │   │ (or Vercel)  │  │ /partner/*   │  separate deploy optional)
             └──────┬───────┘   └──────────────┘  └──────┬───────┘
                    │         PgBouncer                    │
     ┌──────────────▼───────────────────────────────────────▼─────────────────┐
     │ Postgres primary (Multi-AZ, PITR 14–35 d) ──► read replica (reports,   │
     │ ops dashboards, analytics export)                                      │
     └──────────────┬─────────────────────────────────────────────────────────┘
                    │ outbox relay
     ┌──────────────▼──────────────┐    ┌─────────────────────────────┐
     │ worker pools (autoscaled):  │    │ optional: SQS / Redis when  │
     │  ai (budget-bound), render  │◄──►│ the Postgres queue is a     │
     │  (CPU), notify, integrations│    │ measured bottleneck         │
     └─────────────────────────────┘    └─────────────────────────────┘
   S3/R2 (versioned, cross-region copy) · Sentry · OpenTelemetry → Grafana · status page
   Partner app (Expo) · Customer app · Web · Ops — all on token audiences with 2FA where staff
   Analytics: nightly export to a warehouse (BigQuery / ClickHouse / DuckDB on R2)
```

### When to move

Move when **any two** of these triggers are true, or any one of the first three:

- sustained **more than about 300–500 orders a day**, or seasonal peaks (school sports season, tournaments) at 5× normal;
- an **uptime commitment of 99.9%** or better to partners or B2B customers, or zero-downtime deploys needed several times a day;
- **more than about 10–20 active production partners**, or partners integrating by API rather than through the app;
- API p95 latency above 500 ms with CPU above 60% after the Phase 2 query fixes;
- Postgres CPU above 60% sustained, or reports slowing ops screens;
- an engineering team of 3 or more deploying independently.

### Components added over MVP

- The load balancer and 2+ API containers (ECS Fargate, Cloud Run, DigitalOcean App Platform or Kubernetes only if the team already knows it).
- Multi-AZ Postgres, PgBouncer and a read replica.
- Autoscaled worker pools, and a cloud queue only if needed.
- Row-Level Security for partner tables.
- Full tracing and on-call.
- A warehouse for analytics.
- The separate partner app.

### Cost range (rough, late 2026)

About **$400–1,500/month** in infrastructure: Multi-AZ database $150–500, compute $100–400, load balancer $20–40, observability $50–300, storage and CDN $20–100. Usage-based fees scale with orders on top of that.

---

## 15. Phased roadmap

### Phase 0: hardening now (1–2 weeks, on the current stack)

- [x] Disable customer demo payments in production (`orders.confirm_payment`), behind `DEMO_PAYMENTS`.
- [ ] Add a version check to `save_order`, or at least serialise order writes, to stop lost updates.
- [ ] Give staff a way to retry factory release for `paid_release_failed` orders (the route currently 409s once `payment` is set).
- [ ] Turn on SQLite WAL and `busy_timeout` in `Store._conn`.
- [ ] Add the rclone off-site step to `deploy/backup.sh`, run it hourly, or add Litestream to R2.
- [ ] Do one restore drill.
- [ ] OTP: per-IP and daily caps, Turnstile on the web store, an SMS volume alert.
- [ ] Refuse `CORS_ORIGINS=*` in production; add security headers in the Caddyfile.
- [ ] Pin Python dependencies with a lockfile; enable Dependabot or Renovate for all four apps; add `pip-audit` and `npm audit` to CI.
- [ ] Add Sentry to the API and web store; add uptime checks; make `/health` query the database and stop exposing configuration.
- [ ] Switch to JSON logs with a request id.
- [ ] Write the privacy notice draft and the data inventory; add consent for AI training use.

### Phase 1: MVP launch (about 6–10 weeks)

- [ ] `server/app/db/` with SQLAlchemy Core and psycopg 3; Alembic in `server/alembic/`; the target schema.
- [ ] Re-implement `Store`/`PlatformStore` on Postgres; Postgres fixture for tests; the migration script with verification; staging on Postgres; cut-over.
- [ ] `state.py` state machine with separate payment, fulfilment and release states; `order_events`, `audit_log`, `outbox`.
- [ ] `jobs` table and worker container; move AI generation, AI edits, from-image, notifications, print rendering and factory release to jobs; `/jobs/{id}` polling in app, web and ops.
- [ ] Razorpay: create order, hosted checkout, webhook with signature verification and event inbox, reconciliation, refunds, and COD states.
- [ ] R2 with presigned uploads for logos; print files and invoices frozen at payment; a `files` table.
- [ ] Split `partner_users` from staff; a `/partner/*` router; scoped repositories; a cross-tenant test suite.
- [ ] Staff and partner-admin TOTP; re-authentication for refunds and role changes.
- [ ] Business alerts job; failed-jobs page in ops; the four runbooks.

### Phase 2: growth (months 3–9)

- [ ] **Shipping:** Shiprocket (or a similar aggregator) integration for rates, AWB creation, label PDFs to R2, pickup scheduling, tracking webhooks into `shipment_events` and fulfilment transitions, NDR and RTO handling, and COD remittance reconciliation.
- [ ] **Inventory v1** (section 16): materials, stock per partner location, reservations at payment, consumption at the first production stage, a movements ledger, low-stock alerts, and a planner check.
- [ ] Partner app (Expo) for stage scanning, print file download, shipping and stock.
- [ ] Planner and ops reports on SQL aggregates; a plan cache; 2–4 API workers.
- [ ] Server-Sent Events for job status; Expo push notifications; WhatsApp order updates.
- [ ] Per-partner API keys and signed outbound webhooks; factory integration using the same.
- [ ] GST-compliant invoice PDFs and credit notes; settlement reports per partner (payouts to partners through Razorpay Route or manual transfer).
- [ ] DPDP: erasure and export tooling; retention purge jobs.

### Phase 3: scale (when the section 14 triggers are met)

- [ ] Load-balanced API and web; Multi-AZ Postgres; PgBouncer; a read replica for reports.
- [ ] Autoscaled worker pools; a cloud queue only if measured.
- [ ] Row-Level Security on partner tables; SSO for staff.
- [ ] OpenTelemetry tracing, SLOs, on-call rotation, a status page, quarterly game days.
- [ ] Cross-region backup copies; RPO ≤ 1 min and RTO ≤ 1 h tested.
- [ ] Analytics warehouse; demand forecasting for inventory; the in-house design model (the training data is already being logged).

---

## 16. Inventory and shipping (target architecture; neither exists today)

### Inventory (recommendation)

**Today** there is no inventory module. The planner (`planning.py`) plans capacity in pieces per stage, not materials. Sellers have capacity factors but no stock.

| Table | Purpose |
|---|---|
| `materials` | id, kind (`fabric`, `blank_garment`, `trim`, `ink`, `packaging`), name, unit (metre, piece, kg), attributes jsonb (GSM, colour, size for blanks) |
| `stock_locations` | id, partner_id (the house seller for your own factory), name |
| `stock_levels` | location_id, material_id, on_hand, reserved, reorder_point; `available = on_hand − reserved` |
| `stock_movements` | an append-only ledger: id, location_id, material_id, qty (±), type (`receipt`, `reserve`, `release`, `consume`, `adjust`, `return`, `transfer`), order_id, actor, reason, at |
| `bom` (bill of materials) | garment × size × fabric → material quantities. Fabric metres per size can be derived from the engine's panel geometry (`engine/garments.py` has panel sizes in mm) plus a wastage factor. |

Flow:

1. At checkout, `sellers.choose` also checks **availability** at candidate partners, so a partner without stock is not offered.
2. **Reserve when the order is paid** (in the same transaction as `payment → paid`, via `state.py`). For COD, reserve at confirmation with a timeout. A short hold at checkout creation is optional if stock is scarce.
3. **Consume** when the first production stage (printing or cutting) completes; **release** on cancel.
4. `stock_levels` is updated only through movements in the same transaction, with a `CHECK (on_hand >= 0)` or explicit oversell policy.
5. The planner gains a material constraint: an order whose materials aren't available is flagged "waiting for stock" rather than silently scheduled.
6. Alerts fire at the reorder point. Partners adjust stock from the partner app, and every adjustment is audited.

### Shipping (recommendation)

**Today:** carriers are configured by hand in the `delivery` setting, with tracking URL templates. Staff or sellers create shipment records with a typed tracking number and move them through `planned → packed → dispatched → delivered` (`lifecycle.create_shipment`, `update_shipment`). COD is marked collected on delivery. There is no courier API, label or webhook.

Target with a courier aggregator (Shiprocket, or alternatives such as NimbusPost, iThink Logistics or Delhivery direct):

1. When an order is `ready`, a `shipping.create_awb` job:
   - books the shipment (pickup location = the partner's address, weight and dimensions from the product, COD amount);
   - stores the AWB and courier;
   - downloads the label PDF to `uj-production`;
   - schedules pickup.
2. **Tracking webhooks** go to `POST /api/v1/webhooks/shiprocket`:
   - authenticate with the token or signature the aggregator supports (confirm the mechanism; Shiprocket uses a configured security token header);
   - store the raw payload in `shipment_events` with a unique key;
   - map courier statuses (picked up, in transit, out for delivery, delivered, NDR, RTO initiated or delivered) to shipment and fulfilment transitions through `state.py`;
   - notify the customer through the outbox.
3. **NDR (failed delivery attempts):** an ops queue to reattempt or return, and a customer message asking them to confirm the address.
4. **COD remittance:** a daily job pulls remittance reports and marks `cod_collected` per AWB with the remittance id, which replaces today's automatic "collected on delivery". Mismatches raise an alert.
5. **Rates at checkout:** optionally call the aggregator's serviceability and rate API to refine the delivery estimate. `sellers.py` PIN code rules remain the first filter, since they are fast and offline.
6. Polling fallback: a job that refreshes tracking for shipments with no event in 24 h.

---

## Appendix: files that will change, by phase

| Phase | Files |
|---|---|
| 0 | `server/app/orders.py`, `server/app/main.py`, `server/app/platform/api_market.py`, `server/app/platform/commerce.py`, `server/app/store.py` (`_conn` pragmas, `save_order` version), `server/app/platform/security.py` (OTP limits), `server/app/config.py`, `server/requirements.txt` (plus a lockfile), `deploy/backup.sh`, `deploy/Caddyfile`, `web/src/lib/proxy.ts` |
| 1 | new `server/app/db/`, `server/alembic/`, `server/scripts/sqlite_to_postgres.py`, `server/app/jobs/`, `server/app/worker.py`, `server/app/files.py`, `server/app/platform/state.py`, `server/app/platform/payments.py`; rewrites of `store.py`, `platform/db.py`, `platform/lifecycle.py`, `platform/notify.py`, `platform/security.py`; `deploy/docker-compose.yml` (worker service, `DATABASE_URL`); `ops/` (failed jobs, 2FA, partner area); `app/` and `web/` (job polling, gateway checkout) |
| 2 | new `server/app/platform/inventory.py`, `server/app/platform/shipping.py`, a partner Expo app; `platform/planning.py`, `platform/sellers.py`, `platform/api_ops*.py` |
| 3 | infrastructure as code (Terraform or Pulumi), deployment manifests, RLS migrations |
