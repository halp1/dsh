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

test('panels covering the narrow-layout conversation are opaque while docked desktop columns stay see-through', () => {
  // Shapes measured from the live 0.2.2 shell at 390px and at desktop width.
  const rightPanel = (mode) => `<div class="P3OORG_panel" data-sidebar-right-panel="${mode}">
      <div class="_tabCell_3oazc_144" data-dockkit-host="dock"><div class="_tabHost_3oazc_164 _pane_3oazc_211" data-dockkit-pane="pane1"></div></div>
    </div>`
  const dom = new JSDOM(`<body><div id="root">
    <div class="pI_x6G_frame" id="desktop">
      <div class="pI_x6G_sidebarCol"></div>
      <div class="pI_x6G_rightbarCol">${rightPanel('push')}</div>
    </div>
    <div class="pI_x6G_frame" id="desktop-fullscreen"><div class="pI_x6G_rightbarCol">${rightPanel('fullscreen')}</div></div>
    <div class="pI_x6G_frame" id="mobile" data-sidebar-drawer data-sidebar-collapsed>
      <div class="pI_x6G_sidebarCol"></div>
      <div class="pI_x6G_rightbarCol">${rightPanel('fullscreen')}</div>
    </div>
  </div></body>`)
  const doc = dom.window.document
  const transparency = new Transparency(doc, { overrideTokens: () => () => {} })
  // jsdom does not resolve var(), so find the rule that paints each surface.
  const fill = (selector) => {
    const element = doc.querySelector(selector)
    const rule = [...doc.styleSheets].flatMap((sheet) => [...sheet.cssRules])
      .find((r) => element.matches(r.selectorText) && /--dsh-background-(drawer|panel)-fill/.test(r.style.getPropertyValue('background')))
    return rule?.style.getPropertyValue('background').match(/--dsh-background-\w+-fill/)[0]
  }

  transparency.enable(0.5)
  assert.equal(fill('#mobile > [class*="_sidebarCol"]'), '--dsh-background-drawer-fill')
  assert.equal(fill('#mobile [data-dockkit-pane]'), '--dsh-background-panel-fill')
  for (const selector of ['#desktop > [class*="_sidebarCol"]', '#desktop [data-dockkit-pane]', '#desktop-fullscreen [data-dockkit-pane]']) {
    assert.equal(fill(selector), undefined, selector)
  }
  // Opening the drawer only removes the collapsed flag.
  doc.getElementById('mobile').removeAttribute('data-sidebar-collapsed')
  assert.equal(fill('#mobile > [class*="_sidebarCol"]'), '--dsh-background-drawer-fill')

  transparency.disable()
  assert.equal(fill('#mobile > [class*="_sidebarCol"]'), undefined)
  assert.equal(fill('#mobile [data-dockkit-pane]'), undefined)
})
