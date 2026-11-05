/**
 * Translucency stylesheet against the host's real fade class shapes.
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { JSDOM } from 'jsdom'
import { Transparency } from '../src/client/transparency.ts'

test('hides overlay fades but never a scroll container carrying a mask fade class', () => {
  const dom = new JSDOM(`<body><div id="root">
    <span id="overlay" class="bhn1Oq_fade"></span>
    <span id="overlay-mixed" class="bhn1Oq_fade other"></span>
    <div id="group" class="O_Ebla_body   O_Ebla_fadeBottom"></div>
    <div id="nav" class="eGxaPq_scroller eGxaPq_fadeTop eGxaPq_fadeBottom"></div>
    <span id="faded" class="_64N1GW_faded"></span>
  </div></body>`)
  const doc = dom.window.document
  const theme = { overrideTokens: () => () => {} }
  new Transparency(doc, theme).enable(0.5)

  const style = (id) => dom.window.getComputedStyle(doc.getElementById(id))
  assert.equal(style('overlay').display, 'none')
  assert.equal(style('overlay-mixed').display, 'none')
  // Hiding these collapses the container, the host drops the fade class,
  // the container reappears, and the cycle repeats every frame.
  assert.notEqual(style('group').display, 'none')
  assert.notEqual(style('nav').display, 'none')
  assert.notEqual(style('faded').display, 'none')
})
