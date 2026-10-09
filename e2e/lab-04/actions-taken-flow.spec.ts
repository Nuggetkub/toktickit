import {
  ADMINISTRATOR,
  API_ORIGIN,
  COLLEAGUE,
  INACTIVE_STAFF,
  REQUESTER,
  STAFF,
  actionRow,
  actionsCard,
  addAction,
  apiCreateAction,
  createTicket,
  expect,
  openInQueue,
  openMyTickets,
  signIn,
  signOut,
  test,
  ticketIdFromUrl,
  uniqueSummary,
} from "./support";

// E2E-01 and E2E-05 in docs/lab-04/tests.md, in a browser against the real
// stack and the lab4_e2e schema.

test.describe.configure({ mode: "serial" });

test("E2E-01 IT Staff record and plan work, a colleague completes theirs, and the Requester reads both", async ({ page, expectHttp }) => {
  test.setTimeout(180_000);

  // The inactive colleague's id, for the forged request below.
  await signIn(page, ADMINISTRATOR);
  const users = await (await page.request.get(`${API_ORIGIN}/api/admin/users?search=wichai`)).json();
  const inactive = users.items.find((user: { email: string }) => user.email === INACTIVE_STAFF.email);
  expect(inactive, "the seeded inactive member of staff").toBeTruthy();
  await signOut(page);

  await signIn(page, REQUESTER);
  const ticketNumber = await createTicket(page, { summary: uniqueSummary("Annexe printer offline") });
  await signOut(page);

  await signIn(page, STAFF);
  await openInQueue(page, ticketNumber);
  const ticketId = ticketIdFromUrl(page);

  // Completed work, recorded by Grace for herself (the form's default status).
  const done = "Power-cycled the annexe printer and cleared the queue.";
  let form = await addAction(page, { description: done, result: "Printer prints a test page again." });
  // An inactive account is never offered as an assignee (BR-06).
  const offered = await form.getByLabel(/^Assignee/).locator("option").allTextContents();
  expect(offered).toContain(STAFF.fullName);
  expect(offered).toContain(COLLEAGUE.fullName);
  expect(offered.join("|")).not.toContain("Wichai");
  await form.getByRole("button", { name: "Save action" }).click();
  await expect(actionRow(page, done)).toContainText("Completed");

  // Open work, planned for Daniel.
  const planned = "Replace the printer's worn feed roller.";
  form = await addAction(page, { open: true, description: planned, assignee: COLLEAGUE.fullName });
  await form.getByRole("button", { name: "Save action" }).click();
  await expect(actionRow(page, planned)).toContainText("Open");
  await expect(actionRow(page, planned)).toContainText(COLLEAGUE.fullName);

  // A forged request naming the inactive account is refused, beside assigneeId.
  expectHttp("POST", /^\/api\/tickets\/\d+\/actions$/, 400);
  const forged = await apiCreateAction(page, ticketId, {
    status: "OPEN", actionAt: new Date().toISOString(), description: "Forged assignment to an inactive account.",
    result: null, followUpRequired: false, followUpNote: null, attachmentNotes: null, assigneeId: inactive.id,
  });
  expect(forged.status).toBe(400);
  expect(forged.json.error.fieldErrors).toHaveProperty("assigneeId");
  await signOut(page);

  // Daniel finds it under My open actions and completes it.
  await signIn(page, COLLEAGUE);
  const mine = page.getByRole("region", { name: "My open actions" });
  await mine.getByRole("link", { name: new RegExp(ticketNumber) }).click();
  await expect(page.getByRole("heading", { name: `Ticket ${ticketNumber}` })).toBeVisible();
  await actionRow(page, planned).getByRole("button", { name: "Complete" }).click();
  const dialog = page.getByRole("dialog", { name: "Complete action" });
  await dialog.getByLabel(/^Result/).fill("Fitted a new feed roller; ten pages printed cleanly.");
  await dialog.getByRole("button", { name: "Complete action" }).click();
  await expect(dialog).toHaveCount(0);
  await expect(actionRow(page, planned)).toContainText("Completed");
  await expect(actionRow(page, planned)).toContainText(COLLEAGUE.fullName);
  await signOut(page);

  // The Requester sees both, read-only.
  await signIn(page, REQUESTER);
  await openMyTickets(page);
  await page.getByRole("link", { name: ticketNumber }).click();
  await expect(actionRow(page, done)).toContainText("Completed");
  await expect(actionRow(page, planned)).toContainText("Completed");
  const card = actionsCard(page);
  for (const control of ["Add action", "Edit", "Complete", "Cancel action"]) {
    await expect(card.getByRole("button", { name: control, exact: true })).toHaveCount(0);
  }
});

test("E2E-05 a double-clicked Save creates one Action, and a failed save keeps the form for Retry", async ({ page, expectHttp }) => {
  test.setTimeout(150_000);
  await signIn(page, REQUESTER);
  const ticketNumber = await createTicket(page, { summary: uniqueSummary("Docking station drops the display") });
  await signOut(page);
  await signIn(page, STAFF);
  await openInQueue(page, ticketNumber);
  const ticketId = ticketIdFromUrl(page);
  const createPath = new RegExp(`/api/tickets/${ticketId}/actions$`);

  const countOnServer = async (description: string) => {
    const list = await (await page.request.get(`${API_ORIGIN}/api/tickets/${ticketId}/actions`)).json();
    return list.items.filter((item: { description: string }) => item.description === description).length;
  };

  // Save clicked twice while the first request is held at the network edge.
  const twice = "Swapped the docking station's USB-C cable.";
  let posts = 0;
  let release!: () => void;
  const held = new Promise<void>((resolve) => { release = resolve; });
  await page.route(createPath, async (route) => {
    if (route.request().method() !== "POST") return route.fallback();
    posts++;
    await held;
    await route.continue();
  });
  let form = await addAction(page, { description: twice, result: "Display stays on through a reboot." });
  await form.getByRole("button", { name: "Save action" }).dblclick();
  await expect(form.getByRole("button", { name: /Saving action/ })).toBeDisabled();
  release();
  await expect(actionRow(page, twice)).toHaveCount(1);
  await page.unroute(createPath);
  expect(await countOnServer(twice)).toBe(1);
  expect(posts, "requests sent for one double-click").toBeLessThanOrEqual(2);

  // A forced 500: the form keeps what was typed and offers Retry, which succeeds once.
  const retried = "Updated the docking station firmware.";
  expectHttp("POST", /^\/api\/tickets\/\d+\/actions$/, 500);
  let failOnce = true;
  await page.route(createPath, async (route) => {
    if (route.request().method() !== "POST" || !failOnce) return route.fallback();
    failOnce = false;
    await route.fulfill({ status: 500, contentType: "application/json", body: JSON.stringify({ error: { code: "INTERNAL", message: "x" } }) });
  });
  form = await addAction(page, { description: retried, result: "Firmware 2.4 installed; display stable." });
  await form.getByRole("button", { name: "Save action" }).click();
  await expect(form.getByRole("alert")).toBeVisible();
  await expect(form.getByLabel(/^Description/)).toHaveValue(retried);
  await expect(form.getByLabel(/^Result/)).toHaveValue("Firmware 2.4 installed; display stable.");
  await form.getByRole("button", { name: "Retry" }).click();
  await expect(actionRow(page, retried)).toHaveCount(1);
  await page.unroute(createPath);
  expect(await countOnServer(retried)).toBe(1);
});
