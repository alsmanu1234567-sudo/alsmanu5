import test from "node:test";
import assert from "node:assert/strict";
import {
  extractInteractiveResponseId,
  listButton,
  quickReply,
  sendInteractive,
  setInteractiveBaileysForTests,
  urlButton,
} from "../../services/interactive.js";

const identity = (value) => value;
setInteractiveBaileysForTests({
  proto: {
    Message: {
      InteractiveMessage: {
        create: identity,
        Header: { create: identity },
        Body: { create: identity },
        Footer: { create: identity },
        NativeFlowMessage: {
          create: identity,
          NativeFlowButton: { create: identity },
        },
      },
    },
  },
  generateWAMessageFromContent(_chatId, message) {
    return { key: { id: "generated-native-flow-id" }, message };
  },
});

test("interactive button helpers build Baileys Native Flow buttons", () => {
  const quick = quickReply("فتح", "gw:menu:open");
  assert.equal(quick.name, "quick_reply");
  assert.equal(JSON.parse(quick.buttonParamsJson).id, "gw:menu:open");

  const list = listButton("الأقسام", [{
    title: "الرئيسية",
    rows: [{ id: "gw:help:games", title: "الألعاب", description: "قائمة الألعاب" }],
  }]);
  assert.equal(list.name, "single_select");
  assert.equal(JSON.parse(list.buttonParamsJson).sections[0].rows[0].id, "gw:help:games");

  const url = urlButton("الموقع", "https://example.com");
  assert.equal(url.name, "cta_url");
  assert.equal(JSON.parse(url.buttonParamsJson).url, "https://example.com/");
  assert.throws(() => urlButton("غير آمن", "javascript:alert(1)"), /HTTP or HTTPS/);
});

test("interactive response IDs are extracted from wrapped native and legacy replies", () => {
  assert.equal(extractInteractiveResponseId({
    message: {
      ephemeralMessage: {
        message: {
          interactiveResponseMessage: {
            nativeFlowResponseMessage: {
              paramsJson: JSON.stringify({ id: "arxo:game123:move:4" }),
            },
          },
        },
      },
    },
  }), "arxo:game123:move:4");
  assert.equal(extractInteractiveResponseId({
    message: { listResponseMessage: { singleSelectReply: { selectedRowId: "gw:xo:move:0" } } },
  }), "gw:xo:move:0");
});

test("sendInteractive relays a native message and fails instead of faking a button", async () => {
  let relayed;
  const sock = {
    relayMessage: async (chatId, message, options) => {
      relayed = { chatId, message, options };
    },
  };
  const button = quickReply("اضغط", "gw:sample");
  const result = await sendInteractive(sock, "group@g.us", {
    text: "رسالة اختبار",
    buttons: [button],
  });
  assert.equal(result.interactive, true);
  assert.equal(result.messageId, "generated-native-flow-id");
  assert.equal(relayed.chatId, "group@g.us");
  const payload = relayed.message.viewOnceMessage.message.interactiveMessage;
  assert.equal(payload.body.text, "رسالة اختبار");
  assert.equal(payload.nativeFlowMessage.buttons[0].name, "quick_reply");
  assert.equal(payload.nativeFlowMessage.messageParamsJson, "{}");
  assert.equal(payload.nativeFlowMessage.messageVersion, 1);
  assert.equal(JSON.parse(payload.nativeFlowMessage.buttons[0].buttonParamsJson).id, "gw:sample");
  assert.equal(relayed.options.additionalNodes[0].tag, "biz");
  assert.equal(relayed.options.additionalNodes[0].content[0].attrs.type, "native_flow");

  await sendInteractive(sock, "person@s.whatsapp.net", { buttons: [button] });
  assert.equal(relayed.options.additionalNodes[0].tag, "bot");

  await assert.rejects(sendInteractive({ sendMessage: async () => {} }, "group@g.us", {
    text: "لا تحول الزر إلى نص",
    buttons: [button],
  }), /cannot send interactive/);
});
