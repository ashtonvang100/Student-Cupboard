export async function apiRequest(baseUrl,path,token='',options={}) {
 const {origin=globalThis.location?.origin,fetchImpl=globalThis.fetch,method='GET',body,signal,timeout=15000,idempotencyKey}=options;
 const base=new URL(baseUrl,origin);
 if(base.username||base.password||base.search||base.hash)throw new Error('Use an API URL without credentials, query parameters, or a fragment.');
 if(base.protocol!=='https:'&&!(base.protocol==='http:'&&['localhost','127.0.0.1'].includes(base.hostname)))throw new Error('Use an HTTPS backend URL.');
 if(!path.startsWith('/')||path.startsWith('//'))throw new Error('Invalid API route.');
 const multipart=body instanceof FormData;
 const response=await fetchImpl(base.href.replace(/\/$/,'')+path,{
  method,headers:{Accept:'application/json',...(token?{Authorization:`Bearer ${token}`} : {}),...(body!==undefined&&!multipart?{'Content-Type':'application/json'}:{}),...(idempotencyKey?{'Idempotency-Key':idempotencyKey}:{})},
  body:body===undefined?undefined:multipart?body:JSON.stringify(body),
  signal:signal?AbortSignal.any([signal,AbortSignal.timeout(timeout)]):AbortSignal.timeout(timeout),cache:'no-store',redirect:'error',
 });
 const payload=await response.json().catch(()=>null);
 if(!response.ok){const error=new Error(response.status===401?'Staff authentication is required or has expired.':response.status===403?'This account does not have staff access.':payload?.error?.message??`Request failed (${response.status}).`);error.status=response.status;error.code=payload?.error?.code??'HTTP_ERROR';throw error;}
 if(payload===null)throw new Error('Expected a JSON response from the backend.');
 return payload;
}
export async function collectPages(fetchPage,path) {
 const rows=[];
 for(let page=1;page<=10000;page++){
  const result=await fetchPage(`${path}?page=${page}&limit=100`);
  if(!Array.isArray(result?.data)||typeof result?.pagination?.hasMore!=='boolean')throw new Error('The backend returned an unexpected collection response.');
  rows.push(...result.data);if(!result.pagination.hasMore)return rows;
 }
 throw new Error('This catalog is too large to load safely.');
}
