/**
 * dsh-plugin-latex, browser half: live KaTeX while a reply streams.
 *
 * DSH's Markdown renderer (`MarkdownText` in dsh-client-ui-primitives) already
 * renders TeX through KaTeX, but only on its *settled* arm. Its streaming arm
 * parses without the math grammar on purpose, so half-written formulas never
 * flash KaTeX errors. The cost is that every formula shows as raw `$…$`
 * source until the whole reply finishes.
 *
 * This plugin replaces the component behind the shared `MarkdownText` memo
 * object (its namespace is frozen, the memo object is not), so every surface
 * that renders assistant Markdown gets the same behavior. While a message
 * streams AND contains math, the text is cut into blocks at safe top-level
 * boundaries:
 *
 * - completed blocks render once through the settled arm (math included) and
 *   stay memoized, so per-chunk work is bounded by the last block;
 * - the growing last block renders through the settled arm when it has math,
 *   otherwise through the original incremental streaming arm (so long code
 *   fences keep their cheap incremental highlighting);
 * - an unclosed inline formula (`$…`, `\(…`) shows as plain text until its
 *   closing delimiter arrives (nothing is held back, so a literal `$` in
 *   prose never stalls the stream);
 * - an unclosed display formula (`$$`, `\[`, ```math) is previewed from its
 *   complete lines, with open environments, braces and `\left`s auto-closed.
 *
 * Messages without math, and every settled message, render exactly as before.
 *
 * This file is the shipped artifact: a classic script in the client module
 * system's closure-factory format. Platform modules (react, the primitives)
 * come from the injected `require`, never from a bundle.
 * @module dsh-plugin-latex/client
 */
window.__ModuleLoader__.load({ id: 'dsh-plugin-latex', factory: (require) => {
  'use strict';
  const module = { exports: {} };

  // ---------------------------------------------------------------------------
  // Pure text analysis (no React, no DOM): exported for tests.
  // ---------------------------------------------------------------------------

  /** Opening code fence: up to 3 spaces, then ``` or ~~~ (3+), then an info string. */
  const FENCE_OPEN = /^ {0,3}(`{3,}|~{3,})(.*)$/;
  /** Closing code fence. */
  const FENCE_CLOSE = /^ {0,3}(`{3,}|~{3,})[ \t]*$/;
  /** A line that continues a list or block quote; never a split point. */
  const LIST_OR_QUOTE = /^(?:[-*+](?:[ \t]|$)|\d{1,9}[.)](?:[ \t]|$)|>)/;
  /** Opening display-math line: `$$` or `\[` after at most 3 spaces. */
  const MATH_OPEN = /^ {0,3}(\$\$|\\\[)(.*)$/;
  /** Closing `$$` fence, alone on its line (upstream micromark-extension-math). */
  const DOLLAR_CLOSE = /^ {0,3}\${2,}[ \t]*$/;
  /**
   * A partial last line is only judged as a split point once it is long enough
   * that a list marker (up to 9 digits plus `.`) could no longer appear.
   */
  const DECIDED_PARTIAL_LINE = 12;

  /**
   * Fast check: could this text contain math at all? Monotone for append-only
   * text (a line's fence status depends only on earlier lines), so a stream
   * that turns on live mode stays in it.
   * @param {string} text - Markdown source.
   * @returns {boolean} whether math delimiters appear outside code fences.
   */
  function mayContainMath(text) {
    if (text.indexOf('$') === -1 && text.indexOf('\\(') === -1 && text.indexOf('\\[') === -1) {
      return /^ {0,3}(`{3,}|~{3,})[ \t]*math\b/m.test(text);
    }
    return scan(text).hasMath;
  }

  /**
   * One forward pass over the lines of `text`.
   * @param {string} text - Markdown source (possibly mid-stream).
   * @returns {{
   *   splits: number[],
   *   hasMath: boolean,
   *   open: null | { kind: 'fence' | 'math', math: boolean, start: number, bodyStart: number },
   *   paraStart: number,
   * }} block split offsets, a math flag, the block still open at the end,
   * and where the trailing paragraph-level region starts.
   */
  function scan(text) {
    const splits = [];
    let hasMath = false;
    /** @type {null | { kind: 'fence', ch: string, len: number, math: boolean, start: number, bodyStart: number } | { kind: 'math', close: string, math: true, start: number, bodyStart: number }} */
    let open = null;
    let prevBlank = false;
    let paraStart = 0;
    let offset = 0;
    for (;;) {
      const nl = text.indexOf('\n', offset);
      const end = nl === -1 ? text.length : nl;
      const line = text.slice(offset, end);
      const next = nl === -1 ? text.length : nl + 1;

      if (open !== null && open.kind === 'fence') {
        const m = FENCE_CLOSE.exec(line);
        if (m !== null && m[1][0] === open.ch && m[1].length >= open.len) {
          open = null;
          paraStart = next;
        }
        prevBlank = false;
      } else if (open !== null && open.kind === 'math') {
        if (closesMath(line, open.close)) {
          open = null;
          paraStart = next;
        }
        prevBlank = false;
      } else {
        const blank = line.trim() === '';
        if (
          !blank && prevBlank && offset > 0 && /^\S/.test(line) && !LIST_OR_QUOTE.test(line)
          && (nl !== -1 || line.length >= DECIDED_PARTIAL_LINE)
        ) {
          splits.push(offset);
        }
        const fence = FENCE_OPEN.exec(line);
        const math = fence === null ? MATH_OPEN.exec(line) : null;
        if (fence !== null && !(fence[1][0] === '`' && fence[2].includes('`'))) {
          const lang = /^[\w-]*/.exec(fence[2].trim())[0];
          const isMath = lang === 'math';
          if (isMath) hasMath = true;
          open = { kind: 'fence', ch: fence[1][0], len: fence[1].length, math: isMath, start: offset, bodyStart: next };
        } else if (math !== null) {
          hasMath = true;
          const marker = math[1];
          const rest = math[2];
          const sameLineClosed = marker === '$$'
            ? /\$\$[ \t]*$/.test(rest) && rest.trim() !== ''
            : /\\\][ \t]*$/.test(rest);
          if (!sameLineClosed) {
            const restStart = offset + line.length - rest.length;
            open = { kind: 'math', close: marker === '$$' ? '$$' : '\\]', math: true, start: offset, bodyStart: rest.trim() === '' ? next : restStart };
          } else {
            paraStart = next;
          }
        } else if (blank) {
          paraStart = next;
        } else if (!hasMath && /\$|\\\(|\\\[/.test(line)) {
          hasMath = true;
        }
        prevBlank = blank;
      }

      if (nl === -1) break;
      offset = nl + 1;
    }
    return { splits, hasMath, open, paraStart };
  }

  /**
   * Whether `line` closes a display-math block opened with `close`'s partner.
   * @param {string} line - one source line.
   * @param {string} close - `$$` or `\]`.
   * @returns {boolean} true when the block ends on this line.
   */
  function closesMath(line, close) {
    if (close === '$$') return DOLLAR_CLOSE.test(line);
    return /\\\][ \t]*$/.test(line);
  }

  /**
   * Length of the run of `ch` starting at `i`.
   * @param {string} s - text.
   * @param {number} i - start index.
   * @param {string} ch - run character.
   * @returns {number} run length (0 when `s[i] !== ch`).
   */
  function runLength(s, i, ch) {
    let j = i;
    while (s[j] === ch) j++;
    return j - i;
  }

  /**
   * Index of the next maximal run of exactly `n` × `ch` at or after `from`.
   * @param {string} s - text.
   * @param {number} from - search start.
   * @param {string} ch - run character.
   * @param {number} n - required run length.
   * @returns {number} run start, or -1.
   */
  function findRun(s, from, ch, n) {
    let i = from;
    while (i < s.length) {
      if (s[i] === ch) {
        const len = runLength(s, i, ch);
        if (len === n) return i;
        i += len;
      } else {
        i++;
      }
    }
    return -1;
  }

  /**
   * Index of the `\)` closing a `\(` whose content starts at `from`.
   * @param {string} s - text.
   * @param {number} from - content start.
   * @returns {number} index of the closing backslash, or -1.
   */
  function findParenClose(s, from) {
    let i = from;
    while (i < s.length) {
      if (s[i] === '\\') {
        if (s[i + 1] === ')') return i;
        i += 2;
      } else {
        i++;
      }
    }
    return -1;
  }

  /**
   * The inline formula in `s` that has opened but not closed yet, honoring
   * code spans and backslash escapes. Everything after an unclosed opener is
   * inside it, so there is at most one.
   * @param {string} s - the trailing paragraph-level region of a stream.
   * @returns {{ at: number, length: number, kind: '$' | '\\(' } | null} the opener, or null.
   */
  function findUnclosedInline(s) {
    let i = 0;
    while (i < s.length) {
      const c = s[i];
      if (c === '`') {
        const n = runLength(s, i, '`');
        const close = findRun(s, i + n, '`', n);
        i = close === -1 ? i + n : close + n;
      } else if (c === '\\') {
        if (s[i + 1] === '(') {
          const close = findParenClose(s, i + 2);
          if (close === -1) return { at: i, length: 2, kind: '\\(' };
          i = close + 2;
        } else {
          i += 2;
        }
      } else if (c === '$') {
        const n = runLength(s, i, '$');
        const close = findRun(s, i + n, '$', n);
        if (close === -1) return { at: i, length: n, kind: '$' };
        i = close + n;
      } else {
        i++;
      }
    }
    return null;
  }

  /**
   * Neutralize an unclosed inline opener so the rest of the paragraph renders
   * as plain text (exactly what the user would see without this plugin) until
   * the closing delimiter arrives. Nothing is hidden, so prose with a literal
   * `$` never stalls.
   * @param {string} s - paragraph-level region.
   * @param {{ at: number, length: number, kind: string }} opener - from findUnclosedInline.
   * @returns {string} the region with the opener escaped.
   */
  function escapeOpener(s, opener) {
    const escaped = opener.kind === '$' ? '\\$'.repeat(opener.length) : '\\\\(';
    return s.slice(0, opener.at) + escaped + s.slice(opener.at + opener.length);
  }

  /**
   * Make a partial display formula renderable: keep complete lines only, then
   * close what is still open (environments, `\left`, braces). Returns null when
   * there is nothing to show or the source is not plausibly closable.
   * @param {string} body - formula source streamed so far.
   * @returns {string | null} a complete TeX formula, or null.
   */
  function closePartialFormula(body) {
    const cut = body.lastIndexOf('\n');
    let src = (cut === -1 ? '' : body.slice(0, cut)).replace(/\s+$/, '');
    if (src === '') return null;
    // Environments, innermost last.
    const stack = [];
    const env = /\\(begin|end)\s*\{([^}]*)\}/g;
    for (let m = env.exec(src); m !== null; m = env.exec(src)) {
      if (m[1] === 'begin') stack.push(m[2]);
      else if (stack.length > 0 && stack[stack.length - 1] === m[2]) stack.pop();
      else return null;
    }
    // Braces, ignoring escaped \{ and \}.
    let depth = 0;
    for (let i = 0; i < src.length; i++) {
      const c = src[i];
      if (c === '\\') { i++; continue; }
      if (c === '{') depth++;
      else if (c === '}') depth--;
      if (depth < 0) return null;
    }
    const lefts = (src.match(/\\left(?![a-zA-Z])/g) ?? []).length;
    const rights = (src.match(/\\right(?![a-zA-Z])/g) ?? []).length;
    // A dangling row separator or alignment mark adds nothing but an empty cell.
    src = src.replace(/(?:\\\\|&)\s*$/, '').replace(/\s+$/, '');
    if (src === '') return null;
    let closed = src + '}'.repeat(depth);
    for (let k = lefts - rights; k > 0; k--) closed += ' \\right.';
    for (let k = stack.length - 1; k >= 0; k--) closed += `\n\\end{${stack[k]}}`;
    return closed;
  }

  /**
   * Plan one streaming frame.
   * @param {string} text - the accumulated Markdown source.
   * @returns {{
   *   segments: { key: number, text: string }[],
   *   tail: { key: number, text: string, math: boolean } | null,
   *   pending: string | null,
   * }} completed blocks, the growing block (cut before any unclosed formula),
   * and a renderable preview of an unclosed display formula.
   */
  function planStream(text) {
    const { splits } = scan(text);
    const bounds = [0, ...splits];
    const segments = [];
    for (let k = 0; k < bounds.length - 1; k++) {
      segments.push({ key: bounds[k], text: text.slice(bounds[k], bounds[k + 1]) });
    }
    const tailStart = bounds[bounds.length - 1];
    let tailText = text.slice(tailStart);
    let pending = null;

    const tailScan = scan(tailText);
    if (tailScan.open !== null && tailScan.open.math) {
      const formula = closePartialFormula(tailText.slice(tailScan.open.bodyStart));
      if (formula !== null) pending = `$$\n${formula}\n$$`;
      tailText = tailText.slice(0, tailScan.open.start);
    } else if (tailScan.open === null) {
      const region = tailText.slice(tailScan.paraStart);
      const opener = findUnclosedInline(region);
      if (opener !== null) tailText = tailText.slice(0, tailScan.paraStart) + escapeOpener(region, opener);
    }

    const tail = tailText.trim() === ''
      ? null
      : { key: tailStart, text: tailText, math: scan(tailText).hasMath };
    return { segments, tail, pending };
  }

  // ---------------------------------------------------------------------------
  // React side.
  // ---------------------------------------------------------------------------

  const STYLE_ID = 'dsh-plugin-latex-css';
  /**
   * Live mode renders several sibling `.markdown` blocks instead of one. A flex
   * gap stands in for the collapsed paragraph margin the single document would
   * have had (16px body, 4px compact); the rules after it restore the extra
   * space a heading or rule carries that the block's zeroed first-child margin
   * removed.
   */
  const CSS = `
.dsh-latex-stream { display: flex; flex-direction: column; gap: 16px; min-width: 0; }
.dsh-latex-stream[data-variant="compact"] { gap: 4px; }
.dsh-latex-stream > div:not(:first-child) > :is(h1, h2, h3):first-child,
.dsh-latex-stream > div:not(:first-child) > hr:first-child { margin-top: 16px !important; }
.dsh-latex-stream[data-variant="compact"] > div:not(:first-child) > :is(h1, h2, h3, h4, h5, h6):first-child { margin-top: 4px !important; }
.dsh-latex-stream[data-variant="compact"] > div:not(:first-child) > hr:first-child { margin-top: 4px !important; }
.dsh-latex-pending { opacity: 0.6; transition: opacity 120ms ease-out; }
`;

  /** Marker on our wrapper so a re-apply (HMR) can find the original. */
  const WRAPPED = Symbol.for('dsh-plugin-latex.original');

  /**
   * Build the live replacement for MarkdownText's inner component.
   * @param {typeof import('react')} React - the host's React.
   * @param {Function} original - MarkdownText's original inner function.
   * @returns {Function} the replacement component.
   */
  function createLiveMarkdown(React, original) {
    const h = React.createElement;
    // One memoized component for every block, so a block that crosses from
    // "growing" to "completed" keeps its instance (same type, same key).
    const Block = React.memo(original);

    function LiveMarkdown(props) {
      const { text, streaming = false, labels, variant = 'body' } = props;
      const plan = React.useMemo(
        () => (streaming === true && typeof text === 'string' && mayContainMath(text) ? planStream(text) : null),
        [streaming, text],
      );
      if (plan === null) return h(Block, props);

      const children = plan.segments.map((segment) => h(Block, {
        key: segment.key, text: segment.text, streaming: false, labels, variant,
      }));
      if (plan.tail !== null) {
        children.push(h(Block, {
          key: plan.tail.key, text: plan.tail.text, streaming: !plan.tail.math, labels, variant,
        }));
      }
      if (plan.pending !== null) {
        children.push(h('div', { key: 'pending', className: 'dsh-latex-pending' },
          h(Block, { text: plan.pending, streaming: false, labels, variant })));
      }
      return h('div', {
        className: 'dsh-latex-stream',
        'data-variant': variant,
        'data-live-math': '',
      }, children);
    }
    LiveMarkdown.displayName = 'MarkdownText(dsh-plugin-latex)';
    LiveMarkdown[WRAPPED] = original;
    return LiveMarkdown;
  }

  /**
   * Install the live renderer on the shared MarkdownText memo object.
   * @param {{ type: Function }} markdownText - the primitives' MarkdownText.
   * @param {typeof import('react')} React - the host's React.
   * @returns {() => void} restores the original component.
   */
  function install(markdownText, React) {
    if (markdownText === null || typeof markdownText !== 'object' || typeof markdownText.type !== 'function') {
      throw new Error('dsh-plugin-latex: MarkdownText is not a memo component; this DSH version is not supported');
    }
    const original = markdownText.type[WRAPPED] ?? markdownText.type;
    const live = createLiveMarkdown(React, original);
    markdownText.type = live;
    return () => {
      if (markdownText.type === live) markdownText.type = original;
    };
  }

  module.exports = {
    name: 'latex',
    inject: [],
    apply(ctx) {
      const React = require('react');
      const { MarkdownText } = require('@deepseek-ai/dsh-client-ui-primitives');
      ctx.effect(() => install(MarkdownText, React), 'latex: live math renderer');
      ctx.effect(() => {
        if (typeof document === 'undefined' || document.getElementById(STYLE_ID) !== null) return () => {};
        const style = document.createElement('style');
        style.id = STYLE_ID;
        style.textContent = CSS;
        document.head.appendChild(style);
        return () => { style.remove(); };
      }, 'latex: styles');
    },
    // Exposed for tests and devtools.
    mayContainMath,
    scan,
    findUnclosedInline,
    escapeOpener,
    closePartialFormula,
    planStream,
    createLiveMarkdown,
    install,
  };
  return module.exports;
} });
