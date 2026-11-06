'use strict'

// Authored 18px monochrome speech-bubble template. No network or external asset is used.
const TEMPLATE_SVG = '<svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 18 18"><path fill="black" d="M3 3h12a2 2 0 0 1 2 2v7a2 2 0 0 1-2 2H8l-4 3v-3H3a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2zm1 3v2h10V6zm0 4v2h7v-2z"/></svg>'

// nativeImage SVG support varies. Rasterize the authored simple shape locally for builds
// accepting only bitmap/PNG images; black RGB makes RGBA/BGRA layout immaterial.
function templateBitmap(scale = 2) {
  const width = 18 * scale
  const pixels = Buffer.alloc(width * width * 4)
  for (let y = 0; y < width; y++) {
    for (let x = 0; x < width; x++) {
      const px = (x + 0.5) / scale, py = (y + 0.5) / scale
      let inside = px >= 1 && px < 17 && py >= 3 && py < 14
      if (inside) {
        const cx = Math.max(3, Math.min(15, px)), cy = Math.max(5, Math.min(12, py))
        inside = (px - cx) ** 2 + (py - cy) ** 2 <= 4
      }
      inside ||= px >= 4 && px < 8 && py >= 14 && py < 20 - px
      const hole = px >= 4 && ((px < 14 && py >= 6 && py < 8) || (px < 11 && py >= 10 && py < 12))
      if (inside && !hole) pixels[(y * width + x) * 4 + 3] = 255
    }
  }
  return { pixels, width, height: width, scaleFactor: scale }
}
function createTemplateImage(nativeImage) {
  let image
  try { image = nativeImage.createFromDataURL(`data:image/svg+xml;base64,${Buffer.from(TEMPLATE_SVG).toString('base64')}`) } catch {}
  if (!image || image.isEmpty()) {
    const { pixels, ...size } = templateBitmap()
    image = nativeImage.createFromBitmap(pixels, size)
  }
  if (!image.isEmpty()) image.setTemplateImage(true)
  return image
}
module.exports = { TEMPLATE_SVG, templateBitmap, createTemplateImage }
