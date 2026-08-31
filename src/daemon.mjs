import "./fetch-fix.mjs";
import fs from "node:fs";
import path from "node:path";
import { spawn } from "node:child_process";
import { RingApi, PushNotificationAction } from "ring-client-api";
import { RingRestClient } from "ring-client-api/rest-client";
import * as creds from "./creds.mjs";
import { createControlServer } from "./control-socket.mjs";
import { stateDir, snapshotDir, logPath } from "./paths.mjs";

let ringApi = null;
let camerasById = new Map(); // string id -> RingCamera
let active = null; // { cameraId, session, mpv } | null
let pendingLink = null; // RingRestClient awaiting a 2FA code, or null
const motionSubscribedCameraIds = new Set();

function log(line) {
  fs.mkdirSync(stateDir, { recursive: true, mode: 0o700 });
  fs.appendFileSync(logPath, `[${new Date().toISOString()}] ${line}\n`);
}

async function ensureApi() {
  if (ringApi) return ringApi;
  if (!creds.exists()) throw new Error("not set up; run `node bin/setup.mjs` first");

  const { refreshToken } = creds.load();
  ringApi = new RingApi({ refreshToken, cameraStatusPollingSeconds: 20 });

  // Ring rotates the refresh token on use — persist every rotation or the
  // next daemon restart will fail to authenticate with a stale token.
  ringApi.onRefreshTokenUpdated.subscribe(({ newRefreshToken }) => {
    creds.save(newRefreshToken);
    log("refresh token rotated and persisted");
  });

  // Set up motion notifications immediately rather than waiting for the
  // panel's first poll (up to pollIntervalSec later) — this is a daemon
  // feature independent of whether the panel is even open.
  ringApi
    .getCameras()
    .then((cameras) => subscribeToMotion(cameras))
    .catch((err) => log(`initial camera fetch failed: ${err?.message || err}`));

  return ringApi;
}

// RingCamera subscribes itself to Ring's push (ding/motion) stream on
// construction, and RingApi caches camera objects across calls — so this
// only needs to attach our own listener once per camera object's lifetime,
// guarded by id here since listCameras() re-triggers this on every poll.
function subscribeToMotion(cameras) {
  for (const camera of cameras) {
    const idStr = String(camera.id);
    if (motionSubscribedCameraIds.has(idStr)) continue;
    motionSubscribedCameraIds.add(idStr);
    camera.onNewNotification.subscribe((notification) => {
      handlePushNotification(camera, notification).catch((err) =>
        log(`push notification handling failed: ${err?.message || err}`),
      );
    });
  }
}

async function handlePushNotification(camera, notification) {
  if (notification?.android_config?.category !== PushNotificationAction.Motion) return;
  const dingId = notification?.data?.event?.ding?.id;
  log(`motion detected: ${camera.name} (${camera.id})`);
  await notifyMotion(camera, dingId);
}

// notify-send -A implies --wait and prints the chosen action's name to
// stdout once the user interacts (or nothing, if it times out/gets
// dismissed). Omarchy's notification daemon treats the "default" action id
// as "the user clicked the notification body" (not a separate button).
async function notifyMotion(camera, dingId) {
  const proc = spawn(
    "notify-send",
    ["-a", "Ring Cameras", "-i", "camera-web", "-A", "default=View clip", `Motion detected`, camera.name],
    { stdio: ["ignore", "pipe", "ignore"] },
  );

  let output = "";
  proc.stdout.on("data", (chunk) => {
    output += chunk.toString("utf8");
  });

  const clicked = await new Promise((resolve) => {
    proc.on("exit", () => resolve(output.includes("default")));
    proc.on("error", () => resolve(false));
  });

  if (!clicked || !dingId) return;

  try {
    const url = await resolveRecordingUrl(camera, dingId);
    playRecording(url);
  } catch (err) {
    log(`could not resolve recording for ding ${dingId}: ${err?.message || err}`);
  }
}

// The clip may still be processing right when the notification fires;
// retry a few times rather than failing outright if the user clicks fast.
// getRecordingUrl targets Ring's short-lived "recent dings" API — verified
// it 404s ("Url not found") once a ding has aged out of that feed, even
// though the clip is still there. Falls back to the same long-term
// recording archive History uses (videoSearch), matched by ding id —
// verified that recovers a valid URL for a ding getRecordingUrl rejected.
async function resolveRecordingUrl(camera, dingId, attempts = 4) {
  for (let i = 0; i < attempts; i++) {
    try {
      return await camera.getRecordingUrl(dingId, { transcoded: true });
    } catch (err) {
      const dateTo = Date.now();
      const dateFrom = dateTo - 15 * 60_000;
      const result = await camera.videoSearch({ dateFrom, dateTo, order: "desc" });
      const match = result.video_search.find((v) => String(v.ding_id) === String(dingId));
      if (match) return match.hq_url || match.lq_url || match.untranscoded_url;
      if (i === attempts - 1) throw err;
      await new Promise((resolve) => setTimeout(resolve, 2000));
    }
  }
}

async function listCameras() {
  const api = await ensureApi();
  const cameras = await api.getCameras();
  camerasById = new Map(cameras.map((c) => [String(c.id), c]));
  subscribeToMotion(cameras);
  return cameras.map((c) => ({
    id: String(c.id),
    name: c.name,
    batteryLevel: c.batteryLevel,
    isOffline: c.isOffline,
    hasLight: c.hasLight,
    hasSiren: c.hasSiren,
  }));
}

function getCamera(cameraId) {
  const camera = camerasById.get(String(cameraId));
  if (!camera) throw new Error("unknown camera id; call list_cameras first");
  return camera;
}

async function takeSnapshot(cameraId) {
  const camera = getCamera(cameraId);
  const buffer = await camera.getSnapshot();
  fs.mkdirSync(snapshotDir, { recursive: true, mode: 0o700 });
  const filePath = path.join(snapshotDir, `${cameraId}-${Date.now()}.jpg`);
  fs.writeFileSync(filePath, buffer, { mode: 0o600 });
  return filePath;
}

const HISTORY_LIMIT = 30;

async function getHistory(cameraId, hours) {
  const camera = getCamera(cameraId);
  const dateTo = Date.now();
  const dateFrom = dateTo - Math.max(1, Number(hours) || 24) * 3600_000;
  const result = await camera.videoSearch({ dateFrom, dateTo, order: "desc" });
  return result.video_search.slice(0, HISTORY_LIMIT).map((v) => ({
    dingId: v.ding_id,
    createdAt: v.created_at,
    kind: v.kind,
    duration: v.duration,
    url: v.hq_url || v.lq_url || v.untranscoded_url,
    favorite: v.favorite,
  }));
}

// Recordings are plain HTTPS URLs (mp4/HLS) — mpv fetches and decodes them
// itself, no ffmpeg piping needed like the live-view path requires. Fire
// and forget: each clip opens its own player window, independent of any
// active live view.
function playRecording(url) {
  if (!url) throw new Error("recording has no playable url");
  spawn("mpv", ["--no-terminal", "--force-window=yes", "--title=Ring recording", url], {
    stdio: "ignore",
    detached: true,
  }).unref();
  return { playing: true };
}

// One live view at a time for this prototype: starting a new one stops
// whatever was already playing. ffmpeg (spawned internally by streamVideo)
// muxes the live RTP into MPEG-TS and hands us the raw bytes via
// stdoutCallback; we just forward them into mpv's stdin.
async function startLiveView(cameraId) {
  if (active) stopLiveView();

  const camera = getCamera(cameraId);
  const mpv = spawn(
    "mpv",
    ["--no-terminal", "--force-window=yes", `--title=Ring: ${camera.name}`, "-"],
    { stdio: ["pipe", "ignore", "ignore"] },
  );

  // Closing the mpv window (or mpv dying) while streamVideo() is still handing
  // us chunks breaks the pipe, and the next write lands an asynchronous EPIPE
  // on mpv.stdin. With no listener Node promotes that to an unhandled 'error'
  // and kills the whole daemon — systemd restarts it, but the camera list and
  // any active session are gone — so every live view ended by closing its
  // window was taking the daemon down. Swallow the pipe-teardown errors; the
  // mpv "exit" handler below does the actual cleanup.
  mpv.stdin.on("error", (err) => {
    if (err?.code !== "EPIPE" && err?.code !== "ERR_STREAM_DESTROYED") {
      log(`live view mpv stdin error: ${err?.message || err}`);
    }
  });

  const session = await camera.streamVideo({
    output: ["-f", "mpegts", "pipe:1"],
    stdoutCallback: (chunk) => {
      if (mpv.killed || !mpv.stdin.writable) return;
      try {
        mpv.stdin.write(chunk);
      } catch {
        /* pipe closed between the check and the write; mpv "exit" cleans up */
      }
    },
  });

  session.onCallEnded.subscribe(() => {
    if (active && active.cameraId === String(cameraId)) stopLiveView();
  });
  mpv.on("exit", () => {
    if (active && active.mpv === mpv) stopLiveView();
  });

  active = { cameraId: String(cameraId), session, mpv };
  log(`live view started: ${camera.name} (${cameraId})`);
  return { cameraId: String(cameraId), playing: true };
}

function stopLiveView() {
  if (!active) return { playing: false };
  const { cameraId, session, mpv } = active;
  active = null;
  try {
    session.stop();
  } catch {
    /* best-effort */
  }
  try {
    mpv.stdin.end();
  } catch {
    /* best-effort */
  }
  try {
    mpv.kill();
  } catch {
    /* best-effort */
  }
  log(`live view stopped: ${cameraId}`);
  return { cameraId, playing: false };
}

// In-panel account linking, mirroring bin/setup.mjs's flow but split into
// two socket round-trips so the QML panel can show a 2FA step instead of a
// blocking terminal prompt. Email/password/code arrive over the control
// socket, which ctl.mjs only ever forwards from stdin for these commands —
// never argv — so they don't show up in `ps`/`/proc/<pid>/cmdline`.
function finalizeLink(refreshToken) {
  creds.save(refreshToken);
  ringApi = null; // rebuilt lazily by ensureApi() from the new token
  camerasById = new Map();
  // Re-linking builds brand new RingCamera objects even for the same
  // physical camera ids — without clearing this, subscribeToMotion() would
  // see the id as "already subscribed" and skip attaching a listener to
  // the new object, silently breaking notifications after any re-link.
  motionSubscribedCameraIds.clear();
  pendingLink = null;
  log("Ring account linked");
  broadcastStatus();
}

async function linkStart(email, password) {
  if (!email || !password) throw new Error("email and password required");
  pendingLink = new RingRestClient({ email, password });
  try {
    const auth = await pendingLink.getCurrentAuth();
    finalizeLink(auth.refresh_token);
    return { status: "linked" };
  } catch (err) {
    if (pendingLink.promptFor2fa) {
      return { status: "needs_2fa", prompt: pendingLink.promptFor2fa };
    }
    pendingLink = null;
    throw new Error(err?.message || String(err));
  }
}

async function linkTwoFactor(code) {
  if (!pendingLink) throw new Error("no login in progress; start over");
  if (!code) throw new Error("code required");
  try {
    const auth = await pendingLink.getAuth(code);
    finalizeLink(auth.refresh_token);
    return { status: "linked" };
  } catch {
    return { status: "needs_2fa", prompt: "Incorrect 2FA code. Try again." };
  }
}

function linkCancel() {
  pendingLink = null;
  return { status: "cancelled" };
}

function broadcastStatus() {
  server.broadcast("status_changed", status());
}

function status() {
  return {
    setupComplete: creds.exists(),
    cameraCount: camerasById.size,
    activeLiveView: active ? active.cameraId : null,
    linkPending: !!pendingLink,
  };
}

async function handleCommand(cmd, req) {
  switch (cmd) {
    case "status":
      return status();

    case "list_cameras":
      return { cameras: await listCameras() };

    case "snapshot":
      if (!req.cameraId) throw new Error("cameraId required");
      return { path: await takeSnapshot(req.cameraId) };

    case "live_view_start":
      if (!req.cameraId) throw new Error("cameraId required");
      return startLiveView(req.cameraId);

    case "live_view_stop":
      return stopLiveView();

    case "history":
      if (!req.cameraId) throw new Error("cameraId required");
      return { events: await getHistory(req.cameraId, req.hours) };

    case "play_recording":
      return playRecording(req.url);

    case "link_start":
      return linkStart(req.email, req.password);

    case "link_2fa":
      return linkTwoFactor(req.code);

    case "link_cancel":
      return linkCancel();

    default:
      throw new Error(`unknown command: ${cmd}`);
  }
}

const server = createControlServer(handleCommand);

process.on("SIGTERM", () => process.exit(0));
process.on("SIGINT", () => process.exit(0));

await server.listen();
log(`daemon listening, creds ${creds.exists() ? "present" : "absent"}`);
