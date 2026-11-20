#!/bin/sh
# databag one-line installer for any Mac or Linux machine: a laptop, a desktop, a VM or a server.
#
#   curl -fsSL https://raw.githubusercontent.com/vinodkumarbhovi/databag-os/main/install.sh | sh
#
# What it does, in order (on a Mac nothing needs your password):
#   1. Node.js 24: uses yours if it is new enough, otherwise downloads the official build
#      from nodejs.org into ~/.databag-os/runtime and checks its SHA-256.
#   2. Ollama (the local AI runtime), unless you set DATABAG_AI=cloud.
#   3. databag itself, from npm (package "databag-os") or the latest GitHub release, into ~/.databag-os/app.
#   4. Asks the setup questions (domain, company, logo, AI, apps), downloads Gemma 4
#      and starts databag. It can then start by itself whenever the machine starts
#      (a LaunchAgent on macOS, a systemd service on Linux).
#
# Options (environment variables):
#   DATABAG_HOME=/path   where data lives (default ~/.databag-os)
#   DATABAG_AI=cloud     skip Ollama; you will be asked for an OpenRouter or OpenAI key
#   DATABAG_VERSION=x.y  install a specific databag version
#   DATABAG_PACKAGE=…    install from a package file or URL instead (offline or company mirrors)
set -eu

DATA="${DATABAG_HOME:-$HOME/.databag-os}"
RUNTIME="$DATA/runtime"
APP="$DATA/app"
PKG="${DATABAG_PACKAGE:-databag-os${DATABAG_VERSION:+@$DATABAG_VERSION}}"
REPO="vinodkumarbhovi/databag-os"

say() { printf '\033[1;32m›\033[0m %s\n' "$1"; }
fail() { printf '\033[1;31m✗\033[0m %s\n' "$1" >&2; exit 1; }
have() { command -v "$1" >/dev/null 2>&1; }

case "$(uname -s)" in Darwin) OS=darwin ;; Linux) OS=linux ;; *) fail "This installer supports macOS and Linux. On Windows, use Docker (see the README)." ;; esac
case "$(uname -m)" in arm64|aarch64) ARCH=arm64 ;; x86_64|amd64) ARCH=x64 ;; *) fail "Unsupported processor: $(uname -m)" ;; esac
have curl || fail "curl is needed."
mkdir -p "$RUNTIME"

# 1. Node.js 24 or newer
node_ok() { have node && [ "$(node -p 'process.versions.node.split(".")[0]' 2>/dev/null || echo 0)" -ge 24 ]; }
if [ -x "$RUNTIME/node/bin/node" ]; then PATH="$RUNTIME/node/bin:$PATH"; fi
if ! node_ok; then
  say "Downloading Node.js 24 from nodejs.org…"
  BASE="https://nodejs.org/dist/latest-v24.x"
  SUMS="$(curl -fsSL "$BASE/SHASUMS256.txt")"
  FILE="$(printf '%s\n' "$SUMS" | awk '{print $2}' | grep -E "^node-v[0-9.]+-$OS-$ARCH\.tar\.gz$" | head -1)"
  [ -n "$FILE" ] || fail "No Node.js build found for $OS-$ARCH."
  TMP="$(mktemp -d)"
  curl -fL --progress-bar "$BASE/$FILE" -o "$TMP/$FILE"
  WANT="$(printf '%s\n' "$SUMS" | awk -v f="$FILE" '$2 == f {print $1}')"
  if have shasum; then GOT="$(shasum -a 256 "$TMP/$FILE" | awk '{print $1}')"; else GOT="$(sha256sum "$TMP/$FILE" | awk '{print $1}')"; fi
  [ "$WANT" = "$GOT" ] || fail "The Node.js download did not match its checksum. Try again."
  rm -rf "$RUNTIME/node" && mkdir -p "$RUNTIME/node"
  tar -xzf "$TMP/$FILE" -C "$RUNTIME/node" --strip-components 1
  rm -rf "$TMP"
  PATH="$RUNTIME/node/bin:$PATH"
fi
say "Node.js $(node -v)"

# 2. Ollama, for the local AI model
if [ "${DATABAG_AI:-local}" != "cloud" ]; then
  if ! have ollama && [ ! -d /Applications/Ollama.app ] && [ ! -d "$HOME/Applications/Ollama.app" ]; then
    if [ "$OS" = darwin ]; then
      say "Downloading Ollama (runs the AI model on this machine)…"
      TMP="$(mktemp -d)"
      curl -fL --progress-bar https://ollama.com/download/Ollama-darwin.zip -o "$TMP/Ollama.zip"
      mkdir -p "$HOME/Applications"
      unzip -q "$TMP/Ollama.zip" -d "$HOME/Applications"
      rm -rf "$TMP"
    else
      say "Installing Ollama with its official script (it may ask for your password)…"
      curl -fsSL https://ollama.com/install.sh | sh
    fi
  fi
  if ! curl -fs http://127.0.0.1:11434/api/version >/dev/null 2>&1; then
    say "Starting Ollama…"
    if [ "$OS" = darwin ]; then open -g -a Ollama 2>/dev/null || open -g "$HOME/Applications/Ollama.app"; else (ollama serve >/dev/null 2>&1 &); fi
    i=0; until curl -fs http://127.0.0.1:11434/api/version >/dev/null 2>&1; do i=$((i + 1)); [ $i -gt 60 ] && break; sleep 1; done
  fi
  # The Ollama app puts its command-line tool here on a Mac.
  for d in /usr/local/bin /opt/homebrew/bin "$HOME/Applications/Ollama.app/Contents/Resources" /Applications/Ollama.app/Contents/Resources; do [ -x "$d/ollama" ] && PATH="$PATH:$d"; done
fi

# 3. databag itself
say "Installing databag…"
mkdir -p "$APP"
BIN="$APP/bin/databag"
# npm may answer with a placeholder (for example while a new version is in review); then use the GitHub release.
if ! npm install --global --prefix "$APP" --no-fund --no-audit --loglevel=error "$PKG" 2>/dev/null || [ ! -x "$BIN" ]; then
  say "Installing the latest release from GitHub…"
  npm uninstall --global --prefix "$APP" --loglevel=error databag-os >/dev/null 2>&1 || true
  npm install --global --prefix "$APP" --no-fund --no-audit --loglevel=error "https://github.com/$REPO/releases/latest/download/databag-os.tgz" || fail "Could not install databag."
fi
[ -x "$BIN" ] || fail "databag was not installed correctly."

# A small launcher that always uses this Node.js, so "databag" works in any new shell,
# whether or not that shell can find Node.js itself.
mkdir -p "$DATA/bin"
printf '#!/bin/sh\nexec "%s" "%s" "$@"\n' "$(command -v node)" "$APP/lib/node_modules/databag-os/bin/databag.mjs" > "$DATA/bin/databag"
chmod +x "$DATA/bin/databag"
BIN="$DATA/bin/databag"

# Make "databag" available in new terminal windows.
LINE="export PATH=\"$DATA/bin:\$PATH\""
if [ "$OS" = darwin ]; then FILES="$HOME/.zprofile $HOME/.bashrc"; else FILES="$HOME/.profile $HOME/.bashrc"; fi
for rc in $FILES; do
  case "$rc" in */.zprofile|*/.profile) ;; *) [ -f "$rc" ] || continue ;; esac
  grep -qs "$DATA/bin" "$rc" || printf '\n# databag\n%s\n' "$LINE" >> "$rc"
done
[ -d "$HOME/.local/bin" ] && ln -sf "$DATA/bin/databag" "$HOME/.local/bin/databag"

# 4. Setup questions, model download, start
say "Almost done. A few questions to make databag yours:"
# "curl … | sh" uses the pipe as input, so the questions read from the terminal itself.
if (exec < /dev/tty) 2>/dev/null; then "$BIN" < /dev/tty; else "$BIN" init --yes && "$BIN"; fi
if [ "$OS" = darwin ]; then sleep 3; open "http://localhost:4100" 2>/dev/null || true; fi
say "databag is installed. Open http://localhost:4100 to create your account. Run 'databag help' for commands."
