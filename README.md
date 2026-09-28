# UrJersey

Design your own jersey, V-neck or shorts on your phone, check it is print-ready, and order it for one player or a whole team.

This repository has two parts:

| Folder | What it is |
| --- | --- |
| `app/` | The UrJersey mobile app: Expo SDK 57, React Native 0.86 (New Architecture: Fabric, TurboModules, Hermes), TypeScript, Expo Router. Runs on iOS and Android; the same code also runs in a browser for quick testing. |
| `server/` | The UrJersey API (FastAPI). It owns the design engine (brief understanding in English, Hindi, Telugu and Tamil, design generation, panel rendering, manufacturing checks, logo ideas, background removal, orders and print files). It is a fork of the Sportswear AI Design Studio engine and does not depend on that web app. |

## Run it

### 1. Start the API

```bash
cd server
python3 -m venv .venv && . .venv/bin/activate
pip install -r requirements.txt -r requirements-dev.txt
uvicorn app.main:app --host 0.0.0.0 --port 8000
```

`--host 0.0.0.0` lets a phone on the same Wi-Fi reach it. Run the tests with `pytest -q`.

Optional environment variables:

| Variable | Default | Meaning |
| --- | --- | --- |
| `DESIGN_PROVIDER` | `auto` | `rule` (built-in engine, no network), `claude` or `slm`. `auto` uses a configured in-house model (`SLM_BASE_URL`) if it answers, then Claude when `ANTHROPIC_API_KEY` is set, then the built-in engine. |
| `API_KEYS` | empty | Comma-separated keys. When set, every request needs an `X-API-Key` header; the app asks for it on the Settings screen. |
| `FACTORY_URL`, `FACTORY_TOKEN` | empty | Where paid orders are sent. **Empty means no factory: orders go to a TEST queue and nothing is produced.** |
| `DB_PATH` | `data/designs.db` at the repository root | SQLite file for designs, ratings, orders and the queue. |
| `CORS_ORIGINS` | `*` | Only matters for the web build. |
| `AI_EDITS` | `auto` | AI help in the Ask tab: `claude`, `slm` (your own model at `SLM_BASE_URL`) or `off`. `auto` turns it on when `ANTHROPIC_API_KEY` is set. |
| `ANTHROPIC_API_KEY` | empty | Server-side only. Never put it in the app. |
| `AI_EDIT_MODEL` | `claude-haiku-4-5` | The small, low-cost model used for AI edits. |
| `AI_FREE_EDITS_PER_DAY` | `10` | Free AI edits per phone per day (UTC). |
| `AI_BONUS_EDITS_PER_ORDER` | `20` | Extra daily AI edits for each paid order from that phone (up to 3 orders). |
| `AI_EDITS_PER_MINUTE` | `4` | Per-phone burst limit. |
| `AI_DAILY_BUDGET` | `2000` | Most AI edits per day across all phones together; `0` means no cap. |

### 2. Start the app

```bash
cd app
npm install
npx expo run:android      # or: npx expo run:ios  (builds the UrJersey development app)
npx expo start            # later runs: just start Metro and open the installed app
```

Speech input (`expo-speech-recognition`), the 3D preview (`expo-gl`) and image capture need native code, so use the UrJersey development build above (or `npx eas-cli@latest build --profile development`), not Expo Go. `npm run start:go` still opens Expo Go for quick UI work; speech input then explains that it needs the app build and points to the keyboard's microphone key.

Browser: `npx expo start --web` (or `npm run export:web` for a static build).

### 3. Point the app at the API

The app tries, in order: the address saved in **Settings → Server address**, `EXPO_PUBLIC_API_URL`, `expo.extra.apiUrl` in `app.json`, then a development default.

| Where the app runs | Address |
| --- | --- |
| Android emulator | `http://10.0.2.2:8000` (default) |
| iOS simulator, browser | `http://localhost:8000` (default) |
| A real phone | Your computer's LAN address, e.g. `http://192.168.1.20:8000`. In development the app guesses it from the Metro host. |

The API key is typed on the Settings screen and stored with `expo-secure-store` (Keychain / Keystore). It is never bundled into the app or put in links. On the web build it is kept in memory for the session only.

## Low-cost AI design help

The Ask tab tries the free built-in rules first ("make the collar gold", "change the pattern to waves", "add Priya on the back"). Only when the rules understand nothing does the server ask a small model, and the model returns just a short list of field changes (colours, pattern, coverage, scale, font, stripes and so on), never a whole design and never an image. The server checks every change: values are clamped to the allowed ranges, unknown fields are dropped, and names and numbers are only accepted when the customer typed them.

What keeps the cost down:

- **Rules first**: most edits never reach a model. Rule edits are unlimited and free.
- **Small model, tiny answers**: one short request (about 1,000 tokens in, under 100 out). No thinking, no image generation while people play.
- **Cache**: the same request on the same design is answered from the database without calling the model, for any phone.
- **Allowance**: each phone gets `AI_FREE_EDITS_PER_DAY` AI edits, more after a paid order, a per-minute limit, and a daily cap for the whole service. Cache hits and failed calls don't count. The app shows "AI edits left today" and a clear message when they run out; simple edits keep working.
- **Own model later**: every design, rating and edit is already logged. Once there is enough data, serve a fine-tuned small model behind an OpenAI-compatible endpoint and set `AI_EDITS=slm` and `SLM_BASE_URL`; the Ask tab then costs only your own hosting.

The phone is identified by a random install id (`X-Device-Id`), not by anything personal. Reinstalling the app gets a new id, which is why the daily cap for the whole service exists. For stricter limits, require sign-in and count per account.

## App links

`urjersey://design?prompt=…&garment=jersey|vneck|shorts&team=…&lang=en|hi|te|ta&autostart=1` prefills the brief and, with `autostart=1`, goes straight to "Here is what we understood". Out-of-range values are dropped, and nothing else in a link is read (no server address, no key).

`urjersey://orders/<order id>` opens an order's status. If `EXPO_PUBLIC_CHECKOUT_URL` is set at build time, unpaid orders show "Continue to checkout", which opens that page with `?order_id=<id>` and nothing else.

## What the app does

1. **Describe**: brief in English, हिन्दी, తెలుగు or தமிழ், typed or spoken; garment; up to 4 locked colours; team, player and number. Optional voice guide reads prompts aloud (it says so when the device has no voice for the language).
2. **Confirm**: shows what the server understood (sport, garment, colours, themes, names with where they came from). Conflicts between the brief and the form, and a missing sport (12 choices), must be answered before designing. Names and numbers print exactly as typed.
3. **Designs**: 4 variants per round, "More designs" for another 4, 1 to 5 star rating.
4. **Studio**: front, back and sleeve panels. Tap to select a name, number or logo, drag to move, pull the corner handle or pinch to resize, twist or use the top handle to rotate. The dashed line is the seam-safe area; layers crossing it fail the checks. Undo and redo keep 60 steps; one drag is one step. 3D preview built from the same print panels (falls back to 2D with a notice when GL is not available). Tools:
   - Style: five palette roles, preset palettes, custom colour picker, 12 patterns, 6 coverages, scale, strength, base, shoulder stripes, side panels, font, shuffle.
   - Text: team (24), player (16), number (3 digits) and free text (32) layers. Team, player and number layers are linked to the roster, so team orders print each player's own name and number.
   - Logos: 8 ideas at a time with "Load more"; upload PNG, JPEG or SVG up to 1.5 MB (checked from the file's bytes), up to 4 per design. Shows print resolution at the largest size you check and warns under 300 DPI; SVG stays vector. Optional plain-background removal with a before/after choice.
   - Ask: describe a change in words or by voice ("make the collar gold, change the pattern to waves"). Simple edits are handled instantly and free; anything else ("make it look more premium") goes to the AI when it is switched on, with the number of AI edits left today shown under the box.
   - Checks: pass / info / warning / failed exactly as the server reports them for the current design. Nothing is shown as ready while a re-check is running, and ordering stays disabled until the server says the current design is ready.
   - Share: the mock-up as a PNG and a text description.
5. **Order**: single (XS to XXL, 1 to 500) or team roster (add/remove rows, paste or import a list such as `Arul, 7, M, 2`), your name and phone (email optional), "remember me" on this phone. Every order carries an idempotency key, so a retry after a dropped connection returns the same order instead of a duplicate. The server re-checks every line and blocks the order if any fails.
6. **Order status**: merged lines, checks, per-size SVG print files (4 per jersey line, 2 per shorts line), demo payment (clearly labelled: no money is taken), and the factory receipt with job ID, queue, time and duplicate flag. With no factory configured the receipt says it went to the TEST queue and that nothing will be produced.

Staff tools (stats, dataset export) exist on the API but are not part of the customer app.

Drafts survive the app being closed: the brief, designs and current design are saved (on native, to a file in the app's documents folder, because logos can exceed AsyncStorage's row limit). Contact details are only saved when the customer ticks "remember me".

## Checks and tests

```bash
cd app
npx tsc --noEmit        # typecheck
npm test                # Jest: API client, errors and retries, roster parsing, undo history,
                        # flow state, order building and idempotent retry, image checks,
                        # app links, 3D mesh, loading/error/check components
npm run export:web && APP_URL=http://127.0.0.1:8081 node e2e/web-flow.mjs
                        # browser end-to-end run against a local API (needs Playwright).
                        # With E2E_AI=1 it also checks an AI edit (the API needs AI_EDITS on).

cd ../server && pytest -q
```

## Platform notes and limits

- **Native builds were compiled but not run on a device here.** The Android and iOS JavaScript bundles build with Hermes, and the full flow was run in a browser against the API. Try it on a real phone or emulator before release.
- iOS builds need a Mac with Xcode, or EAS Build.
- Speech input depends on the phone's recognisers: Hindi, Telugu and Tamil may need the language downloaded (Android: Google app / speech services; iOS: Siri languages). The app says when a language is missing.
- The 3D preview is an approximation built from the flat pattern pieces, for checking placement, not a fitted garment simulation.
- Print files are prototype-grade: simplified pattern pieces with uniform grading, 10 mm bleed and magenta CutContour lines. Proof colours with the printer's ICC profile. Sublimation has no white ink, so white areas are the white polyester fabric.
- Payment is demo only. A real payment provider and a real factory connection need to be configured before taking orders.
