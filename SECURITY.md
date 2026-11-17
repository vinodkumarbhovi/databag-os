# Security

Please report vulnerabilities privately through **GitHub → Security → Report a vulnerability** on this repository, not in a public issue. We aim to reply within a week.

## How databag protects a company

- **Your data stays with you.** A local install keeps everything in `~/.databag-os` on your machine. With the default local model, no company data is sent to an AI provider.
- **Agents ask first.** Anything that reaches other people waits for a person's approval: emails, invitations, invoices, posts and MCP tools (by default). If you decline, the agent cannot claim it went ahead.
- **Secrets are write-only.** API keys and MCP tokens are never sent back to the browser. The settings file is readable by its owner only.
- **No programs from the web page.** MCP servers are reached over HTTP only; databag never starts local programs on behalf of a web request.
- **A cloud install is locked until set up.** The first account needs the setup code (`CRON_SECRET` or `DATABAG_SETUP_CODE`).
- **Uploaded SVG logos** are served with a content security policy, so they cannot run scripts.
- Passwords are hashed with scrypt, and sessions are HTTP-only cookies.

## Running it on the internet

- Use HTTPS. A Cloudflare Tunnel or a reverse proxy with automatic certificates is easiest; see [docs/install.md](docs/install.md#your-domain).
- Keep databag listening on `127.0.0.1`, which is the default, behind that tunnel or proxy.
- Keep backups on another disk (Settings → This machine).
