# Running the app: notes for the marketplace version

## What changed for running it

- **Tabs.** The app now opens on four tabs: Create (the old home screen), Shop, Cart and
  Account. Deep links such as `/design?prompt=…` and `/orders/<id>` work as before.
- **Sign-in.** Customers sign in with a mobile number or an email, using a one-time code or a
  password. The session token is kept in SecureStore on Android and iOS. On web it is kept in
  memory only, so reloading the page signs you out. Guests keep their cart and wishlist on the
  device, and both are merged into the account on sign-in.
- **One-time codes in development.** With `OTP_DEV_ECHO` on (the server default), the sign-in
  screen shows the code under "Test server code". Nothing is sent by SMS or email.
- **No new packages.** `expo-secure-store` was already a dependency.

## End-to-end test

`e2e/web-flow.mjs` now also signs in to the ops API as an admin. It uses that to add a second
seller ("Fast Prints", PIN codes starting with 600), block PIN code 194101 for the house
seller, and move one order through production to delivered. So start the API with an admin:

```sh
cd ../server && DB_PATH=/tmp/uj-app-e2e.db DESIGN_PROVIDER=rule AI_EDITS=off \
  ADMIN_EMAIL=admin@urjersey.test ADMIN_PASSWORD='Adm1nPassword!' \
  .venv/bin/uvicorn app.main:app --host 127.0.0.1 --port 8000

EXPO_OFFLINE=1 EXPO_PUBLIC_API_URL=http://127.0.0.1:8000 npx expo export --platform web --output-dir /tmp/uj-web
# serve /tmp/uj-web as a single-page app on 8081, then:
NODE_PATH=$(npm root -g) SHOTS=/tmp/uj-shots node e2e/web-flow.mjs
```

Optional environment: `API_URL` (default `http://127.0.0.1:8000`), `ADMIN_EMAIL` and
`ADMIN_PASSWORD` (the defaults match the command above), and `APP_URL` (default
`http://127.0.0.1:8081`). Each run signs up a new email address, and the ops setup can be run
again safely, so the test can run twice against the same database.

A "401 (Unauthorized)" console line in the output is expected: the run enters a wrong password
on purpose.
