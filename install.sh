#!/bin/bash
set -euo pipefail

DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

mkdir -p ~/.config/systemd/user
ln -sf "$DIR/omarchy-ring-cameras.service" ~/.config/systemd/user/omarchy-ring-cameras.service

systemctl --user daemon-reload
systemctl --user enable --now omarchy-ring-cameras.service

echo "omarchy-ring-cameras.service installed and started."
echo "Logs: ~/.local/state/omarchy/ring-cameras/daemon.log"
echo "If you haven't linked your Ring account yet, run: node $DIR/bin/setup.mjs"
echo "Uninstall: systemctl --user disable --now omarchy-ring-cameras.service && rm ~/.config/systemd/user/omarchy-ring-cameras.service"
