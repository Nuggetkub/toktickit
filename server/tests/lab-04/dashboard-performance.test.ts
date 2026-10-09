import { performance } from "node:perf_hooks";
import { PrismaClient } from "@prisma/client";
import request from "supertest";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { seedReferenceData } from "../../src/seed-data.js";
import { seedDemoTickets } from "../../src/demo-tickets.js";
import { seedDemoActivity } from "../../src/demo-activity.js";
import { deployMigrations, dropSchema, resetSchema, scratchUrl } from "../lab-03/support.js";

// PERF-01 in docs/lab-04/tests.md (AC-29): a performance smoke test, not a
// benchmark. AC-29 says "the seeded database", and the shared test schema
// holds no Tickets (global-setup.ts seeds reference data only), so timing it
// would time an empty database. This file builds its own schema, migrated and
// loaded with the real demo seed, and points the application at it.
//
// 50 sequential requests to each dashboard and to the busiest Ticket's Action
// list; the 95th percentile must be under 500 ms. The first request of each is
// a warm-up and not counted. The figures are printed so a regression shows as a
// number, not only as a pass or a fail.

const SCHEMA = "lab4_perf_test";
const url = scratchUrl(SCHEMA);
const RUNS = 50;
const LIMIT_MS = 500;
let seeded: PrismaClient;
let app: typeof import("../../src/app.js").app;
let sessionCookieFor: typeof import("../support/session.js").sessionCookieFor;

beforeAll(async () => {
  await resetSchema(SCHEMA);
  deployMigrations(url);
  seeded = new PrismaClient({ datasourceUrl: url });
  await seedReferenceData(seeded);
  await seedDemoTickets(seeded);
  await seedDemoActivity(seeded);
  // src/prisma.ts reads DATABASE_URL when the client is first used, and Vitest
  // gives each test file its own modules, so the application in this file
  // talks to the seeded schema and no other suite is affected.
  process.env.DATABASE_URL = url;
  ({ app } = await import("../../src/app.js"));
  ({ sessionCookieFor } = await import("../support/session.js"));
}, 180_000);

afterAll(async () => {
  const { getPrisma } = await import("../../src/prisma.js");
  await getPrisma().$disconnect();
  await seeded?.$disconnect();
  await dropSchema(SCHEMA);
});

async function p95(label: string, send: () => request.Test) {
  const warm = await send();
  expect(warm.status, JSON.stringify(warm.body)).toBe(200);
  const samples: number[] = [];
  for (let i = 0; i < RUNS; i += 1) {
    const start = performance.now();
    const res = await send();
    samples.push(performance.now() - start);
    expect(res.status).toBe(200);
  }
  samples.sort((a, b) => a - b);
  const at95 = samples[Math.ceil(0.95 * samples.length) - 1];
  const median = samples[Math.floor(samples.length / 2)];
  console.log(`PERF-01 ${label}: ${RUNS} requests, median ${median.toFixed(1)} ms, p95 ${at95.toFixed(1)} ms, max ${samples.at(-1)!.toFixed(1)} ms`);
  return at95;
}

describe("PERF-01 the dashboards and the Action list answer within 500 ms at p95 (AC-29)", () => {
  it("on the seeded demo data, as seeded accounts", async () => {
    // The seeded Requester with the most Tickets, a seeded IT Staff member and
    // Administrator, and the seeded Ticket with the most Actions.
    const [requester] = await seeded.user.findMany({
      where: { role: "REQUESTER", isActive: true }, orderBy: { tickets: { _count: "desc" } }, take: 1, select: { id: true },
    });
    const staff = await seeded.user.findFirstOrThrow({ where: { role: "IT_STAFF", isActive: true }, select: { id: true } });
    const admin = await seeded.user.findFirstOrThrow({ where: { role: "ADMINISTRATOR", isActive: true }, select: { id: true } });
    const [busiest] = await seeded.ticket.findMany({ orderBy: { actionsTaken: { _count: "desc" } }, take: 1, select: { id: true } });
    const context = {
      tickets: await seeded.ticket.count(),
      actions: await seeded.actionTaken.count(),
      events: await seeded.ticketStatusEvent.count(),
    };
    console.log(`PERF-01 context: ${context.tickets} Tickets, ${context.actions} Actions, ${context.events} Status Events; Node ${process.version}`);
    // A smoke test over nothing proves nothing: the seed must have loaded.
    expect(context.tickets).toBeGreaterThan(0);
    expect(context.actions).toBeGreaterThan(0);

    const cookies = {
      requester: await sessionCookieFor(requester.id),
      staff: await sessionCookieFor(staff.id),
      admin: await sessionCookieFor(admin.id),
    };
    const results = {
      requesterDashboard: await p95("Requester dashboard", () => request(app).get("/api/dashboard/requester").set("Cookie", cookies.requester)),
      staffDashboard: await p95("IT Staff dashboard", () => request(app).get("/api/dashboard/staff").set("Cookie", cookies.staff)),
      adminDashboard: await p95("Administrator dashboard", () => request(app).get("/api/dashboard/staff").set("Cookie", cookies.admin)),
      actionList: await p95("Action list", () => request(app).get(`/api/tickets/${busiest.id}/actions`).set("Cookie", cookies.staff)),
    };
    for (const [name, value] of Object.entries(results)) expect(value, name).toBeLessThan(LIMIT_MS);
  }, 180_000);
});
