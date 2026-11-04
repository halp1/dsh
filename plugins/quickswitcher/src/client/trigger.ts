/**
 * Which keydowns toggle the switcher.
 * @module
 */
import type { FixedInput, Platform } from './host.ts'

/** The physical key. */
export const TRIGGER_CODE = 'KeyK'

/**
 * Whether one locally arbitrated keydown is Cmd+K (macOS) or Ctrl+K
 * (elsewhere), with no other modifier held.
 *
 * Composition, a handler that already consumed the key, and auto-repeat are
 * ignored. So is the terminal, where Cmd+K clears the screen and Ctrl+K kills
 * to the end of the line.
 * @param input - what `observeFixedInput` delivered.
 * @param platform - receiving device.
 * @returns true when the switcher should toggle.
 */
export function isTrigger(input: FixedInput, platform: Platform): boolean {
  if (input.type !== 'keydown') return false
  const { gesture, context } = input
  if (gesture.code !== TRIGGER_CODE) return false
  if (gesture.composing || gesture.defaultPrevented || gesture.repeat) return false
  if (context.region === 'terminal') return false
  if (gesture.alt || gesture.shift) return false
  const mac = platform === 'macos'
  return mac ? gesture.meta && !gesture.control : gesture.control && !gesture.meta
}
