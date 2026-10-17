// Node test runner (`npm test`, or `node --test tests/`) for the About page.
// Its facts come from the repo's own files (manifest.json, LICENSE, the first
// commit), and its privacy statement must name every network host the code,
// and the Ring libraries it runs, can reach. Reads source files only: never
// touches creds.json, the daemon, its socket, or Ring.
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import vm from "node:vm";
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");
const read = (name) => fs.readFileSync(path.join(ROOT, name), "utf8");

// About.js is a QML JavaScript resource, not a Node module (this package is
// "type": "module"), so evaluate it the way QML would and take its exports.
const sandbox = { module: { exports: {} } };
vm.runInNewContext(read("About.js"), sandbox, { filename: "About.js" });
const About = sandbox.module.exports;

// Code lines only: whole-line comments are documentation, not behaviour.
function codeLines(text) {
  return text.split("\n").filter((l) => !/^\s*(\/\/|#|\*|\/\*)/.test(l));
}

// URLs (http, ws, stun, turn) and bare quoted host names in code lines.
const URL_HOST = /\b(?:https?|wss?|stuns?|turns?):(?:\/\/)?([A-Za-z0-9.${}_-]+)/g;
const QUOTED_HOST = /["'`]((?:[a-z0-9-]+\.)+(?:com|net|org|io|solutions|dev|app))["'`]/g;
function hostsIn(text) {
  const out = [];
  for (const line of codeLines(text)) {
    for (const m of line.matchAll(URL_HOST)) out.push(m[1]);
    for (const m of line.matchAll(QUOTED_HOST)) out.push(m[1]);
  }
  return out;
}

// How a host found in code is named in the privacy text.
function privacyName(host) {
  const kinesis = /^stun\.kinesisvideo\.[a-z0-9-]+\.amazonaws\.com$/.exec(host);
  if (kinesis) return "stun.kinesisvideo.<region>.amazonaws.com";
  const googleStun = /^stun[1-4]\.l\.google\.com$/.exec(host);
  if (googleStun) return "stun1 to stun4";
  return host;
}

// Plugin and daemon sources (not node_modules, not this test).
function sourceFiles() {
  const out = [];
  for (const dir of [".", "bin", "src"]) {
    for (const f of fs.readdirSync(path.join(ROOT, dir))) {
      if (/\.(qml|js|mjs|sh|service)$/.test(f) && f !== "About.js") out.push(path.join(dir, f));
    }
  }
  return out;
}

function walk(dir, keep) {
  const out = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) out.push(...walk(full, keep));
    else if (keep(full)) out.push(full);
  }
  return out;
}

test("version comes from manifest.json", () => {
  const manifest = JSON.parse(read("manifest.json"));
  assert.equal(About.manifestVersion(read("manifest.json")), manifest.version);
  assert.match(About.manifestVersion(read("manifest.json")), /^\d+\.\d+\.\d+$/);
  assert.equal(About.manifestVersion("not json"), "");
  assert.equal(About.manifestVersion('{"version":"1.0 <b>"}'), "");
  assert.equal(About.NAME, manifest.name);
  assert.equal(manifest.author, "Nine Point Labs");
  assert.equal(manifest.id, "tim.ring-cameras"); // installs depend on it
});

test("license summary and text come from LICENSE", () => {
  const text = read("LICENSE");
  assert.equal(About.licenseSummary(text), "MIT License, © 2026 Nine Point Labs");
  const body = About.licenseBody(text);
  assert.ok(body.startsWith("MIT License\n\nCopyright (c) 2026 Nine Point Labs\n\nPermission is hereby granted"));
  assert.ok(body.includes('THE SOFTWARE IS PROVIDED "AS IS"'));
  assert.ok(!body.includes("a copy\nof"), "one line per paragraph");
});

test("facts: Nine Point Labs, created date, support address", () => {
  assert.equal(About.ORGANIZATION, "Nine Point Labs");
  assert.equal(About.SUPPORT_EMAIL, "help@ninepointlabs.com");
  const first = execFileSync("git", ["log", "--reverse", "--format=%ad", "--date=format:%B %Y"],
    { cwd: ROOT, encoding: "utf8", env: { ...process.env, LC_ALL: "C" } }).split("\n")[0];
  assert.equal(About.CREATED, first);
});

test("versions, details and mailto", () => {
  assert.equal(About.probedVersion((major, minor) => major === 6 && minor <= 11, 6), "6.11");
  assert.equal(About.probedVersion((major, minor) => major === 0 && minor <= 3, 0), "0.3");
  assert.equal(About.probedVersion(() => false, 6), "");
  assert.equal(About.probedVersion(null, 6), "");
  const details = About.details("0.1.0", "0.3", "6.11", "Hyprland, wayland");
  assert.equal(details, "Ring Cameras 0.1.0\nQuickshell 0.3, Qt 6.11\nHyprland, wayland");
  const url = About.mailto("0.1.0", details);
  assert.ok(url.startsWith("mailto:help@ninepointlabs.com?subject=Ring%20Cameras%200.1.0&body="));
  assert.equal(decodeURIComponent(url.split("&body=")[1]), "\n\n--\n" + details);
  assert.match(About.builtWith("0.3", "6.11"), /^Quickshell 0\.3, Qt 6\.11; camera daemon on Node\.js/);
});

test("privacy statement names every host in the plugin and daemon code", () => {
  for (const file of sourceFiles()) {
    for (const host of hostsIn(read(file))) {
      assert.ok(About.PRIVACY.includes(privacyName(host)), `${host} (${file}) is not named in About.PRIVACY`);
    }
  }
  assert.match(About.PRIVACY, /go to Ring \(Amazon\)/);
  assert.match(About.PRIVACY, /under Ring's own terms/);
  assert.match(About.PRIVACY, /no Nine Point Labs account, server or telemetry/);
});

test("privacy statement names every host the Ring libraries reach", (t) => {
  const nm = path.join(ROOT, "node_modules");
  if (!fs.existsSync(path.join(nm, "ring-client-api"))) return t.skip("run npm ci first");
  const files = [
    // ring-client-api's runtime code (not its tests or the CLIs this repo replaces).
    ...walk(path.join(nm, "ring-client-api/lib"), (f) => f.endsWith(".js") && !f.includes(`${path.sep}test${path.sep}`)),
    // The push receiver it starts for motion notifications. sender.js (sending
    // FCM messages as a server) and protos.js (protobuf type URLs) are not used.
    ...["client.js", "fcm.js", "gcm.js", "constants.js"].map((f) => path.join(nm, "@eneris/push-receiver/dist", f)),
  ];
  // Links in error messages, an FCM bundle id and an MCS login-request
  // domain field (names, not hosts), and the host Ring assigns at run time
  // (checked below).
  const notContacted = new Set(["github.com", "receiver.push.com", "mcs.android.com", "${host}"]);
  const found = new Set();
  for (const file of files) for (const host of hostsIn(fs.readFileSync(file, "utf8"))) found.add(host);
  for (const host of ["oauth.ring.com", "api.ring.com", "mtalk.google.com", "api.prod.signalling.ring.devices.a2z.com"]) {
    assert.ok(found.has(host), `expected ${host} in the libraries; re-check what the daemon connects to`);
  }
  for (const host of found) {
    if (notContacted.has(host)) continue;
    assert.ok(About.PRIVACY.includes(privacyName(host)), `${host} is not named in About.PRIVACY`);
  }
  // The location socket's host is assigned by Ring, and only for hub locations.
  assert.match(fs.readFileSync(path.join(nm, "ring-client-api/lib/location.js"), "utf8"), /wss:\/\/\$\{host\}/);
  assert.match(About.PRIVACY, /Ring Alarm base station or Bridge/);
});

test("privacy statement matches the credential, snapshot, socket and log code", () => {
  const paths = read("src/paths.mjs");
  assert.match(paths, /"\.local", "share", "omarchy-ring-cameras"/);
  assert.match(paths, /"\.local", "state", "omarchy", "ring-cameras"/);
  assert.match(paths, /path\.join\(dataDir, "creds\.json"\)/);
  assert.match(paths, /path\.join\(stateDir, "snapshots"\)/);
  assert.match(paths, /path\.join\(stateDir, "control\.sock"\)/);
  assert.match(paths, /path\.join\(stateDir, "daemon\.log"\)/);
  assert.ok(About.PRIVACY.includes("~/.local/share/omarchy-ring-cameras/creds.json (mode 0600, folder 0700)"));
  assert.ok(About.PRIVACY.includes("~/.local/state/omarchy/ring-cameras/snapshots/"));
  const creds = read("src/creds.mjs");
  assert.match(creds, /mkdirSync\(dataDir, \{ recursive: true, mode: 0o700 \}\)/);
  assert.match(creds, /chmodSync\(credsPath, 0o600\)/);
  assert.match(read("src/control-socket.mjs"), /chmodSync\(socketPath, 0o600\)/);
  const daemon = read("src/daemon.mjs");
  assert.match(daemon, /writeFileSync\(filePath, buffer, \{ mode: 0o600 \}\)/);
  // The only file writes are the snapshot, the log and (via creds.mjs) the token.
  const writes = codeLines(daemon).filter((l) => /fs\.(write|append)\w*\(/.test(l)).map((l) => l.trim());
  assert.deepEqual(writes, [
    "fs.appendFileSync(logPath, `[${new Date().toISOString()}] ${line}\\n`);",
    "fs.writeFileSync(filePath, buffer, { mode: 0o600 });",
  ]);
  // Live view goes to mpv's stdin, not a file.
  assert.match(daemon, /output: \["-f", "mpegts", "pipe:1"\]/);
  // The email and password are handed to Ring, never to creds.save.
  assert.doesNotMatch(daemon + read("bin/setup.mjs"), /save\([^)]*(email|password)/);
});

test("the About page never calls the camera daemon", () => {
  for (const f of ["About.js", "AboutView.qml"]) {
    const text = codeLines(read(f)).join("\n");
    assert.doesNotMatch(text, /runAction|omarchy-ring-cameras-ctl|Process\s*\{|execDetached/, f);
  }
  const panel = read("Panel.qml");
  const start = panel.indexOf("function setAbout(");
  assert.doesNotMatch(panel.slice(start, panel.indexOf("\n  }\n", start)), /runAction|refreshStatus/);
});
