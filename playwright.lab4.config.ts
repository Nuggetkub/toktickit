import { labConfig } from "./playwright.config.js";

// The Lab 4 browser suite (issue #90). As for Lab 3, how the servers start lives
// in playwright.config.ts; this only names the lab.
//
// Run with `npm run e2e:lab4`. It uses the disposable `lab4_e2e` schema, loaded
// with the demo seed, and writes its artifacts under `artifacts/lab-04/`.
export default labConfig("lab-04");
