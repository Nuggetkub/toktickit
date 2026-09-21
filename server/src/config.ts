import { createRequire } from "node:module";

// Read package.json at runtime rather than importing it, so this works the same
// under tsx, vitest and a compiled build without needing JSON import attributes.
const require = createRequire(import.meta.url);
const pkg = require("../package.json") as {
  name: string;
  displayName?: string;
};

// The public service name. It lives in package.json so there is one source of
// truth and it cannot drift if the service is renamed. `displayName` is used
// rather than `name` because the npm package is "toktickit-server" while the API
// identifies itself to clients as "TokTickIT API".
export const SERVICE_NAME = pkg.displayName ?? pkg.name;

// Origin allowed to call this API. Wildcard CORS lets any site call the API, so
// the allowed origin is pinned to the Vite dev server by default and overridable
// per environment.
export const CLIENT_ORIGIN = process.env.CLIENT_ORIGIN ?? "http://localhost:5173";

/**
 * Every origin the browser client may call from, comma-separated.
 *
 * Lab 3 sends credentials with each request, and a cookie is only useful if CORS
 * names the exact origin — `Access-Control-Allow-Origin: *` is rejected by the
 * browser as soon as credentials are involved. This list is also what the Origin
 * check in BR-16 compares against, which is the CSRF defence: `SameSite=Lax`
 * stops a cross-*site* request carrying the cookie, and this stops a same-site
 * one from another port on localhost (decision D-03).
 */
export const CLIENT_ORIGINS = (process.env.CLIENT_ORIGINS ?? CLIENT_ORIGIN)
  .split(",")
  .map((origin) => origin.trim())
  .filter(Boolean);

/**
 * Whether the session cookie carries `Secure`. Off by default because local
 * development is plain HTTP; set it for anything served over HTTPS.
 */
export const COOKIE_SECURE = process.env.COOKIE_SECURE === "true";
