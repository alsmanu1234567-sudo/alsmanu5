import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import {
  runScheduledGroupLockSchedules,
  saveWebGroupLockSchedule,
  setDeps,
  stopModerationListenerRecovery,
} from "../../dist/handlers/groups-handler.mjs";

test("group lock schedules follow Khartoum time, catch up, and require admin only when enabled", async () => {
  const groupId = "120363000000000000@g.us";
  let locked = false;
  let isAdmin = true;
  const updates = [];
  const user = {};
  const users = new Map([["101", user]]);
  const sock = {
    user: { id: "249960506662@s.whatsapp.net" },
    sendMessage: async () => {},
    groupMetadata: async () => ({
      id: groupId,
      announce: locked,
      participants: [{
        id: "249960506662@s.whatsapp.net",
        admin: isAdmin ? "superadmin" : null,
      }],
    }),
    groupSettingUpdate: async (_id, setting) => {
      updates.push(setting);
      locked = setting === "announcement";
    },
  };

  setDeps({
    inMemoryDB: {
      users,
      sessions: new Map([["101", sock]]),
    },
    getUser: (id) => users.get(String(id)),
    saveUser: (id, patch) => Object.assign(users.get(String(id)), patch),
    logger: { warn: () => {} },
  });

  try {
    await assert.rejects(
      saveWebGroupLockSchedule("101", groupId, "+249960506662", {
        enabled: true,
        closeTime: "22:00",
        openTime: "22:00",
      }),
      /يجب أن يختلف وقت الفتح عن وقت الإغلاق/u,
    );

    const saved = await saveWebGroupLockSchedule("101", groupId, "+249960506662", {
      enabled: true,
      closeTime: "22:00",
      openTime: "07:00",
    });
    assert.equal(saved.enabled, true);

    // 20:30 UTC is 22:30 in Khartoum, so the group should be locked.
    await runScheduledGroupLockSchedules(new Date("2026-11-14T20:30:00.000Z"));
    assert.deepEqual(updates, ["announcement"]);
    assert.equal(locked, true);

    // Rechecking the same state is idempotent.
    await runScheduledGroupLockSchedules(new Date("2026-11-14T20:30:30.000Z"));
    assert.deepEqual(updates, ["announcement"]);

    // 06:00 UTC is 08:00 in Khartoum, after the configured opening time.
    await runScheduledGroupLockSchedules(new Date("2026-11-15T06:00:00.000Z"));
    assert.deepEqual(updates, ["announcement", "not_announcement"]);
    assert.equal(locked, false);

    isAdmin = false;
    await assert.rejects(
      saveWebGroupLockSchedule("101", groupId, "+249960506662", {
        enabled: true,
        closeTime: "22:00",
        openTime: "07:00",
      }),
      /يجب أن يكون البوت مشرفاً/u,
    );

    const disabled = await saveWebGroupLockSchedule("101", groupId, "+249960506662", {
      enabled: false,
      closeTime: "22:00",
      openTime: "07:00",
    });
    assert.equal(disabled.enabled, false);
  } finally {
    stopModerationListenerRecovery();
  }
});

test("group lock schedule is exposed in the web app", () => {
  const webapp = readFileSync(new URL("../../dist/webapp.mjs", import.meta.url), "utf8");
  assert.match(webapp, /\/api\/fw\/groups\/lock-schedule/u);
  assert.match(webapp, /id="groupLockCloseTime"/u);
  assert.match(webapp, /id="groupLockOpenTime"/u);
  assert.match(webapp, /جدولة فتح وإغلاق الكتابة/u);
});
