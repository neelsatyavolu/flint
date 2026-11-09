# Flint design system: "Ledger"

Flint is a mail client people sit in for hours. It follows `~/DESIGN.md` v3 ("Ledger"): warm off-black and paper, hairline rules over boxes, one blue accent, and two registers. **Ink** is Newsreader, for what a person reads: subjects in the reader, AI summaries and answers, the Home greeting, empty states. **Instrument** is Geist for controls and UI text, with Geist Mono for every number, date, time, count, size, label and key. It reads like a printed ledger with an instrument panel inside it.

This file wins over `~/DESIGN.md` for this project. It changes four things for a long-session desktop app: stacked planes (sidebar, list, reader, floating) instead of a single canvas, 32px controls instead of 36px, plain-text mail bodies and the composer stay in Geist so they match HTML mail, and the Home photo (§5 Home scene). The marketing site (`site/public`) follows `~/DESIGN.md` as written.

## 1. Principles

1. **Rules over boxes.** Depth is luminance steps plus 1px hairlines. No drop shadows, gradients, blur, glass or glow anywhere, focus rings included. Boxes are only for form controls, wells and things you click, drag or open (message cards, menus, the composer).
2. **One accent.** Blue marks the current selection, focus, unread dots, links, the caret and the single most important action in view (Send). Under about 3% of a screen. `ok` / `danger` / `warn` are state only, never surfaces.
3. **Two registers.** Newsreader for reading, Geist for operating, Geist Mono for anything you scan as data. Labels are mono in sentence case: `Today`, `Updated 14:02`. Never uppercase, never tracked.
4. **One loudest thing per view.** A serif subject or greeting, not three competing weights.
5. **Speed is a feature.** Every action responds within one frame (optimistic UI). Loading is flat `--hover` blocks that breathe, never spinners over content or shimmer.
6. **Honest states.** Read receipts, sync and AI show exactly what is known. "Opened" only when it was opened.

## 2. Color tokens

The system theme decides; dark is the fallback. All colors live in `apps/desktop/src/renderer/src/styles/tokens.css`; components never use raw hex. iOS mirrors them in `Colors.xcassets` (checked by `TokenParityTests`).

| Token | Dark | Light | Use |
|---|---|---|---|
| `--plane-0` | `#0B0B0A` | `#F1EEE6` | Sidebar, title bar strip |
| `--plane-1` | `#0E0E0D` | `#F7F5EF` | Mail list (Ledger canvas) |
| `--plane-2` | `#0E0E0D` | `#F7F5EF` | Reader, composer, settings content. Separated from the list by a hairline, not a tone |
| `--plane-3` | `#141413` | `#FBFAF6` | Message cards and floating layers: menus, popovers, composer window, toasts (Ledger card) |
| `--deep` | `#090908` | `#141413` | Code wells only (raw source, pairing codes). Stays dark in both themes |
| `--fg` | `#F2F0EA` | `#16161A` | Ink: primary text |
| `--fg-2` | ink .86 | ink .86 | Body: secondary text, previews |
| `--fg-3` | ink .55 | ink .64 | Mute: meta, placeholders, labels. AA on every plane |
| `--fg-4` | ink .28 | ink .28 | Stone: disabled only, never placeholders |
| `--hover` / `--active` | ink .045 / .08 | ink .045 / .08 | Row hover, pressed, loading blocks |
| `--line` | ink .08 | ink .10 | Hairlines between panes and rows |
| `--line-strong` | ink .18 | ink .22 | Section rules, ghost buttons, card and floating-layer borders |
| `--field` | ink .42 | ink .50 | Input, select and segmented-control borders (3:1) |
| `--primary` / `--primary-fg` | `#F2F0EA` / `#0E0E0D` | `#16161A` / `#F7F5EF` | Ink button |
| `--accent` | `#4C8DFF` | `#2A63CC` | The accent |
| `--accent-hover` | `#6FA3FF` | `#1F4FA8` | Accent hover |
| `--accent-fg` | `#0E0E0D` | `#FFFFFF` | Text on accent fills |
| `--accent-soft` | blue .10 | blue .09 | Selected row, active nav item (Ledger wash) |
| `--selection` | blue .35 | blue .25 | Text selection |
| `--scrim` | `rgba(9,9,8,.7)` | `rgba(22,22,26,.4)` | Behind dialogs |
| `--danger` / `--ok` / `--warn` | `#EE5A4B` / `#4FBF85` / `#D9A23A` | `#BC2E23` / `#1A7048` / `#8A5E12` | State only |

"Ink .55" means `rgba(242,240,234,.55)` in dark and `rgba(22,22,26,…)` in light. `tokens.test.ts` checks the contrast floors.

**Increase contrast.** Under `prefers-contrast: more`, `--fg-2` rises to .92, `--line-strong` to .42 / .50 (3:1 on every plane), `--hover` and `--active` strengthen, and hovered menu items, selected options and the current nav item get a 1px `--line-strong` inset outline.

**Avatar tints** are the only other colors: eight low-chroma hues hashed from the address, `oklch(0.50 0.05 h)` in dark and `oklch(0.62 0.05 h)` in light, initials in `--avatar-fg`. Only in avatars and account chips.

## 3. Typography

Fonts are bundled (`@fontsource-variable/geist`, `geist-mono`, `newsreader`), never fetched. Newsreader's optical size follows font size; never set `opsz` by hand.

| Role | Class | Face | Size / line | Use |
|---|---|---|---|---|
| Display | `.t-display` | Newsreader 400 | 40 / 44 | Home greeting, welcome heading. `-0.01em`, balanced |
| Thread subject | `.t-subject` | Newsreader 400 | 24 / 30 | Reader header, balanced |
| Compose subject | `.t-compose` | Newsreader 400 | 24 / 30 | Subject field in the composer |
| Headline small | `.t-headline-sm` | Newsreader 400 | 18 / 24 | Empty states, dialog headings, Settings page titles |
| Prose | `.t-prose` | Newsreader 400 | 17 / 26 | AI summaries, answers, catch-up, max 65ch |
| Title | `.t-title` | Geist 600 | 15 / 22 | Pane titles ("Inbox"), setting titles |
| UI body | `.t-body` | Geist 400 | 13.5 / 20 | Most UI text, previews, tooltips |
| UI strong | `.t-strong` | Geist 600 | 13.5 / 20 | Unread sender and subject |
| Message | `.t-message` | Geist 400 | 14.5 / 22 | Plain-text mail bodies, the compose editor, signatures, draft previews (matches HTML mail) |
| Data | `.t-data` | Geist Mono 400 | 12 / 16 | Times, dates, counts, sizes, badges, receipt ratios. Tabular |
| Label | `.t-label` | Geist Mono 400 | 12 / 16 | Date groups, section rules, field labels. Sentence case, `--fg-3` |
| Code | — | Geist Mono 400 | 12–13 | `Kbd`, one-time and pairing codes, hostnames, raw source. No ligatures |

Emphasis moves to a different face, not to bold. Units next to numbers (`KB`, `%`) sit in `--fg-3`.

## 4. Layout

macOS window with `titleBarStyle: hiddenInset`. Traffic lights sit over the sidebar; a 38px drag region spans the top of every pane.

```
┌────────────┬──────────────────┬─────────────────────────────────┐
│ sidebar    │ list             │ reader                           │
│ plane-0    │ plane-1          │ plane-2                          │
│ 232px      │ 380px            │ flex (min 480)                   │
└────────────┴──────────────────┴─────────────────────────────────┘
```

- Panes are separated by 1px `--line` hairlines (8px drag hit area), widths remembered. Sidebar collapses with `⌘\`, and to a 56px rail under 1100px.
- **Full Screen layout**: the list takes the whole content area; opening a thread replaces it, Esc returns.
- Spacing only from 4 · 8 · 12 · 16 · 20 · 24 · 32 · 48, counted across border plus padding (a row with a 2px rule gets padding of target − 2).
- Rhythm in app screens: 48 between sections, 32 between groups, 24 inside a group. More space above a heading than below it.
- Radius: `0` for planes, rows, panes and tables. `4px` (`--r-control`) for buttons, inputs, selects, chips, badges and Kbd. `6px` (`--r-card`) for message cards, draft cards, the reply dock, menus, popovers, toasts, dialogs, the composer window, wells and the Home sheet. `999px` only for avatars, unread dots, toggles, the quote pill and status/filter pills.
- Text inside any bordered or filled container sits at least 8px from its edge.

## 5. Components

### Section rules
Groups open with a `--line-strong` top rule; the label sits under it in Label style (`--fg`), with real meta (a count, a time) at right in Label `--fg-3`. Used for Settings groups, Home sections, sidebar groups (Folders, Recents) and date groups in the list. Never two parallel rules: a list's top rule replaces the previous list's bottom rule.

### Sidebar (plane-0)
- Header row: sync button, sidebar toggle. 38px, draggable.
- Items 30px, 8px padding inside an 8px inset, icon 16px `--fg-2`, label Geist 13.5 `--fg-2`, count in Data `--fg-3` right-aligned.
- Active: `--accent-soft` fill, label `--fg`, icon `--accent`. Hover `--hover`. No side bars.
- Group labels (Folders, Recents) are Label style under a `--line` rule, sentence case.

### List (plane-1)
- Header 56px: title in Title style with a scope chevron, subtitle in Label, right side Focused toggle, search, compose.
- Date groups: Label style ("Today", "Yesterday", "Mon 3 Nov"), 28px, sticky, with a `--line` rule above.
- Thread row, comfortable 76px, padding 12px 16px, avatar 32px. Line 1: sender (13.5, 600 unread / 500 read) and time in Data at right. Line 2: subject with a thread count in Data (no chip fill, `--fg-3`) and paperclip. Line 3: preview `--fg-3`, one line. Compact 56px: no preview, avatar 24px.
- Rows are hairline rows: a 1px `--line` between rows, no cards.
- Unread: 6px `--accent` dot in the left gutter. Selected: `--accent-soft` fill only. Keyboard focus: `--active` fill.
- Hover reveals Pin, Archive, Trash, Snooze as 24px icon buttons on a `--plane-1` backing.
- Bundle row (Focused): category glyph on `--active`, name plus unread count in Data, distinct latest senders as 16px avatars.
- Read receipts on sent threads: eye glyph plus "2/3" in Data, `--ok` when all opened.
- Virtualized; 60fps with 10,000 rows.

### Reader (plane-2)
- Toolbar 38px: Archive, Trash, Move, Snooze, Pin, Mark unread, spacer, Reply, Reply all, Forward, More. 28px icon buttons, tooltips with the shortcut in Data.
- Header: subject in Thread subject (Newsreader) as the loudest thing, then a Label row: category, account, message count.
- AI summary: no box. A 1px `--accent` left rule (never thicker), Label "Summary", text in Prose. Collapsible.
- Thread body: cards on `--plane-2`, 16px gutters, 12px apart. Each message: `--plane-3` fill, 1px `--line` border, 6px radius, no shadow. Collapsed messages are 48px rows (avatar 24, sender, snippet, time in Data).
- Expanded header: avatar 32, sender 600, "to" in `--fg-3` plus first recipient and "+N" in `--accent` (popover with From/To/Cc/Bcc in Data), date in Data at right, a ··· menu. Reply all and Forward icon buttons at the card's bottom right.
- Quoted history collapses behind a `•••` pill (32×18, `--active`, full radius).
- Draft card: same card, a "Draft" pill (Label, `--line-strong` border, full radius), "to Name" with the name in `--accent`, Delete / Edit / Send as ghost buttons.
- After the last card there is always `--ask-clearance` of space so nothing sits behind the Ask field.
- HTML mail renders in a sandboxed auto-sizing iframe on white with 16px padding (most mail is designed for white); mail adapted to the theme has no padding. A light sheet inside a card gets a 4px-radius inset. Plain text uses Message.
- Remote images notice: one Label line above the body with "Load images" and "Always for this sender" as accent text buttons.
- Attachments: 4px-radius tiles, 200px wide, file glyph, name, size in Data.
- Empty state: "No conversation selected" in Headline small `--fg-2`, no illustration.

### Composer
- Own window or a sheet over the reader. plane-2, 6px radius when floating.
- Top bar: close, pop-out, then +AI, attach, template, reminder, send later, receipts toggle, separator, From selector (address in Data over the name), Send (accent icon button, the only accent fill).
- Fields have no boxes: Subject in Compose subject (Newsreader), placeholder `--fg-3`; "To, Cc, Bcc" with recipient chips (4px radius, `--active`, avatar 16); then the body in Message. Hairlines between fields only on focus. Caret `--accent`.
- +AI bar: field with an accent caret, suggestion pills, streamed result in Prose with Insert / Replace / Discard.

### Ask anything
- Floating field bottom-right of the reader (320×40, 6px radius, `--plane-3`, `--line-strong` border). Opens a 380px side panel with the conversation in Prose and cited threads as hairline rows.
- Streamed AI text is announced through a polite live region once at start and once at end. Errors are `role="alert"`.

### Home scene
- The only photographic surface. A bundled landscape photo picked by time of day fills the Home view. The only treatment is one flat, uniform scrim (`--scene-scrim`). No gradient, blur, vignette or motion.
- Text on the photo only in the top band: greeting in Display (Newsreader), date and time in Label, in `--on-scene`. Everything else sits on a `--plane-2` sheet, max 720px, 6px radius, 1px `--line` border. Sections inside open with section rules.
- The photo is decorative (`alt=""`), cross-fades in once loaded, and gives way to plain `--plane-2` under Reduce transparency or Increase contrast. Photos are CC0 / public domain, credited in `assets/scenes/LICENSES.md`, never fetched.

### Settings
- Full view replacing list and reader. Left: section nav and a Filter field. Content column max 720px.
- Page title in Headline small. Groups open with section rules. Each setting is a hairline row: 18px icon in `--fg-2`, title (Geist 14.5, 500) over description (13.5, `--fg-3`), control at right. 20px vertical padding.
- A row that opens a page has a chevron; its hover tint reaches 8px past the column with a 4px radius.
- Select 32px, 4px radius, `--field` border, transparent. Toggle 32×18 pill: off `--active` track with a 1px `--field` edge, on `--accent` track with `--accent-fg` knob.
- Versions, sizes, ports, counts and keys are Data.

### Buttons and inputs
- Accent: `--accent` fill, `--accent-fg` text, 32px, 4px radius, Geist 13.5 500. One per view (Send, Connect, Add account). Hover `--accent-hover`.
- Ink (primary): `--primary` fill, `--primary-fg` text. Never on the same view as an accent button.
- Ghost: transparent, `--line-strong` border, `--fg` text, hover `--hover`. Most buttons are ghost.
- Icon button: 28px square, no border, `--fg-2`, hover `--hover`.
- Input: 32px, `--plane-3` fill, `--field` border, 4px radius; focus border `--accent`. Errors: `--danger` border and a Data message in `--danger` below, linked by `aria-describedby`.
- Focus everywhere: `outline: 2px solid var(--accent); outline-offset: 2px` (`--focus-ring`). Inside dense rows, a 1px `--accent-ring` inset outline. No box-shadow rings.
- Disabled: text `--fg-4`, border `--line`, fill unchanged. No opacity fades.

### Menus, popovers, toasts, dialogs
- `--plane-3`, 1px `--line-strong` border, 6px radius, no shadow. Dialogs sit on a flat `--scrim`.
- Menu items 28px with shortcuts in Data at right; checked items show a lucide `Check` in `--accent`.
- Keyboard focus on menu items: `--active` plus a 1px `--line-strong` inset outline; hover is the tint alone.
- Toasts bottom-right above the Ask field: "Archived" plus an accent text-button "Undo". 5s.
- Snooze / send-later presets show the resolved time in Data at right.
- Loading: flat `--hover` blocks breathing 1 → .55 over 1.6s. Spinners only inside buttons.

## 6. Icons

`lucide-react`, stroke 1.5, 16px in lists and nav, 18px in toolbars, `--fg-2` by default. Only the active nav icon and Send use the accent. No emoji.

## 7. Motion

- 150ms `cubic-bezier(.2,0,0,1)` for hover, press and focus. 200ms for panels, popovers and entering content (opacity plus a 6px rise).
- Archived rows collapse height over 160ms. The caret blinks with `steps(1)` at 1s.
- Numbers update in place without animation. `prefers-reduced-motion` makes everything instant.

## 8. Voice

Plain and short. Buttons say what happens: "Send", "Archive", "Load images". Sentence case everywhere, labels included. No exclamation marks, no emoji, no "Oops". Errors say what failed and what to do: "Couldn't reach imap.gmail.com. Check your connection; Flint retries every minute."

## 9. Don'ts

- No shadows, gradients, glass, glow or radial backgrounds. The Home photo gets one flat scrim, nothing else.
- No photos or illustrations outside the Home scene; empty states are a serif line, not a mark.
- No second accent or purple; avatar tints are not accents.
- No Inter, Geist Serif or system-ui as a face. No uppercase tracked labels, no eyebrow kickers above headings.
- No radius above 6px except pills, avatars, dots and toggles.
- No colored side borders thicker than 1px (selected rows use the wash, not a bar).
- No proportional digits in data: times, counts and sizes are mono.
- No spinners over content, no layout shift when data arrives, no centered-everything layouts.
