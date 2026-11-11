import { test } from 'node:test'
import assert from 'node:assert/strict'
import { draftAccess } from '../src/client/draft.ts'
import { hasContent, previewOf } from '../src/client/Composer.tsx'

/** A fake conversation service holding draft attachments the way the composer does. */
function harness({ accept = true } = {}) {
  const drafts = new Map()
  const draftIds = []
  let next = 0
  const released = []
  const conversation = {
    resolveDraftAttachments: (ids) => ids.flatMap((id) => drafts.has(id) ? [drafts.get(id)] : []),
    releaseDraftAttachment: (id) => { released.push(id); drafts.delete(id) },
    releaseDraftAttachments: (list) => { for (const a of list) { released.push(a.id); drafts.delete(a.id) } },
    createDrafts: (_sid, files) => files.map((file) => {
      const a = { kind: file.type.startsWith('image/') ? 'image' : 'file', id: `d${next++}`, file }
      drafts.set(a.id, a)
      return a
    }),
  }
  const input = {
    setDraft: () => {},
    addAttachments: (ids) => { if (!accept) return false; draftIds.push(...ids); return true },
    removeAttachment: (id) => { const i = draftIds.indexOf(id); if (i >= 0) draftIds.splice(i, 1) },
  }
  const sessions = { scope: (id) => id === 's1' ? { get: (name) => name === 'conversation' ? conversation : undefined } : undefined }
  const add = (file) => { const [a] = conversation.createDrafts('s1', [file]); draftIds.push(a.id); return a.id }
  return { access: draftAccess(sessions, 's1', input), drafts, draftIds, released, add, sessions, input }
}

test('draft attachments survive encode, release, and restore byte for byte', async () => {
  const h = harness()
  // Larger than one 32 KiB chunk, every byte value present.
  const big = new Uint8Array(100_000).map((_, i) => (i * 7) % 256)
  const ids = [
    h.add(new File([big], 'shot.png', { type: 'image/png' })),
    h.add(new File(['plain text'], 'notes.txt', { type: 'text/plain' })),
    h.add(new File(['<svg/>'], 'logo.svg', { type: 'image/svg+xml' })),
  ]
  const encoded = await h.access.encode(ids)
  assert.deepEqual(encoded.map((a) => [a.kind, a.name, a.mediaType]), [
    ['image', 'shot.png', 'image/png'],
    ['file', 'notes.txt', 'text/plain'],
    // Not an inline-able image type, so it travels as a file.
    ['file', 'logo.svg', 'image/svg+xml'],
  ])
  assert.deepEqual(new Uint8Array(Buffer.from(encoded[0].data, 'base64')), big)

  h.access.release(ids)
  assert.deepEqual(h.draftIds, [])
  assert.deepEqual(h.released, ids)

  assert.equal(h.access.restore(encoded), true)
  const restored = [...h.drafts.values()]
  assert.deepEqual(restored.map((a) => [a.file.name, a.file.type]), [['shot.png', 'image/png'], ['notes.txt', 'text/plain'], ['logo.svg', 'image/svg+xml']])
  assert.deepEqual(new Uint8Array(await restored[0].file.arrayBuffer()), big)
  assert.equal(h.draftIds.length, 3)
})

test('encode fails when an attachment vanished, and a refused restore releases its drafts', async () => {
  const h = harness()
  const id = h.add(new File(['x'], 'a.txt'))
  h.drafts.delete(id)
  await assert.rejects(h.access.encode([id]), /no longer available/)

  const refusing = harness({ accept: false })
  assert.equal(refusing.access.restore([{ kind: 'file', name: 'a.txt', mediaType: 'text/plain', data: 'eA==' }]), false)
  assert.equal(refusing.drafts.size, 0)
  assert.equal(refusing.released.length, 1)
})

test('an attachments-only draft counts as content and previews by file name', () => {
  assert.equal(hasContent('', 1), true)
  assert.equal(hasContent('  ', 0), false)
  const item = { text: '', attachments: [{ kind: 'image', name: '', mediaType: 'image/png', size: 1 }, { kind: 'file', name: 'b.txt', mediaType: '', size: 1 }] }
  assert.equal(previewOf(item), 'image + b.txt')
  assert.equal(previewOf({ ...item, text: 'look\n at  this' }), 'look at this + image + b.txt')
})
