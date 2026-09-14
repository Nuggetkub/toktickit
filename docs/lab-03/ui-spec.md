# Lab 3 Zen Green UI Specification

**Status:** Draft for peer review
**Extends:** [`docs/lab-02/ui-spec.md`](../lab-02/ui-spec.md)
**Scope:** the authenticated shell, Login, Change Password, Forbidden, the Requester screen
changes, the IT Staff Ticket Queue, the IT Staff Ticket Detail, and User Management.

Everything in the Lab 2 specification stays in force: tokens, typography, spacing, control
states, button hierarchy, announcements, responsive rules and accessibility rules. New
screens are built from the same shared components, so they look like the same application
rather than a second visual system. This document defines only what Lab 3 adds.

---

## 1. New Shared Components

| Component | Rule |
|---|---|
| `StatusBadge` | One per ticket status, always carrying the status in words. |
| `PriorityBadge` | Used for **both** Requested Priority and IT Priority. It is always preceded by its label — "Requested" or "IT" — because the two share one scale and are otherwise indistinguishable. |
| `RoleBadge` | Requester, IT Staff or Administrator, in words. |
| `ConfirmDialog` | Modal with a title, the consequence stated in one sentence, an optional required text field, and Confirm and Cancel. Focus moves into it, is trapped while open, and returns to the triggering control on close. Escape cancels. |
| `DiscussionPanel` | A composer above a newest-first list of entries showing author, role badge, time and content. Content renders as text with line breaks preserved — never as HTML. |

### Status badge tones

Tone reinforces the word; it never replaces it.

| Status | Tone |
|---|---|
| New | Neutral: `--zen-border` outline, `--zen-text` |
| Open | `--zen-pale` fill, `--zen-secondary` text |
| In Progress | `--zen-secondary` fill, white text |
| Waiting for Requester | Amber: `--zen-warning` outline and text |
| Resolved | `--zen-primary` fill, white text |
| Closed | `--zen-readonly` fill, `--zen-text-muted` text |
| Reopened | Amber fill tint, `--zen-warning` text |
| Cancelled | `--zen-readonly` fill, `--zen-text-muted` text, with "Cancelled" in words |

Priority badges keep their Lab 2 tones. Role badges: Requester neutral, IT Staff
`--zen-pale`, Administrator `--zen-primary` outline.

### Private surface

Internal Notes use one new token, `--zen-private: #FFF7E8` — a pale amber — with a
`--zen-warning` left border and a lock icon. The panel heading reads **"Internal notes —
visible only to IT Staff and Administrators"**. Nothing else in the application uses this
surface, so it reads as private at a glance.

---

## 2. Application Shell

The header shows the TokTickIT identity, the role's navigation, and on the right the
signed-in user's name with a `RoleBadge` and a menu containing **Change password** and
**Log out**. Below 768 px the navigation collapses to a labelled menu button; the user's
name stays visible.

| Role | Navigation | Landing page |
|---|---|---|
| Requester | My Tickets, Create Ticket | My Tickets |
| IT Staff | Ticket Queue | Ticket Queue |
| Administrator | Users, Ticket Queue | Users |

Unauthorised destinations are not shown (BR-20). Opening one directly shows the Forbidden
state (§5), not a blank page and not the data.

**Start-up.** The client calls `GET /api/auth/me` before rendering anything private and
shows a neutral "Loading TokTickIT…" status while it waits. No screen from a previous
session is ever shown during that wait.

**Session ended.** On any `401` other than from sign-in, the client clears every piece of
user data it holds — list filters, cached tickets, form drafts — and shows Login with a
`role="status"` notice: "Your session has ended. Please sign in again." (BR-47). Browser
Back after logout lands on Login, not on a cached private screen.

The Development Requester selector, the Change Requester action and the stored requester id
are removed entirely.

---

## 3. Login

A centred card, maximum width about 420 px: the TokTickIT title, "Sign in to your account",
Email, Password with a labelled show/hide toggle, and **Sign in** as the only primary
button. There is no "Forgot your password?" link and no sign-up link (§12).

| State | Presentation |
|---|---|
| Initial | Empty fields, Sign in enabled |
| Validation | "Enter your email address", "Enter a valid email address", "Enter your password" — beneath each field; focus moves to the first |
| Signing in | Button reads "Signing in…" and is disabled; fields read-only |
| Invalid credentials | `role="alert"` above the button: "Email or password is incorrect." Email is kept; password is cleared |
| Inactive account | `role="alert"`: "This account has been deactivated. Contact your administrator." |
| Throttled | `role="alert"`: "Too many sign-in attempts. Try again in N minutes." with N from `Retry-After` |
| API unreachable | `role="alert"`: "Unable to connect to TokTickIT. Please try again." — never raw network text |
| Success | Navigates to Change Password if a change is pending, otherwise to the role's landing page |

---

## 4. Change Password

One screen with two modes.

- **Mandatory** — shown after signing in with an initial password. Heading "Choose a new
  password", explanation "You must choose a new password before continuing." The only other
  available action is **Log out**; the navigation is hidden.
- **Voluntary** — reached from the user menu. Full shell, and **Cancel** returns to the
  previous screen.

Fields: Current password, New password, Confirm new password — each with a show/hide
toggle. Beneath New password, a live checklist of the rules that actually apply (BR-11),
each item ticking as it is met and read out through `aria-describedby`:

- At least 12 characters
- No more than 128 characters
- Not only spaces
- Different from your current password
- Different from your email address
- Matches the confirmation

The list is exactly the five rules BR-11 states, so the screen can never show a password as
acceptable that the server will then reject.

| State | Presentation |
|---|---|
| Validation | Messages beneath the offending field; a wrong current password appears beneath Current password |
| Saving | "Saving password…", disabled |
| Failure | `role="alert"`, safe message; fields kept except the passwords the server rejected |
| Success | Mandatory mode continues to the role's landing page. Voluntary mode shows "Your password has been changed." Passwords are cleared from memory in both |

---

## 5. Forbidden and Not Found

- **Forbidden** — an unauthorised screen opened directly, or a `403 FORBIDDEN` from the API:
  a card reading "You do not have access to this page" with a link to the role's landing
  page. It shows no data from the requested resource.
- **Not found** — a ticket that does not exist or belongs to someone else: "This ticket
  could not be found" with a link back. The two cases read identically, as in Lab 2.

---

## 6. Requester Screen Changes

- **My Tickets** gains a Current Status filter (all eight statuses) and a Status column
  with `StatusBadge`. The mobile card shows the status badge too.
- **Ticket Detail** keeps every Lab 2 field read-only and adds Current Status, Assigned to
  (the owner's name, or "Not yet assigned") and, when set, the Resolution Summary.
- **Discussion.** A Public Comments `DiscussionPanel` below the ticket facts. There is no
  Internal Notes panel, no control for one, and no request for one.
- **Problem Appears Resolved.** A secondary button, shown only when BR-32 allows it, opening
  a `ConfirmDialog`: "Tell IT Staff the problem appears resolved? They will review and close
  the ticket." After confirming, the button is replaced by "You told IT Staff the problem
  appears resolved on <date>." The status badge does **not** change, so the screen never
  suggests the ticket is formally resolved.
- On a closed or cancelled ticket the comment composer, upload control and removal actions
  are replaced by "This ticket is closed. Create a new ticket if you need more help."

---

## 7. IT Staff Ticket Queue

### Toolbar

Search ("Search by ticket number, summary or requester"), then filters: Status, IT
Priority, Category, Owner (Anyone, Me, Unassigned, or a named person), and a "Requester
says resolved" checkbox. Sort control with direction, and Clear filters (tertiary). The
toolbar wraps rather than scrolling. Changing any search, filter or sort returns to page 1.

### Desktop table (≥ 992 px)

| Column | Content |
|---|---|
| Ticket No. | Link to Ticket Detail |
| Summary | One line, truncated with the full text in a tooltip; category beneath it in muted text |
| Requester | Name |
| Priority | "Requested" and "IT" `PriorityBadge`s stacked in one cell |
| Status | `StatusBadge`, plus a "Requester says resolved" marker when set |
| Owner | Name, or **Unassigned** in italic muted text |
| Updated | Relative time with the exact time in a tooltip |

Seven columns, with category folded into Summary and both priorities in one cell. That
keeps every column readable at 992 px; the labsheet warns against a mega-grid, and
Created Date, Related System and Description stay on Ticket Detail where they are used.

### Tablet (768–991 px)

The Requester column is dropped; it remains on the card at mobile width and on Ticket
Detail.

### Mobile (< 768 px)

One card per ticket: Ticket No. and Status on the first line, Summary, both priority
badges, Owner, Updated, and an **Open** action with at least a 44 px target.

### States

| State | Presentation |
|---|---|
| Loading | `role="status"` "Loading tickets…"; the toolbar stays usable |
| Empty | "There are no tickets yet." |
| No results | "No tickets match your search or filters," with Clear filters |
| Forbidden | The Forbidden card (§5) |
| Failure | `role="alert"` safe message with Retry |

Pagination is Lab 2's: "Showing 11–20 of 31 tickets", Previous and Next disabled at the
ends. A response to an older query is discarded if a newer one has been sent, so a slow
reply never overwrites a newer result.

---

## 8. IT Staff Ticket Detail

A breadcrumb "Ticket Queue › TKT-2026-00042" with **Back to queue**, which restores the
queue's filters and page.

### Layout

1. **Header strip** — Ticket Number, `StatusBadge`, both `PriorityBadge`s, owner.
2. **Requester indication banner**, when set — `--zen-pale` panel: "Nadia Rahman says the
   problem appears resolved (14 Sep 2026, 10:41)." This is how IT Staff learn of it
   (BR-33).
3. **Two columns on desktop, stacked below 992 px:**
   - **Ticket information** — read-only (Lab 2 read-only treatment): Requester, Ticket
     Date, Category, Related System, Summary, Description, Requested Priority, Resolution
     Summary when set.
   - **Work panel** — the only editable fields:
     - **Owner** — dropdown of active IT Staff and Administrators plus "Unassigned", with
       **Save owner**. When the ticket is unassigned, a **Claim** primary button appears
       above it.
     - **IT Priority** — four-option control with **Save priority**.
     - **Status** — the current status and a **Change status** control listing only the
       statuses BR-29 allows from here. Choosing Resolved, Closed, Cancelled or Reopened
       opens a `ConfirmDialog`; Resolved requires a resolution summary, Cancelled and
       Reopened a reason, each with its character limits shown.
   Each save has its own busy state ("Saving owner…"), so saving priority never disables
   the owner control.
4. **Tabs:** Public comments (count) · Internal notes (count) · Attachments (count).

### Keeping private notes private

- The two discussions are separate tabs with separate composers, and each keeps its own
  draft — switching tabs never moves text from one to the other.
- The Internal Notes tab and composer use the private surface (§1) and its heading; the
  submit button reads **Add internal note**. The public composer's button reads
  **Post public comment** and carries the helper text "Visible to the requester."
- No control converts a note into a comment.

### States

| State | Presentation |
|---|---|
| Saving | Per-control busy text; the rest of the screen stays usable |
| Success | `role="status"` "Owner updated", "Status changed to In Progress" |
| Validation | Beneath the field, or inside the dialog for summary and reason |
| Conflict (`409 TICKET_VERSION_CONFLICT`) | `role="alert"`: "Someone else changed this ticket. Reload to see the latest version." with **Reload**. The user's unsaved input is kept and nothing is re-sent automatically |
| Owner required | Beneath Status: "Assign an owner before moving this ticket to In Progress." |
| Terminal | Work panel controls disabled, with "This ticket is closed and can no longer be changed." Tabs remain readable; composers are hidden |
| Not found / Forbidden | §5 |

Attachments are Lab 2's list, read-only for IT Staff: download active files, see removed
ones as metadata. No upload or remove control.

---

## 9. User Management

One screen. On desktop, the user list on the left and a side panel on the right for
Create User and Edit User; below 992 px the panel opens full-width over the list.

### List

Toolbar: search ("Search by name or email"), Role filter (All roles, Requester, IT Staff,
Administrator), and **Create user** (primary). Columns: Name, Email, Role (`RoleBadge`),
Status (Active or Inactive badge, in words), and an **Edit** action. No pagination,
multi-column sort or bulk selection (§12). Mobile shows one card per user.

States: loading, "No users match your search," failure with Retry, Forbidden.

### Create and Edit panel

| Field | Create | Edit |
|---|---|---|
| Full name | Required | Required |
| Email address | Required | Required |
| Role | Required, one of three | Required |
| Active | Toggle, default on | Toggle |
| Initial password | Required, BR-11 rules shown | Not shown — see below |

Edit adds a separate **Set new initial password** section with its own field and button,
and the explanation "The user must choose a new password the next time they sign in."
Stored passwords are never displayed or pre-filled.

| Situation | Presentation |
|---|---|
| Validation, duplicate email | Beneath the field; the panel stays open with values kept |
| Saving | "Saving user…", disabled |
| Success | `role="status"` "User saved"; the list refreshes; for a deactivation that unassigned tickets, "3 open tickets were unassigned" |
| Own account | The Active toggle and Role are disabled, with "You cannot deactivate your own account or change your own role." |
| Last Administrator | `role="alert"` from the server's `409`: "At least one active Administrator is required." |
| Forbidden / failure | §5 / safe `role="alert"` |

---

## 10. Responsive Rules

Lab 2 §9 applies unchanged: desktop ≥ 992 px, tablet 768–991 px, mobile < 768 px, touch
targets at least 44 px on mobile, no page-level horizontal scrolling at any width. In
addition: dialogs fit the viewport and scroll inside themselves; long emails, names,
filenames and comments wrap rather than overflow; the Work panel stacks beneath the ticket
information below 992 px.

Evidence viewports: **1440×900**, **834×1112**, **390×844** — the same as Lab 2, so the two
sprints' screenshots compare directly.

---

## 11. Accessibility Additions

- Password show/hide toggles are buttons with an accessible name that states the action
  ("Show password") and `aria-pressed`.
- The live password checklist is linked to its field with `aria-describedby`.
- Tabs follow the WAI-ARIA tabs pattern: arrow keys move between tabs, and each panel is
  labelled by its tab.
- Sortable queue headers expose `aria-sort`.
- Dialogs trap and restore focus; Escape cancels.
- Every badge carries text; no status, priority, role or privacy is shown by colour alone.

---

## 12. Deviations from the Labsheet Illustrations

The illustrations on labsheet pages 8–12 are guidance; where they contradict the written
scope, the text is followed.

| Illustration shows | This specification | Reason |
|---|---|---|
| "Forgot your password?" link on Login | Omitted | Password reset and email are excluded (labsheet §4.2). |
| "Send password reset email" checkbox when creating a user | Replaced by an Initial password field | Email delivery is excluded; labsheet §8.5 asks for an initial password. |
| Pagination on the user list | Omitted | "Pagination for the user list" is listed as not required (§8.5). |
| "Service Actions" tab on Ticket Detail | Omitted | Actions Taken are excluded and deferred to Lab 4 (§4.2, §4.5). |
| "Pending" status badge in the queue | Not a status | The eight required statuses do not include Pending (§4.5). |
| Deactivate User button on the Create User panel | Activation is a toggle in Create and Edit | A user that does not exist yet cannot be deactivated. |
| Password rule checklist requiring upper and lower case, a number and a special character | Length-based rules | Decision D-05. |

---

## 13. Visual Inspection Checklist

To be completed against the running application at all three viewports, not from memory.
**A** marks an item a test asserts; **E** marks one checked by eye.

- [ ] **E** Zen Green tokens consistent across every Lab 3 screen and the Lab 2 screens
- [ ] **A** Status, priority and role badges carry text and use the tones in §1
- [ ] **E** Role navigation shows only permitted destinations for each role
- [ ] **A** Editable Work panel fields visibly distinct from read-only ticket information
- [ ] **A** Validation messages sit beneath their own field
- [ ] **E** Public Comments and Internal Notes are unmistakably different surfaces
- [ ] **A** Focus visible and never trapped outside an open dialog
- [ ] **A** No clipping, overlap, or page-level horizontal scroll (RESP-01)
- [ ] **E** Loading, saving, success, empty, no-results, forbidden, conflict and failure
      states captured from real requests

### Screenshot paths

```
artifacts/lab-03/screenshots/authentication/{login,change-password,shell}-{desktop,tablet,mobile}.png
artifacts/lab-03/screenshots/staff-queue/{desktop,tablet,mobile}.png
artifacts/lab-03/screenshots/staff-ticket-detail/{desktop,tablet,mobile}.png
artifacts/lab-03/screenshots/user-management/{desktop,tablet,mobile}.png
artifacts/lab-03/screenshots/requester/{my-tickets,ticket-detail}-{desktop,tablet,mobile}.png
```
