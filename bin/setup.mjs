#!/usr/bin/env node
// One-time interactive login, done directly against RingRestClient rather
// than shelling out to `ring-auth-cli`. That CLI creates and closes a new
// readline.Interface for each of the Email/Password/2FA prompts, which
// hung indefinitely here: the process sat blocked in epoll_wait with zero
// network sockets ever opened, meaning it never even reached the login
// request — its own readline interface had stopped actually listening to
// stdin. A single long-lived readline.Interface for all three prompts
// avoids that class of bug entirely.
import "../src/fetch-fix.mjs";
import readline from "node:readline/promises";
import { stdin, stdout } from "node:process";
import { RingRestClient } from "ring-client-api/rest-client";
import { save } from "../src/creds.mjs";

const rl = readline.createInterface({ input: stdin, output: stdout });

const email = (await rl.question("Ring email: ")).trim();
const password = await rl.question("Ring password: ");

console.log("\nContacting Ring...");
const client = new RingRestClient({ email, password });

let auth;
try {
  auth = await client.getCurrentAuth();
} catch (err) {
  if (client.promptFor2fa) {
    console.log(client.promptFor2fa);
    for (;;) {
      const code = (await rl.question("2FA code: ")).trim();
      try {
        auth = await client.getAuth(code);
        break;
      } catch {
        console.log("Incorrect 2FA code. Try again.");
      }
    }
  } else {
    rl.close();
    console.error("\nLogin failed:", err?.message || err);
    process.exit(1);
  }
}

rl.close();

save(auth.refresh_token);
console.log("\nSaved to ~/.local/share/omarchy-ring-cameras/creds.json (mode 0600).");
console.log("Start the daemon with: systemctl --user restart omarchy-ring-cameras.service");
