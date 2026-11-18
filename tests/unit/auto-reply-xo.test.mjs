import test from "node:test";
import assert from "node:assert/strict";
import { handleAutoReplyCallback, setDeps } from "../../dist/auto-reply.mjs";
import { createAutoReplyXoGame } from "../../services/auto-reply-xo.mjs";

test("auto-reply XO selection preserves the trigger and advances to target selection", async () => {
  let state = {
    state: "awaiting_reply_type",
    data: { trigger: "لعب", triggerType: "exact", caseSensitive: false },
  };
  const sent = [];
  setDeps({
    getUser: () => ({}),
    getUserReplies: () => [],
    getState: () => state,
    setState: (_userId, nextState, data) => {
      state = { ...state, state: nextState, data: { ...state.data, ...data } };
    },
    replyTargetKeyboard: () => ({ inline_keyboard: [[{ text: "الكل", callback_data: "target_all" }]] }),
    DEVELOPER_ID: "owner",
  });

  const handled = await handleAutoReplyCallback(
    { sendMessage: async (...args) => sent.push(args) },
    "telegram-chat",
    "owner",
    "rtype_xo",
  );

  assert.equal(handled, true);
  assert.equal(state.state, "awaiting_reply_target");
  assert.equal(state.data.trigger, "لعب");
  assert.equal(state.data.replyType, "xo");
  assert.equal(state.data.replyContent, "__xo_game__");
  assert.match(sent[0][1], /لعبة X و O ضد البوت/);
});

test("auto-reply XO sends native move buttons and applies a move plus bot response", async () => {
  const sent = [];
  let nextId = 0;
  const game = createAutoReplyXoGame({
    idFactory: () => `testgame${++nextId}`,
    sendInteractiveFn: async (_sock, chatId, options) => {
      sent.push({ chatId, ...options });
      return { sent: true };
    },
  });
  const sock = { sendMessage: async () => {} };

  const started = await game.start(sock, "group@g.us", "player@s.whatsapp.net", "اللاعب", "owner");
  assert.equal(started.gameId, "testgame1");
  assert.equal(sent[0].buttons.length, 10, "nine cells and a cancel action are available");
  const moveId = JSON.parse(sent[0].buttons[0].buttonParamsJson).id;
  assert.equal(moveId, "arxo:testgame1:move:0");

  assert.equal(await game.handle(sock, "group@g.us", "other@s.whatsapp.net", moveId, "owner"), true);
  assert.equal(sent.length, 1, "another person cannot advance the game");

  assert.equal(await game.handle(sock, "group@g.us", "player@s.whatsapp.net", moveId, "owner"), true);
  assert.equal(sent.length, 2);
  assert.match(sent[1].text, /X/);
  assert.match(sent[1].text, /O/);
  const nextMoveIds = sent[1].buttons.map((button) => JSON.parse(button.buttonParamsJson).id);
  assert.equal(nextMoveIds.some((id) => id.endsWith(":move:0")), false);
  assert.equal(nextMoveIds.length, 8, "the player's and bot's occupied cells disappear, with cancel remaining");
});

test("XO handler ignores unrelated IDs and safely consumes stale game IDs", async () => {
  const game = createAutoReplyXoGame({
    idFactory: () => "testgame2",
    sendInteractiveFn: async () => ({ sent: true }),
  });
  const sock = { sendMessage: async () => {} };

  assert.equal(await game.handle(sock, "chat", "player", "gw:menu:open", "owner"), false);
  assert.equal(await game.handle(sock, "chat", "player", "arxo:missing:move:0", "owner"), true);
});
