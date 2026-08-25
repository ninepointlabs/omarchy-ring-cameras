import fs from "node:fs";
import { dataDir, credsPath } from "./paths.mjs";

// Plain 0600 file, same trust model as ~/.aws/credentials or gh's token
// store: filesystem permissions are the only protection, no passphrase
// unlock step. A Ring refreshToken is a session credential, not a signing
// key — losing it lets someone view/arm your account until you revoke it,
// which doesn't warrant the friction of an encrypted vault for this plugin.
export function exists() {
  return fs.existsSync(credsPath);
}

export function load() {
  if (!exists()) return null;
  return JSON.parse(fs.readFileSync(credsPath, "utf8"));
}

// Ring rotates the refresh token on use; the daemon calls this every time
// RingApi's onRefreshTokenUpdated fires so the next restart doesn't fail.
export function save(refreshToken) {
  fs.mkdirSync(dataDir, { recursive: true, mode: 0o700 });
  const data = { refreshToken, updatedAt: new Date().toISOString() };
  fs.writeFileSync(credsPath, JSON.stringify(data, null, 2) + "\n", { mode: 0o600 });
  fs.chmodSync(credsPath, 0o600);
}
