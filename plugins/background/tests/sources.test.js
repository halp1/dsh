/**
 * Source validation and folder listing against a real temp filesystem.
 */
import { test, before, after } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, mkdir, writeFile, symlink, rm, realpath } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import {
  SourceError,
  contentTypeFor,
  expandHome,
  isImagePath,
  isUrl,
  listFolderImages,
  resolveSource,
} from '../src/node/sources.ts'

let root
before(async () => {
  root = await realpath(await mkdtemp(join(tmpdir(), 'dsh-bg-sources-')))
  await mkdir(join(root, 'pics', 'nested'), { recursive: true })
  await mkdir(join(root, 'empty'))
  await mkdir(join(root, 'with space'))
  await writeFile(join(root, 'pics', 'b.JPG'), 'b')
  await writeFile(join(root, 'pics', 'a.png'), 'a')
  await writeFile(join(root, 'pics', 'c.webp'), 'c')
  await writeFile(join(root, 'pics', 'notes.txt'), 'x')
  await writeFile(join(root, 'pics', 'nested', 'deep.png'), 'd')
  await writeFile(join(root, 'outside.png'), 'o')
  await writeFile(join(root, 'with space', 'my pic.jpeg'), 'm')
  await writeFile(join(root, 'doc.pdf'), 'p')
  await symlink(join(root, 'outside.png'), join(root, 'pics', 'escape.png'))
  await symlink(join(root, 'pics', 'a.png'), join(root, 'pics', 'z-alias.png'))
})
after(async () => { await rm(root, { recursive: true, force: true }) })

test('isUrl accepts only http(s)', () => {
  assert.equal(isUrl('https://example.com/a.png'), true)
  assert.equal(isUrl('http://example.com'), true)
  assert.equal(isUrl('file:///etc/passwd'), false)
  assert.equal(isUrl('/Users/me/a.png'), false)
  assert.equal(isUrl('javascript:alert(1)'), false)
})

test('expandHome handles ~ and ~/ only', () => {
  assert.equal(expandHome('~', '/home/u'), '/home/u')
  assert.equal(expandHome('~/pics', '/home/u'), '/home/u/pics')
  assert.equal(expandHome('/abs/~x', '/home/u'), '/abs/~x')
  assert.equal(expandHome('~other/x', '/home/u'), '~other/x')
})

test('isImagePath and contentTypeFor use the extension case-insensitively', () => {
  assert.equal(isImagePath('/a/B.JPG'), true)
  assert.equal(isImagePath('/a/b.txt'), false)
  assert.equal(contentTypeFor('/x.png'), 'image/png')
  assert.equal(contentTypeFor('/x.JPEG'), 'image/jpeg')
  assert.equal(contentTypeFor('/x.jpg'), 'image/jpeg')
  assert.equal(contentTypeFor('/x.svg'), 'image/svg+xml')
  assert.equal(contentTypeFor('/x.avif'), 'image/avif')
  assert.equal(contentTypeFor('/x.webp'), 'image/webp')
  assert.equal(contentTypeFor('/x.gif'), 'image/gif')
})

test('resolveSource classifies a URL without touching the network', async () => {
  assert.deepEqual(await resolveSource('https://images.test/path/sky.jpg'), { kind: 'url', source: 'https://images.test/path/sky.jpg' })
})

test('resolveSource accepts an image file, with spaces in the path', async () => {
  const file = join(root, 'with space', 'my pic.jpeg')
  assert.deepEqual(await resolveSource(file), { kind: 'file', source: file })
})

test('resolveSource accepts a folder, tolerating a trailing slash', async () => {
  assert.deepEqual(await resolveSource(join(root, 'pics') + '/'), { kind: 'folder', source: join(root, 'pics') })
})

test('resolveSource rejects a relative path', async () => {
  await assert.rejects(resolveSource('pics/a.png'), (e) => e instanceof SourceError && /absolute/.test(e.message))
})

test('resolveSource rejects missing paths, non-images, and empty folders', async () => {
  await assert.rejects(resolveSource(join(root, 'nope.png')), (e) => e instanceof SourceError && /does not exist/.test(e.message))
  await assert.rejects(resolveSource(join(root, 'doc.pdf')), (e) => e instanceof SourceError && /not a supported image/.test(e.message))
  await assert.rejects(resolveSource(join(root, 'empty')), (e) => e instanceof SourceError && /no images/.test(e.message))
})

test('resolveSource rejects non-http URL schemes as paths', async () => {
  await assert.rejects(resolveSource('file:///etc/hosts'), SourceError)
})

test('listFolderImages is sorted, non-recursive, images only, and never escapes the folder', async () => {
  const pics = join(root, 'pics')
  assert.deepEqual(await listFolderImages(pics), [
    join(pics, 'a.png'),
    join(pics, 'b.JPG'),
    join(pics, 'c.webp'),
    join(pics, 'z-alias.png'),
  ])
})
