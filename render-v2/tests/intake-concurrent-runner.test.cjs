'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const {plan,MAX_CONCURRENCY}=require('../integration/intake-concurrent-runner.cjs');
test('intake runner caps at ten and never uses send button',()=>{const jobs=Array.from({length:10},(_,i)=>({id:'j'+i,website:'https://example'+i+'.com/',category:'landscaping'}));const p=plan(jobs,{concurrency:10});assert.equal(MAX_CONCURRENCY,10);assert.equal(p.concurrency,10);assert.equal(p.customerSend,false);assert.equal(p.forbiddenSelector,'#generateBtn');assert.equal(p.selectors.compile,'#generateTop');});
test('intake runner rejects unsafe website and >10 concurrency',()=>{assert.throws(()=>plan([{website:'http://example.com'}]),/https/);assert.throws(()=>plan([{website:'https://example.com'}],{concurrency:11}),/concurrency/);});
