#!/usr/bin/env node
import net from "node:net";
import { socketPath } from "../src/paths.mjs";

const args = process.argv.slice(2);
const useStdin = args.includes("--stdin");
const [cmd, payloadJson] = args.filter((a) => a !== "--stdin");

if (!cmd) {
  process.stderr.write("usage: omarchy-ring-cameras-ctl <cmd> [json-payload | --stdin]\n");
  process.exit(2);
}

// --stdin carries the payload as one line on stdin instead of argv, for
// commands with secrets (email/password/2FA code) — argv is readable by
// any other process on this machine via /proc/<pid>/cmdline for as long as
// this short-lived process is alive. Resolves on the first newline rather
// than waiting for stdin to close, since it's not guaranteed the writer
// (the QML panel's Process) ever closes the child's stdin.
//
// MAX_MESSAGE_BYTES bounds this the same way it bounds the socket reads
// below: whatever is on the other end of stdin, buffer growth stops well
// short of exhausting memory instead of continuing until a newline shows up.
const MAX_MESSAGE_BYTES = 1024 * 1024; // 1 MiB

function readStdinLine() {
  return new Promise((resolve, reject) => {
    let buffer = "";
    function onData(chunk) {
      if (buffer.length + chunk.length > MAX_MESSAGE_BYTES) {
        process.stdin.removeListener("data", onData);
        process.stdin.pause();
        reject(new Error("stdin_too_large"));
        return;
      }
      buffer += chunk.toString("utf8");
      const newlineIndex = buffer.indexOf("\n");
      if (newlineIndex !== -1) {
        process.stdin.removeListener("data", onData);
        process.stdin.pause();
        resolve(buffer.slice(0, newlineIndex));
      }
    }
    process.stdin.on("data", onData);
    process.stdin.resume();
  });
}

let payload = {};
if (useStdin) {
  let line;
  try {
    line = (await readStdinLine()).trim();
  } catch {
    process.stdout.write(JSON.stringify({ ok: false, error: "stdin_too_large" }) + "\n");
    process.exit(1);
  }
  if (line) {
    try {
      payload = JSON.parse(line);
    } catch {
      process.stdout.write(JSON.stringify({ ok: false, error: "invalid_json_payload" }) + "\n");
      process.exit(1);
    }
  }
} else if (payloadJson) {
  try {
    payload = JSON.parse(payloadJson);
  } catch {
    process.stdout.write(JSON.stringify({ ok: false, error: "invalid_json_payload" }) + "\n");
    process.exit(1);
  }
}

const socket = net.createConnection(socketPath);
let buffer = "";

socket.on("connect", () => {
  socket.write(JSON.stringify({ cmd, ...payload }) + "\n");
});

socket.on("data", (chunk) => {
  // Bounds what this process ever accumulates from the daemon before a
  // newline arrives — the daemon enforces the same limit on its own
  // buffering (see MAX_MESSAGE_BYTES in control-socket.mjs), but this side
  // needs its own bound too: whatever ends up here also gets written to
  // this process's stdout, which the QML panel retains in full via
  // StdioCollector, so an unbounded read here means unbounded retention in
  // the long-lived shell process, not just this short-lived one.
  if (buffer.length + chunk.length > MAX_MESSAGE_BYTES) {
    process.stdout.write(JSON.stringify({ ok: false, error: "response_too_large" }) + "\n");
    socket.destroy();
    process.exit(1);
  }
  buffer += chunk.toString("utf8");
  let newlineIndex;
  while ((newlineIndex = buffer.indexOf("\n")) !== -1) {
    const line = buffer.slice(0, newlineIndex);
    buffer = buffer.slice(newlineIndex + 1);
    if (line.trim()) process.stdout.write(line + "\n");
    if (cmd !== "watch") socket.end();
  }
});

socket.on("error", () => {
  process.stdout.write(JSON.stringify({ ok: false, error: "daemon_not_running" }) + "\n");
  process.exit(1);
});

socket.on("close", () => {
  if (cmd !== "watch") process.exit(0);
});
