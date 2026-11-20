# Configuration

Settings are read in this order, with later sources winning:

1. built-in defaults (`shared/defaults.mjs`)
2. the settings file `~/.databag-os/config.json`, written by `databag init` and **Settings** (in the cloud this is stored in the database instead)
3. environment variables

Most people never touch the file: `databag init` and the Settings page cover everything.

## Settings file

```jsonc
{
  "company": {
    "name": "Acme",
    "domain": "acme.com",                 // email addresses: you@acme.com
    "url": "https://os.acme.com",         // where people open databag (links in emails, booking pages)
    "logo": { "type": "image/png", "v": 1 },  // the image itself is ~/.databag-os/brand/logo
    "accent": "#1f6b4f"                   // company colour
  },
  "apps": ["mail", "calendar", "docs", "crm", "accounting", "agents", "factories"],
  "ai": { "baseUrl": "http://127.0.0.1:11434/v1", "model": "gemma4:e4b" },
  "host": "127.0.0.1", "port": 4100,
  "currency": "EUR",
  "relay": { "host": "smtp.resend.com", "port": 587, "user": "resend", "pass": "…" },
  "agent": { "confirm": "send" },         // "all" = also ask before changes inside databag
  "backup": { "dir": "/Volumes/Backup/databag", "keep": 7 }
}
```

The file is created readable by your user only, because it can contain API keys.

## AI

Any OpenAI-compatible endpoint that supports tool calling works.

| Choice | `baseUrl` | `model` |
|---|---|---|
| Gemma 4 on the machine (default) | `http://127.0.0.1:11434/v1` | `gemma4:e4b` (or `gemma4:e2b` for 8 GB machines, `gemma4:12b` for 32 GB) |
| OpenRouter | `https://openrouter.ai/api/v1` | e.g. `google/gemini-2.5-flash` |
| OpenAI | `https://api.openai.com/v1` | e.g. `gpt-4.1-mini` |
| LM Studio / vLLM | `http://127.0.0.1:1234/v1` | the loaded model |

Change it in **Settings → AI**. Each agent can also use its own model; see [agents-and-factories.md](agents-and-factories.md#model).

## Environment variables

Useful for Docker and the cloud. When set, they override the file, and Settings shows them as read-only.

| Variable | What it sets |
|---|---|
| `DATABAG_HOME` | data folder (default `~/.databag-os`, `/data` in Docker) |
| `DATABAG_URL` | public address, e.g. `https://os.acme.com` |
| `DATABAG_AI_BASE_URL`, `DATABAG_AI_MODEL`, `DATABAG_AI_KEY` | the AI endpoint |
| `OPENROUTER_API_KEY` | on its own, switches to OpenRouter with `google/gemini-2.5-flash` |
| `DATABAG_SPEECH_MODEL` | model for dictation (must accept audio) |
| `DATABASE_URL`, `DATABASE_AUTH_TOKEN` | a Turso/libSQL database instead of the local file |
| `CRON_SECRET` / `DATABAG_SETUP_CODE` | protects `/api/cron`, and is the code for the first account in the cloud |
| `DATABAG_APPS` | comma-separated list of apps to show |
| `DATABAG_CURRENCY` | e.g. `EUR`, `USD`, `INR` |
| `MAIL_RELAY_HOST`, `_PORT`, `_USER`, `_PASS`, `_SECURE` | outgoing mail relay |

See [.env.example](../.env.example).

## Mail

Everything is in **Settings → Domain and mail**, which is also step 4 of onboarding.

- **Mailboxes:** every person you add in Settings → People gets `name@yourdomain`, with no limit. Mail between colleagues is delivered instantly and never leaves the machine.
- **Your domain:** databag shows the records to add at your domain provider. **Check my domain** looks them up in public DNS (Cloudflare and Google):

  | Record | Why |
  |---|---|
  | `TXT yourdomain  databag-verify=…` | proves the domain is yours |
  | `A os.yourdomain → your IP` | the address your team opens |
  | `MX yourdomain → mail.yourdomain` and `A mail.yourdomain → your IP` | where mail for the domain arrives |
  | `TXT yourdomain  v=spf1 …` | which servers may send for the domain |
  | `TXT databag._domainkey.yourdomain  v=DKIM1 …` | the key that signs every outgoing message |
  | `TXT _dmarc.yourdomain  v=DMARC1 …` | what receivers do with mail that fails the checks |

- **Sending to the internet:**
  - *Directly* (the default): databag finds each recipient's mail server and delivers to it, DKIM-signed. This needs outgoing port 25, which is open on most servers and blocked on many home connections; databag tells you when it is. Gmail and Outlook only accept the mail once the SPF and DKIM records are in place.
  - *Through a relay*: Resend, Postmark, Amazon SES, Gmail (`smtp.gmail.com`, port 587, with an app password) or your current provider. This works from any network and is the most reliable from a home or office connection.
  - *Inside the company only*: nothing goes out.
- **Receiving from the internet:** point the MX record at the machine and let port 25 reach it, forwarded to databag's mail port (2525 by default).

The relay can also come from environment variables (`MAIL_RELAY_*`); Settings then shows it as read-only.
