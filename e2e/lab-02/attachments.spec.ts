import { test, expect } from "@playwright/test";
import { PNG_BYTES, REQUESTER_A, createTicket, selectRequester, uniqueSummary } from "./support.js";

// E2E-03 — AC-13, AC-15. The whole attachment lifecycle against the real API,
// the real filesystem and a real browser download: upload, download, soft
// removal with a reason, and the download refused afterwards while the metadata
// stays on the Ticket.

test("an attachment can be uploaded, downloaded, removed with a reason, and then not downloaded", async ({ page }) => {
  await selectRequester(page, REQUESTER_A);
  await createTicket(page, { summary: uniqueSummary("Screenshot of the Wi-Fi error dialog") });
  await page.getByRole("link", { name: "Open this Ticket" }).click();

  await expect(page.getByRole("heading", { name: "Attachments" })).toBeVisible();
  await expect(page.getByText("No files have been attached to this Ticket.")).toBeVisible();

  // Upload. The bytes are a genuine PNG, because the server types the file from
  // its content and not from what the browser declares (BR-31).
  await page.getByLabel("Add an attachment").setInputFiles({
    name: "wifi-error.png",
    mimeType: "image/png",
    buffer: PNG_BYTES,
  });

  const list = page.getByRole("list", { name: "Attachments" });
  const item = list.getByRole("listitem").filter({ hasText: "wifi-error.png" });
  await expect(item).toHaveCount(1);
  await expect(item).toContainText("Active");
  await expect(item).toContainText("PNG image");
  await expect(page.getByRole("status")).toContainText("wifi-error.png was uploaded");

  // Download. The link cannot carry the requester header, so the screen fetches
  // the bytes and saves them — this asserts the file actually reaches the disk.
  const [download] = await Promise.all([
    page.waitForEvent("download"),
    item.getByRole("button", { name: "Download wifi-error.png" }).click(),
  ]);
  expect(download.suggestedFilename()).toBe("wifi-error.png");
  const savedTo = await download.path();
  expect(savedTo).toBeTruthy();

  // Removal needs a confirmation and a typed reason; the confirm button refuses
  // until the reason is one the server would accept (BR-38).
  await item.getByRole("button", { name: "Remove wifi-error.png" }).click();
  const dialog = page.getByRole("alertdialog", { name: "Remove wifi-error.png?" });
  await expect(dialog).toBeVisible();

  const confirm = dialog.getByRole("button", { name: "Remove attachment" });
  await expect(confirm).toBeDisabled();
  await dialog.getByLabel("Removal reason").fill("oops");
  await expect(confirm).toBeDisabled();

  await dialog.getByLabel("Removal reason").fill("Uploaded the wrong screenshot");
  await expect(confirm).toBeEnabled();
  await confirm.click();

  // The row stays. That is what makes the removal soft rather than a delete.
  await expect(item).toContainText("Removed");
  await expect(item).toContainText("Uploaded the wrong screenshot");
  await expect(item).toContainText("wifi-error.png");
  await expect(item).toContainText("PNG image");

  // No download control at all, and the reason it is missing is written out
  // rather than left to the badge colour (BR-39).
  await expect(item.getByRole("button", { name: /Download/ })).toHaveCount(0);
  await expect(item).toContainText("Download is unavailable because this attachment was removed");

  // And it survives a reload: the state is in the database, not in the page.
  await page.reload();
  const reloaded = page.getByRole("list", { name: "Attachments" }).getByRole("listitem").first();
  await expect(reloaded).toContainText("Removed");
  await expect(reloaded.getByRole("button", { name: /Download/ })).toHaveCount(0);
});

test("a file the rules refuse is named with its reason and never reaches the Ticket", async ({ page }) => {
  await selectRequester(page, REQUESTER_A);
  await createTicket(page, { summary: uniqueSummary("Cannot install the VPN client") });
  await page.getByRole("link", { name: "Open this Ticket" }).click();
  await expect(page.getByRole("heading", { name: "Attachments" })).toBeVisible();

  await page.getByLabel("Add an attachment").setInputFiles({
    name: "payload.exe",
    mimeType: "application/x-msdownload",
    buffer: Buffer.from([0x4d, 0x5a, 0x90, 0x00, 0x03]),
  });

  // AC-14: the message names the file and the reason, and no attachment appears.
  await expect(page.getByRole("alert")).toContainText("payload.exe is not a permitted type");
  await expect(page.getByRole("list", { name: "Attachments" })).toHaveCount(0);
  await expect(page.getByText("No files have been attached to this Ticket.")).toBeVisible();
});
