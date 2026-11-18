import assert from "node:assert/strict";
import { test } from "node:test";
import {
  deleteWebGroupReminder,
  getWebGroupDetails,
  runScheduledGroupReminders,
  saveWebGroupReminder,
  setDeps,
  setWebGroupReminderEnabled,
  stopModerationListenerRecovery,
} from "../../dist/handlers/groups-handler.mjs";

test("group reminders validate, send once on selected Khartoum days, and support pause/resume/delete", async () => {
  const groupId = "120363000000000000@g.us";
  const userId = "101";
  const user = {};
  const sent = [];
  const users = new Map([[userId, user]]);
  const sock = {
    user: { id: "249960506662@s.whatsapp.net" },
    groupMetadata: async (id) => ({
      id,
      subject: "مجموعة اختبار",
      participants: [{
        id: "249960506662@s.whatsapp.net",
        admin: "superadmin",
      }],
    }),
    sendMessage: async (jid, payload) => sent.push({ jid, payload }),
  };

  setDeps({
    inMemoryDB: {
      users,
      sessions: new Map([[userId, sock]]),
    },
    getUser: (id) => users.get(String(id)),
    saveUser: (id, patch) => Object.assign(users.get(String(id)), patch),
    logger: { warn: () => {} },
  });

  try {
    await assert.rejects(
      saveWebGroupReminder(userId, groupId, "+249960506662", {
        message: "تذكير الاجتماع",
        time: "25:00",
        days: [2],
      }),
      /وقتاً صحيحاً/u,
    );
    await assert.rejects(
      saveWebGroupReminder(userId, groupId, "+249960506662", {
        message: "تذكير الاجتماع",
        time: "02:30",
        days: [],
      }),
      /اختر يوماً واحداً/u,
    );

    const reminder = await saveWebGroupReminder(userId, groupId, "+249960506662", {
      message: "تذكير الاجتماع",
      time: "02:30",
      days: [2],
    });
    assert.equal(reminder.enabled, true);
    assert.deepEqual(reminder.days, [2]);

    const detail = await getWebGroupDetails(userId, groupId, "+249960506662");
    assert.equal(detail.reminders.length, 1);
    assert.equal(detail.reminders[0].message, "تذكير الاجتماع");

    // 00:30 UTC is 02:30 Tuesday in Khartoum.
    const tuesday = new Date("2026-11-10T00:30:00.000Z");
    await runScheduledGroupReminders(tuesday);
    await runScheduledGroupReminders(tuesday);
    assert.deepEqual(sent, [{
      jid: groupId,
      payload: { text: "تذكير الاجتماع" },
    }], "one reminder should be sent at most once per selected local date");

    await runScheduledGroupReminders(new Date("2026-11-11T00:30:00.000Z"));
    assert.equal(sent.length, 1, "an unselected weekday must not send");

    await setWebGroupReminderEnabled(userId, groupId, "+249960506662", reminder.id, false);
    await runScheduledGroupReminders(new Date("2026-11-17T00:30:00.000Z"));
    assert.equal(sent.length, 1, "a paused reminder must not send");

    await setWebGroupReminderEnabled(userId, groupId, "+249960506662", reminder.id, true);
    await runScheduledGroupReminders(new Date("2026-11-17T00:30:00.000Z"));
    assert.equal(sent.length, 2, "a resumed reminder should send on its selected day");

    assert.deepEqual(
      await deleteWebGroupReminder(userId, groupId, "+249960506662", reminder.id),
      { ok: true },
    );
    assert.deepEqual((await getWebGroupDetails(userId, groupId, "+249960506662")).reminders, []);
  } finally {
    stopModerationListenerRecovery();
  }
});
