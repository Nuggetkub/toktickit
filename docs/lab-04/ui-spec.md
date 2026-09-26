# Lab 4 Zen Green UI Specification

**Status:** Draft for peer review
**Extends:** [`docs/lab-03/ui-spec.md`](../lab-03/ui-spec.md), which extends
[`docs/lab-02/ui-spec.md`](../lab-02/ui-spec.md)
**Scope:** Dashboard navigation, the Requester and IT Staff dashboards, Actions Taken on both
Ticket Detail screens, the status history, resolution feedback, drill-down into the existing
lists, and the final polish of every screen from Labs 2 to 4.

Everything in the Lab 2 and Lab 3 specifications stays in force: tokens, typography,
spacing, control states, button hierarchy, badges, the private surface, announcements,
breakpoints and accessibility rules. This document defines only what Lab 4 adds. A new
screen is built from the existing components, so the finished product reads as one
application.

---

## 1. New Shared Components

| Component | Rule |
|---|---|
| `MetricCard` | A single link: a label, a large value, and a muted one-line explanation of what is counted. Its accessible name reads as a sentence, e.g. "Waiting for me: 2 tickets". It has a `--zen-surface` fill, the Lab 2 card radius, and a visible focus ring. A card whose `query` is `null` links to its list on the same page, never to nowhere. |
| `ActionStatusBadge` | Open, Completed or Cancelled, always in words. Open uses the amber outline of "Waiting for Requester", Completed the `--zen-primary` fill, and Cancelled the `--zen-readonly` fill with muted text. |
| `ActionForm` | The create and edit form for one Action (§4). The `Follow-up note` field is shown only while "Follow-up required" is ticked. |
| `StatusTimeline` | An ordered list (`<ol>`) of Status Events: "Grace Okafor moved this from Open to In Progress · 26 Sep 2026, 08:20". Each entry names both statuses as `StatusBadge`s, so no change is shown by colour alone. |

Action Status tone reinforces the word; it never replaces it, as with every Lab 3 badge.

---

## 2. Application Shell

**Dashboard** becomes the first navigation item. The active page is marked by a 3 px
underline **and** `aria-current="page"`, not by colour alone.

| Role | Navigation | Landing page |
|---|---|---|
| Requester | Dashboard, My Tickets, Create Ticket | Dashboard |
| IT Staff | Dashboard, Ticket Queue | Dashboard |
| Administrator | Dashboard, Ticket Queue, Users | Users (unchanged from Lab 3) |

The Administrator's order follows the code (`App.tsx` builds Ticket Queue, then Users), with
Dashboard added first. Lab 3 ui-spec §2 wrote the pair the other way round.

The route is `/dashboard` for every role. The screen chooses the Requester or the staff
version from the signed-in role and never calls the other endpoint.

### Drill-down into the existing lists

A dashboard link carries its filters in the URL, and the list screens now read their initial
filters **from the URL**. This is new: in Lab 3 they read only router state.

| Screen | URL parameters read | Control shown |
|---|---|---|
| My Tickets `/tickets` | `currentStatus` | The Status filter gains **Active tickets** (the five active statuses) above the eight single statuses |
| Ticket Queue `/queue` | `currentStatus`, `itPriority`, `owner`, `requesterIndicated` | Same **Active tickets** option in Status; Owner and the checkbox as in Lab 3 |
| User Management `/users` | `role` | The existing Role filter |

- A URL value the screen cannot represent is not silently dropped. The list shows the
  server's `400` as "This link's filter is not valid" with **Clear filters**.
- Changing a filter afterwards updates the URL (`replace`, not `push`), so Back returns to the
  dashboard rather than stepping through every filter change.
- The Lab 3 "Back to queue" restore through router state keeps working, and takes precedence
  over the URL when both exist.

---

## 3. Dashboards

Both dashboards share one layout:

1. A heading, "Dashboard", and a muted line: "Updated 26 Sep 2026, 11:00 · Refresh". The time
   is the response's `generatedAt` in the viewer's local time. **Refresh** is a tertiary
   button that re-fetches.
2. A card grid.
3. Lists in panels below it, each with a heading, its total ("Showing 5 of 9"), and a
   **View all** link where a list page exists.

There are no period deltas, charts or Quick Actions grid (§8).

### Requester Dashboard

| Card | Label | Explanation line | Link |
|---|---|---|---|
| R-1 | My active tickets | "Submitted and still being worked on" | My Tickets, Active tickets |
| R-2 | Waiting for me | "IT Staff need information from you" | My Tickets, Waiting for Requester |
| R-3 | Resolved — please check | "Fixed by IT Staff, awaiting closure" | My Tickets, Resolved |
| R-4 | Resolved in the last 7 days | "Including tickets now closed" | the Recently resolved panel |

Panels: **Needs your attention**, **Recently updated**, **Recently resolved**. Each row shows
the Ticket Number (a link to the Requester Ticket Detail), Summary, `StatusBadge`, and the
Last Updated or Resolved time. On mobile, each row becomes a card with the same content and
a 44 px target.

The dashboard does not repeat My Tickets' table, search or paging (labsheet §8.2). Its lists
are capped at five.

### IT Staff Dashboard

| Card | Label | Link |
|---|---|---|
| S-1 | Unassigned | Queue: Unassigned, Active tickets |
| S-2 | My active tickets | Queue: Owner Me, Active tickets |
| S-3 | My open actions | the My open actions panel |
| S-4 | Requester says resolved | Queue: Requester says resolved, Active tickets |

Below the four cards, two compact breakdown panels:

- **Tickets by status**: eight rows, each a `StatusBadge`, a count and a link.
- **Active by IT Priority**: four rows, each a `PriorityBadge` labelled "IT", a count and a
  link.

Each is a real list (`<ul>`) of links, not a chart. A zero row stays visible and is still a
link. A card or row that is `0` is shown, never hidden.

Panels:

- **My open actions**: Action Date/Time, Ticket Number and Summary, and the Action's first
  line. An Action whose Action Date/Time has passed carries an "Overdue" text marker as well
  as its amber tone.
- **Urgent active tickets**.
- **Recently updated**.

Every row opens `/queue/:ticketId`, and from My open actions it scrolls to that Action (§4).

**The Administrator** sees the same dashboard plus a **User accounts** panel: three rows
(Requester, IT Staff, Administrator), each reading "5 active · 1 inactive" and linking to
User Management filtered by that role.

### Layout by width

| Width | Cards | Panels |
|---|---|---|
| Desktop ≥ 992 px | 4 in one row | Two columns: lists on the left (wider), breakdowns and User accounts on the right |
| Tablet 768–991 px | 2 × 2 | One column |
| Mobile < 768 px | 1 per row | One column; list rows become cards |

### States

| State | Presentation |
|---|---|
| Loading | `role="status"` "Loading dashboard…"; card placeholders the same size as cards, so nothing shifts when data arrives |
| Empty | Every count shows `0`. Each empty panel says what is empty, e.g. "Nothing needs your attention." A Requester with no tickets at all sees "You have not submitted any tickets yet" and **Create Ticket** |
| Forbidden | The Lab 3 Forbidden card (Lab 3 ui-spec §5) |
| Failure | `role="alert"` "The dashboard could not be loaded. Please try again." with **Retry**. No stale or partial numbers stay on screen beside the alert |
| Refreshing | Current numbers stay visible; the Refresh button reads "Refreshing…" and is disabled |

---

## 4. Actions Taken on Ticket Detail

A section headed **Actions taken (n)**, placed after the ticket facts and Work panel and
before the discussion tabs. It is on both the IT Staff and the Requester Ticket Detail. It is
a section rather than a fourth tab, so the work log and the resolution gate that depends on
it are always in view.

### List

| Width | Presentation |
|---|---|
| Desktop and tablet | A table: Action Date/Time · Description (with Result beneath it in muted text) · Assignee · Performed by · Status (`ActionStatusBadge`, plus a "Follow-up required" text marker) · Actions |
| Mobile < 768 px | One card per Action with the same fields labelled, as the Lab 2 `data-label` table-to-card pattern already does |

Rows are ordered as the API returns them: newest first (BR-11). Expanding a row, with a
disclosure button that has `aria-expanded`, shows the full Description, Result, Follow-up
Note, Attachment Notes, Recorded by and Recorded At, and, when cancelled, the canceller and
reason. Attachment Notes is labelled **"Attachment notes — refers to files in the
Attachments tab"**, so it is never mistaken for an upload.

Empty: "No actions have been recorded yet."

### IT Staff and Administrator

- **Add action** (primary) opens `ActionForm` in create mode, inline above the list:
  - **Status**: a radio pair, "Record completed work" (default) or "Plan open work".
  - **Action date/time**: a `datetime-local` field, defaulting to now.
  - **Description**.
  - **Result**: required and marked so under "Record completed work"; optional under "Plan
    open work".
  - **Assignee**: a dropdown of active IT Staff and Administrators, defaulting to the current
    user. The Ticket Owner is not pre-selected, because BR-02 separates the two.
  - **Follow-up required**: a checkbox that reveals **Follow-up note**.
  - **Attachment notes**.
- Above the Save button, helper text: **"Visible to the requester. Use an internal note for
  anything private."**
- On an Open Action, the Actions column offers:
  - **Edit**, which opens `ActionForm` in edit mode on that row.
  - **Complete**, which opens a `ConfirmDialog` with a required Result field, the follow-up
    fields, and an Action date/time pre-filled with now when the stored time is in the
    future.
  - **Cancel action**, a destructive-secondary button that opens a `ConfirmDialog` with a
    required reason.
- A Completed or Cancelled Action shows no Edit, Complete or Cancel control, only
  "Final — record a new action to correct it."
- An Open Action whose assignee was cleared shows **Unassigned** in italic muted text. Its
  Edit form starts with the Assignee field empty and marked required.

| State | Presentation |
|---|---|
| Saving | Per-form busy text ("Saving action…"); Save disabled until the response arrives, so a double-click sends once. The `Idempotency-Key` is created once per form opening and re-sent on retry (BR-15) |
| Success | `role="status"` "Action recorded", "Action completed"; the list, the count and the resolution guidance (§5) refresh |
| Validation | Beneath each field, with focus moved to the first invalid one |
| Conflict (`ACTION_VERSION_CONFLICT`) | `role="alert"` "Someone else changed this action. Reload to see the latest version." with **Reload**; the user's input is kept |
| `ACTION_FINAL` / `ACTION_NOT_ALLOWED` | `role="alert"` with the server's message; the list refreshes so the controls match the true state |
| Network or server failure | `role="alert"` safe message; **everything entered is kept** (BR-32); Save becomes Retry and re-sends with the same key |
| Ticket resolved or terminal | Add action hidden; "Reopen the ticket to record more work." or the Lab 3 terminal message |

### Requester

The same list, read-only: no Add, Edit, Complete or Cancel control is rendered, and none is
requested. Every field is visible (BR-16).

---

## 5. Workflow and Resolution Feedback

On the IT Staff Ticket Detail Work panel, the **Change status** control still lists only the
BR-18 next statuses (Lab 3 ui-spec §8).

- **When the gate is closed**, *Resolved* stays in the list, disabled, followed by a
  "Resolution needs:" list built from `resolutionGate` (§4 of the API contract):
  - "Complete or cancel 1 open action"
  - "Record at least one completed action"
  - "The latest completed action asks for follow-up — record the follow-up work"

  The list is linked to the control with `aria-describedby`. This is guidance before the
  attempt, not the rule.
- **If the server still answers `RESOLUTION_BLOCKED`**, because the screen was stale, the
  dialog shows the server's `unmet` list in a `role="alert"`, keeps the typed resolution
  summary, and refreshes the Actions list.
- **After any successful change**, the status badge, Work panel, Actions list, status history
  and `resolutionGate` all refresh from the response and a re-read. No page reload.
- **Cancelling a Ticket with open Actions**: the confirmation adds "2 open actions will also
  be cancelled."

### Status history

A **History** disclosure below the Actions section, collapsed by default and showing its
event count, holds the `StatusTimeline`, oldest first. It appears on both Ticket Detail
screens. When `recordedFromCreation` is false, the first line reads "Earlier changes were made
before history was recorded."

---

## 6. Final Polish Across Labs 2–4

This is issue #89's checklist, applied to every screen and not only the new ones:

- One loading, empty, no-results, forbidden, not-found, conflict and failure presentation per
  kind, matching Lab 3 ui-spec §§5–8. No screen invents its own wording for an existing
  state.
- Every submit control is disabled while its request is pending. Every form keeps its input
  after a recoverable failure (BR-32).
- No console error or warning in the browser during the E2E run. The suite fails on one.
- No placeholder text, "TODO", lorem ipsum, dead link, or control that does nothing.
- The `/system-check` route and any other development-only screen is either reachable from
  nothing and documented as a developer tool, or removed. It is not in any role's navigation.

---

## 7. Responsive and Accessibility Rules

Lab 2 §9 and Lab 3 §§10–11 apply unchanged: desktop ≥ 992 px, tablet 768–991 px, mobile
< 768 px, 44 px touch targets on mobile, and no page-level horizontal scrolling. In addition:

- Long Action descriptions, results and notes wrap and never widen the table. The table
  scrolls horizontally inside its own panel before it can push the page.
- A metric value never truncates. A long label wraps to two lines, and cards in a row share
  one height.
- Dashboard cards and list rows are links, reachable by Tab in reading order: cards, then
  breakdowns, then panels.
- `ActionForm`'s conditional Follow-up note is announced: the checkbox has
  `aria-controls` pointing at the field, and the field is inserted after it in focus order.
- Every count is text, and no chart conveys anything that the text does not.

Evidence viewports stay **1440×900**, **834×1112** and **390×844**, so all three sprints'
screenshots compare directly.

---

## 8. Deviations from the Labsheet Illustrations

| Illustration shows | This specification | Reason |
|---|---|---|
| "TikTockIT" | TokTickIT | The product's name throughout Labs 1–3. |
| "+3 from yesterday" deltas on every card | Omitted | A delta needs daily snapshots and a day boundary (D-08, D-09). BI and analytics are excluded (§4.2). |
| Status cards New, Open, In Progress, Waiting for Requester on the staff dashboard | Kept as the **Tickets by status** breakdown, with all eight | A card per status would be eight cards. The breakdown shows every status, zeros included, in less space. |
| "Quick Actions" (Create Ticket, Search Tickets, My Queue) | Omitted | They duplicate the navigation one line above. IT Staff do not create Tickets (Lab 3 matrix). |
| "Profile" menu | The Lab 3 user menu (name, role badge, Change password, Log out) | There is no profile feature in scope. |
| "Welcome back, Michael!" | "Dashboard" heading | The shell already shows the signed-in name. |
| Staff navigation "Dashboard, Create Ticket" | Dashboard, Ticket Queue | IT Staff cannot create Tickets (Lab 3 authorization matrix). |

---

## 9. Visual and Accessibility Checklist

Completed against the running application at all three viewports, never from memory. **A**
marks an item a test asserts; **E** marks one checked by eye, naming the capture that shows
it. Each box is ticked only with that evidence named beside it.

- [ ] **E** Zen Green tokens are consistent across both dashboards, the Actions section and
      the Lab 2 and Lab 3 screens
- [ ] **A** Metric cards carry a label, a value and a sentence-form accessible name, and each
      links to a list whose total equals the card
- [ ] **A** Action Status, Ticket status and priority badges carry text
- [ ] **A** Editable Action fields are visibly distinct from read-only ones; a final Action
      offers no edit control
- [ ] **A** Validation messages sit beneath their own field, including the conditional
      Follow-up note
- [ ] **A** Focus is visible; dialogs trap and restore it; drill-down links are
      keyboard-reachable in reading order
- [ ] **A** Nothing clipped, nothing overlapping, and no page-level horizontal scroll at any
      viewport (RESP-01)
- [ ] **E** Loading, empty, forbidden, conflict and failure states captured from real
      responses for both dashboards and the Actions section
- [ ] **A** No console error during the full E2E run

### Screenshot paths

```
artifacts/lab-04/screenshots/staff-dashboard/{staff,administrator}-{desktop,tablet,mobile}.png
artifacts/lab-04/screenshots/requester-dashboard/{populated,empty}-{desktop,tablet,mobile}.png
artifacts/lab-04/screenshots/actions-taken/{staff-list,staff-form,requester-list}-{desktop,tablet,mobile}.png
artifacts/lab-04/screenshots/actions-taken/resolution-blocked-desktop.png
artifacts/lab-04/screenshots/states/{dashboard-loading,dashboard-failure,action-conflict,action-validation}.png
```

The three folders are the ones labsheet §12 names. Every capture is written by the E2E suite
from the seeded database, never taken by hand.
