#!/bin/bash
set -euo pipefail

DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

# The QML panel invokes `omarchy-ring-cameras-ctl` as a bare command (not an
# absolute path) so this works regardless of where the repo was cloned —
# it just needs to resolve on $PATH, same as any other omarchy-* binary.
mkdir -p ~/.local/bin
ln -sf "$DIR/bin/ctl.mjs" ~/.local/bin/omarchy-ring-cameras-ctl
chmod +x "$DIR/bin/ctl.mjs"

NODE_BIN="$(command -v node || true)"
if [[ -z "$NODE_BIN" ]]; then
  echo "node not found on PATH; install Node.js first (any of nvm/mise/volta/your distro's package works)." >&2
  exit 1
fi

# Generated, not shipped as a static file: a systemd --user service can't
# rely on the resolved $NODE_BIN or on the repo living at any particular
# path, since both vary per install (which Node version manager you use,
# where you cloned this).
mkdir -p ~/.config/systemd/user
cat > ~/.config/systemd/user/omarchy-ring-cameras.service <<EOF
[Unit]
Description=Omarchy Ring cameras daemon
After=default.target

[Service]
Type=simple
ExecStart=$NODE_BIN $DIR/src/daemon.mjs
Restart=on-failure
RestartSec=2
LimitCORE=0
NoNewPrivileges=true
PrivateTmp=true

[Install]
WantedBy=default.target
EOF

systemctl --user daemon-reload
systemctl --user enable --now omarchy-ring-cameras.service

echo "omarchy-ring-cameras.service installed and started (using $NODE_BIN)."
echo "Logs: ~/.local/state/omarchy/ring-cameras/daemon.log"
echo "Make sure ~/.local/bin is on your PATH, then open the 'Ring Cameras' bar icon to link your account (or run: node $DIR/bin/setup.mjs)"
echo "Uninstall: systemctl --user disable --now omarchy-ring-cameras.service && rm ~/.config/systemd/user/omarchy-ring-cameras.service ~/.local/bin/omarchy-ring-cameras-ctl"
