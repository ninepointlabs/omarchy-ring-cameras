// ring-client-api builds its network Agent from its own npm-installed
// `undici` dependency, then hands that Agent to the global `fetch` as a
// custom dispatcher (rest-client.js calls the bare `fetch` identifier, so
// it always uses whatever `globalThis.fetch` is at call time). On this
// machine that global fetch is Node v26.7.0's *built-in* fetch, backed by
// a different internal undici version than the one npm installed — passing
// an Agent from one undici version as a dispatcher to a fetch from another
// doesn't error, it just silently never dispatches the request. Confirmed
// live: the login request sat for 80+ seconds with zero network sockets
// ever opened, while curl and undici's own fetch hit the same endpoint in
// under 200ms. Node's `package.json` engines range (^18 || ^20 || ^22)
// warned about exactly this kind of mismatch on newer majors.
//
// Forcing the global fetch to undici's own implementation makes the
// dispatcher and the fetch call come from the same undici instance, which
// fixes it. Import this before importing anything from ring-client-api.
import { fetch as undiciFetch } from "undici";

globalThis.fetch = undiciFetch;
