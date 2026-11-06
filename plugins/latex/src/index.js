/**
 * dsh-plugin-latex, node half.
 *
 * Registers one global system-prompt section telling every agent (top-level
 * sessions, subagents, forks, workflow agents) to write mathematics as LaTeX.
 * A global section participates in every prompt assembly, scoped or not; the
 * only agents it cannot reach are presets that replace the whole system prompt
 * with a `complete` section.
 *
 * The rendering half lives in ./client.js; the Loader row this plugin creates
 * is what makes the client-modules scanner serve it.
 * @module dsh-plugin-latex
 */

import { LATEX_PROMPT, SECTION_NAME, SECTION_ORDER } from './prompt.js';

export { LATEX_PROMPT, SECTION_NAME, SECTION_ORDER };

/** Stable Cordis plugin name. */
export const name = 'latex';

/**
 * Validate and default the plugin config.
 * @param {{ prompt?: unknown, promptText?: unknown } | undefined} raw - the profile row's config.
 * @returns {{ prompt: boolean, promptText: string }} resolved config.
 */
export function resolveConfig(raw) {
  const config = raw ?? {};
  const prompt = config.prompt ?? true;
  if (typeof prompt !== 'boolean') throw new Error('latex: config.prompt must be a boolean');
  const promptText = config.promptText ?? LATEX_PROMPT;
  if (typeof promptText !== 'string') throw new Error('latex: config.promptText must be a string');
  return { prompt, promptText: promptText.trim() };
}

/**
 * Host plugin body.
 * @param {import('@deepseek-ai/cordis').Context} ctx - plugin context.
 * @param {{ prompt?: boolean, promptText?: string } | undefined} rawConfig - optional config.
 */
export function apply(ctx, rawConfig) {
  const config = resolveConfig(rawConfig);
  if (!config.prompt || config.promptText === '') return;
  // Optional dependency: a profile without the prompt registry (none ship
  // that way today) still gets the renderer.
  ctx.inject(['systemPrompt'], (promptCtx) => {
    promptCtx.systemPrompt.section({
      name: SECTION_NAME,
      order: SECTION_ORDER,
      text: config.promptText,
      // LaTeX is full of braces; `{{` must never be read as a prompt variable.
      interpolate: false,
    });
  });
}
