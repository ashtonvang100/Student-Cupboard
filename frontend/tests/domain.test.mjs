import test from 'node:test';
import assert from 'node:assert/strict';
import {availability,validateImages,canApprove} from '../src/domain.mjs';
const now = Date.parse('2026-11-17T12:00:00Z');
test('availability never presents missing, stale, unclear, or future observations as current',()=>{
 for(const item of [{updatedAt:null},{updatedAt:'bad'},{updatedAt:'2026-11-15T12:00:00Z'},{updatedAt:'2026-11-18T12:00:00Z'},{updatedAt:'2026-11-17T12:00:00Z',unclear:true}]) assert.equal(availability({...item,quantity:3},now,24).label,'Needs update');
 assert.equal(availability({updatedAt:'2026-11-17T12:00:00Z',quantity:0},now,24).label,'Not available');
 assert.equal(availability({updatedAt:'2026-11-17T12:00:00Z',quantity:3},now,24).label,'Available');
});
test('scan uploads enforce documented limits',()=>{
 const f = size => ({type:'image/jpeg',size:size*1024*1024});
 assert.equal(validateImages([f(8),f(8),f(8)]),'');
 assert.ok(validateImages([f(8),f(8),f(8),f(1)]));
 assert.ok(validateImages([f(9)]));
 assert.ok(validateImages([]));
 assert.ok(validateImages(Array.from({length:6},()=>f(1))));
 assert.ok(validateImages([{type:'image/svg+xml',size:10}]));
});
test('all detections require review and whole nonnegative counts before approval',()=>{
 assert.equal(canApprove([]),false);
 assert.equal(canApprove([{reviewed:false,quantity:2}]),false);
 assert.equal(canApprove([{reviewed:true,quantity:-1}]),false);
 assert.equal(canApprove([{reviewed:true,quantity:1.5}]),false);
 assert.equal(canApprove([{reviewed:true,quantity:0},{reviewed:true,excluded:true}]),true);
});
import {joinCatalog} from '../src/domain.mjs';
test('catalog joins on productId, keeps missing nutrition unknown, and never mistakes inventory edit for shelf freshness',()=>{
 const rows=joinCatalog([{id:10,name:'Rice',categoryId:2,nutrition:{proteinGrams:3}}],[{id:2,name:'Grains'}],[{id:99,productId:10,quantity:12,updatedAt:'2026-11-17T12:00:00Z'}]);
 assert.equal(rows[0].inventoryId,99);assert.equal(rows[0].quantity,12);assert.equal(rows[0].category,'Grains');
 assert.equal(rows[0].nutrition.protein,3);assert.equal(rows[0].nutrition.calories,null);assert.equal(rows[0].updatedAt,null);
 assert.equal(availability(rows[0],now,24).label,'Needs update');
});
