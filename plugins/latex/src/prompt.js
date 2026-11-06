/**
 * The model-facing guidance that makes agents write mathematics as LaTeX.
 *
 * Kept in its own module so tests (and anyone curious) can read the exact text
 * without booting a host. The delimiters listed here are exactly the ones the
 * DSH chat renderer parses (`micromark-extension-math` plus DSH's
 * compatibility grammar): `$…$`, `$$…$$`, `\(…\)` and `\[…\]`.
 * @module dsh-plugin-latex/prompt
 */

/** Section name in the system-prompt registry. */
export const SECTION_NAME = 'plugin:latex-math';

/**
 * Sort position. Between DELIVERABLE_FILE_REFERENCES (9000) and
 * STRUCTURED_OUTPUT (9900): output-formatting guidance, after all tool docs.
 */
export const SECTION_ORDER = 9500;

export const LATEX_PROMPT = `# Math formatting

The chat interface renders LaTeX math with KaTeX, live while you stream. Whenever a reply contains mathematics (equations, formulas, variables, expressions, derivations, proofs, matrices, sums, integrals, probabilities, asymptotic bounds such as $O(n \\log n)$, units with exponents), write it as LaTeX. Never use plain-text or Unicode stand-ins like x^2, sqrt(x), a/b, <=, ∑ or √ for math.

- Inline math: \`$...$\`, e.g. \`the roots are $x = \\frac{-b \\pm \\sqrt{b^2 - 4ac}}{2a}$\`. No space directly inside the dollar signs. \`\\(...\\)\` also works.
- Display math: \`$$\` requires newlines around them — put \`$$\` alone on the line before and the line after the expression (or use \`\\[\` and \`\\]\` the same way). Never put \`$$\` on the same line as the math or surrounding text. For multi-line work use environments such as \`aligned\`, \`cases\`, \`pmatrix\` or \`bmatrix\` inside display math.
- Words inside math go in \`\\text{...}\`; use \`\\operatorname{...}\` for named operators.
- Do not put math in code spans or code blocks; those show raw source. The exceptions: when the user asks for LaTeX source itself, and anything written into files, code, commit messages or shell commands, where you use whatever that target needs (for example \`x**2\` in Python).
- Escape literal dollar signs in prose as \`\\$\` (for example "costs \\$5") so they are not read as math. Inside code spans and code blocks, do not escape them.
- Only KaTeX-supported math commands work: no \`\\usepackage\`, TikZ or document-level commands.
- Plain numbers in prose ("3 files", "port 8080", "version 2.1") stay plain text.`;
