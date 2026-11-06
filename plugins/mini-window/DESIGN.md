---
name: DSH Mini Window
description: Screenshot-pinned macOS dark mini window extending DSH's existing visual identity.
colors:
  primary: "#365ac5"
  primary-hover: "#436bdc"
  accent: "#547cff"
  background: "#101112"
  raised: "#181a1d"
  overlay: "#202226"
  input: "#08090b"
  text: "#ededee"
  label-secondary: "#c4c6ca"
  label-tertiary: "#b0b3bb"
  label-caption: "#a1a5ae"
  muted: "#aeb2ba"
  border: "#363941"
  control-border: "#30333a"
  interactive-hover: "#25282d"
  interactive-active: "#313640"
  icon-hover: "#282b31"
  field-surface: "#202228"
  focus: "#8ba7ff"
  notice-background: "#3b2328"
  notice-text: "#f6ccd0"
  error: "#f0a6ae"
  running: "#8db6ff"
typography:
  title:
    fontFamily: '-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif'
    fontSize: "19px"
    fontWeight: 600
    lineHeight: 1.4
  subheading:
    fontFamily: '-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif'
    fontSize: "16px"
    fontWeight: 600
  workspace:
    fontFamily: '-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif'
    fontSize: "12px"
  body:
    fontFamily: '-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif'
    fontSize: "14px"
  label:
    fontFamily: '-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif'
    fontSize: "13px"
  field:
    fontFamily: '-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif'
    fontSize: "14px"
  metadata:
    fontFamily: '-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif'
    fontSize: "11px"
  supporting:
    fontFamily: '-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif'
    fontSize: "12px"
    lineHeight: 1.5
rounded:
  window: "28px"
  composer-expanded: "28px"
  composer-compact: "56px"
  control: "9px"
  search: "12px"
  row: "8px"
  notice: "10px"
  icon: "50%"
spacing:
  tight: "4px"
  small: "8px"
  medium: "12px"
  large: "16px"
  shell-inline: "20px"
components:
  window:
    backgroundColor: "{colors.background}"
    textColor: "{colors.text}"
    rounded: "{rounded.window}"
    padding: "14px 20px 20px"
  window-compact:
    backgroundColor: "transparent"
    textColor: "{colors.text}"
    rounded: "{rounded.composer-compact}"
    padding: "0"
    width: "640px"
    height: "112px"
  button-primary:
    backgroundColor: "{colors.primary}"
    textColor: "white"
    typography: "{typography.label}"
    rounded: "{rounded.control}"
    padding: "8px 12px"
  button-primary-hover:
    backgroundColor: "{colors.primary-hover}"
    textColor: "white"
  button-secondary:
    backgroundColor: "{colors.raised}"
    textColor: "{colors.text}"
    typography: "{typography.label}"
    rounded: "{rounded.control}"
    padding: "8px 12px"
  button-icon:
    backgroundColor: "transparent"
    textColor: "{colors.text}"
    rounded: "{rounded.icon}"
    padding: "0"
    size: "32px"
  button-icon-hover:
    backgroundColor: "{colors.icon-hover}"
  field:
    backgroundColor: "{colors.raised}"
    textColor: "{colors.text}"
    typography: "{typography.field}"
    rounded: "{rounded.control}"
    padding: "10px 12px"
  model-default-select:
    backgroundColor: "{colors.raised}"
    textColor: "{colors.text}"
    typography: "{typography.field}"
    rounded: "{rounded.control}"
    padding: "10px 12px"
  search:
    backgroundColor: "{colors.field-surface}"
    textColor: "{colors.text}"
    typography: "{typography.field}"
    rounded: "{rounded.search}"
    padding: "10px 12px"
  session-row:
    backgroundColor: "transparent"
    textColor: "{colors.text}"
    rounded: "{rounded.row}"
    padding: "12px"
  composer:
    backgroundColor: "{colors.input}"
    textColor: "{colors.text}"
    typography: "{typography.body}"
    rounded: "{rounded.composer-expanded}"
  composer-compact:
    backgroundColor: "{colors.input}"
    textColor: "{colors.text}"
    typography: "{typography.body}"
    rounded: "{rounded.composer-compact}"
    padding: "16px 12px 12px"
    height: "112px"
  notice:
    backgroundColor: "{colors.notice-background}"
    textColor: "{colors.notice-text}"
    typography: "{typography.supporting}"
    rounded: "{rounded.notice}"
    padding: "8px 10px"
---

# Design System: DSH Mini Window

## Overview

**Creative North Star: "DSH within reach"**

A quiet macOS floating utility, grounded in the user's Gemini mini-window screenshots and extended with DSH's existing identity. The approved refinement removes the outer compact chrome: the dark, generously padded real composer is the only visible pill, now without a CSS border or editor focus rectangle. Expanded mode keeps one near-black conversation canvas and a padded, borderless composer instead of repeating outlined bubbles. This documents the refined implementation, not a new visual world.

The real DSH composer and conversation remain the functional and visual foundation. The approved requirement to preserve that composer takes precedence over generic web-design prohibitions on stock components. There is no invented display-font pairing, generated raster artwork, or alternate composition-led identity.

**Key Characteristics:**
- Screenshot-pinned dark rounded macOS utility with a single compact composer pill.
- Resident DSH composer and real session history.
- System typography, quiet stroke icons and restrained blue actions.
- Chrome-free compact input and natively resizable expanded conversation.

Implementation evidence: [styles](src/client/styles.ts), [UI](src/client/ui.tsx), [conversation integration](src/client/index.tsx), [native geometry constants](shared/state.mjs), and [native host](native/main.cjs). Durable constraints come from [PRODUCT.md](PRODUCT.md). [mini-surface.md](docs/mini-surface.md) records the updated Operate-mode contract, including the user-approved single-pill refinement.

Initial visual sources are two user-supplied dark Gemini-mini screenshots, showing compact and expanded states. Their attachment IDs were verified in the later user-provided references: `sha256:a21e38b673e5f59440cf5e81d6275840b7dce637c600847034b85b8066acbd22` and `sha256:1a2cc18c0dc15d8c558fc31f371cedd95e82ae7f4f79d63209adab99bbee67b7`. They are references, not authored assets. The approved build was code-led, without generated raster imagery. Current [expanded capture](docs/screenshots/expanded.png), [compact capture](docs/screenshots/compact.png) and [settings capture](docs/screenshots/settings.png) are exact browser-renderer captures with embedded Capture/Validation metadata and current file hashes in the sidecar. They use real backend data with a simulated native bridge only for preview controls. Their Retina image dimensions are 2800×1608; the mini root remains 640×600 expanded or 640×112 compact at CSS position (380, 32). They are not physical OS-window screenshots or composition-led goldens.

Verification boundary: after the human restarted the existing server on port 3080, the public RPC catalog and mini-default Settings workflow succeeded with `antigravity` / `gemini-3.8-flash-tiered` / `high`. A distinct new mini chat returned `MINI_GEMINI_HIGH_OK` in about 4 seconds; persisted `lastUsed` matches with no pending selection. Main default (`openai-codex` / `gpt-6.1-sol` / `high`) and configured `Command+Shift+C` shortcut were unchanged. Native restart/show APIs returned HTTP 200 ready/visible/registered, loading the rebuilt borderless companion. Current renderer captures are available; physical native border appearance and drag/resize geometry remain outside their evidence. The optional catalog GET has a source-side buffered-body fix but remains HTTP 400 on the cached running host until its next normal restart; installed UI uses the working public RPC, so no additional restart is needed for the primary workflow. Earlier SHIP evidence is historical, not a new independent-review verdict. Previous detector palette/radius omissions remain advisory-only. This documentation pass did not rerun browser, detector, build or tests.

## Colors

The palette is charcoal and ink with cool gray labels, blue interactive states and muted rose feedback. Frontmatter is normative; the sidecar's synthesized tonal strips are preview metadata, not additional shipping colors.

### Primary
- **DSH action blue** (`primary`, `primary-hover`): settings' Save shortcut button and its hover state.
- **Utility blue** (`accent`): native checkbox accent and the mini accent variable; do not imply every inherited composer action uses this variable.
- **Focus blue** (`focus`): keyboard focus outlines and the session-search focus border.

### Neutral
- **Charcoal canvas** (`background`): expanded window, expanded composer seat and overlay-panel backing. Compact root and seat are transparent.
- **Raised charcoal / overlay charcoal** (`raised`, `overlay`): scoped DSH background aliases for inherited controls and layers.
- **Ink editor** (`input`): the sole visible compact pill and borderless expanded composer, retaining the real editor.
- **Soft white** (`text`): primary labels and composer text. Secondary, tertiary and caption aliases preserve DSH's label hierarchy; `muted` carries workspace and session metadata.
- **Control separators** (`border`, `control-border`): settings/help separators and ordinary fields/buttons retain their established colors. Neither the expanded shell nor compact composer draws a border; no gray-contour requirement remains for those surfaces.
- **Quiet state surfaces** (`interactive-hover`, `interactive-active`, `icon-hover`, `field-surface`): scoped interaction aliases, header-button hover and literal search-field backing.

Notice surfaces and labels use `notice-background` and `notice-text`; inline mini errors use `error`. The cool blue `running` dot denotes a running session or ready runtime, always alongside descriptive text rather than as the sole status cue.

**The Scoped Identity Rule.** Mini-window aliases apply only to the mini document; ordinary DSH pages retain their incumbent appearance, and the main Settings section inherits host aliases.

## Typography

**Body and UI font:** the operating-system stack recorded in frontmatter. The target is specifically a macOS native companion with a web renderer, so the resolved macOS system face is intentional. Segoe UI and sans-serif are fallback entries, not a proposed cross-platform visual identity. No separate display font is present.

### Hierarchy
- **Title:** panel headings for Sessions, Mini Window and workspace selection.
- **Subheading:** New mini chats section heading within settings.
- **Workspace:** the expanded header keeps directory/workspace context at 12px; the repeated long session-title label is hidden. Compact header text is absent.
- **Body:** actual conversation content and composer input are 14px, with content-font delta 0. In compact mode the editor uses a 24px line height, 32px minimum input height and padding of 4px vertically / 12px horizontally.
- **Field / label:** search, settings fields, row titles and ordinary control text. Session titles use weight 500; settings field labels use weight 500 with regular-weight input values.
- **Metadata / supporting:** workspace context, dates, message snippets and notices. Snippets clamp to two lines and wrap long tokens.

**The Native Text Rule.** Preserve macOS system typography and the inherited DSH text hierarchy; do not add a web display font to make this utility seem branded.

## Layout

The shared constants define a fixed compact window (640×112 logical pixels), expanded default (640×600), and expanded minimum (440×360). Expanded mode uses Electron's native resize edges and remembers its geometry across collapse and reopening. Compact mode is not resizable. Display work-area clamping may reduce dimensions or the enforced minimum where the available desktop area is smaller; these are native window sizes, not web breakpoints.

The expanded shell is a vertical flex layout with clipped rounded edges, padding recorded on `window`, and a 40px draggable header followed by 8px bottom margin. Its controls opt out of the drag region; only workspace metadata is shown in the flexible title control. Compact root has no background, border or padding and hides that header entirely. The real composer occupies the full 112px height as a single pill, with 16px top / 12px horizontal and bottom padding and 6px internal gap. An invisible 12px top strip, inset 56px from each side, provides native dragging without surrounding chrome.

Expanded content flexes with `min-height: 0`: the transcript scrolls and the composer seat stays at the bottom with 8px top padding. The compact transcript hides siblings other than the resident composer seat, uses bottom alignment, and resets that seat to relative positioning with no inset or padding. Do not restore inherited absolute positioning in compact mode. The composer stays mounted through mode changes. Compact mode caps editor growth at 32px; expanded editor cap is 160px. The expanded composer has 12px top padding and no border. Composer dock/billing strips are hidden in both modes, without replacing the editor or changing persisted user preferences. Running, prompt attempts, pending approvals, attachments, multiline text or taller editor content request expansion through the integration.

At viewport widths of 500px or less, hide expanded-header workspace metadata, show model icons without their text, and reduce expanded horizontal shell padding to 14px. Compact root padding remains zero. This is the sole authored CSS width breakpoint, not a mobile product promise. Overlay panels occupy the inset area below the expanded header (top 62px, other edges 20px), scroll internally and make the conversation inert while open. Browser preview framing uses a 640px maximum width and 32px exterior margin; that preview frame is not native-window chrome.

## Elevation & Depth

Depth is tonal and restrained. Both shell and composer have no CSS box shadow; expanded composer also has no border. The native host requests a transparent frameless window with native shadow and OS rounded-corner treatment both disabled; CSS supplies the rounded shape. Vibrancy is removed so transparent compact corners do not reveal a second frame. These native settings are implementation evidence, not a claim that browser screenshots demonstrate compositor behavior. The expanded canvas remains opaque charcoal; compact backing is transparent outside the one dark editor pill.

Hover feedback changes background color over 120ms with ease-out only when reduced motion is not requested. No animated window morph or decorative movement is authored. Buttons and settings fields keep the 2px keyboard outline with 3px offset; the search container additionally changes its border on focus-within. The real composer editor intentionally suppresses that rectangular outline and uses its accented caret instead.

**The Single Surface Rule.** Compact mode shows only the real composer pill; expanded mode avoids repeated outlined or shadowed containers around that editor.

## Shapes

The compact signature is a single full-height composer pill using `composer-compact`; its transparent root follows that radius without drawing another surface. Expanded canvas and borderless composer use the softer `window` and `composer-expanded` shape. Controls use the smaller `control` radius, session rows use `row`, search uses `search`, and errors use `notice`. Borders are thin, subdued separators, not nested editor outlines.

Visible expanded-header controls use circular 32px hit boxes. Authored UI icons use a 24-unit SVG viewBox, no fill, rounded caps/joins and stroke width 1.7, rendered at 20px. Compact mode has no visible header icons. The decorative resize hint is removed; native resize edges remain the expanded resize mechanism.

The menu-bar asset is an authored monochrome 18px speech-bubble SVG in [native/icon.cjs](native/icon.cjs), marked as a native template image. If native SVG decoding is unavailable, the same module creates a local high-DPI black/transparent bitmap at scale factor 2. That procedural fallback is a shipping raster with code provenance, not AI-generated artwork or a downloaded logo.

## Components

### Buttons

Quiet utility controls. Icon buttons carry accessible names and title tooltips; the SVG itself is decorative. Background hover, focus outline and disabled opacity are retained. The secondary settings button inherits scoped host aliases, while the primary Save shortcut button uses explicit action blue and its darker contour. Primary disabled opacity is 0.45; icon disabled opacity is 0.4. Header actions are visible only in expanded mode; New chat there is disabled while busy or without an active workspace. Compact commands remain available through native menus and keyboard shortcuts, not an outer toolbar.

### Inputs / Fields

Shortcut input uses the raised surface, thin control border, rounded shape and explicit label. Session search is an inset dark container with a copied stroke-search SVG, transparent inner input and focus-within border change. The search input removes its outline locally; the container carries that focus treatment. The workspace setup uses a labeled native select rather than a fabricated custom dropdown. New mini chats settings reuse that native field style for provider-grouped model choices and, conditionally, supported reasoning efforts; loading, unavailable saved choices, save errors and saved status are explicit.

### Cards / Containers

Expanded mode has one primary conversation canvas, not a grid of decorative cards. Its padded composer keeps the ink background but removes the inner border. Compact mode draws only that real composer as the borderless ink pill; the root draws nothing outside it. Error notices use a muted rose container, readable multiline text, bounded scrolling and a dismiss action where available.

### Navigation

The expanded toolbar offers hide, explicit workspace context, existing sessions, New chat, settings and expand/collapse, without repeating the long session title. The compact toolbar is hidden. Native application and tray menus expose Expand/Collapse, New Chat and Settings; Command-comma opens settings. Double-clicking empty, non-interactive padding toggles mode; it does not intercept editor or button double-clicks. Session and workspace panels reuse flat rows with bottom separators and restrained hover/focus backing. Session rows include title, workspace or directory, date, optional running dot and optional two-line search snippet. Keyboard arrows move focus between session rows; modal panels trap Tab among their controls and restore focus to history on close. Escape respects open composer menus before closing a panel or hiding the window.

### Mini-only model defaults

[ModelDefaults](src/client/model-defaults.tsx) adds a New mini chats section using existing system-type headings, labeled native selects and Save/Refresh buttons. It offers the live model catalog and only reasoning efforts advertised by the selected model, not unrelated global speed or verbosity controls. Clearing the selection uses the main DSH default without saving to it. Changes persist in independent private mini state and apply only to new mini chats, not resumed sessions/history. New-chat creation waits for queued saves, refreshes server state and fails closed on load/validation errors. The canonical selection is persisted before the standard core-owned agent opens; this is not an alternative agent or composer. The installed UI loads options through the injected public `remote.session.modelCatalog()` RPC callback. The live-tested Gemini/High identifiers are catalog-derived (`antigravity`, `gemini-3.8-flash-tiered`, `high`), not hardcoded visual options; the optional HTTP catalog fallback is not the primary UI path.

### Resident DSH composer

This is DSH's real embedded conversation/composer, not a substitute input built for a screenshot. Preserve model selection, tools, attachments, send/stop behavior and approval handling through the host slots. Styling adjusts the scoped surface, padding, contour, editor sizing and placement, and hides composer dock/billing strips in both modes; it does not overwrite current user preferences. The sidecar shows extracted local primitives; it deliberately does not invent a standalone HTML replica of the live composer, which requires the DSH runtime.

## Do's and Don'ts

### Do:
- Do preserve the screenshot-pinned dark rounded macOS world and DSH identity, with only one visible compact composer pill.
- Do keep the real composer mounted and bottom-anchored in expanded mode, with compact seat positioning reset and generous input padding.
- Do retain system typography, accessible action names, form/button keyboard rings, accented editor caret and reduced-motion behavior.
- Do limit mini-default settings to the catalog-selected model and its advertised reasoning options, without changing main DSH defaults or existing sessions.
- Do preserve native resizing and remembered expanded geometry; distinguish CSS breakpoints from window bounds.
- Do record browser captures, user-reference attachments and procedural icon provenance separately.

### Don't:
- Don't replace the approved DSH composer because a generic web-design rule discourages stock components.
- Don't invent a display-font pairing, generated raster artwork or composition-led golden screenshots.
- Don't describe browser-preview captures as actual macOS window screenshots.
- Don't claim exhaustive native fullscreen or multi-monitor manual verification from helper tests or browser metrics.
- Don't restore shell/pill borders, native shadows, rectangular editor focus outlines, compact outer chrome, repeated expanded session titles, billing/dock strips or resize decoration.
- Don't infer model wire IDs from display names, change main defaults, or advertise the unverified optional catalog GET as the primary path.
- Don't leak mini-window overrides into ordinary DSH pages or overwrite current user preferences.
