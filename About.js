// Facts and text for the About page (AboutView.qml), kept out of QML so node
// can check them against the repo (see tests/about.test.mjs).
//
// The version comes from manifest.json and the license from LICENSE at run
// time, so neither is copied here and neither can drift from the real file.
// Nothing here talks to the camera daemon: the About page works whether or
// not the daemon is running or an account is linked.

var NAME = "Ring Cameras"
var TAGLINE = "Live view, snapshots, event history and motion notifications for your Ring cameras, from the Omarchy bar."
var ORGANIZATION = "Nine Point Labs"
var CREATED = "August 2026" // first commit: 2026-08-25
var SUPPORT_EMAIL = "help@ninepointlabs.com"

// Must stay true to the code. Sources: src/creds.mjs (creds.json, 0600),
// src/paths.mjs, src/daemon.mjs (snapshots, live view piped to mpv, history
// URLs played by mpv, notify-send, daemon.log), src/control-socket.mjs (0600
// socket), and the ring-client-api / @eneris/push-receiver / werift code it
// runs: oauth.ring.com, api.ring.com, app-snaps.ring.com,
// prd-api-us.prd.rings.solutions, the a2z.com signalling socket, the
// Kinesis and Google STUN servers, and Google's FCM hosts for push.
// tests/about.test.mjs fails if a host is added to the code (or to those
// libraries) without being named here.
var PRIVACY = [
  "Your video and account data go to Ring (Amazon) and are handled under Ring's own terms and privacy "
    + "notice. There is no Nine Point Labs account, server or telemetry: a local daemon talks to Ring "
    + "directly from this computer.",
  "Linking sends your Ring email, password and any 2FA code to oauth.ring.com; they are not saved. "
    + "What is saved is Ring's refresh token, which also holds a device ID derived from this computer and "
    + "the push-notification registration, in ~/.local/share/omarchy-ring-cameras/creds.json (mode 0600, "
    + "folder 0700). Anyone who can read that file can use your Ring account until you sign this device "
    + "out in the Ring app.",
  "The daemon connects to api.ring.com, prd-api-us.prd.rings.solutions and app-snaps.ring.com for "
    + "cameras, history and snapshots. Live view uses Ring's WebRTC signalling at "
    + "api.prod.signalling.ring.devices.a2z.com, STUN servers at stun.kinesisvideo.<region>.amazonaws.com "
    + "and stun.l.google.com (stun1 to stun4 too), and the media servers Ring assigns. History clips "
    + "stream from the addresses Ring returns for them. Motion notifications arrive through Google "
    + "Firebase Cloud Messaging (android.clients.google.com, firebaseinstallations.googleapis.com, "
    + "fcmregistrations.googleapis.com, fcm.googleapis.com, mtalk.google.com) using Ring's own app "
    + "registration. If your location has a Ring Alarm base station or Bridge, it also opens the "
    + "real-time connection Ring assigns for it.",
  "Live view and clips play in mpv and are never written to disk. Each snapshot is saved as a JPEG "
    + "(mode 0600) in ~/.local/state/omarchy/ring-cameras/snapshots/ and kept until you delete it. "
    + "daemon.log in that folder records logins, token rotations, live view starts and stops and motion "
    + "events with camera names, never your password or token. Other programs running as you can use "
    + "the daemon through control.sock there (mode 0600). The poll interval is saved in "
    + "~/.config/omarchy/shell.json."
].join("\n\n")

// "0.1.0" from manifest.json's text, or "" when it can't be read.
function manifestVersion(text) {
  try {
    var v = JSON.parse(String(text || "")).version
    return typeof v === "string" && /^[0-9A-Za-z.+-]{1,32}$/.test(v) ? v : ""
  } catch (e) {
    return ""
  }
}

// "MIT License, © 2026 Nine Point Labs" from LICENSE's text: its first line
// plus its copyright line, as written there.
function licenseSummary(text) {
  var lines = String(text || "").split("\n")
  var name = ""
  var holder = ""
  for (var i = 0; i < lines.length; i++) {
    var line = lines[i].trim()
    if (line === "") continue
    if (name === "") name = line
    var m = /^Copyright\s+(?:\(c\)|©)\s*(.+)$/i.exec(line)
    if (m) { holder = "© " + m[1]; break }
  }
  return holder ? name + ", " + holder : name
}

// LICENSE with one line per paragraph, so it wraps to the panel's width.
function licenseBody(text) {
  var paras = String(text || "").replace(/\r/g, "").split(/\n\s*\n/)
  var out = []
  for (var i = 0; i < paras.length; i++) {
    var p = paras[i].split(/\s+/).join(" ").trim()
    if (p !== "") out.push(p)
  }
  return out.join("\n\n")
}

// Highest minor version `has(major, minor)` accepts, as "major.minor"
// (Quickshell.hasVersion / hasQtVersion only answer yes or no), or "".
function probedVersion(has, major) {
  if (typeof has !== "function" || !has(major, 0)) return ""
  var minor = 0
  while (minor < 99 && has(major, minor + 1)) minor++
  return major + "." + minor
}

function builtWith(quickshell, qt) {
  return "Quickshell " + (quickshell || "?") + ", Qt " + (qt || "?")
    + "; camera daemon on Node.js with ring-client-api, ffmpeg and mpv"
}

// Version details to paste into a support email.
function details(version, quickshell, qt, desktop) {
  return NAME + " " + (version || "unknown version") + "\n"
    + "Quickshell " + (quickshell || "unknown") + ", Qt " + (qt || "unknown") + "\n"
    + (desktop || "unknown desktop")
}

function mailto(version, detailText) {
  return "mailto:" + SUPPORT_EMAIL
    + "?subject=" + encodeURIComponent(NAME + " " + (version || ""))
    + "&body=" + encodeURIComponent("\n\n--\n" + detailText)
}

if (typeof module !== "undefined") {
  module.exports = {
    NAME: NAME, TAGLINE: TAGLINE, ORGANIZATION: ORGANIZATION, CREATED: CREATED,
    SUPPORT_EMAIL: SUPPORT_EMAIL, PRIVACY: PRIVACY,
    manifestVersion: manifestVersion, licenseSummary: licenseSummary, licenseBody: licenseBody,
    probedVersion: probedVersion, builtWith: builtWith, details: details, mailto: mailto
  }
}
