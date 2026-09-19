import { labConfig } from "./playwright.config.js";

// The Lab 3 browser suite. Everything about *how* the servers are started lives
// in playwright.config.ts; this only says which lab is running, so the two
// suites cannot drift apart in their database isolation, ports or CORS origin.
//
// Run with `npm run e2e:lab3`. It uses the disposable `lab3_e2e` schema and
// writes its artifacts under `artifacts/lab-03/`.
export default labConfig("lab-03");
