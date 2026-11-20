# Install

databag runs on your own machine, wherever that is. The same steps work on a laptop, a desktop, a Mac Mini, a VM, or a server in your office, cloud or data center.

- [Your own machine](#your-own-machine) (recommended): macOS or Linux
- [A Linux server or VM](#a-linux-server-or-vm): reachable by your whole team
- [Your domain](#your-domain)
- [Docker](#docker): any server, VM or PC, including Windows
- [Cloud (Vercel)](#cloud-vercel)
- [Updating and removing](#updating-and-removing)

## Your own machine

**You need:**
- macOS (Apple silicon or Intel) or Linux (x64 or arm64). On Windows, use WSL2 or [Docker](#docker).
- 16 GB of memory for the local model; 8 GB is enough with an API key.
- About 15 GB of free disk.

Open a terminal and paste:

```bash
curl -fsSL https://raw.githubusercontent.com/vinodkumarbhovi/databag-os/main/install.sh | sh
```

The installer:
1. Installs **Node.js 24** if you don't have it. It downloads the official build from nodejs.org, checks it, and keeps it in `~/.databag-os/runtime`. No password is needed.
2. Installs **Ollama**, which runs the AI model: the app on macOS, the official script on Linux (which may ask for your password). Skip this with `DATABAG_AI=cloud` if you will use an API key.
3. Installs **databag** from npm, or from the latest GitHub release.
4. Asks five questions:
   - **Your domain**, e.g. `acme.com`. It is used for your email addresses, and optionally for the address your team opens (`https://os.acme.com`).
   - **Company name**.
   - **Logo**: drag a PNG, JPG or SVG into the window, or skip it and add one later in Settings.
   - **AI**:
     - Gemma 4 on this computer (default, free, private), or
     - OpenRouter, or
     - OpenAI, with your API key.
   - **Apps**: all of them, or a selection.
5. Downloads **Gemma 4 E4B** (about 10 GB, once). It then sets databag to run in the background and start with the machine (a LaunchAgent on macOS, a systemd user service on Linux), and opens http://localhost:4100.

Create your account in the browser and you're in. Add your team in **Settings → People**.

Already have Node 24 or newer? `npx databag-os` does steps 3–5.

**From the source code:**

```bash
git clone https://github.com/vinodkumarbhovi/databag-os && cd databag-os
npm install && npm run build
node bin/databag.mjs   # setup questions, then start
```

For development: `npm run seed` creates a demo company, then `npm run dev`.

## A Linux server or VM

The same one-line installer works on Ubuntu, Debian, Fedora and most other Linux servers, in your office, on a cloud VM (AWS, Azure, GCP, Hetzner…) or in your data center.

```bash
curl -fsSL https://raw.githubusercontent.com/vinodkumarbhovi/databag-os/main/install.sh | sh
```

On a server with no screen, or with a hosted model instead of a local one:

```bash
curl -fsSL https://raw.githubusercontent.com/vinodkumarbhovi/databag-os/main/install.sh | DATABAG_AI=cloud sh
```

To answer the questions with flags instead (for scripts and automation):

```bash
npx databag-os init --yes --domain acme.com --company "Acme" --url https://os.acme.com \
  --host 127.0.0.1 --port 4100 --openrouter-key sk-or-...
npx databag-os service install     # systemd: runs in the background, restarts on failure
sudo loginctl enable-linger $USER  # once: keep it running after logout and start it at boot
```

- `--host 127.0.0.1` (the default) is right behind a reverse proxy or tunnel. Use `--host 0.0.0.0` only on a private network.
- Logs: `journalctl --user -u databag -f`
- A GPU server can run a larger model for the whole team: `ollama pull gemma4:12b`, then choose it in **Settings → AI**.

## Your domain

Your team reaches databag at an address like `https://os.acme.com`. Two ways to set that up:

**Cloudflare Tunnel** (easiest, free): HTTPS is included and no router changes are needed. It also works behind any home or office internet connection.

1. Add your domain to [Cloudflare](https://dash.cloudflare.com) on the free plan. Then, at your domain provider (GoDaddy, Namecheap, TransIP…), change the nameservers to the two Cloudflare gives you.
2. On the machine running databag:
   ```bash
   brew install cloudflared        # macOS; on Linux see developers.cloudflare.com/cloudflared
   cloudflared tunnel login
   cloudflared tunnel create databag
   cloudflared tunnel route dns databag os.acme.com
   cloudflared tunnel run --url http://localhost:4100 databag
   ```
   To keep the tunnel running after restarts: `sudo cloudflared service install`.

**A server with a public IP** (a VM or data center machine):
1. At your domain provider, add an **A record** that points `os` to your public IP.
2. Put a reverse proxy in front of databag. [Caddy](https://caddyserver.com) gets the HTTPS certificate by itself:
   ```text
   os.acme.com {
     reverse_proxy 127.0.0.1:4100
   }
   ```
   Or, on a machine behind a router, forward port 443 to it and run `databag https <certificate> <key> os.acme.com`.

`databag domain` shows these steps again, filled in with your own domain.

**Email from the internet** to `you@acme.com` needs an MX record pointing at the machine, plus inbound port 25. Many home connections block port 25. The simple route is to keep your current mailbox provider for outside mail, and set a relay (Resend, Postmark, your provider's SMTP) for sending; see [configuration.md](configuration.md#mail). Mail between colleagues always works.

## Docker

```bash
git clone https://github.com/vinodkumarbhovi/databag-os && cd databag-os
docker compose --profile local-ai up -d     # databag + Ollama; downloads Gemma 4 on first start
```

Other AI options:

```bash
# Use an Ollama already running on the host (on a Mac, Docker cannot use the GPU, so this is faster):
DATABAG_AI_BASE_URL=http://host.docker.internal:11434/v1 docker compose up -d
# Use OpenRouter instead of a local model:
OPENROUTER_API_KEY=sk-or-... docker compose up -d
```

Open http://localhost:4100. Data is kept in the `databag-data` volume. For internet access, put it behind Caddy, Traefik, nginx or a Cloudflare Tunnel, and set `DATABAG_URL` to the public address.

## Cloud (Vercel)

1. Create a [Turso](https://turso.tech) database (free tier). In the Vercel dashboard you can add it with *Storage → Turso*.
2. Get an [OpenRouter key](https://openrouter.ai/keys).
3. Deploy this repository to Vercel and add these environment variables:
   - `DATABASE_URL` and `DATABASE_AUTH_TOKEN` (or `TURSO_DATABASE_URL` / `TURSO_AUTH_TOKEN`)
   - `OPENROUTER_API_KEY`
   - `CRON_SECRET`: a long random string, e.g. from `openssl rand -hex 32`. Mark it **Sensitive**.
4. Open the site. The first account needs the setup code, which is your `CRON_SECRET` (or `DATABAG_SETUP_CODE`).

Differences in the cloud:
- Uploads are limited to 4 MB each.
- Incoming internet mail is not available.
- Scheduled jobs run once a day on the Hobby plan, and also whenever people use the app.

## Updating and removing

```bash
npm install --global --prefix ~/.databag-os/app databag-os@latest   # update
databag service remove                                              # stop running in the background
rm -rf ~/.databag-os                                                # remove databag AND all its data
```

A backup is made every day into `~/.databag-os/backups`. You can choose another folder, such as an external drive, in Settings. To restore one, run `databag restore <folder>` while databag is stopped.
