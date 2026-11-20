import test from 'node:test';
import assert from 'node:assert/strict';
import { prepareArticleWithAi } from '../../services/ai/article-ai.mjs';
test('uses selected model and user prompt, removes links and author', async () => {
  let payload, headers;
  const fetchImpl=async (_url, options) => { payload=JSON.parse(options.body); headers=options.headers; return new Response(JSON.stringify({choices:[{message:{content:'مقتطف مفيد\nالكاتب: شخص\nhttps://example.com'}}]}), {status:200}); };
  const result=await prepareArticleWithAi({key:'secret', model:'selected/model', title:'عنوان', content:'المقال', prompt:'رتب نقاطاً', fetchImpl});
  assert.equal(result,'مقتطف مفيد'); assert.equal(headers.Authorization,'Bearer secret'); assert.equal(payload.model,'selected/model'); assert.match(payload.messages[1].content,/رتب نقاطاً/);
});
test('does not publish when provider fails', async () => {
  await assert.rejects(prepareArticleWithAi({key:'k',model:'m',content:'x',fetchImpl:async()=>new Response('',{status:429})}),/429/);
});
