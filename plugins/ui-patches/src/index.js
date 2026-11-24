/** Shared page patches, independent of browser origin, posture, and client storage. */
import { readFile } from 'node:fs/promises';

export const name = 'ui-patches';
export const inject = ['webServer'];

// Target only billing's own capsules. Never hide the shared composer dock,
// whose other occupants can include useful controls from unrelated plugins.
const COMPOSER_PRICING_CSS = `
[data-testid="billing-live-cost-bar"],
[data-testid="billing-live-cost-chip"] {
  display: none !important;
}
`;

// Served by this host so remote and mobile browsers get the same face
// without having Fira Code installed. The version keeps the URL immutable.
export const FIRA_CODE_PATH = '/ui-patches/fonts/fira-code-6.2.woff2';
const FIRA_CODE_FILE = new URL('../assets/FiraCode-VF.woff2', import.meta.url);

// Replace the built-in default stack rather than the effective variable, so a
// font chosen under Settings > Code font still wins. `:root:root` outranks the
// theme's own `:root` rule regardless of stylesheet order.
const FIRA_CODE_CSS = `
@font-face {
  font-family: "Fira Code";
  src: url("${FIRA_CODE_PATH}") format("woff2-variations"), url("${FIRA_CODE_PATH}") format("woff2");
  font-weight: 300 700;
  font-style: normal;
  font-display: swap;
}
:root:root {
  --dsh-font-family-code-default: "Fira Code", "SF Mono", Menlo, Consolas, "Liberation Mono", monospace, "PingFang SC", "Microsoft YaHei";
}
`;

// The composer keymap submits on plain Enter everywhere, so a phone's return
// key sends instead of breaking the line. On mobile, hide plain Enter from the
// editor's keydown handlers but keep its default action: the browser then
// fires `insertParagraph`, which the plain-text editor turns into a line
// break, as it already does for Shift+Enter on iOS. The mobile test mirrors
// the shell's own `isMobileDevice`. A highlighted trigger-menu candidate still
// takes Enter, and IME composition and modified chords are left alone.
export const MOBILE_ENTER_NEWLINE_SCRIPT = `(() => {
  const { userAgent, platform, maxTouchPoints } = navigator;
  if (!(/Android|iPhone|iPad|iPod/i.test(userAgent) || (platform === "MacIntel" && maxTouchPoints > 1))) return;
  window.addEventListener("keydown", (event) => {
    if (event.key !== "Enter" || event.isComposing || event.keyCode === 229) return;
    if (event.shiftKey || event.altKey || event.ctrlKey || event.metaKey) return;
    const target = event.target;
    const input = target instanceof Element ? target.closest("[data-composer-input][contenteditable=true]") : null;
    if (input === null || input.hasAttribute("data-composer-composing")) return;
    if (document.querySelector("[data-trigger-menu] [role=listbox][aria-activedescendant]") !== null) return;
    event.stopImmediatePropagation();
  }, true);
})();`;

function booleanOption(config, key) {
  const value = config[key] ?? true;
  if (typeof value !== 'boolean') {
    throw new TypeError(`ui-patches: ${key} must be a boolean`);
  }
  return value;
}

function serveFiraCode(req, res) {
  if (req.method !== 'GET' && req.method !== 'HEAD') {
    res.statusCode = 405;
    res.setHeader('allow', 'GET, HEAD');
    res.end();
    return;
  }
  return readFile(FIRA_CODE_FILE).then((font) => {
    res.statusCode = 200;
    res.setHeader('content-type', 'font/woff2');
    res.setHeader('content-length', font.length);
    res.setHeader('cache-control', 'public, max-age=31536000, immutable');
    res.end(req.method === 'HEAD' ? undefined : font);
  }, () => {
    res.statusCode = 404;
    res.end();
  });
}

/** Apply the same stylesheet to every shell served by this profile. */
export function apply(ctx, config = {}) {
  const hideComposerPricing = booleanOption(config, 'hideComposerPricing');
  const firaCode = booleanOption(config, 'firaCode');
  const mobileEnterNewline = booleanOption(config, 'mobileEnterNewline');

  if (firaCode) {
    ctx.effect(
      () => ctx.webServer.register({ kind: 'exact', path: FIRA_CODE_PATH, handler: serveFiraCode }),
      `ui-patches: GET ${FIRA_CODE_PATH}`,
    );
  }

  const css = [hideComposerPricing && COMPOSER_PRICING_CSS, firaCode && FIRA_CODE_CSS].filter(Boolean).join('');
  const rows = [
    css !== '' && { kind: 'style', text: css },
    mobileEnterNewline && { kind: 'script', placement: 'head', text: MOBILE_ENTER_NEWLINE_SCRIPT },
  ].filter(Boolean);
  if (rows.length === 0) return;

  ctx.on('webserver/index-inject', (table) => {
    table.push(...rows);
  });
}
