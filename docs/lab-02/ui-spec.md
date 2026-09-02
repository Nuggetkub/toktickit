# Lab 2 Zen Green UI Specification

**Status:** Draft for peer review
**Scope:** Development Requester Selection, Create Ticket, My Tickets, Requester Ticket
Detail, and the Attachment components used by the last of these.

Lab 2 establishes the presentation rules that later labs reuse. Anything defined here is
built once as a shared component and consumed, not re-implemented per screen.

---

## 1. Design Principles

The interface should feel calm and unhurried — a person filing a support ticket is usually
already annoyed. Three rules follow from that:

1. **State is always stated.** Loading, empty, no-results, submitting, success and failure
   each say what is happening in words. A spinner alone is not a state.
2. **Nothing is communicated by colour alone.** Every badge, error and status carries text
   or an icon as well, which is also what makes the interface usable to someone who cannot
   distinguish the greens from the greys.
3. **The user's work is never lost.** A failed request leaves the form populated, and a
   destructive action asks first.

---

## 2. Zen Green Tokens

| Token | Value | Use |
|---|---|---|
| `--zen-primary` | `#006B3C` | Application header, primary buttons, strong emphasis |
| `--zen-secondary` | `#0B7A46` | Active navigation, links, focus accents, hover states |
| `--zen-pale` | `#EAF6EF` | Selected rows, success panels, subtle section emphasis |
| `--zen-page` | `#F5F7F6` | Page background |
| `--zen-surface` | `#FFFFFF` | Cards, forms, table surfaces |
| `--zen-text` | `#12241C` | Body text — dark charcoal-green, deliberately not pure black |
| `--zen-text-muted` | `#4A5A52` | Helper text, table secondary columns, metadata |
| `--zen-border` | `#D6DFDA` | Field and card borders |
| `--zen-readonly` | `#EFF2F0` | Read-only field background |
| `--zen-error` | `#A32020` | Error text, invalid field border |
| `--zen-warning` | `#B26A00` | Amber warning callout or badge |
| `--zen-success` | `#006B3C` | Success confirmation, always paired with text |

Warning colour is reserved for warnings. It is never used as decoration.

### Typography and spacing

- One font stack throughout; body text 16 px, never below 14 px for anything a user must
  read.
- Spacing uses a 4 px scale (4, 8, 12, 16, 24, 32). Fields within a group are separated by
  16 px, groups by 24 px.
- Cards use a 1 px `--zen-border`, an 8 px radius, and a restrained shadow — no heavy
  elevation.

---

## 3. Control States

| Element | Rule |
|---|---|
| Label | Above its control, always visible. Placeholder text is never a substitute for a label. |
| Required field | Red asterisk after the label, plus `aria-required`. |
| Editable field | `--zen-surface` background, `--zen-border` border. |
| Read-only field | `--zen-readonly` background, no border emphasis, not focusable as an input. Clearly distinct from editable at a glance. |
| Invalid field | `--zen-error` border, message immediately **below** the field, with `aria-describedby` pointing at it **and** `role="alert"` on the message. Never a single lumped error at the top of the form. |
| Focus | Visible `--zen-secondary` focus ring on every interactive element, never removed. |
| Disabled | Reduced contrast, `aria-disabled`, and not activatable. |
| Busy button | Text changes to the present participle — "Creating ticket…" — and the button is disabled for the duration. |

### Button hierarchy

| Variant | Use | Appearance |
|---|---|---|
| Primary | The one main action on a screen | Solid `--zen-primary`, white text |
| Secondary | Supporting action | Outlined, `--zen-primary` text |
| Tertiary | Low-emphasis action such as Clear filters | Text only, underlined on hover |
| Destructive | Attachment removal | Outlined `--zen-error`, requires confirmation |

Every button carries visible text. Icons may support text but never replace it, and any
icon-only control has an accessible name and a tooltip.

### Announcements

- `role="status"` for loading, submitting and success — polite, does not interrupt.
- `role="alert"` for failures that need action — assertive. This includes field-level
  validation messages: `aria-describedby` is only read when the control takes focus, so a
  message revealed by submitting the form would otherwise be silent for a screen-reader
  user positioned anywhere else on it. If a future screen routinely fails many fields at
  once, revisit this — several assertive announcements in a row is its own problem, and the
  answer then is a polite live region plus an error summary that takes focus.

---

## 4. Application Shell

The header carries the TokTickIT identity, primary navigation (My Tickets, Create Ticket),
the selected Requester's name, and a Change Requester action. The active route is indicated
by both colour and an underline, so the indication survives a colour-blind reading.

Change Requester returns to the selector and clears requester-scoped state — list filters,
paging and any cached ticket — before the replacement context loads.

Below 768 px the navigation stays reachable without horizontal scrolling: it collapses to a
labelled menu, and the selected Requester's name remains visible in the header.

---

## 5. Development Requester Selection

A single centred card containing the TokTickIT title, a short explanation, a dropdown of
active Requesters, and a Continue button.

**Required copy:** "Select a Development Requester to test requester-specific ticket
behaviour. This is not a login screen and provides no security."

| State | Presentation |
|---|---|
| Loading | Dropdown disabled, `role="status"` message "Loading requesters…" |
| Ready | Active requesters listed by name with e-mail as secondary text; Continue enabled once a choice is made |
| Empty | "No active Development Requesters are available." Continue disabled |
| Failure | Safe retry message in `role="alert"`; no raw network text |

The dropdown and Continue are keyboard reachable in that order, with a visible focus ring.

---

## 6. Create Ticket

### Layout

A centred card, maximum width around 880 px. Content order:

1. **System-assigned block** — Ticket Number and Ticket Date, side by side. Both are
   read-only. Before submission they show placeholder text explaining that the backend
   assigns them when the ticket is saved; after a successful save they show the real
   values.
2. **Requester** — read-only, populated from the selected context.
3. **Classification** — Category and Related System, side by side on desktop, stacked on
   mobile.
4. **Ticket Summary** — full width, single line.
5. **Requested Priority** — a four-option control, labelled with words rather than colour.
6. **Description** — full width textarea, resizable vertically without breaking the layout.
7. **Attachments** — the file selection area, with the permitted types and the 5 MB and
   five-file limits stated up front rather than discovered on rejection.
8. **Actions** — Submit Ticket as the only primary button, Cancel as secondary.

### States

| State | Presentation |
|---|---|
| Initial | Empty form, reference data loaded, submit enabled |
| Loading reference data | Category and Related System disabled with `role="status"` |
| Validation failure | Message under each offending field; focus moves to the first invalid field; entered values retained |
| Submitting | Submit shows "Creating ticket…" and is disabled |
| Success | `--zen-pale` panel stating the ticket was created, showing the Ticket Number and Ticket Date, with links to view the ticket or create another |
| API failure | `role="alert"` with a safe message; **every entered value is preserved**; retry available |
| Invalid attachment | The rejected file is named alongside its reason — type, size, or the five-file limit — and other selected files are unaffected |

---

## 7. My Tickets

### Toolbar

Search field, Category filter, Related System filter, Requested Priority filter, Sort
control, Clear filters (tertiary), and Create Ticket (primary). The toolbar wraps to
multiple rows rather than scrolling horizontally.

There is **no Current Status filter in Lab 2** — every ticket is `NEW`, so the control
could never change the result set. It arrives in Lab 3 with the statuses that make it
meaningful.

### List

Desktop is a table: Ticket Number, Summary, Category, Related System, Requested Priority,
Ticket Date. Ticket Number and Summary open the detail screen. Tablet may drop Related
System. Mobile becomes a card per ticket carrying Ticket Number, Summary, Priority badge
and Ticket Date, with a clear View detail action.

### States

| State | Presentation |
|---|---|
| Loading | Skeleton rows or a `role="status"` message; the toolbar stays usable |
| Empty | "You have not created any tickets yet," with a Create Ticket action |
| No results | "No tickets match your search or filters," with a Clear filters action |
| Failure | `role="alert"` with a safe message and a retry |

Empty and no-results are deliberately different messages with different recovery actions —
telling someone to clear filters they never set is confusing.

### Pagination

Shows the current page, the total pages and the total result count in words — "Showing
1–10 of 24 tickets". Previous and Next are visibly disabled at the ends rather than
removed.

---

## 8. Requester Ticket Detail and Attachments

All ticket fields are read-only: Ticket Number, Ticket Date, Requester, Category, Related
System, Summary, Requested Priority, Current Status, Description. They use the read-only
field treatment so the screen never invites editing that Lab 2 does not support.

### Attachment section

Visually separate, listing for each file: original filename, type, size, upload time and
state.

| Attachment state | Presentation |
|---|---|
| Active | Download (secondary) and Remove (destructive) actions |
| Uploading | Progress or busy indication, `role="status"` |
| Invalid | Named with its rejection reason; not added to the list |
| Removed | Retained metadata, a Removed badge, the removal reason and date shown; **no working download** — the control is absent or disabled with an explanation |

Removal opens a confirmation requiring a typed reason of 5–250 characters. The confirm
button is destructive and disabled until the reason is valid.

Upload errors appear beside the attachment section, not at the top of the page, and name
the file they concern.

---

## 9. Responsive Rules

| Viewport | Behaviour |
|---|---|
| Desktop ≥ 992 px | Multi-column form and table layout; content centred with a maximum width |
| Tablet 768–991 px | Two columns where practical; Summary and Description keep useful width; secondary table columns may drop |
| Mobile < 768 px | Fields stack; touch targets at least 44 px; table becomes cards; **no page-level horizontal scrolling** |
| All sizes | No clipped labels, no overlapping messages, no hidden buttons, no unreadable attachment names |

Where a wide element genuinely cannot shrink, it scrolls inside its own container — the
page itself never scrolls sideways.

---

## 10. Accessibility

- Every control has a visible label; icon-only controls carry an accessible name and
  tooltip.
- Keyboard order follows visual order; focus indicators are never suppressed.
- Colour is never the only carrier of meaning — priority and status badges include text.
- Validation messages are associated with their field via `aria-describedby`, and invalid
  fields set `aria-invalid`.
- Body text contrast meets WCAG AA against its background; `--zen-text` on `--zen-surface`
  and white on `--zen-primary` both satisfy it.

---

## 11. Visual Inspection Checklist

Completed on 2026-09-02 against the real running screens at all three viewports, not from
memory. **A** marks an item a test asserts on every run; **E** marks one checked by eye
against the committed screenshots and the running application.

- [x] **E** Zen Green tokens applied consistently across all four screens — also asserted at
      the token level by STYLE-01
- [x] **E** Read-only fields clearly distinct from editable fields — grey `--zen-readonly`
      surface, no border, not focusable
- [x] **A** Required markers present; validation messages sit beneath their own field
      (STYLE-01)
- [x] **E** Button hierarchy correct; only one primary action per screen
- [x] **A** Busy and disabled states visible and non-activatable (STYLE-01, and the removal
      confirm button in the Ticket Detail suite)
- [x] **A** Loading, empty, no-results, success and failure states all reachable and legible
      (the component suites reach each one directly)
- [x] **A** Removed attachments show retained metadata with no working download (UI-10, E2E-03)
- [x] **E** Priority badges readable without relying on colour — the level is written in the
      badge, and the tone only reinforces it
- [x] **A** No clipping, overlap, or page-level horizontal scrolling at any viewport (RESP-01,
      measured rather than eyeballed)
- [x] **E** Keyboard focus visible throughout, tab order sensible — focus ring is never
      suppressed; tab order follows the DOM, which follows the visual order

The screenshots below were captured by the same run that made the assertions, so the images
and the evidence cannot drift apart.

### Screenshot paths

```
artifacts/lab-02/screenshots/create-ticket/{desktop,tablet,mobile}.png
artifacts/lab-02/screenshots/my-tickets/{desktop,tablet,mobile}.png
artifacts/lab-02/screenshots/ticket-detail/{desktop,tablet,mobile}.png
```
