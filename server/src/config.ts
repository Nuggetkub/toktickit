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
