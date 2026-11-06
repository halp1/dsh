import { test } from 'node:test'
import assert from 'node:assert/strict'
import { JSDOM } from 'jsdom'
import { loadImageSource } from '../src/client/image-source.ts'
import { Stage } from '../src/client/stage.ts'
import { fileUrl } from '../src/client/pool.ts'
import { DEFAULT_APPEARANCE } from '../src/shared/state.ts'

const image = () => new Response('image bytes', { headers: { 'content-type': 'image/png' } })
const item = (id) => ({ key: id, entryId: id, index: 0, url: fileUrl(id, 0), appearance: DEFAULT_APPEARANCE })
const readable = async (url) => (await fetch(url)).text()

test('host images use the authenticated fetch channel for preloading and CSS, with bounded blob lifetimes', async (t) => {
  const dom = new JSDOM('<body></body>', { url: 'https://dsh.haelp.dev/pair-app' })
  t.after(() => dom.window.close())
  const calls = []
  const load = (url) => loadImageSource(url, async (path, init) => {
    // The remote extension owns rewriting and credentials on fetch, not CSS.
    assert.equal(new Headers(init.headers).get('accept'), 'image/*')
    calls.push(path)
    return image()
  })
  const preloaded = []
  const stage = new Stage(dom.window.document, async (url) => {
    assert.equal(await readable(url), 'image bytes')
    preloaded.push(url)
    return true
  }, load)
  t.after(() => stage.clear())
  for (const id of ['folder one', 'b', 'c']) assert.equal(await stage.show(item(id)), true)
  assert.deepEqual(calls, ['folder one', 'b', 'c'].map((id) => fileUrl(id, 0)))
  const css = [...dom.window.document.querySelectorAll('#dsh-background-stage > div')].map((el) => el.style.backgroundImage).join(' ')
  assert.ok(css.includes(preloaded[2]))
  assert.ok(!css.includes('api/dsh-background.file'))
  assert.equal(stage.current.url, fileUrl('c', 0), 'controller identity is not the temporary blob URL')
  await assert.rejects(fetch(preloaded[0]), 'reusing a layer releases its previous image')
  assert.equal(await readable(preloaded[1]), 'image bytes', 'the fading layer stays available')
  stage.clear()
  for (const url of preloaded) await assert.rejects(fetch(url))
  assert.equal(dom.window.document.getElementById('dsh-background-stage'), null)
})

test('stale, cleared, and failed image loads release blobs without replacing the current background', async (t) => {
  const dom = new JSDOM('<body></body>')
  t.after(() => dom.window.close())
  const sources = []
  let finish
  let started
  const loading = new Promise((resolve) => { started = resolve })
  const stage = new Stage(dom.window.document, async (url) => {
    if (url === sources[1]) return new Promise((resolve) => { finish = resolve; started() })
    return url !== sources[3]
  }, async (url) => {
    const source = await loadImageSource(url, async () => image())
    sources.push(source.url)
    return source
  })
  t.after(() => stage.clear())
  assert.equal(await stage.show(item('a')), true)
  const stale = stage.show(item('b'))
  await loading
  assert.equal(await stage.show(item('c')), true)
  finish(true)
  assert.equal(await stale, false)
  await assert.rejects(fetch(sources[1]))
  assert.equal(stage.current.entryId, 'c')
  assert.equal(await stage.show(item('bad')), false)
  await assert.rejects(fetch(sources[3]))
  assert.equal(stage.current.entryId, 'c')

  let resolveLoad
  const pending = new Stage(dom.window.document, async () => true, () => new Promise((resolve) => { resolveLoad = resolve }))
  const showing = pending.show(item('late'))
  pending.clear()
  const source = await loadImageSource(fileUrl('late', 0), async () => image())
  resolveLoad(source)
  assert.equal(await showing, false)
  await assert.rejects(fetch(source.url))
})

test('image loading rejects denied and non-image responses, while third-party URLs stay direct', async () => {
  for (const response of [new Response('denied', { status: 403 }), new Response('<html>login</html>', { headers: { 'content-type': 'text/html' } })]) {
    await assert.rejects(loadImageSource(fileUrl('a', 0), async () => response))
  }
  const direct = await loadImageSource('https://images.example/wall.png', async () => assert.fail('must not fetch with host credentials'))
  assert.equal(direct.url, 'https://images.example/wall.png')
  direct.dispose()
})
