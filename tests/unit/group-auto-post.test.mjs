import { test } from "node:test";
import assert from "node:assert/strict";
import {
  deleteWebGroupAutoPost,
  getKhartoumClock,
  getWebGroupDetails,
  previewWebGroupAutoPost,
  publishWebGroupAutoPostNow,
  runScheduledGroupAutoPosts,
  saveWebGroupAutoPost,
  setDeps,
  setWebGroupAutoPostEnabled,
  stopModerationListenerRecovery,
} from "../../dist/handlers/groups-handler.mjs";
import { clearMawdoo3Cache } from "../../dist/services/groups/mawdoo3-feed-service.mjs";

test("group auto-post validates, previews, publishes without repeats, and schedules in Khartoum time", async () => {
  const realFetch = globalThis.fetch;
  const groupId = "120363123456789012@g.us";
  const userId = "123";
  const user = { antiLinkGroups: [], inspectInviteGroups: [], groupAutoPosts: [] };
  const sent = [];
  let isAdmin = true;
  const html = `
    <a href="/قصة_حب_الأولى">قصة حب أولى</a>
    <a href="/قصة_حب_الثانية">قصة حب ثانية</a>
  `;
  const articleContent = "هذا نص المقال الكامل الذي يجب أن يظهر في المجموعة، وليس عنواناً ورابطاً فقط. يحتوي على عدة جمل ليكون مثالاً واقعياً للمحتوى الذي يستخرجه البوت من صفحة موضوع.";
  globalThis.fetch = async (url) => new Response(
    String(url).includes("/خاص:")
      ? html
      : `<article><div class="article-content"><p>${articleContent}</p></div></article>`,
    {
      status: 200,
      headers: { "content-type": "text/html; charset=utf-8" },
    }
  );
  clearMawdoo3Cache();

  const sock = {
    user: { id: "249960506662@s.whatsapp.net" },
    groupMetadata: async (id) => ({
      id,
      subject: "مجموعة اختبار",
      participants: [{ id: "249960506662@s.whatsapp.net", admin: isAdmin ? "admin" : undefined }],
    }),
    sendMessage: async (jid, payload) => sent.push({ jid, payload }),
  };
  setDeps({
    inMemoryDB: {
      sessions: new Map([[userId, sock]]),
      users: new Map([[userId, user]]),
    },
    getUser: () => user,
    saveUser: (_id, patch) => Object.assign(user, patch),
  });

  try {
    await assert.rejects(
      saveWebGroupAutoPost(userId, groupId, "+249960506662", { topic: "قصص حب", times: "25:00" }),
      /24 ساعة/
    );

    const clock = getKhartoumClock(new Date("2026-11-10T00:30:00.000Z"));
    assert.deepEqual(clock, { date: "2026-11-10", time: "02:30", weekday: "Tue" });

    const item = await saveWebGroupAutoPost(userId, groupId, "+249960506662", {
      topic: "قصص حب",
      times: getKhartoumClock().time,
      excerptLength: 80,
    });
    assert.equal(item.enabled, false);
    assert.equal(item.topic, "قصص حب");
    assert.equal(item.excerptLength, 80);

    const enabled = await setWebGroupAutoPostEnabled(
      userId, groupId, "+249960506662", item.id, true
    );
    assert.equal(enabled.enabled, true);

    const preview = await previewWebGroupAutoPost(
      userId, groupId, "+249960506662", item.id
    );
    assert.match(preview.title, /قصة حب/);
    assert.match(preview.url, /^https:\/\/mawdoo3\.com\//);
    assert.ok(preview.content.length <= 80);
    assert.ok(articleContent.startsWith(preview.content.replace(/…$/, "")));
    assert.deepEqual(Object.keys(preview).sort(), ["content", "title", "url"]);
    assert.equal(sent.length, 0, "preview must not send to the group");

    const manual = await publishWebGroupAutoPostNow(
      userId, groupId, "+249960506662", item.id
    );
    assert.equal(manual.ok, true);
    assert.equal(sent.length, 1);
    assert.equal(sent[0].jid, groupId);
    assert.equal(sent[0].payload.text, `📖 ${manual.title}\n\n${preview.content}`);
    assert.doesNotMatch(sent[0].payload.text, /المصدر:|https?:|الكاتب/);

    await runScheduledGroupAutoPosts();
    await runScheduledGroupAutoPosts();
    assert.equal(sent.length, 2, "the same schedule slot must not publish twice");
    assert.notEqual(sent[0].payload.text, sent[1].payload.text);

    const detail = await getWebGroupDetails(userId, groupId, "+249960506662");
    assert.equal(detail.autoPosts.length, 1);
    assert.equal(detail.autoPosts[0].enabled, true);
    assert.equal("seenUrls" in detail.autoPosts[0], false);

    isAdmin = false;
    await assert.rejects(
      setWebGroupAutoPostEnabled(userId, groupId, "+249960506662", item.id, false),
      /مشرفاً/
    );
    isAdmin = true;

    await deleteWebGroupAutoPost(userId, groupId, "+249960506662", item.id);
    assert.deepEqual(user.groupAutoPosts, []);
    assert.equal(user.groupAutoPostHistory[0].urls.length, 2);
    const replacement = await saveWebGroupAutoPost(userId, groupId, "+249960506662", {
      topic: "قصص حب",
      times: "09:00",
    });
    await assert.rejects(
      previewWebGroupAutoPost(userId, groupId, "+249960506662", replacement.id),
      /غير مكرر/
    );
    await deleteWebGroupAutoPost(userId, groupId, "+249960506662", replacement.id);
  } finally {
    globalThis.fetch = realFetch;
    clearMawdoo3Cache();
    stopModerationListenerRecovery();
  }
});

test('excerpt removes author and links and respects the requested size', async () => {
  const { articleExcerpt } = await import('../../dist/handlers/groups-handler.mjs');
  const text = 'تمت الكتابة بواسطة: شخص\nهذا نص مفيد يحتوي تفاصيل كثيرة عن الموضوع حتى يكفي للاقتطاع بشكل صحيح وآمن ومناسب. https://example.com/a\nالمصدر: رابط';
  const result = articleExcerpt(text, 50);
  assert.ok(result.length <= 50);
  assert.doesNotMatch(result, /الكتابة بواسطة|شخص|https?:|المصدر/);
});

test('AI auto-post uses stored key, selected model, prompt and never repeats article', async () => {
  const originalFetch = globalThis.fetch;
  const groupId = '120363123456789012@g.us', userId = 'ai-user';
  const user = {nvidiaKey:'test-key',nvidiaModel:'test/selected',groupAutoPosts:[]};
  const sent=[], requests=[];
  const longText='هذا مقال عربي يتضمن معلومات مفيدة للمجموعة ويحتوي على تفاصيل كثيرة ومهمة في الموضوع.';
  globalThis.fetch=async (url,opts={})=>{
    if (String(url).includes('/chat/completions')) {
      requests.push(JSON.parse(opts.body));
      return new Response(JSON.stringify({choices:[{message:{content:'هذا مقتطف المقال المفيد.'}}]}),{status:200});
    }
    return new Response(String(url).includes('/خاص:') ? '<a href="/قصة_حب_واحدة">قصة حب واحدة</a>' : `<article><p>${longText}</p></article>`,{status:200});
  };
  clearMawdoo3Cache();
  const sock={user:{id:'249960506662@s.whatsapp.net'},groupMetadata:async()=>({participants:[{id:'249960506662@s.whatsapp.net',admin:'admin'}]}),sendMessage:async(id,payload)=>sent.push({id,payload})};
  setDeps({inMemoryDB:{sessions:new Map([[userId,sock]]),users:new Map([[userId,user]])},getUser:()=>user,saveUser:(_id,patch)=>Object.assign(user,patch)});
  try {
    const item=await saveWebGroupAutoPost(userId,groupId,'+249960506662',{topic:'قصص حب',times:'10:00',excerptMode:'ai',aiPrompt:'رتبه في نقاط'});
    assert.equal(item.excerptMode,'ai'); assert.equal(item.aiPrompt,'رتبه في نقاط');
    const preview=await previewWebGroupAutoPost(userId,groupId,'+249960506662',item.id);
    assert.equal(preview.content,'هذا مقتطف المقال المفيد.'); assert.equal(requests[0].model,'test/selected'); assert.match(requests[0].messages[1].content,/رتبه في نقاط/);
    await publishWebGroupAutoPostNow(userId,groupId,'+249960506662',item.id);
    assert.match(sent[0].payload.text,/هذا مقتطف المقال المفيد/); assert.doesNotMatch(sent[0].payload.text,/https?:|المصدر|الكاتب/);
    await assert.rejects(publishWebGroupAutoPostNow(userId,groupId,'+249960506662',item.id),/غير مكرر/);
  } finally {globalThis.fetch=originalFetch;clearMawdoo3Cache();stopModerationListenerRecovery();}
});
