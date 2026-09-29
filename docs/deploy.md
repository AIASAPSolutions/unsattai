# Hosting UrJersey on one server

This guide puts the whole product on one small Linux server:

| Address | What it is |
|---|---|
| `https://shop.yourdomain` | Customer web store |
| `https://api.yourdomain` | The API. The mobile app and the operations app talk to it, and so does the web store from inside the server. |
| `https://ops.yourdomain` | Operations app for staff and sellers |

Everything runs in Docker. There are three containers:

- **api**: FastAPI with a SQLite database stored on a Docker volume.
- **web**: the Next.js store.
- **caddy**: gets free HTTPS certificates from Let's Encrypt, renews them, routes the three addresses and serves the operations app.

The files are in `deploy/`. The stack was built and run end to end (HTTPS, sign-in, store to API, operations sign-in, backup, restore and upgrading an old database) before this guide was written.

## 1. The cheapest options

All three apps together use about 200 MB of memory while running. Building the web store needs about 1 to 1.5 GB for a minute, so pick 2 GB of memory or add swap (step 4).

| Option | Cost (check current prices) | Notes |
|---|---|---|
| **Oracle Cloud Always Free** (Ampere ARM, Mumbai or Hyderabad region) | ₹0 | Up to 4 CPUs and 24 GB memory free for good. A card is needed to sign up. New free machines are sometimes "out of capacity" in a region; retry later, or pick the other Indian region. **Recommended first choice.** |
| Hetzner Cloud CX22 / CAX11 (Singapore or Europe) | about €4 to €5 a month | 2 CPUs, 4 GB memory. Cheapest paid option, but no India region, so pages load a little slower from India. |
| DigitalOcean (Bangalore), 2 GB | about $12 a month | India region, simple dashboard. |
| AWS Lightsail (Mumbai), 2 GB | about $10 to $12 a month | India region; the first months are sometimes free. |

You also need **a domain name**: about ₹500 to ₹1,000 a year for `.in` or `.com`. Buy it from any registrar, for example Cloudflare, GoDaddy or Namecheap.

Other running costs are optional:

- **SMS and email for sign-in codes** (step 9): SMS in India costs about ₹0.15 to ₹0.25 per message. Email is free up to a few thousand messages a month with most providers.
- **AI design help** (`DESIGN_PROVIDER=claude`, `AI_EDITS`): pay per use. It stays off by default, and the built-in design engine costs nothing.
- **Off-site backups** (step 11): Cloudflare R2 is free up to 10 GB.

So the cheapest real launch is about **₹1,000 a year**: Oracle's free server plus a domain, with SMS paid per sign-in.

## 2. Create the server

The steps below are for Oracle Cloud. Other providers are similar: create an **Ubuntu 24.04** machine and allow ports 22, 80 and 443.

1. Sign up at cloud.oracle.com and pick **India South (Hyderabad)** or **India West (Mumbai)** as the home region. The region cannot be changed later.
2. Go to **Compute → Instances → Create instance**.
   - Image: **Canonical Ubuntu 24.04**.
   - Shape: **Ampere → VM.Standard.A1.Flex**, with 2 CPUs and 12 GB of memory (inside the free limit).
   - Add your SSH public key.
   - Boot volume: 50 GB (free up to 200 GB in total).
3. Open the ports. Go to **Networking → Virtual cloud networks → your network → Security lists → Default**, then **Add ingress rules**: source `0.0.0.0/0`, TCP ports **80** and **443**. Add a second rule for UDP port 443 (optional; it enables HTTP/3).
4. Note the machine's **public IP address**.

## 3. Point the domain at it

At your domain registrar, create three **A records** that all point to the server's public IP:

```
shop   A   <server IP>
api    A   <server IP>
ops    A   <server IP>
```

Using Cloudflare DNS? Set these records to **DNS only** (grey cloud) at least for the first start, so Caddy can get its certificates.

Check that they work before continuing: `ping shop.yourdomain` should show the server IP. This can take from a few minutes to an hour.

## 4. Prepare the server

Connect with `ssh ubuntu@<server IP>`, then run:

```bash
# Updates and basic tools
sudo apt update && sudo apt -y upgrade
sudo apt -y install git ca-certificates curl ufw sqlite3

# Docker (official install script) and permission for your user
curl -fsSL https://get.docker.com | sudo sh
sudo usermod -aG docker $USER
newgrp docker            # or log out and back in
docker compose version   # should print v2.x

# Firewall: SSH, HTTP, HTTPS
sudo ufw allow 22/tcp && sudo ufw allow 80/tcp && sudo ufw allow 443/tcp && sudo ufw allow 443/udp
sudo ufw --force enable
```

**Oracle only:** Oracle's Ubuntu image also has its own iptables rules that block 80 and 443. Open them:

```bash
sudo iptables -I INPUT 6 -m state --state NEW -p tcp --dport 80 -j ACCEPT
sudo iptables -I INPUT 6 -m state --state NEW -p tcp --dport 443 -j ACCEPT
sudo iptables -I INPUT 6 -m state --state NEW -p udp --dport 443 -j ACCEPT
sudo apt -y install iptables-persistent && sudo netfilter-persistent save
```

**Servers with 2 GB of memory or less:** add swap so the web store build doesn't run out of memory.

```bash
sudo fallocate -l 2G /swapfile && sudo chmod 600 /swapfile && sudo mkswap /swapfile && sudo swapon /swapfile
echo '/swapfile none swap sw 0 0' | sudo tee -a /etc/fstab
```

## 5. Put the code on the server

There is no GitHub repository yet, so the code travels as the git bundle `urjersey.bundle`. From your computer:

```bash
scp urjersey.bundle ubuntu@<server IP>:~
```

Then on the server:

```bash
sudo mkdir -p /opt/urjersey && sudo chown $USER /opt/urjersey
git clone ~/urjersey.bundle /opt/urjersey
cd /opt/urjersey
```

**Once a GitHub repository exists** (recommended), clone it instead with `git clone https://github.com/<you>/urjersey.git /opt/urjersey`. Upgrades then become a `git pull` (step 10).

## 6. Settings (`.env`)

```bash
cd /opt/urjersey/deploy
cp .env.example .env
nano .env
```

Fill in at least these:

| Setting | Value |
|---|---|
| `SHOP_DOMAIN`, `API_DOMAIN`, `OPS_DOMAIN` | `shop.yourdomain`, `api.yourdomain`, `ops.yourdomain` |
| `ACME_EMAIL` | Your email, for certificate notices |
| `ADMIN_EMAIL`, `ADMIN_PASSWORD` | The first operations admin. Use a long password with upper and lower case letters and a digit. It is created only on the very first start, when there is no staff account yet. A weak password is refused and no admin is made (`docker compose logs api` says why). |
| `OTP_DEV_ECHO` | Keep it at `0`. With `1`, anyone could read sign-in codes from the API. |
| `SMS_WEBHOOK_URL`, `EMAIL_WEBHOOK_URL` | See step 9. Without them, customers cannot receive their sign-in codes. |

Everything else can stay as it is. **Never commit `.env`**: it is already listed in `deploy/.gitignore`. Keep a copy of it in your password manager.

## 7. Start everything

```bash
cd /opt/urjersey/deploy
docker compose up -d --build
```

The first build takes about 3 to 10 minutes. Then check:

```bash
docker compose ps                          # api and web should say "healthy"
docker compose logs caddy | grep -i certificate   # "certificate obtained successfully" for each domain
curl https://api.yourdomain/api/v1/health  # {"status":"ok",...}
```

Open `https://shop.yourdomain` and `https://ops.yourdomain` in a browser.

**Data survives restarts.** The containers restart by themselves after a crash or a server reboot, and the database lives in the Docker volume `urjersey_api-data`. `docker compose down` keeps it; **never run `docker compose down -v`**, which deletes it.

## 8. First sign-in and setup in the operations app

1. Go to `https://ops.yourdomain` and sign in with `ADMIN_EMAIL` and `ADMIN_PASSWORD`. Change the password at once on the **Account** page.
2. **Settings:** set prices, fabrics, delivery zones and charges, cash on delivery (fee and maximum order value), coupons and offers, and production stages and capacity.
3. **Sellers:**
   - Edit the company's own unit (`UrJersey`): its address, GSTIN, delivery areas and holidays.
   - Add partner sellers with their PIN code coverage, and use the PIN code test to check them.
   - Give each seller a staff login with the **seller** role, so they see only their own orders.
4. **Staff:** add the rest of the team with the right roles.
5. **Products:** the store starts with 12 sample designs. Edit them, unpublish them or add your own.
6. Carriers, and the factory connection (`FACTORY_URL`) when you have one.

## 9. Sign-in codes by SMS and email

Customers sign in with a one-time code sent to their phone or email. The server doesn't lock you into a provider. For each code or order message it sends a `POST` with JSON to the address you set:

- SMS: `{"to": "+919876543210", "text": "..."}` to `SMS_WEBHOOK_URL`
- Email: `{"to": "a@b.com", "subject": "...", "text": "..."}` to `EMAIL_WEBHOOK_URL`

If you set `SMS_WEBHOOK_TOKEN` or `EMAIL_WEBHOOK_TOKEN`, it is sent as `Authorization: Bearer <token>`.

Most providers expect their own format, so the usual setup is a tiny adapter that reshapes the message and calls the provider:

- **SMS in India:** MSG91, Fast2SMS or Twilio. Indian SMS needs DLT registration of your sender ID and message template, which the provider helps with and which takes a few days.
- **Email:** Resend, Brevo, Amazon SES or Postmark.

The adapter can be a free serverless function, for example on Cloudflare Workers.

Until a provider is connected, codes are only written to the server log. You can read one with `docker compose logs api | grep "SMS to"`, which is fine for testing but not for customers. Order messages also appear in the operations app's outbox.

## 10. Database migrations and upgrades

**There are no manual migration steps.** When the API starts, it creates any missing tables and columns itself. It only ever adds tables and columns and never deletes data, and any schema changes run at startup. This was tested by creating a database with the very first version of the server and starting the current version on it: the old designs were kept, and the new tables, the admin and the sample products were added.

To upgrade to a new version of the code:

```bash
cd /opt/urjersey/deploy
./backup.sh                     # 1. always back up first
git pull                        # 2. new code (or: git pull ~/urjersey.bundle main, after copying a new bundle)
docker compose up -d --build    # 3. rebuild and restart; the schema upgrades on start
docker compose ps && curl -s https://api.yourdomain/api/v1/health
```

Customers see a few seconds of downtime while the containers restart.

**Going back** after a bad upgrade: `git checkout <previous commit>`, run `./restore.sh backups/<the backup from step 1>`, then `docker compose up -d --build`.

**Moving an existing database** into the server, for example the `designs.db` from a test machine: copy it over, then run

```bash
gzip -c designs.db > old.db.gz
./restore.sh old.db.gz
```

It checks that the file isn't damaged, saves the current database as `backups/before-restore-<time>.db.gz`, swaps the database in, and restarts the apps. The schema is upgraded on start.

## 11. Backups

`deploy/backup.sh` makes a safe copy while the apps keep running. It writes it to `deploy/backups/urjersey-<time>.db.gz` and keeps the last 14.

Run it every night at 02:30 with cron:

```bash
crontab -e
# add this line:
30 2 * * * /opt/urjersey/deploy/backup.sh >> /opt/urjersey/deploy/backups/backup.log 2>&1
```

**Copy the backups off the server.** A backup that lives only on the same machine is lost with it. The free option is Cloudflare R2 (10 GB free) with rclone:

```bash
sudo apt -y install rclone
rclone config            # add a remote named "r2": type s3, provider Cloudflare, with your R2 keys
# then add this line to crontab, after the backup:
45 2 * * * rclone copy /opt/urjersey/deploy/backups r2:urjersey-backups --include "*.gz"
```

Restore any backup with `./restore.sh backups/urjersey-YYYYMMDD-HHMMSS.db.gz`. Try a restore once after launch so you know it works.

Also keep `deploy/.env` somewhere safe. The HTTPS certificates are renewed automatically and don't need a backup.

## 12. Build the mobile app against the server

The mobile app finds the API from `EXPO_PUBLIC_API_URL`, which is set when the app is built. It needs a free Expo account and, for the stores, a Google Play developer account ($25 once) and an Apple developer account ($99 a year).

```bash
cd app
npm ci
npm i -g eas-cli && eas login
eas init                                   # links the project to your Expo account
eas env:create --name EXPO_PUBLIC_API_URL --value https://api.yourdomain --environment production --visibility plaintext
eas env:create --name EXPO_PUBLIC_API_URL --value https://api.yourdomain --environment preview --visibility plaintext
eas build -p android --profile preview      # an APK to install and test on phones
eas build -p android --profile production   # for Google Play; then: eas submit -p android
eas build -p ios --profile production       # for the App Store; then: eas submit -p ios
```

The URL is not a secret. No API key is put into the app.

The operations app and the web store are already built by `docker compose` with the right addresses. Nothing extra is needed for them.

## 13. Everyday commands

```bash
cd /opt/urjersey/deploy
docker compose ps                      # status
docker compose logs -f api             # live API log (also web, caddy)
docker compose restart api             # restart one app
docker stats                           # memory and CPU
df -h && docker system df              # disk space
docker image prune -f                  # remove old images after upgrades
```

**Monitoring:** add a free uptime check (UptimeRobot or Better Stack) on `https://api.yourdomain/api/v1/health` and `https://shop.yourdomain`, so you get an email or SMS if the site goes down.

**Operating system updates:** run `sudo apt update && sudo apt -y upgrade` monthly, then reboot. The apps come back by themselves.

## 14. Security checklist

- `OTP_DEV_ECHO=0`, a long `ADMIN_PASSWORD`, and the admin password changed after the first sign-in.
- Only ports 22, 80 and 443 are open. The API and web containers are not reachable from outside except through Caddy.
- The web store talks to the API over the server's internal network (`http://api:8000`). Customer tokens stay in httpOnly cookies and never reach the browser's JavaScript.
- No secrets in the apps or in git. `.env` stays on the server.
- Optional: set up SSH key sign-in only (`PasswordAuthentication no` in `/etc/ssh/sshd_config`) and install `fail2ban`.
- Payments are still in demo mode. Connecting a real payment gateway, for example Razorpay, is a separate step before taking real money.

## 15. When you outgrow one server

One server comfortably handles a small business: thousands of orders a month. SQLite with one API process is simple and fast at that size.

- **More traffic:** move to a bigger machine. On Oracle's free tier, raise it to 4 CPUs and 24 GB. Nothing else changes.
- **Several API servers or high availability:** move the database to PostgreSQL. This is a code change in `server/app/platform/db.py` and the design store, not a setting.
- **Images and print files:** today they are generated on request. With heavy traffic, add a CDN such as Cloudflare in front of `shop` and `api` (proxied, with SSL mode **Full (strict)**).

## Files in `deploy/`

| File | What it does |
|---|---|
| `docker-compose.yml` | The three containers, volumes and ports |
| `api.Dockerfile`, `web.Dockerfile`, `caddy.Dockerfile` | How each image is built. The Caddy image also builds the operations app. |
| `Caddyfile` | HTTPS and routing for the three addresses |
| `.env.example` | All settings with explanations |
| `backup.sh`, `restore.sh` | Backups and restores |
