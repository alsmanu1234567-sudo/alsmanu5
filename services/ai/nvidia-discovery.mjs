import { createHash } from 'node:crypto';
const BASE = 'https://integrate.api.nvidia.com/v1';
const BUILD = 'https://build.nvidia.com/models';
export const keyFingerprint = key => createHash('sha256').update(String(key)).digest('hex').slice(0, 24);
const norm = s => String(s).toLowerCase().replace(/[^a-z0-9]/g, '');

// Only model cards explicitly marked Free Endpoint are eligible. Match the
// NVIDIA catalogue ID to the public card slug; do not send unknown paid models.
export function freeModelSlugs(html) {
  const result = new Set();
  for (const li of String(html).match(/<li\b[\s\S]*?<\/li>/gi) || []) {
    if (!/Free Endpoint/i.test(li)) continue;
    const match = li.match(/data-nvtrack-nav-object="artifact-card"[^>]*href="\/([^"?#]+)"/i);
    if (match) result.add(norm(match[1]));
  }
  return result;
}
export async function discoverNvidiaModels(key, {fetchImpl = fetch, concurrency = 4, timeoutMs = 60000, onProgress = () => {}} = {}) {
  if (!key) throw new Error('أضف مفتاح NVIDIA أولاً');
  const [catalog, freePage] = await Promise.all([
    fetchImpl(`${BASE}/models`, {headers: {Authorization: `Bearer ${key}`}, signal: AbortSignal.timeout(20000)}),
    fetchImpl(BUILD, {signal: AbortSignal.timeout(20000)}),
  ]);
  if (!catalog.ok) throw new Error(`تعذر جلب قائمة NVIDIA (${catalog.status})`);
  if (!freePage.ok) throw new Error('تعذر التحقق من النماذج المجانية من NVIDIA');
  const firstPage = await freePage.text();
  const free = freeModelSlugs(firstPage);
  const pageCount = Number(firstPage.match(/of\s+(\d+)\s+pages/i)?.[1] || 1);
  if (pageCount > 30) throw new Error('عدد صفحات كتالوج NVIDIA غير متوقع؛ لم يبدأ الفحص');
  const pages = await Promise.all(Array.from({length:Math.max(0, pageCount-1)}, async (_, index) => {
    const response = await fetchImpl(`${BUILD}?page=${index+2}`, {signal:AbortSignal.timeout(30000)});
    if (!response.ok) throw new Error('تعذر تحميل جميع صفحات قائمة النماذج المجانية');
    return response.text();
  }));
  for (const page of pages) for (const id of freeModelSlugs(page)) free.add(id);
  if (!free.size) throw new Error('تعذر قراءة قائمة النماذج المجانية؛ لم يتم اختبار نماذج مجهولة التكلفة');
  const body = await catalog.json();
  if (!Array.isArray(body.data)) throw new Error('قائمة NVIDIA غير صالحة');
  const models = [...new Map(body.data.filter(m => typeof m.id === 'string' && free.has(norm(m.id))).map(m => [m.id, {id:m.id, name:m.id}])).values()];
  const results = new Array(models.length); let next = 0, done = 0;
  async function worker() {
    for (;;) {
      const index = next++; if (index >= models.length) return;
      const model = models[index];
      try {
        const res = await fetchImpl(`${BASE}/chat/completions`, {
          method:'POST', headers:{Authorization:`Bearer ${key}`, 'Content-Type':'application/json'},
          body:JSON.stringify({model:model.id, messages:[{role:'user',content:'Reply with OK.'}], max_tokens:120, temperature:0}),
          signal:AbortSignal.timeout(timeoutMs),
        });
        if (res.ok) {
          const data = await res.json();
          if (typeof data.choices?.[0]?.message?.content === 'string' && data.choices[0].message.content.trim()) results[index] = model;
        }
      } catch { /* timeouts and network errors are not counted as working */ }
      done++; try { await onProgress(done, models.length); } catch {}
    }
  }
  await Promise.all(Array.from({length:Math.max(1,Math.min(6, concurrency, models.length || 1))}, worker));
  return { models:results.filter(Boolean), tested:models.length };
}
