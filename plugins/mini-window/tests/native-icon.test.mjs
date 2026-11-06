import test from 'node:test'
import assert from 'node:assert/strict'
import { createRequire } from 'node:module'
const require = createRequire(import.meta.url)
const { TEMPLATE_SVG, templateBitmap, createTemplateImage } = require('../native/icon.cjs')

test('authored tray SVG has a local high-DPI template bitmap fallback', () => {
  assert.match(TEMPLATE_SVG, /^<svg /)
  assert.equal(TEMPLATE_SVG.includes('href='), false)
  const bitmap = templateBitmap()
  assert.equal(bitmap.width, 36)
  assert.equal(bitmap.height, 36)
  assert.equal(bitmap.scaleFactor, 2)
  assert.equal(bitmap.pixels.length, 36 * 36 * 4)
  const alpha = (x, y) => bitmap.pixels[((y * 2) * 36 + x * 2) * 4 + 3]
  assert.equal(alpha(0, 0), 0)
  assert.equal(alpha(3, 5), 255)
  assert.equal(alpha(6, 7), 0)
  assert.equal(alpha(4, 15), 255)
  assert.equal(alpha(16, 16), 0)
  let template = false
  const image = { isEmpty: () => false, setTemplateImage: value => { template = value } }
  const result = createTemplateImage({
    createFromDataURL: () => ({ isEmpty: () => true }),
    createFromBitmap: (pixels, size) => { assert.equal(pixels.length, bitmap.pixels.length); assert.equal(size.scaleFactor, 2); return image },
  })
  assert.equal(result, image)
  assert.equal(template, true)
})
