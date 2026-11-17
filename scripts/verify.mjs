import fs from 'node:fs';
import path from 'node:path';
import assert from 'node:assert/strict';
import {root,backendEnv} from './common.mjs';
const token=JSON.parse(backendEnv().STAFF_API_TOKENS)[0].token;
const frontend=await fetch('http://127.0.0.1:5173');assert.equal(frontend.status,200);
const health=await fetch('http://127.0.0.1:5173/api/health');assert.equal((await health.json()).data.database,'connected');
const unauthenticated=await fetch('http://127.0.0.1:5173/api/products');assert.equal(unauthenticated.status,401);
for(const resource of ['products','categories','inventory','inventory/scans']){
 const response=await fetch(`http://127.0.0.1:5173/api/${resource}?limit=100`,{headers:{Authorization:`Bearer ${token}`}});assert.equal(response.status,200);const data=await response.json();assert.ok(Array.isArray(data.data));console.log(`${resource}: ${data.data.length} records loaded through frontend proxy`);
}
const config=await (await fetch('http://127.0.0.1:5173/config.js')).text();assert.ok(config.includes("apiBaseUrl: '/api'"));assert.ok(!config.includes(token));
console.log('Frontend, database health, authentication, and proxied API checks passed.');
