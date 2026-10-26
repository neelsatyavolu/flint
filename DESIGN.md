# Flint design system: "Graphite & Spark"

Flint is a mail client people sit in for hours, so the interface stays quiet: warm graphite planes, hairlines instead of boxes, one blue spark for whatever is live or selected. It takes Spark's three-pane layout and keeps its structure, but the surface is our own. Mail chrome is set in a grotesque, machine data (times, counts, labels) in a monospace, and AI summaries and answers in a serif. Message bodies, plain text or HTML, share one sans face so a thread reads evenly.

This file wins over `~/DESIGN.md` for this project. It is derived from that system ("Machine & Ink") and changes three things for a long-session app: planes instead of a single canvas, a 4px control radius (plus a 12px card radius for message cards), and muted avatar tints.

## 1. Principles

1. **Planes, not cards.** Depth comes from three stacked warm-gray planes (sidebar, list, reader) separated by 1px hairlines. No drop shadows, gradients, blur or glass anywhere. The one photograph in the app, the Home scene, follows its own rule (§5 Home scene).
2. **One accent.** Spark blue `#4C8DFF` marks the current selection, focus, unread dots, links, the caret and the single primary action in view. Keep it under about 3% of a screen.
3. **Three type roles.** Geist for UI. Geist Mono for data: times, counts, group labels, shortcuts, status words. Newsreader for prose the AI wrote (summaries, answers).
4. **Calm density.** Every row has room to breathe. Nothing jumps on hover; only background shifts.
5. **Speed is a feature.** Every action responds within one frame (optimistic UI). Loading states are hairline progress or skeleton rows, never spinners over content.
6. **Honest states.** Read receipts, sync and AI show exactly what is known. "Opened" only when it was opened.

## 2. Color tokens

Dark ("Graphite") is the default. Light ("Paper") follows the system or the Theme setting. All colors live in `apps/desktop/src/renderer/src/styles/tokens.css`; components never use raw hex.

| Token | Graphite (dark) | Paper (light) | Use |
|---|---|---|---|
| `--plane-0` | `#111110` | `#EFEDE6` | Sidebar, title bar strip |
| `--plane-1` | `#161615` | `#F6F4EE` | Mail list |
| `--plane-2` | `#1B1B19` | `#FBFAF6` | Reader, composer, settings content |
| `--plane-3` | `#232321` | `#FFFFFF` | Floating layers: menus, popovers, composer window, toasts |
| `--fg` | `#EDEBE5` | `#1A1A17` | Primary text |
| `--fg-2` | `rgba(237,235,229,.70)` | `rgba(26,26,23,.68)` | Secondary text, previews |
| `--fg-3` | `rgba(237,235,229,.52)` | `rgba(26,26,23,.62)` | Meta, placeholders, group labels. At least 4.5:1 on every plane |
| `--fg-4` | `rgba(237,235,229,.26)` | `rgba(26,26,23,.28)` | Disabled, empty-state mark |
| `--hover` | `rgba(237,235,229,.045)` | `rgba(26,26,23,.04)` | Row/item hover |
| `--active` | `rgba(237,235,229,.08)` | `rgba(26,26,23,.07)` | Pressed, secondary selected |
| `--line` | `rgba(237,235,229,.08)` | `rgba(26,26,23,.10)` | Hairlines between panes and rows |
| `--line-strong` | `rgba(237,235,229,.18)` | `rgba(26,26,23,.20)` | Inputs, ghost buttons, floating layer borders |
| `--accent` | `#4C8DFF` | `#2F6FE0` | The spark |
| `--accent-fg` | `#0B1424` | `#FFFFFF` | Text on accent fills |
| `--accent-soft` | `rgba(76,141,255,.14)` | `rgba(47,111,224,.10)` | Selected row, active nav item |
| `--accent-ring` | `rgba(76,141,255,.68)` | `rgba(47,111,224,.81)` | Thin 1px focus outlines inside dense rows (sidebar). At least 3:1 on every plane |
| `--danger` | `#E5483A` | `#C8352A` | Destructive actions, errors |
| `--ok` | `#4FBF85` | `#24894F` | Success state only (e.g. "Opened") |
| `--warn` | `#D9A441` | `#9C6B12` | Sync warnings, "can't confirm" receipts |

Every text token from `--fg-3` up meets WCAG AA (4.5:1) on every plane in both themes; `tokens.test.ts` checks this. `--fg-4` is for disabled text and marks only.

**Increase contrast.** Under `prefers-contrast: more` (macOS Accessibility → Increase contrast), `--fg-2` rises to `.84` / `.80`, `--line-strong` to `.42` / `.50` (3:1 on every plane), `--hover` and `--active` get a little stronger, and hovered menu items, selected options and the current nav item also get a 1px `--line-strong` inset outline, so no state depends on a faint tint alone.

**Avatar tints** are the only other colors. Eight muted hues, picked by hashing the address, so a sender keeps their color: `oklch(0.58 0.09 h)` in dark and `oklch(0.68 0.08 h)` in light for h in 25, 60, 95, 150, 195, 235, 280, 330, with initials in `#F4F2EC`. They never appear outside avatars and account color chips.

Never use pure `#000` or `#FFF` as a plane, and never a cool blue-black.

## 3. Typography

Fonts are bundled (`@fontsource`), never loaded from the network.

| Role | Face | Size / line | Weight | Use |
|---|---|---|---|---|
| UI body | Geist | 13.5 / 20 | 400 | Most UI text, previews |
| UI strong | Geist | 13.5 / 20 | 600 | Unread sender and subject, nav item active |
| Title | Geist | 15 / 22 | 600 | Pane titles ("Inbox"), dialog titles |
| Thread subject | Geist | 21 / 28 | 600 | Reader header, `text-wrap: balance` |
| Compose subject | Geist | 24 / 32 | 600 | Subject field in composer |
| Data | Geist Mono | 11.5 / 16 | 400 | Times, counts, badges, shortcut hints |
| Label | Geist Mono | 11 / 16 | 500 | UPPERCASE, tracking `0.08em`, `--fg-3`: date groups ("TODAY"), section heads |
| Prose | Newsreader | 16.5 / 26 | 400 | AI summaries and answers, max 68ch |
| Message | Geist | 14.5 / 22 | 400 | Plain-text mail bodies, the compose editor, signature and template editors, draft previews, matching HTML mail |

Each role has tokens in `tokens.css` (`--text-*` / `--lh-*`) and a `.t-*` class; Message is `--text-message`, `--lh-message` and `.t-message`. Components use these instead of off-scale sizes: tooltips and chips are UI body, counts are Data. A 16px avatar shows a single initial at 9px; 24px and up show two.

Numbers use `font-variant-numeric: tabular-nums`. Italics appear only in prose.

## 4. Layout

macOS window with `titleBarStyle: hiddenInset`. Traffic lights sit over the sidebar; a 38px drag region spans the top of every pane.

```
┌────────────┬──────────────────┬─────────────────────────────────┐
│ sidebar    │ list             │ reader                           │
│ plane-0    │ plane-1          │ plane-2                          │
│ 232px      │ 380px            │ flex (min 480)                   │
│ 200–320    │ 320–560          │                                  │
└────────────┴──────────────────┴─────────────────────────────────┘
```

- Pane widths are draggable on the 1px hairline (8px hit area) and remembered.
- Sidebar collapses with the toggle in its header or `⌘\`. Under 1100px window width the sidebar auto-collapses to a 56px icon rail.
- **Full Screen layout** (Settings → Appearance → Layout): the list takes the whole content area; opening a thread replaces it, Esc returns.
- 4px base grid. Spacing steps: 4 · 8 · 12 · 16 · 20 · 24 · 32 · 48.
- Radius: `0` for planes, rows and panes. `4px` for controls (buttons, inputs, selects, chips, badges, menus, popovers, toasts, composer window). `12px` (`--r-card`) for message cards, draft cards, the reply dock and the Home sheet only: they are the places a surface holds a document or floats over the Home photo. Circles and pills (`999px`) only for avatars, unread dots, toggles and the small quote pill.

## 5. Components

### Sidebar (plane-0)
- Header row: sync button (rotates while syncing), sidebar toggle. 38px tall, draggable.
- Items: 30px tall, 8px horizontal padding inside a 8px inset, icon 16px `--fg-2`, label Geist 13.5 `--fg-2`, count in Geist Mono `--fg-3` right-aligned.
- Active item: `--accent-soft` fill, label `--fg` 600, icon `--accent`. Hover: `--hover`.
- Order: Home · Inbox (unified, with one child row per account showing account avatar + address + unread) · Agent Activity · Pins · Drafts · Sent · Scheduled · Snoozed · Trash (per-account children when expanded) · section label FOLDERS: Archive · Blocked · Read Statuses · More (all IMAP folders/labels by account) · section label RECENTS (last opened folders, with Clear) · bottom: AI Agents, Settings.
- Disclosure chevrons (12px) sit left of the icon and only show on hover or when expanded.

### List (plane-1)
- Header: title "Inbox" with a menu chevron (switch account scope), subtitle in `--fg-3` ("Focused" or "All mail"), right side: Focused toggle, search, compose. 56px.
- Date group labels: Label style, 28px, sticky while scrolling.
- Thread row, comfortable: 76px, padding 12px 16px, avatar 32px at left (top aligned to the sender line). Line 1: sender(s) (13.5, 600 if unread else 500) and time (Data, `--fg-3`) right. Line 2: subject (13.5, `--fg` if unread, `--fg-2` if read) with thread count badge (Data in a 4px-radius `--active` chip) and paperclip icon at right. Line 3: preview (13.5, `--fg-3`), one line, ellipsis. Compact density: 56px, preview hidden, avatar 24px.
- Unread: 6px `--accent` dot in the left gutter, vertically centred on line 1.
- Selected: `--accent-soft` background with a 2px `--accent` bar on the left edge. Keyboard focus without selection: `--active` background.
- Hover reveals a quick-action cluster at the right of line 1 (Pin, Archive, Trash, Snooze), 24px icon buttons on a `--plane-1` backing so text never shows through.
- Bundle row (Focused mode): same height as a thread row; avatar slot holds a category glyph (bell for Notifications, newspaper for Newsletters) on `--active`; title is the category name with unread count in Data; line 2 shows the latest sender and subject.
- Read receipt marker on sent threads: a small eye glyph plus "2/3" in Data; `--ok` when every recipient opened, `--fg-3` otherwise.
- Pinned threads show a 12px pin glyph before the time.
- Virtualized; scrolling stays at 60fps with 10,000 rows.

### Reader (plane-2)
- Toolbar (38px, draggable background): Archive, Trash, Move, Snooze, Pin, Mark unread, then a spacer, then Reply, Reply all, Forward, More. 28px icon buttons, `--fg-2`, hover `--hover`, tooltip with shortcut in Data.
- Thread header: subject (Thread subject style), then a chip row for category and account color.
- AI summary card (when AI is on and the thread has 3+ messages or 300+ words): no box, a 2px `--accent` rule on the left, label "SUMMARY" in Label style, text in Prose. Collapsible.
- Thread body: a column of cards on `--plane-2`, 16px side gutters, 12px between cards. Each message is its own card: `--plane-3` fill, 1px `--line` border, `--r-card` radius, no shadow. Collapsed messages are 48px card rows (avatar 24, sender, snippet, time); the latest unread and the last message are expanded.
- Expanded card header: avatar 32, sender name 600, "to" in `--fg-3` followed by the first recipient and "+N" in `--accent` (click opens a popover listing From, To, Cc and Bcc with addresses), date in Data at right, and a ... menu (Reply, Reply all, Forward, Show original when the mail was adapted, Mark thread unread, Unsubscribe, Block sender). Reply all and Forward icon buttons (plus Reply when the mail has a single other party) sit at the bottom right of the card and are always visible.
- Quoted history ("On ... wrote:", Gmail, Apple Mail and Outlook quotes) is collapsed behind a small `•••` pill (32 x 18, `--active`, fully rounded) under the message; clicking expands it inline.
- Draft card: same card, 12px 20px padding, a DRAFT tag (Data, 1px `--line-strong` border, 4px radius), "to Name" with the name in `--accent`, and Delete, Edit, Send ghost buttons at right. The text is a plain preview, never the draft HTML.
- Scroll: opening a thread scrolls the newest message card fully into view (or to its top if taller than the pane). After the last card or the reply dock there is always `--ask-clearance` of empty space (floating field height plus gaps) so nothing sits behind the Ask field.
- Body: HTML mail renders in a sandboxed iframe that auto-sizes to its content. The frame background is `#FFFFFF` with 16px padding by default for HTML mail (most mail is designed for white) and follows the theme for plain text. Mail adapted to the theme has no frame padding, so its text lines up with the avatar and header. On the light theme the card is already white, so HTML mail has no frame padding there either. A light sheet inside a card gets an 8px-radius inset so it never touches the card edge (the dark-mail adaptation can instead put the mail directly on the card). Plain-text mail uses the Message style.
- Remote images blocked notice: a single line above the body, `--fg-3`, with "Load images" and "Always for this sender".
- Attachments: 4px-radius tiles, 200px wide, file glyph, name, size in Data.
- Reply: the reply dock card (`--r-card`) mounts at the bottom of the thread, below the last card and any draft cards, with the same bottom clearance. Quick-reply chips above it seed the dock.
- Empty state: the Flint mark at 96px in `--fg-4`, centred, nothing else.

### Composer
- Opens as its own window (or a sheet over the reader for inline replies). plane-2.
- Top bar: close, pop-out/in, then right: +AI, attach, template, reminder, send later, receipts toggle (eye), separator, From selector (address over name in Data), Send (accent icon button; the only accent fill).
- Fields, no boxes: Subject (Compose subject style, placeholder `--fg-3`), then "To, Cc, Bcc" recipient line with chips (4px radius, `--active`, avatar 16), then the body. Hairlines between fields only on focus.
- Body: rich text (TipTap) in Geist 14.5/22. Signature renders as part of the body, one short gap below the text, with no marker, and stays editable. It is sent exactly as written, so a `--` divider appears only when the signature contains one. Quoted text collapses behind a "···" pill.
- The caret is `--accent`.
- +AI opens an inline prompt bar under the toolbar: field with a blinking accent caret, suggestion chips (Write a reply, Shorter, More formal, Fix grammar, Translate). Results stream into a preview block with Insert / Replace / Discard.

### Ask anything
- Floating field bottom-right of the reader (320px, 40px tall, 4px radius, `--plane-3`, `--line-strong` border, sparkle glyph in `--accent`). Opens a side panel (380px) over the reader with the conversation in Prose and cited threads as clickable rows.
- Streamed AI text (Ask, thread summary, translation, bundle summary) is announced through a visually hidden polite live region: one line when it starts ("Answering") and one when it ends ("Answer ready"), never token by token. When an answer the user asked for finishes, focus moves to it unless they have moved elsewhere. Errors are `role="alert"`.

### Home scene
- Home is the only photographic surface in Flint. A landscape photo, bundled with the app and picked by time of day, fills the Home view behind its content. No other view gets a photo or illustration.
- The only treatment allowed on the photo is one flat, uniform scrim (`--scene-scrim`: ink at 30% in Graphite, 18% in Paper). No gradient, blur, glass, vignette, Ken Burns or parallax.
- Text appears on the photo only in the top band (about 200px: greeting, date and time), in `--on-scene` (`#F4F2EC`). Everything else readable (catch-up, needs reply, lists, buttons) sits on solid planes: a `--plane-2` sheet, max 720px, `--r-card` radius, 1px `--line` border, no shadow or blur.
- The photo is decorative (`alt=""`). It shows only once it has loaded, cross-fades over `--dur-panel`, and gives way to plain `--plane-2` under Reduce transparency or Increase contrast.
- Photos are CC0 or public domain, bundled with the app (credits in `assets/scenes/LICENSES.md`) and never fetched at runtime.

### Settings
- Opens as a full view replacing list and reader. Left: section nav (General, Accounts, Appearance, Inbox, Signatures, Templates, Rules, Read Receipts, Notifications, +AI, Agents, Shortcuts, Blocked, About). Its header is the 38px drag region and clears the traffic lights when the sidebar is collapsed. Under it, a Filter field narrows the nav by section name and the settings inside each section; Enter opens the first match, Esc clears it, then closes Settings.
- Content column max 720px. Each setting is a row: 20px icon in `--accent` at left, title (Geist 14.5, 600) and description (13.5, `--fg-3`) stacked, control at right (select, toggle, button). Rows separated by `--line` hairlines, 20px vertical padding, 16px gap. Section title in Title style above.
- A row that opens a page (+AI → Personalization) uses the same metrics with a chevron at right. Its hover tint reaches 8px past the column on each side with a 4px radius, so the text never touches the tint's edge.
- Deep links: `openSettings("rules")`, `"ai/writing"`, `"accounts/<id>"` (expands that account) and `"accounts/<id>/reauth"` (also opens Sign in again). Account ids keep their case.
- Select: 32px, 4px radius, `--line-strong` border, transparent background, chevrons at right.
- Toggle: 32×18 pill. Off: `--active` track with a 1px `--fg-3` edge (the tint alone is under 3:1 on Paper) and an `--fg-2` knob. On: `--accent` track and edge with an `--accent-fg` knob.

### Buttons and inputs
- Primary (one per view): `--accent` fill, `--accent-fg` text, 32px, 4px radius, Geist 13.5 600.
- Secondary: `--fg` fill, `--plane-1` text. Ghost: transparent, `--line-strong` border. Icon button: 28px square, no border.
- Input: 32px, transparent, `--line-strong` border, `--accent` border and caret on focus.
- Focus ring (`--focus-ring`): 2px solid `--accent` outline, offset 1px, on every focusable element via `:focus-visible`. The solid accent is at least 3:1 on every plane in both themes; a translucent ring was not.

### Menus, popovers, toasts
- `--plane-3`, 1px `--line-strong` border, 4px radius, no shadow. Menu items 28px with shortcut hints in Data at right. Checked items show a lucide `Check` (14px, stroke 1.5, `--accent`), never a text glyph.
- Menu items and picker rows show keyboard focus as the `--active` tint plus a 1px `--line-strong` inset outline; pointer hover is the tint alone.
- Toasts bottom-right, resting on top of the Ask field so they never cover the list or the field: "Archived · Undo" with the action as a text button in `--accent`. 5s.
- Snooze / send-later pickers: list of presets (Later today, Tomorrow, This weekend, Next week, Pick date & time) with the resolved time in Data at right.

## 6. Icons

`lucide-react`, stroke 1.5, 16px in lists and nav, 18px in toolbars. Icons are `--fg-2` by default; only the active nav icon, the +AI glyph and the Send button use the accent. No emoji anywhere.

## 7. Motion

- 120ms `cubic-bezier(.2,0,0,1)` for hover, press and focus. 180ms for panels and popovers (opacity plus 4px translate).
- Archived/trashed rows collapse height over 160ms.
- The caret blinks with `steps(1)` at 1s.
- `prefers-reduced-motion` turns all of these into instant changes.

## 8. Voice

Plain and short. Buttons say what happens: "Send", "Archive", "Load images", "Connect ChatGPT". Sentence case everywhere except Label style. No exclamation marks, no emoji, no "Oops". Errors say what failed and what to do: "Couldn't reach imap.gmail.com. Check your connection; Flint retries every minute."

## 9. Don'ts

- No drop shadows, gradients, glassmorphism, glow. That includes the Home photo: a flat scrim is the only treatment.
- No photos or illustrations outside the Home scene, and no text on the photo below its top band.
- No second accent; avatar tints are not accents.
- No Inter, no system-ui as the main face.
- No rounded corners above 4px except message, draft and dock cards and the Home sheet (`--r-card`), the quote pill, avatars, dots and toggles.- No spinners over content, no layout shift when data arrives.
- No centered-everything layouts.
