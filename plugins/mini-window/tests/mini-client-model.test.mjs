import test from 'node:test'
import assert from 'node:assert/strict'
import { MiniSessions } from '../src/client/session-controller.ts'
import { HostClient } from '../src/client/host-client.ts'
import { defaultState, normalizeState, validatePatch } from '../shared/state.mjs'
const source = value => ({ getSnapshot: () => value, subscribe: () => () => {} })
function fixture() {
  const calls = [], state = { ...defaultState(), lastSessionId:'existing', lastWorkspaceId:'ws', defaultModel:{provider:'test-provider',model:'test-tiered',reasoningEffort:'high'} }
  const sessions = { list:source({phase:'ready',byId:{existing:{}},ids:['existing']}), refresh:async()=>{calls.push('refresh')}, create:async()=>{throw new Error('Must not use main-window session creation')}, retain:id=>({sessionId:id,ready:Promise.resolve(),release:()=>{}}) }
  const workspaces = {list:source({phase:'ready',items:[{workspaceId:'ws',sessionIds:['existing']}],archivedSessionIds:[]})}
  const host = {getSnapshot:()=>({state}),refresh:async()=>{},patch:async patch=>calls.push(patch),createChat:async workspaceId=>{calls.push(['mini-create',workspaceId]);return 'mini-new'}}
  const controller = new MiniSessions(sessions,workspaces,{connectWorkspace:async()=>{throw new Error('Must not reuse a main blank')}},host)
  return {controller,host,state,calls}
}
test('mini defaults do not replace a restored existing session model',async()=>{
  const f=fixture();await f.controller.initialize()
  assert.equal(f.controller.getSnapshot().reference.sessionId,'existing')
  assert.equal(f.calls.some(value=>Array.isArray(value)&&value[0]==='mini-create'),false)
  assert.deepEqual(f.state.defaultModel,{provider:'test-provider',model:'test-tiered',reasoningEffort:'high'})
  f.controller.dispose()
})
test('configured mini defaults use seeded unique creation rather than reusing main blanks',async()=>{
  const f=fixture();await f.controller.initialize();assert.equal(await f.controller.newChat('ws',true),true)
  assert.equal(f.controller.getSnapshot().reference.sessionId,'mini-new')
  assert.ok(f.calls.some(value=>Array.isArray(value)&&value[0]==='mini-create'&&value[1]==='ws'))
  assert.equal(f.calls.filter(value=>value==='refresh').length,2)
  assert.equal(f.calls.some(value=>value?.defaultModel),false)
  f.controller.dispose()
})
test('uncategorized chat still gets mini-only model defaults and remembers no workspace',async()=>{
  const f=fixture();await f.controller.initialize()
  assert.equal(await f.controller.newChat(null),true)
  assert.ok(f.calls.some(value=>Array.isArray(value)&&value[0]==='mini-create'&&value[1]===null))
  assert.equal(f.controller.getSnapshot().workspaceId,null)
  assert.deepEqual(f.calls.at(-1),{lastSessionId:'mini-new',lastWorkspaceId:null})
  f.controller.dispose()
})
test('unavailable mini default fails closed and preserves the previous chat',async()=>{
  const f=fixture();await f.controller.initialize();f.host.createChat=async()=>{throw new Error('Choose an available model in Settings.')}
  assert.equal(await f.controller.newChat(),false)
  assert.equal(f.controller.getSnapshot().reference.sessionId,'existing')
  assert.match(f.controller.getSnapshot().error,/available model/)
  f.controller.dispose()
})
test('a fresh server preference wins over stale-null companion state before creation',async()=>{
  const f=fixture();await f.controller.initialize();f.state.defaultModel=null
  f.host.refresh=async()=>{f.state.defaultModel={provider:'test-provider',model:'test-tiered',reasoningEffort:'high'}}
  assert.equal(await f.controller.newChat('ws',true),true)
  assert.equal(f.controller.getSnapshot().reference.sessionId,'mini-new')
  assert.ok(f.calls.some(value=>Array.isArray(value)&&value[0]==='mini-create'))
  f.controller.dispose()
})
test('failed preference refresh never falls back to main creation',async()=>{
  const f=fixture();await f.controller.initialize()
  f.host.getSnapshot=()=>({state:f.state,error:'Preferences could not refresh.'})
  assert.equal(await f.controller.newChat(),false)
  assert.equal(f.controller.getSnapshot().reference.sessionId,'existing')
  assert.equal(f.calls.some(value=>Array.isArray(value)&&value[0]==='mini-create'),false)
  f.controller.dispose()
})
test('new chat waits for in-flight local preference saves before refreshing',async()=>{
  const f=fixture();await f.controller.initialize();f.state.defaultModel=null
  let finish;f.host.waitForSaves=()=>new Promise(resolve=>{finish=resolve})
  const pending=f.controller.newChat();await Promise.resolve()
  assert.equal(f.calls.some(value=>Array.isArray(value)&&value[0]==='mini-create'),false)
  f.state.defaultModel={provider:'test-provider',model:'test-tiered',reasoningEffort:'high'};finish()
  assert.equal(await pending,true)
  assert.equal(f.controller.getSnapshot().reference.sessionId,'mini-new');f.controller.dispose()
})
test('model preferences are whitelisted, copied, and backward compatible',()=>{
  assert.equal(normalizeState({revision:2}).defaultModel,null)
  const original={provider:'p',model:'m',reasoningEffort:'high'}
  const patch=validatePatch({defaultModel:original});original.reasoningEffort='low'
  assert.equal(patch.defaultModel.reasoningEffort,'high')
  assert.deepEqual(validatePatch({defaultModel:null}),{defaultModel:null})
  assert.throws(()=>validatePatch({defaultModel:{provider:'p',model:'m',temperature:0.5}}),/selection/)
  assert.throws(()=>validatePatch({defaultModel:{provider:'p',model:'m',reasoningEffort:4}}),/reasoning/)
})
test('an old running host produces an actionable restart message',async()=>{
  const client=new HostClient(async()=>new Response('not found',{status:404}))
  await assert.rejects(client.models(),/Restart your existing DSH server/)
})
test('the installed UI uses the public catalog RPC instead of an extra HTTP catalog request',async()=>{
  let calls=0
  const catalog={default:{provider:'p',model:'m'},groups:[]}
  const client=new HostClient(async()=>{throw new Error('Must not fetch the HTTP catalog')},async()=>{calls++;return catalog})
  assert.equal(await client.models(),catalog);assert.equal(calls,1)
})
test('catalog RPC errors never fall back to an unrelated HTTP catalog',async()=>{
  const client=new HostClient(async()=>{throw new Error('Must not fetch the HTTP catalog')},async()=>{throw new Error('Catalog temporarily unavailable')})
  await assert.rejects(client.models(),/temporarily unavailable/)
})
test('catalog/create responses do not replace the versioned preferences snapshot',async()=>{
  const paths=[]
  const client=new HostClient(async(url)=>{paths.push(url);return new Response(JSON.stringify(url.endsWith('.models')?{groups:[]} : url.endsWith('.chat')?{sessionId:'mini-id'} :{state:{...defaultState(),revision:8},runtime:{status:'ready',visible:true,expanded:false,shortcutRegistered:true}}))})
  await client.refresh();assert.deepEqual(await client.models(),{groups:[]});assert.equal(await client.createChat('ws'),'mini-id')
  assert.equal(client.getSnapshot().state.revision,8)
  assert.deepEqual(paths,['api/dsh-mini-window.state','api/dsh-mini-window.models','api/dsh-mini-window.chat'])
})
