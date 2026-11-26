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

test('the narrow-layout drawer is opaque while the docked desktop sidebar stays see-through', () => {
  const dom = new JSDOM(`<body><div id="root">
    <div class="pI_x6G_frame" id="desktop"><div class="pI_x6G_sidebarCol"></div></div>
    <div class="pI_x6G_frame" id="mobile" data-sidebar-drawer data-sidebar-collapsed><div class="pI_x6G_sidebarCol"></div></div>
  </div></body>`)
  const doc = dom.window.document
  const transparency = new Transparency(doc, { overrideTokens: () => () => {} })
  // jsdom does not resolve var(), so find the rules that paint each column.
  const fills = (id) => {
    const column = doc.querySelector(`#${id} > div`)
    return [...doc.styleSheets].flatMap((sheet) => [...sheet.cssRules])
      .filter((rule) => column.matches(rule.selectorText) && rule.style.getPropertyValue('background').includes('--dsh-background-drawer-fill'))
  }

  transparency.enable(0.5)
  assert.equal(fills('mobile').length, 1)
  assert.equal(fills('desktop').length, 0)
  // Opening the drawer only removes the collapsed flag.
  doc.getElementById('mobile').removeAttribute('data-sidebar-collapsed')
  assert.equal(fills('mobile').length, 1)

  transparency.disable()
  assert.equal(fills('mobile').length, 0)
})
