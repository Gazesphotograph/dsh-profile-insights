import assert from 'node:assert/strict'
import { mkdtemp, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { foldSession, dayKey, apply, ROUTE_PREFIX } from '../index.js'
import { createPricer, costOf, createUsageStore, validateSettings, buildUsage, priceKey } from '../usage.js'
const now = new Date(2026,10,4,12).getTime()
const rows=[{provider:'lab',id:'m',canonical:'lab/m',cost:{input:2,output:10,cache_read:0.1,cache_write:2.5,tiers:[{tier:{type:'context',size:272000},input:4,output:15,cache_read:0.2,cache_write:5}]}}]
const settings=validateSettings({daily:0.1,monthly:1,warningPercent:80})
const pricer=createPricer(rows)
assert.equal(pricer('relay','lab/m').source,'list-estimate')
assert.equal(pricer('lab','m').source,'catalog')
assert.equal(pricer('relay','m-fast'),undefined)
assert.equal(pricer('relay','m:high'),undefined)
assert.equal(costOf({input:1e6,output:1000,cacheRead:10,cacheWrite:0},pricer('lab','m')),4+0.015+0.000002)
assert.equal(costOf({input:100,output:10,cacheRead:1000,cacheWrite:0},pricer('lab','m')),0.0004)
assert.equal(costOf({input:100,output:10,cacheRead:1000,cacheWrite:1},{cost:{input:2,output:10,cache_read:0.1}}),null)
assert.equal(costOf({input:100,output:10,cacheRead:0,cacheWrite:0},{cost:{input:0,output:0}}),0)
const events=[
 {type:'request/header',time:now,data:{header:{config:{provider:'lab',model:'m'}}}},
 {type:'assistant/message',time:now,data:{turn:1,step:1,usage:{inputTokens:100,outputTokens:10,cacheReadTokens:1000}}},
 {type:'assistant/message',time:now+1,data:{turn:1,step:1,usage:{inputTokens:200,outputTokens:10,cacheReadTokens:1000}}},
 {type:'llm/retry-started',time:now+2,data:{turn:1,step:1}},
 {type:'assistant/message',time:now+3,data:{turn:1,step:1,usage:{inputTokens:200,outputTokens:10,cacheReadTokens:1000}}},
]
const folded=foldSession(events,{id:'s',createdAt:now})
assert.equal(folded.samples.length,2)
assert.equal(folded.samples[0].tokens.input,200)
const fork=foldSession([...events,{type:'assistant/message',time:now+4,data:{turn:2,step:1,usage:{inputTokens:1e6}}}],{id:'fork',createdAt:now},events.length)
assert.equal(fork.samples.length,1)
assert.equal(fork.samples[0].model,'m')
const usage=buildUsage([folded,fork],{rows,settings,pricing:{}},dayKey,now+100)
assert.equal(usage.totals.requests,3)
assert.equal(usage.totals.tokens,usage.sessions.reduce((sum,s)=>sum+s.tokens,0))
assert.equal(usage.totals.cost,usage.sessions.reduce((sum,s)=>sum+s.cost,0))
assert.equal(usage.totals.cost,usage.timeline.reduce((sum,s)=>sum+s.cost,0))
assert.equal(usage.budgets.daily.state,'exceeded')
assert.equal(usage.budgets.monthly.state,'exceeded')
assert.equal(usage.totals.unpriced,0)
const custom=createPricer(rows,{[priceKey('lab','m')]:{input:0,output:0,cache_read:0,cache_write:0}})
assert.equal(custom('lab','m').source,'custom')
for(const bad of [{daily:-1},{monthly:0},{warningPercent:101},{overrides:{bad:{input:1,output:2}}}])assert.throws(()=>validateSettings(bad))
console.log('ok: exact/canonical prices, custom/free/unknown rates, context tiers, disjoint caches, retry replacement, fork exclusion, totals and budget thresholds')
const directory=await mkdtemp(join(tmpdir(),'dsh-usage-test-'))
try {
 const store=createUsageStore(directory,{fetcher:async()=>{throw new Error('offline')}})
 const before=await store.snapshot();assert.ok(before.rows.length>100)
 await store.save({...settings,overrides:{[priceKey('lab','m')]:{input:1,output:2}}})
 const reopened=await createUsageStore(directory).snapshot()
 assert.equal(reopened.settings.monthly,1)
 assert.equal(reopened.settings.overrides[priceKey('lab','m')].input,1)
 await assert.rejects(store.sync())
 assert.equal((await store.snapshot()).rows.length,before.rows.length)
 const success=createUsageStore(directory,{fetcher:async()=>new Response(JSON.stringify({lab:{models:{m:{cost:{input:1,output:2}}}}}))})
 await success.sync();assert.equal((await success.snapshot()).rows.length,1)
 const routes=new Map(),disposers=[]
 apply({effect(fn){disposers.push(fn())},get(name){return name==='connection'?{fetch:{register:r=>{routes.set(r.path,r);return()=>routes.delete(r.path)}}}:name==='profileContext'?{dir:directory}:undefined},sessionQuery:{listSessions:async()=>[{header:{id:'s'}}],readSession:async()=>({session:{id:'s'},events,inheritedEventCount:0})}},{accountTimeoutMs:0,skillTimeoutMs:0})
 assert.equal(routes.size,5)
 const call=(path,method='GET',body)=>routes.get(ROUTE_PREFIX+path).fetch(new Request('http://local'+ROUTE_PREFIX+path,{method,body:body===undefined?undefined:JSON.stringify(body),headers:{'content-type':'application/json'}}))
 const s=await(await call('/stats')).json();assert.equal(s.ok,true);assert.ok(s.usage);assert.equal(s.usage.totals.tokens,s.totals.tokens.total)
 assert.equal((await call('/usage-settings','PUT',{daily:-1})).status,400)
 assert.equal((await call('/usage-settings','PUT',{daily:5,monthly:10})).status,200)
 assert.equal((await(await call('/stats')).json()).usage.settings.daily,5)
 assert.equal((await call('/stats','HEAD')).status,200)
 for(const d of disposers)d?.()
 assert.equal(routes.size,0)
 console.log('ok: settings persist after reopen, offline last-good prices, live sync parsing, 5 authenticated routes, validation, cache invalidation, HEAD and cleanup')
}finally{await rm(directory,{recursive:true,force:true})}
