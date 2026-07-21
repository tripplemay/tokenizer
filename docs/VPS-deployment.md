# VPS Deployment

This guide deploys Tokenizer as a central server. Each computer runs the CLI locally and uploads usage events to the VPS API. The VPS stores events in PostgreSQL and serves the dashboard.

## 1. Prepare The VPS

Install Docker and the Docker Compose plugin on the VPS.

Clone the repository:

```bash
git clone https://github.com/tripplemay/tokenizer.git
cd tokenizer
```

Create the environment file:

```bash
cp .env.example .env
```

Edit `.env`:

```env
ADMIN_TOKEN=use-a-long-random-private-token
NEXT_PUBLIC_APP_URL=https://your-domain.example
DATABASE_URL=postgresql://tokenizer:tokenizer@localhost:5432/tokenizer
APP_HOST_PORT=127.0.0.1:3010
```

`ADMIN_TOKEN` is used in the dashboard to generate one-time client enrollment commands. Keep it private.

## 2. Start Services

Build and start PostgreSQL, run migrations, then start the app:

```bash
docker compose build
docker compose up -d postgres
docker compose run --rm migrate
docker compose up -d app
```

The compose stack includes:

- `postgres`: PostgreSQL with persistent Docker volume `postgres-data`.
- `migrate`: one-shot `prisma migrate deploy` job, run during deploys.
- `app`: Next.js dashboard and ingestion API on port `3000`.

PostgreSQL is only exposed inside the Docker Compose network. It is not published to the VPS host because the production server already runs other database services.

Check status:

```bash
docker compose ps
docker compose logs -f app
```

Open the dashboard:

```text
https://token.vpanel.cc
```

The production VPS uses Nginx with Let's Encrypt HTTPS and proxies `token.vpanel.cc` to `127.0.0.1:3010`.

## 3. Configure A Client Machine

Generate a one-time install command from the dashboard, then run it on each client machine:

```bash
curl -fsSL https://token.vpanel.cc/install.sh | bash -s -- --enroll-token enroll_xxx
```

The installer creates `~/.tokenizer/config.json`:

```json
{
  "serverUrl": "https://your-domain.example",
  "projectRoots": ["/Users/you/project"],
  "sources": {
    "claude": true,
    "codex": true,
    "opencode": true
  }
}
```

It also restricts the device token in `~/.tokenizer/credentials.json` to the
current user: file mode `0600` on macOS and Linux, and an `icacls` ACL granting
only the current account on Windows (`chmod` there only toggles the read-only
attribute and would leave the token readable by other local accounts). If the
CLI cannot apply the restriction it prints a warning rather than failing the
enrollment — check for that warning if the token must stay confidential.

For a raw VPS IP without HTTPS, use:

```json
"serverUrl": "http://<vps-ip>:3000"
```

Each machine gets a stable local device file:

```text
~/.tokenizer/device.json
```

Do not copy this file between machines. Run `tokenizer init` separately on every device.

## 4. Upload Usage Events

Diagnose OpenCode if needed:

```bash
npm run cli -- diagnose opencode
```

Collect and sync in one step:

```bash
npm run cli -- run
```

Or collect and sync separately:

```bash
npm run cli -- collect
npm run cli -- sync
```

After sync, refresh the VPS dashboard. The `Devices` count and source breakdown should update.

## 5. GitHub CI/CD Deployment

The repository includes `.github/workflows/deploy-vps.yml`.

Behavior:

- Runs `npm ci` and `npm run verify` on GitHub Actions.
- Deploys only after verification passes.
- Deploys automatically on pushes to `main`.
- Supports manual deployment from the GitHub Actions `workflow_dispatch` button.
- SSHs into the VPS, checks out the pushed commit, writes `.env`, builds images, starts PostgreSQL, runs migrations, and restarts the app.

### Required GitHub Secrets

Add these in GitHub repository settings: `Settings` -> `Secrets and variables` -> `Actions`.

```text
VPS_HOST=your-vps-ip-or-hostname
VPS_USER=tripplezhou
VPS_SSH_KEY=<private SSH key used by GitHub Actions>
ADMIN_TOKEN=use-a-long-random-private-token
NEXT_PUBLIC_APP_URL=https://token.vpanel.cc
```

Optional secrets:

```text
VPS_SSH_PORT=22
VPS_DEPLOY_PATH=/opt/tokenizer
```

If `VPS_DEPLOY_PATH` is omitted, the workflow deploys to `/opt/tokenizer`.

Current production values (deploysvr, migrated 2026-07-13):

```text
VPS_HOST=194.238.26.173
VPS_USER=root
NEXT_PUBLIC_APP_URL=https://token.vpanel.cc
VPS_DEPLOY_PATH=/opt/tokenizer
```

> Migrated off the retiring shared host `34.180.93.185` (user `tripplezhou`) on
> 2026-07-13. The new host `deploysvr` is a shared box (kolmatrix / aigc-gateway
> / invoce / grandtianfu also run there); tokenizer's compose stack, `postgres-data`
> volume, and the `127.0.0.1:3010` app port are isolated per compose project.

### Prepare The VPS User

Create a deploy user and deployment directory if they do not already exist:

```bash
sudo adduser deploy
sudo usermod -aG docker deploy
sudo mkdir -p /opt/tokenizer
sudo chown deploy:deploy /opt/tokenizer
```

Add the public key matching `VPS_SSH_KEY` to the deploy user's authorized keys:

```bash
sudo mkdir -p /home/deploy/.ssh
sudo nano /home/deploy/.ssh/authorized_keys
sudo chown -R deploy:deploy /home/deploy/.ssh
sudo chmod 700 /home/deploy/.ssh
sudo chmod 600 /home/deploy/.ssh/authorized_keys
```

Verify SSH access from your local machine before relying on CI:

```bash
ssh deploy@<vps-ip>
docker compose version
```

The workflow clones the GitHub repository on the VPS during the first deployment. If the repository is private, make sure the deploy user can clone it. The simplest options are:

- Use a read-only deploy key on the repository and configure it in the deploy user's SSH config.
- Clone once manually on the VPS using credentials, then let CI fetch future commits.

### Trigger A Deployment

Push to `main`:

```bash
git push origin main
```

Or open GitHub Actions, select `Deploy VPS`, and click `Run workflow`.

### CI/CD Upgrade Flow

After CI/CD is configured, normal server upgrades are:

```bash
git push origin main
```

The workflow handles checkout, `.env` rendering, Docker rebuild, migrations, and app restart.

## 6. Manual Upgrade The Server

On the VPS:

```bash
git pull
docker compose build
docker compose up -d postgres
docker compose run --rm migrate
docker compose up -d app
```

Run the `migrate` service on every upgrade before restarting `app`.

## 7. Backup Data

The database is stored in the Docker volume `postgres-data`. For a logical backup:

```bash
docker compose exec postgres pg_dump -U tokenizer tokenizer > tokenizer-backup.sql
```

Restore into a fresh database:

```bash
docker compose exec -T postgres psql -U tokenizer tokenizer < tokenizer-backup.sql
```

## 8. Reverse Proxy Notes

Production uses Nginx and Certbot on the VPS. HTTPS traffic for `token.vpanel.cc` is proxied to the app on local port `3010`.

Required behavior:

- Forward normal HTTP requests to `http://127.0.0.1:3010`.
- Preserve request headers, including `authorization` and `x-admin-token`.
- Set `NEXT_PUBLIC_APP_URL` to the public HTTPS URL.

The active Nginx site is version-controlled at `deploy/nginx/tokenizer.conf` and
installed on the host as:

```text
/etc/nginx/sites-available/tokenizer.conf   (symlinked into sites-enabled/)
```

token.vpanel.cc is DNS-only (Cloudflare grey cloud, proxied=false), so clients
connect straight to the origin over HTTPS. The certificate is issued and renewed
by Certbot via the Cloudflare DNS-01 challenge (no HTTP-01 / DNS cutover needed):

```text
certbot certonly --dns-cloudflare \
  --dns-cloudflare-credentials /root/.secrets/cloudflare.ini -d token.vpanel.cc

/etc/letsencrypt/live/token.vpanel.cc/fullchain.pem
/etc/letsencrypt/live/token.vpanel.cc/privkey.pem
```

## 9. Troubleshooting

Unauthorized sync:

- Confirm the client has `~/.tokenizer/credentials.json`.
- Confirm the device was enrolled with a valid one-time enrollment token.
- Confirm reverse proxy forwards `authorization`.

App starts before tables exist:

- Run `docker compose run --rm migrate` manually and check the output.
- Confirm `docker compose up -d app` is run only after migrations succeed.

OpenCode events missing:

- Run `npm run cli -- diagnose opencode` on the client machine.
- Confirm `~/.local/share/opencode/opencode.db` exists and has tokenized messages.

Duplicate counts on repeated sync:

- This is expected. The server deduplicates by `deviceId`, `source`, and `sourceEventId`.

GitHub Actions cannot connect to VPS:

- Confirm `VPS_HOST`, `VPS_USER`, `VPS_SSH_PORT`, and `VPS_SSH_KEY` are correct.
- Confirm the matching public key is in `/home/<user>/.ssh/authorized_keys`.
- Confirm the VPS firewall allows SSH from GitHub Actions runners.

GitHub Actions can SSH but Docker fails:

- Confirm Docker is installed.
- Confirm `VPS_USER` is in the `docker` group.
- Log out and back in after adding the user to the Docker group.
