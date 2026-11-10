/**
 * `/ask <question>`: answer one question without making permanent changes.
 *
 * The command steers the question into the agent as an ordinary user message,
 * preceded by a notice-form context message that tells the model to stay
 * hands-off for this question. Sandbox mode and approval policy are untouched,
 * so the limits rest on the model following the instructions.
 *
 * @module dsh-plugin-ask
 */
import { createUserMessage } from '@deepseek-ai/dsh-llm'

export const name = 'ask'
export const inject = ['commands']

/** Stable definition identity for adapters. Independent of display copy. */
export const DEFINITION_ID = 'dsh-plugin-ask'

export const USAGE = 'Usage: /ask <question>'

/** One-line account shown on the collapsed context row. */
export const SUMMARY = 'Ask mode: answer without making permanent changes'

export const INSTRUCTIONS = `<ask_mode>
The user's next message is a question asked in Ask mode. Your goal is to answer it accurately and completely without making any permanent changes of any kind.

Allowed:
- Read files, search code, inspect git history and state, query tools, and search the web.
- Run commands that only observe, such as listing, reading, diffing, type checking without emitting files, or running existing tests that leave tracked files untouched.
- Scratch work that helps you answer. You may write throwaway files, scripts, or clones under the system temporary directory (for example a fresh directory from \`mktemp -d\`) and run them there. Delete them before you finish.

Not allowed:
- Creating, editing, moving, or deleting files in the workspace or in any other location that persists, including dotfiles, caches you would not otherwise create, and configuration.
- Committing, pushing, branching, stashing, or otherwise changing repository state.
- Installing, upgrading, or removing packages, plugins, or tools.
- Running builds, formatters, code generators, migrations, or anything else that writes lasting output.
- Starting long-lived processes or services, scheduling tasks, or changing settings, permissions, or the session mode.
- Sending, posting, or submitting anything to external services.

If a proper answer needs a change, describe it instead of applying it. Show the code or a diff in your reply and let the user decide. If confirming a detail would need a forbidden command, say what you would run and why rather than running it. Any subagent you delegate to must follow the same rules, so include them in its task.

These limits apply to this question only. The sandbox mode is unchanged, so they depend on you. Finish with a direct answer to the question.
</ask_mode>`

/**
 * Build the messages one `/ask` invocation submits, in delivery order.
 * @param question - the trimmed question text, possibly empty when attachments carry it.
 * @param attachments - admitted composer attachments, in selection order.
 * @returns the hidden context notice followed by the user's own message.
 */
export function askMessages(question, attachments) {
  const context = createUserMessage({
    content: [{ type: 'text', text: INSTRUCTIONS }],
    source: { kind: 'ask', form: 'notice', summary: SUMMARY },
  })
  const prompt = createUserMessage({
    content: [...attachments, ...(question === '' ? [] : [{ type: 'text', text: question }])],
    source: { kind: 'user' },
  })
  return { context, prompt }
}

/**
 * The `/ask` command handler.
 * @param invocation - the command registry's invocation record.
 * @returns the command result rendered by the UI.
 */
export function handleAsk({ agent, rawInput, attachments }) {
  const question = rawInput.trim()
  if (question === '' && attachments.length === 0) return { kind: 'error', text: `Ask needs a question. ${USAGE}` }
  const { context, prompt } = askMessages(question, attachments)
  // Same step batch: the notice precedes the question, and steering wakes an
  // idle agent or lands at the next step boundary of a running one.
  agent.inject(context)
  agent.steer(prompt)
  return { kind: 'success' }
}

export function apply(ctx) {
  ctx.commands.register({
    definitionId: DEFINITION_ID,
    name: 'ask',
    description: 'Answer a question without making changes',
    input: { hint: '<question>', attachments: true },
    // The steered user message already carries the question.
    recordInput: false,
    handler: handleAsk,
  })
}
