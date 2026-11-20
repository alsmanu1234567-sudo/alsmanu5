import test from 'node:test';
import assert from 'node:assert/strict';
import { discoverNvidiaModels, freeModelSlugs, keyFingerprint } from '../../services/ai/nvidia-discovery.mjs';
const card = (id, badge='Free Endpoint') => `<li><span>${badge}</span><a data-nvtrack-nav-object="artifact-card" href="/${id}">x</a></li>`;
const response = (value,status=200) => new Response(typeof value === 'string' ? value : JSON.stringify(value), {status, headers:{'content-type':'application/json'}});
test('free catalog pagination and bounded probes only retain successful replies', async () => {
  let active=0,max=0; const tested=[]; const progress=[];
  const fake = async (url,options={}) => {
    if (url.endsWith('/v1/models')) return response({data:[{id:'nvidia/a'},{id:'nvidia/b'},{id:'nvidia/c'},{id:'paid/d'}]});
    if (url.includes('build.nvidia.com')) return response(url.includes('page=2') ? card('nvidia/c') : card('nvidia/a')+card('nvidia/b')+card('paid/d','Partner Endpoint')+' of 2 pages');
    const id=JSON.parse(options.body).model; tested.push(id); active++; max=Math.max(max,active);
    await new Promise(r=>setTimeout(r,5)); active--;
    return id === 'nvidia/b' ? response({},404) : response({choices:[{message:{content:'OK'}}]});
  };
  const result = await discoverNvidiaModels('key', {fetchImpl:fake, concurrency:2, onProgress:(d,t)=>progress.push([d,t])});
  assert.deepEqual(result.models.map(m=>m.id),['nvidia/a','nvidia/c']);
  assert.equal(result.tested,3); assert.ok(max<=2); assert.ok(!tested.includes('paid/d')); assert.equal(progress.length,3);
  assert.equal(freeModelSlugs(card('nvidia/a')).has('nvidiaa'),true);
  assert.notEqual(keyFingerprint('a'),keyFingerprint('b'));
});
test('refuses to probe unknown free status', async () => {
  let probes=0;
  const fake = async url => url.endsWith('/models') && url.includes('/v1/') ? response({data:[{id:'x'}]}) : url.includes('build') ? response('<html>blocked</html>') : (probes++,response({}));
  await assert.rejects(discoverNvidiaModels('key',{fetchImpl:fake}),/تعذر قراءة/);
  assert.equal(probes,0);
});
