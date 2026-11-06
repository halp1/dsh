import { test } from 'node:test'
import assert from 'node:assert/strict'
import { isTrigger } from '../src/client/trigger.ts'

const key = (gesture = {}, context = {}) => ({
  type: 'keydown',
  gesture: { code: 'KeyK', control: false, alt: false, shift: false, meta: false, repeat: false, composing: false, defaultPrevented: false, ...gesture },
  context: { region: 'page', modal: null, ...context },
  consume() {},
})

test('only the platform primary modifier plus K, outside the terminal', () => {
  for (const [input, platform, expected] of [
    [key({ meta: true }), 'macos', true],
    [key({ meta: true }, { region: 'editable' }), 'macos', true],
    [key({ control: true }), 'macos', false],
    [key({ control: true }), 'windows', true],
    [key({ control: true }), 'linux', true],
    [key({ meta: true }), 'windows', false],
    [key({ meta: true, shift: true }), 'macos', false],
    [key({ meta: true, alt: true }), 'macos', false],
    [key({ meta: true, control: true }), 'macos', false],
    [key({ meta: true, code: 'KeyJ' }), 'macos', false],
    [key({ meta: true, repeat: true }), 'macos', false],
    [key({ meta: true, composing: true }), 'macos', false],
    [key({ meta: true, defaultPrevented: true }), 'macos', false],
    [key({ meta: true }, { region: 'terminal' }), 'macos', false],
    [{ type: 'reset' }, 'macos', false],
  ]) {
    assert.equal(isTrigger(input, platform), expected, JSON.stringify({ platform, ...input.gesture, ...input.context }))
  }
})
