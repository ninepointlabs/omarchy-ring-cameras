import os from "node:os";
import path from "node:path";

const home = os.homedir();

export const dataDir = path.join(home, ".local", "share", "omarchy-ring-cameras");
export const stateDir = path.join(home, ".local", "state", "omarchy", "ring-cameras");

export const credsPath = path.join(dataDir, "creds.json");
export const snapshotDir = path.join(stateDir, "snapshots");
export const socketPath = path.join(stateDir, "control.sock");
export const logPath = path.join(stateDir, "daemon.log");
