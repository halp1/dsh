import { test } from 'node:test'
import assert from 'node:assert/strict'
import { fuzzyMatch, mergeRanges } from '../src/client/match.ts'

test('accepts in-order subsequences case-insensitively and rejects the rest', () => {
  for (const [query, text, ok] of [
    ['fix', 'Fix login bug', true],
    ['FLB', 'fix login bug', true],
    ['qs', 'dsh-plugin-quickswitcher', true],
    ['bgfix', 'Fix login bug', false],
    ['zz', 'Fix login bug', false],
    ['toolong', 'tool', false],
    ['', 'anything', true],
  ]) {
    assert.equal(fuzzyMatch(query, text) !== null, ok, `${query} in ${text}`)
  }
})

test('ranks prefix over word start over scattered, and tight over loose', () => {
  const score = (q, t) => fuzzyMatch(q, t)?.score ?? Number.NEGATIVE_INFINITY
  const ranked = ['login page', 'fix login', 'blog in', 'l o g i n x']
    .sort((a, b) => score('login', b) - score('login', a))
  assert.deepEqual(ranked, ['login page', 'fix login', 'blog in', 'l o g i n x'])
  // A camelCase hump counts as a word start.
  assert.ok(score('qs', 'quickSwitcher') > score('qs', 'quietness'))
})

test('prefers word-start occurrences without stranding later characters', () => {
  // "s" mid-word in "dsh" is skipped for the "s" of "switcher".
  assert.deepEqual(fuzzyMatch('sw', 'dsh switcher')?.ranges, [[4, 6]])
  // Jumping to the later boundary "b" would leave no room for "c": stay put.
  assert.deepEqual(fuzzyMatch('abc', 'abxbc')?.ranges, [[0, 2], [4, 5]])
  // Positions index the original text even when lowercasing changes length.
  assert.deepEqual(fuzzyMatch('x', '\u0130x')?.ranges, [[1, 2]])
})

test('mergeRanges sorts and joins overlapping or touching ranges', () => {
  assert.deepEqual(mergeRanges([[5, 7], [0, 2], [2, 3], [6, 9]]), [[0, 3], [5, 9]])
})
