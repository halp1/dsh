# DSH UI patches

Small UI corrections shared by the local web UI, paired remote browsers, mobile views, and the mini window.

## Composer pricing

Hides the billing plugin's peak/off-peak and turn/session pricing capsule, including its optional toolbar position. The billing dashboard, chat input, and other composer dock controls are unchanged.

The mini-window plugin already hides its own composer footer, but that rule is scoped to the mini window. Billing also stores its display preference separately for each browser origin. This plugin instead injects a stylesheet into the shared web shell, so the patch applies before client rendering without changing anyone's local storage or requiring a client bundle rebuild.

## Cursor stats

Hides the Cursor integration plugin's composer dock rows: the checkpoint and compaction status, the routing and quota pills, and the local context estimate. The plugin offers no setting for these. The Cursor usage page under Settings is unchanged.

## One-line portrait composer

On a portrait phone, remote-web-ui moves the composer's trailing controls (voice input, model picker) onto their own line under the permission and skill controls. This patch puts them back on the same line, reserving room for the send button and context meter that remote-web-ui pins to the right edge. It applies only under remote-web-ui's `dsh-remote-portrait` body class, so desktop and landscape layouts are unchanged.

## Fira Code

Makes [Fira Code](https://github.com/tonsky/FiraCode) the code font for inline code, fenced code blocks, and every other surface that uses the shell's code font. The font file ships with the plugin and the host serves it at `/ui-patches/fonts/fira-code-6.2.woff2`, so remote and mobile browsers render it without a local install.

The patch only replaces the built-in default stack. A font entered under Settings > General > Code font still takes precedence.

Fira Code is licensed under the SIL Open Font License 1.1, see [assets/FiraCode-OFL.txt](assets/FiraCode-OFL.txt).

## Mobile Enter

On phones and tablets, the return key inserts a line break in the composer instead of sending. Send with the Send button. Desktop keeps Enter to send and Shift+Enter for a line break.

The shell submits on plain Enter on every device. On mobile, a head script stops plain Enter from reaching the composer's keydown handlers but keeps the key's default action. The browser then emits `insertParagraph`, which the plain-text editor already turns into a line break. Enter still picks a highlighted slash or `@` suggestion, and IME composition and modified chords are left alone. The device test matches the shell's own mobile check.

## Portrait account menu

On a phone in portrait, tapping More at the bottom of the sidebar opens the menu with Settings, Feedback, and sign in. Picking an item closes the sidebar.

remote-web-ui's portrait layer closes the sidebar drawer on any tap in the sidebar's settings area, because that area used to hold a plain Settings button. It now holds the account menu, and closing the drawer removes the menu as it opens. For that one tap, a head script hides the event target from the layer's document click listener and restores it before the app's own handler runs. The drawer closes after a menu item is picked, which is what the layer intended.

## Install

```sh
dsh plugin --profile web add file:/Users/halp/code/dsh/plugins/ui-patches
```

Refresh each open browser after installing or changing the patch. No build step is required.

To turn a patch off, disable the plugin or set this profile override:

```yaml
- id: ui-patches
  config:
    hideComposerPricing: false
    hideCursorStats: false
    composerOneLine: false
    firaCode: false
    mobileEnterNewline: false
    portraitAccountMenu: false
```

## Test

```sh
pnpm install
pnpm test
```
