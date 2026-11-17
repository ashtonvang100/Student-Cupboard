import fs from 'node:fs';
import path from 'node:path';
import {local,backendEnv} from './common.mjs';
const token=JSON.parse(backendEnv().STAFF_API_TOKENS)[0].token;
async function api(route,body){const r=await fetch('http://127.0.0.1:3000/api'+route,{method:body?'POST':'GET',headers:{Authorization:`Bearer ${token}`,...(body?{'Content-Type':'application/json'}:{})},body:body?JSON.stringify(body):undefined});const p=await r.json();if(!r.ok)throw new Error(p.error?.message||'Seed request failed');return p.data}
if((await api('/products')).length){console.log('Existing catalog found; sample seeding skipped.');}else{
 const category=await api('/categories',{name:'Local samples',description:'Development-only sample records, not actual pantry stock.'});
 for(const [name,quantity,calories,protein] of [['Sample apples',12,95,0.5],['Sample oats',8,150,5],['Sample bread',6,80,4]]){
 const p=await api('/products',{name,categoryId:category.id,description:'LOCAL SAMPLE DATA — not real pantry inventory.',nutrition:{servingSize:'1 sample serving',calories,proteinGrams:protein}});
 const inventory=(await api('/inventory?limit=100')).find(i=>i.productId===p.id);
 await api(`/inventory/${inventory.id}/transactions`,{transactionType:'addition',quantityChange:quantity,reason:'Initial local development sample stock'});
 }
}
fs.writeFileSync(path.join(local,'sample-data-seeded'),new Date().toISOString());
console.log('Local sample catalog ready.');
