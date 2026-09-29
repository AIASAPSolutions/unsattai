# Configuration

Everything that changes between your computer, a test server and the live shop is an environment variable. No keys, addresses or passwords are written in the code.

Each app has an example file. Copy it and fill it in:

| App | Example file | Your copy (never committed) | When it is read |
|---|---|---|---|
| API (`server/`) | `server/.env.example` | `server/.env` | When the API starts |
| Web store (`web/`) | `web/.env.example` | `web/.env.local` | `NEXT_PUBLIC_*` when the store is built, the rest when it starts |
| Operations app (`ops/`) | `ops/.env.example` | `ops/.env.local` | When it is built (`VITE_*` values end up in the browser) |
| Mobile app (`app/`) | `app/.env.example` | `app/.env` | When it is built or started (`EXPO_PUBLIC_*` values end up in the app) |
| Everything on one server (`deploy/`) | `deploy/.env.example` | `deploy/.env` | `docker compose up` |

On a hosting platform (Render, Railway, Fly.io), type the same names into its environment settings instead of using a file. Real environment variables always win over a file.

**Business settings are not environment variables.** Prices, fabrics, delivery zones and charges, cash on delivery, coupons, production stages and capacity, company details, sellers, staff and products are changed in the operations app, and the change takes effect at once without a restart.

## Local development in five minutes

```bash
# API
cd server && cp .env.example .env    # set ADMIN_EMAIL and ADMIN_PASSWORD
python3 -m venv .venv && .venv/bin/pip install -r requirements-dev.txt
.venv/bin/uvicorn app.main:app --reload --port 8000

# Web store
cd web && cp .env.example .env.local && npm ci && npm run dev          # http://localhost:3000

# Operations app
cd ops && cp .env.example .env.local && npm ci && npm run dev          # http://localhost:5173

# Mobile app
cd app && cp .env.example .env && npm ci && npx expo start
```

Locally, `APP_ENV=development` and `OTP_DEV_ECHO=1` return sign-in codes in the API answer, so you can sign in without an SMS or email service. Both are ignored when `APP_ENV=production`.

## API (`server/`)

A blank value means "use the default".

### Basics

| Variable | Default | What it does |
|---|---|---|
| `APP_ENV` | `development` | `production` turns off every development shortcut (sign-in codes are never returned) and warns about missing settings in the log |
| `DB_PATH` | `server/data/designs.db` | The SQLite database file. On a server, put it on a disk that survives restarts (`/data/urjersey.db` in Docker). |
| `CORS_ORIGINS` | `*` | Browser addresses allowed to call the API, comma-separated. Production: `https://ops.yourdomain,https://shop.yourdomain` |
| `LOG_LEVEL` | `INFO` | `DEBUG`, `INFO`, `WARNING` or `ERROR` |
| `BRAND_NAME` | `UrJersey` | The name in SMS, emails and sign-in codes |
| `PUBLIC_SHOP_URL` | (none) | The web store's address. Order emails then get a "View your order" button. |
| `MAX_UPLOAD_MB` | `12` | Largest request (logos and pictures) |
| `MAX_CART_ITEMS` | `20` | Items per cart |
| `API_KEYS` | (none) | Comma-separated channel keys. Empty = open API; customers and staff still sign in. |
| `PORT` | `8000` | Only used by the Docker image, which hosting platforms set |

### First admin

| Variable | What it does |
|---|---|
| `ADMIN_EMAIL`, `ADMIN_PASSWORD` | Creates the first operations admin on the very first start, when there are no staff yet. The password needs 10+ characters with upper and lower case letters and a digit. A weak one is refused (the log says why). Change it after signing in. |

### Sign-in codes, passwords and sessions

| Variable | Default | What it does |
|---|---|---|
| `OTP_DEV_ECHO` | `1` | Return the code in the API answer. Local testing only; always off when `APP_ENV=production`. |
| `OTP_MINUTES` | `10` | How long a code works |
| `OTP_MAX_ATTEMPTS` | `5` | Wrong tries before a new code is needed |
| `OTP_RESEND_SECONDS` | `30` | Wait before another code can be sent |
| `OTP_SMS_TEXT` | `{code} is your {brand} code. It expires in {minutes} minutes. Don't share it.` | SMS wording (Twilio and webhook). With MSG91, the approved template's wording is used. |
| `OTP_EMAIL_SUBJECT` | `Your {brand} code: {code}` | Email subject for codes |
| `LOGIN_MAX_FAILURES` | `5` | Wrong passwords before the account is locked |
| `LOGIN_LOCK_MINUTES` | `15` | How long the lock lasts |
| `PASSWORD_RESET_MINUTES` | `15` | After signing in with a code, how long a new password can be set without the old one |
| `CUSTOMER_SESSION_DAYS` | `60` | How long customers stay signed in |
| `STAFF_SESSION_DAYS` | `1` | How long staff stay signed in |

### SMS

| Variable | What it does |
|---|---|
| `SMS_PROVIDER` | `log` (default: the server log only), `msg91`, `twilio` or `webhook` |
| `MSG91_AUTH_KEY` | MSG91 auth key |
| `MSG91_OTP_TEMPLATE_ID` | DLT-approved template for codes. Variables: `##otp##`, and optionally `##minutes##` and `##brand##`. |
| `MSG91_ORDER_TEMPLATE_ID` | Template for order updates. Variables: `##message##`, and optionally `##number##`. Empty = no order SMS. |
| `MSG91_SENDER_ID` | Approved sender ID, if your template needs it |
| `MSG91_FLOW_URL` | Only if MSG91 gives you a different address (default `https://control.msg91.com/api/v5/flow`) |
| `TWILIO_ACCOUNT_SID`, `TWILIO_AUTH_TOKEN` | Twilio account |
| `TWILIO_FROM` or `TWILIO_MESSAGING_SERVICE_SID` | Sending number, or messaging service |
| `SMS_WEBHOOK_URL`, `SMS_WEBHOOK_TOKEN` | For any other service. The API posts JSON: `{"to", "text", "otp"}` for codes, `{"to", "text", "number", "message"}` for order updates. The token is sent as a bearer token. |

### Email

| Variable | What it does |
|---|---|
| `EMAIL_PROVIDER` | `log` (default), `smtp`, `resend` or `webhook`. When it is blank, a set `SMTP_HOST` means `smtp`. |
| `EMAIL_FROM` | Sender, e.g. `UrJersey <no-reply@yourdomain>`. It must be an address your email service lets you send from. |
| `EMAIL_REPLY_TO` | Where replies go (optional) |
| `EMAIL_BRAND_COLOUR` | Header colour of the HTML email (default `#14225c`) |
| `EMAIL_FOOTER` | Small print at the bottom |
| `SMTP_HOST`, `SMTP_PORT` | Mail server. Examples: `smtp.gmail.com`, `smtp.zoho.in`, `smtp-relay.brevo.com`, `email-smtp.ap-south-1.amazonaws.com`, `smtp.resend.com` |
| `SMTP_SECURITY` | `starttls` (port 587, default), `ssl` (port 465) or `none` |
| `SMTP_USERNAME`, `SMTP_PASSWORD` | Mail server sign-in. For Gmail, use an app password. |
| `RESEND_API_KEY` | For `EMAIL_PROVIDER=resend` |
| `EMAIL_WEBHOOK_URL`, `EMAIL_WEBHOOK_TOKEN` | For any other service. The API posts `{"to", "subject", "text", "html"}`. |

Emails are sent as plain text with a matching HTML version. Codes are shown large. Order emails get a "View your order" button when `PUBLIC_SHOP_URL` is set.

### Design engine and AI help (optional)

| Variable | Default | What it does |
|---|---|---|
| `DESIGN_PROVIDER` | `auto` | `rule` (built-in engine, free), `claude`, `slm` (your own model), or `auto` (Claude when a key is set, else the rules) |
| `ANTHROPIC_API_KEY` | (none) | Claude API key. Only on the server, never in an app. |
| `CLAUDE_MODEL`, `CLAUDE_EFFORT` | `claude-opus-5`, `medium` | Model and effort for full designs |
| `AI_EDITS` | `auto` | The "Ask" tab: `auto`, `claude`, `slm` or `off` |
| `AI_EDIT_MODEL` | `claude-haiku-4-5` | Small model for edits |
| `AI_FREE_EDITS_PER_DAY`, `AI_BONUS_EDITS_PER_ORDER`, `AI_EDITS_PER_MINUTE` | `10`, `20`, `4` | Per-phone allowances |
| `AI_DAILY_BUDGET` | `2000` | AI calls per day for everyone together (`0` = no cap) |
| `SLM_BASE_URL`, `SLM_MODEL`, `SLM_TIMEOUT` | `http://localhost:11434/v1`, `sportswear-spec`, `60` | Your own OpenAI-compatible small model server |

### Factory

| Variable | What it does |
|---|---|
| `FACTORY_URL`, `FACTORY_TOKEN` | Where paid orders are handed to production. Empty = a TEST queue you can see in the API. |

## Web store (`web/`)

| Variable | What it does |
|---|---|
| `UJ_API_URL` | Where the store's own server reaches the API. On one server: `http://api:8000`; elsewhere, the API's address. The browser never calls it directly. |
| `UJ_API_KEY` | Only when the API sets `API_KEYS`. Stays on the store's server. |
| `NEXT_PUBLIC_SITE_URL` | The store's public address, for share links, SEO and the sitemap. Needed when it is built. |
| `UJ_COOKIE_SECURE` | Blank = HTTPS-only sign-in cookies in production. `0` only to try a production build over plain http. |
| `PORT` | Port to listen on (default 3000; set by hosting platforms) |

## Operations app (`ops/`)

| Variable | What it does |
|---|---|
| `VITE_API_BASE_URL` | The API's public address, e.g. `https://api.yourdomain` |
| `VITE_WEB_STORE_URL` | The web store's address, used for quote links |
| `VITE_API_KEY` | Only when the API sets `API_KEYS`. It is visible in the browser, so use a key made only for this app. |

These are built into the app. Change them, then rebuild (`docker compose up -d --build` does it).

## Mobile app (`app/`)

| Variable | What it does |
|---|---|
| `EXPO_PUBLIC_API_URL` | The API's public address. Empty locally = the computer running Expo, port 8000. Users can also change it on the Settings screen. |
| `EXPO_PUBLIC_CHECKOUT_URL` | Optional payment page for orders |
| `APP_NAME`, `APP_SLUG`, `APP_SCHEME`, `APP_VERSION` | Name on the phone, Expo project slug, link scheme (`urjersey://`), version |
| `IOS_BUNDLE_ID`, `ANDROID_PACKAGE` | Store identifiers. Choose them once before the first store upload; they can't be changed after. |
| `EAS_PROJECT_ID`, `EXPO_OWNER` | From `eas init` |
| `APP_ALLOW_HTTP` | `1` allows plain http for local testing. Use `0` for store builds. |

For EAS builds, set these with `eas env:create` or in the Expo dashboard. `app.config.ts` reads them. `EXPO_PUBLIC_*` values are visible inside the app, so never put a secret in one.

## Checking the settings

- `GET /api/v1/health` shows the design engine, AI help, and connected SMS and email services (never keys).
- On start, the API log warns about missing or wrong messaging settings, and about sign-in codes being shown when not in production.
- In the operations app, **Messages → SMS and email services** shows the same and sends a test SMS or email.
