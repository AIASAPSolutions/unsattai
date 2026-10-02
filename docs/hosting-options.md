# Where to host Unsattai

Unsattai has three parts that run all the time: the **API** (with its database), the **web store** and the **operations app**. The mobile app is published through the Play Store and App Store and talks to the API. All of them only need to reach the API's address, so they can live together on one machine or apart.

The API keeps its data in one SQLite file. Two rules follow from that, wherever you host:

- Run **one** copy of the API.
- Put the database on a **disk that survives restarts** (a volume).

That is plenty for a small shop with thousands of orders a month. Moving to PostgreSQL later is a code change (see "When you grow" below).

Prices below were checked in September 2026 and change often. Confirm them on each provider's site.

## The short answer

| If you want… | Choose | About |
|---|---|---|
| The lowest cost | **One server on Oracle Cloud Always Free** (Mumbai or Hyderabad) with `deploy/` | ₹0 a month, plus a domain |
| A cheap paid server you control | **Hetzner** (~€4–5 a month), **DigitalOcean Bangalore** (~$12) or **AWS Lightsail Mumbai** (~$10–12), with `deploy/` | $5–12 a month |
| No server to look after | **Railway**, **Render** or **Fly.io** for the API and store, with **Cloudflare Pages** (free) for the operations app | $10–30 a month |
| Room to grow into a bigger company | **AWS Mumbai** (or GCP or Azure India) with managed PostgreSQL, after the PostgreSQL change | $60+ a month |

**Recommendation:** start with **one server** using `deploy/` (Oracle free, or Hetzner or DigitalOcean if Oracle has no capacity). It is the cheapest, keeps all three apps side by side on a private network, and comes with backups, automatic HTTPS and a tested upgrade path. The step-by-step guide is [deploy.md](deploy.md).

If you'd rather never log in to a server, **Railway** is the easiest managed option: it builds straight from the GitHub repository with the Dockerfiles already in it.

## Option A: one server (recommended)

Everything is in `deploy/`, and the steps are in [deploy.md](deploy.md). One `docker compose up -d --build` starts:

- the API
- the web store
- Caddy, which gets HTTPS certificates and serves the operations app

| Provider | Region for India | Size | Price |
|---|---|---|---|
| Oracle Cloud Always Free | Mumbai, Hyderabad | Up to 4 ARM CPUs, 24 GB memory | ₹0 (a card is needed to sign up; free machines are sometimes out of capacity) |
| Hetzner Cloud | Singapore (nearest) | 2 CPUs, 4 GB | about €4–5 a month |
| DigitalOcean | Bangalore | 1 CPU, 2 GB | about $12 a month |
| AWS Lightsail | Mumbai | 2 GB | about $10–12 a month |
| Contabo, Vultr, Linode | Mumbai (Vultr, Linode) or Singapore | 2–4 GB | about $5–12 a month |

- **Good:** lowest cost, simple, your data sits on your machine, and backups and restores are scripted.
- **Watch:** you apply operating system updates about once a month (one command), and you set up the off-site backup copy.

## Option B: managed platforms (no server to look after)

Each part is deployed separately from the GitHub repository:

| Part | How | Settings |
|---|---|---|
| API | Docker service from `server/Dockerfile` (root directory `server`) | A volume mounted at `/data`, one instance, and the API variables from [configuration.md](configuration.md), including `APP_ENV=production`, `DB_PATH=/data/unsattai.db`, `CORS_ORIGINS` and `PUBLIC_SHOP_URL`. Health check path: `/api/v1/health`. |
| Web store | Docker service from `web/Dockerfile` (root directory `web`) | `UNSATTAI_API_URL` (the platform's private address for the API if it has one, else `https://api.yourdomain`) and `NEXT_PUBLIC_SITE_URL` |
| Operations app | Static site: root directory `ops`, build command `npm ci && npx vite build`, output folder `dist` | `VITE_API_BASE_URL`, `VITE_WEB_STORE_URL`. `ops/public/_redirects` already sends every page to the app. |

Both Dockerfiles listen on the `PORT` the platform gives them.

Then add your three domains (`api.`, `shop.`, `ops.`) in the platform's settings and point DNS where it says. HTTPS is automatic.

| Platform | What it costs for Unsattai | Notes |
|---|---|---|
| **Railway** | Hobby plan $5 a month, which includes $5 of usage. Expect about $10–20 a month for the API and store, plus a volume at about $0.15 per GB a month. | Easiest setup, with private networking between services. The nearest region is Singapore. Usage-based billing, so set a spending limit. |
| **Render** | Two Starter services at $7 a month each, plus a disk (about $0.25 per GB a month). Static sites are free. About $15–20 a month, more on a paid workspace plan. | Fixed prices. The nearest region is Singapore. Free services sleep and can't have a disk, so the API needs a paid instance. |
| **Fly.io** | About $4–8 a month per small machine, a volume at about $0.15 per GB a month, and a dedicated IPv4 at about $3.60 a month if you want one. About $12–20 a month. | Has a Mumbai region. Deployed with the `fly` command line, not a dashboard. |
| **Cloudflare Pages** | Free | For the operations app only |

**Vercel for the web store?** It works technically. Vercel's free Hobby plan is for non-commercial use only, so a shop needs Pro (about $20 a month per member). The API still needs one of the platforms above, so this rarely saves money.

- **Good:** no operating system to patch, deploys on every push, and a dashboard with logs.
- **Watch:** it costs more than one server. Backups depend on the platform's volume snapshots, so also copy the database off the platform now and then. Never run two API instances.

## Option C: a big cloud, when you grow

On AWS, GCP or Azure in their Mumbai or India regions:

- containers on ECS Fargate or Cloud Run
- **managed PostgreSQL** (RDS or Cloud SQL)
- S3 or R2 for files, and a CDN

This allows several API servers, automatic failover and point-in-time database restore. It needs the PostgreSQL change first: the database code is in `server/app/platform/db.py` and `server/app/store.py`. Expect at least $60–150 a month.

## Services you need wherever you host

| Need | Cheapest good choice | About |
|---|---|---|
| Domain | Any registrar (Cloudflare, GoDaddy, Namecheap) | ₹500–1,000 a year |
| DNS and CDN | Cloudflare (free) | ₹0 |
| Email for codes and order updates | Brevo (free for a few hundred emails a day), Amazon SES (about $0.10 per 1,000), Resend (free for 3,000 a month), Zoho ZeptoMail | ₹0 to start |
| SMS in India | MSG91 (DLT registration needed) | about ₹0.15–0.25 per SMS |
| Off-site backups | Cloudflare R2 (free up to 10 GB) | ₹0 |
| Uptime alerts | UptimeRobot or Better Stack (free plans) | ₹0 |
| App stores | Google Play ($25 once), Apple ($99 a year) | |
| Payments (next step) | Razorpay or Cashfree | about 2% per payment |

**To save on SMS:** customers can sign in with an email code, which is free. They can also set a password after their first sign-in, so codes are needed less often.

## When you grow

- More traffic on one server: move to a bigger machine. Nothing else changes.
- Several API servers or zero-downtime upgrades: switch the database to PostgreSQL (Option C).
- Heavy image traffic: put Cloudflare in front of the store and API.
