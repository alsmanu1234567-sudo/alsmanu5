/**
 * Guarded web routes and static dashboard for Group World.
 * Dependencies: the existing webapp auth guard and group-world service.
 * Exports: registerGroupWorldWebApp.
 */

import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";
import {
  activateGroupWorldForWeb,
  adjustGroupWorldSlotForWeb,
  getGroupWorldLiveInfo,
  resolveGroupWorldAdminUser,
  refreshGroupWorldSlotsForWeb,
  sendGroupWorldAnnouncement,
} from "./handlers/groups-handler.mjs";
import {
  groupWorldService,
  renderMessageTemplate,
} from "./services/groups/group-world-service.mjs";

const MODULE_DIR = dirname(fileURLToPath(import.meta.url));
const PUBLIC_DIR = resolve(MODULE_DIR, "../public/group-world");
const STATIC_FILES = {
  "/group-world": ["index.html", "text/html; charset=utf-8"],
  "/group-world/": ["index.html", "text/html; charset=utf-8"],
  "/group-world/app.js": ["app.js", "text/javascript; charset=utf-8"],
  "/group-world/responsive-nav.js": ["responsive-nav.js", "text/javascript; charset=utf-8"],
  "/group-world/styles.css": ["styles.css", "text/css; charset=utf-8"],
};

async function requirePermission(userId, groupId, permission) {
  if (!(await groupWorldService.hasPermission(groupId, userId, permission))) {
    throw new Error("لا تملك الصلاحية المطلوبة لهذه المجموعة");
  }
}

function groupIdFrom(req) {
  return String(req.body?.groupId || req.query?.groupId || "").trim();
}

function intLimit(value, fallback = 100, max = 500) {
  const number = Number(value);
  return Number.isInteger(number) && number > 0 ? Math.min(number, max) : fallback;
}

export function registerGroupWorldWebApp(app, parseJson, guard) {
  for (const [path, [filename, contentType]] of Object.entries(STATIC_FILES)) {
    app.get(path, async (_req, res) => {
      try {
        const body = await readFile(resolve(PUBLIC_DIR, filename));
        res.setHeader("Content-Type", contentType);
        res.setHeader("Cache-Control", filename === "index.html" ? "no-store" : "public, max-age=300");
        res.end(body);
      } catch {
        res.status(404).end("Group World dashboard assets are missing");
      }
    });
  }

  app.get("/api/group-world/groups", guard(async (uid) => {
    const groups = await groupWorldService.listGroups();
    const visible = [];
    for (const group of groups) {
      if (await groupWorldService.hasPermission(group.groupId, uid, "view")) {
        visible.push({
          groupId: group.groupId,
          enabled: group.enabled,
          groupName: group.name || group.subject || group.groupId,
          memberCount: Object.keys(group.accounts || {}).length,
        });
      }
    }
    return visible;
  }));

  app.post("/api/group-world/activate", parseJson, guard(async (uid, req) => {
    return activateGroupWorldForWeb(uid, req.body?.groupId, req.body?.phoneNumber);
  }));

  app.get("/api/group-world/overview", guard(async (uid, req) => {
    const groupId = groupIdFrom(req);
    await requirePermission(uid, groupId, "view");
    const overview = await groupWorldService.getOverview(groupId);
    if (req.query?.phoneNumber) {
      try {
        overview.connection = await getGroupWorldLiveInfo(uid, groupId, req.query.phoneNumber);
      } catch {
        overview.connection = { groupId, connected: false };
      }
    }
    return overview;
  }));

  app.post("/api/group-world/enable", parseJson, guard(async (uid, req) => {
    const { groupId, enabled, reason } = req.body || {};
    await requirePermission(uid, groupId, "settings");
    return groupWorldService.setEnabled(groupId, enabled, uid, reason);
  }));

  app.post("/api/group-world/module", parseJson, guard(async (uid, req) => {
    const { groupId, name, enabled } = req.body || {};
    await requirePermission(uid, groupId, "settings");
    return groupWorldService.setModule(groupId, name, enabled, uid);
  }));

  app.post("/api/group-world/settings", parseJson, guard(async (uid, req) => {
    const { groupId, patch } = req.body || {};
    await requirePermission(uid, groupId, "settings");
    return groupWorldService.updateSettings(groupId, patch, uid);
  }));

  app.post("/api/group-world/game-ban", parseJson, guard(async (uid, req) => {
    const { groupId, memberId, game, enabled } = req.body || {};
    await requirePermission(uid, groupId, "settings");
    return groupWorldService.setGameBan(groupId, memberId, game, enabled, uid);
  }));

  app.post("/api/group-world/tournament/create", parseJson, guard(async (uid, req) => {
    const { groupId, title, mode } = req.body || {};
    await requirePermission(uid, groupId, "settings");
    return groupWorldService.createTournament(groupId, title, uid, mode || "individual");
  }));

  app.post("/api/group-world/tournament/start", parseJson, guard(async (uid, req) => {
    const { groupId, tournamentId } = req.body || {};
    await requirePermission(uid, groupId, "settings");
    return groupWorldService.startTournament(groupId, tournamentId, uid);
  }));

  app.get("/api/group-world/members", guard(async (uid, req) => {
    const groupId = groupIdFrom(req);
    await requirePermission(uid, groupId, "view");
    return groupWorldService.getMembers(groupId, req.query?.q || "");
  }));

  app.get("/api/group-world/member", guard(async (uid, req) => {
    const groupId = groupIdFrom(req);
    await requirePermission(uid, groupId, "view");
    return groupWorldService.getMemberProfile(groupId, req.query?.memberId);
  }));

  app.get("/api/group-world/leaderboard", guard(async (uid, req) => {
    const groupId = groupIdFrom(req);
    await requirePermission(uid, groupId, "view");
    return groupWorldService.getLeaderboard(
      groupId,
      String(req.query?.period || "all"),
      intLimit(req.query?.limit, 20, 100),
    );
  }));

  app.get("/api/group-world/reports", guard(async (uid, req) => {
    const groupId = groupIdFrom(req);
    await requirePermission(uid, groupId, "view");
    return groupWorldService.getReport(groupId, intLimit(req.query?.days, 14, 90));
  }));

  app.post("/api/group-world/points", parseJson, guard(async (uid, req) => {
    const { groupId, memberId, amount, reason } = req.body || {};
    await requirePermission(uid, groupId, "points");
    return groupWorldService.adjustBalance(groupId, memberId, amount, uid, reason);
  }));

  app.post("/api/group-world/member", parseJson, guard(async (uid, req) => {
    const { groupId, memberId, enabled, reason } = req.body || {};
    await requirePermission(uid, groupId, "members");
    return groupWorldService.setMemberEnabled(groupId, memberId, enabled, uid, reason);
  }));

  app.post("/api/group-world/member/update", parseJson, guard(async (uid, req) => {
    const { groupId, memberId, patch, reason } = req.body || {};
    await requirePermission(uid, groupId, "members");
    return groupWorldService.adminUpdateMember(groupId, memberId, patch, uid, reason);
  }));

  app.post("/api/group-world/team/assign", parseJson, guard(async (uid, req) => {
    const { groupId, memberId, teamId } = req.body || {};
    await requirePermission(uid, groupId, "members");
    return groupWorldService.assignMemberToTeam(groupId, memberId, teamId, uid);
  }));

  app.post("/api/group-world/catalog", parseJson, guard(async (uid, req) => {
    const { groupId, collection, item } = req.body || {};
    await requirePermission(uid, groupId, "catalog");
    return groupWorldService.upsertCatalogItem(groupId, collection, item, uid);
  }));

  app.post("/api/group-world/catalog/delete", parseJson, guard(async (uid, req) => {
    const { groupId, collection, itemId } = req.body || {};
    await requirePermission(uid, groupId, "catalog");
    return groupWorldService.deleteCatalogItem(groupId, collection, itemId, uid);
  }));

  app.post("/api/group-world/command", parseJson, guard(async (uid, req) => {
    const { groupId, command } = req.body || {};
    await requirePermission(uid, groupId, "commands");
    return groupWorldService.addCustomCommand(groupId, command, uid);
  }));

  app.post("/api/group-world/command/update", parseJson, guard(async (uid, req) => {
    const { groupId, commandId, patch } = req.body || {};
    await requirePermission(uid, groupId, "commands");
    return groupWorldService.updateCustomCommand(groupId, commandId, patch, uid);
  }));

  app.post("/api/group-world/command/delete", parseJson, guard(async (uid, req) => {
    const { groupId, commandId } = req.body || {};
    await requirePermission(uid, groupId, "commands");
    return groupWorldService.deleteCustomCommand(groupId, commandId, uid);
  }));

  app.post("/api/group-world/admin", parseJson, guard(async (uid, req) => {
    const { groupId, phoneNumber, permissions } = req.body || {};
    await requirePermission(uid, groupId, "settings");
    return groupWorldService.addAdministrator(
      groupId,
      phoneNumber,
      permissions,
      uid,
      resolveGroupWorldAdminUser(phoneNumber),
    );
  }));

  app.post("/api/group-world/admin/delete", parseJson, guard(async (uid, req) => {
    const { groupId, phoneNumber } = req.body || {};
    await requirePermission(uid, groupId, "settings");
    return groupWorldService.removeAdministrator(groupId, phoneNumber, uid);
  }));

  app.get("/api/group-world/slots", guard(async (uid, req) => {
    const groupId = groupIdFrom(req);
    await requirePermission(uid, groupId, "view");
    return groupWorldService.getSlots(groupId);
  }));

  app.post("/api/group-world/slots/refresh", parseJson, guard(async (uid, req) => {
    const { groupId, phoneNumber } = req.body || {};
    await requirePermission(uid, groupId, "members");
    return refreshGroupWorldSlotsForWeb(uid, groupId, phoneNumber);
  }));

  app.post("/api/group-world/slots/adjust", parseJson, guard(async (uid, req) => {
    const { groupId, phoneNumber, slotNumber, amount, reason } = req.body || {};
    await requirePermission(uid, groupId, "points");
    return adjustGroupWorldSlotForWeb(uid, groupId, phoneNumber, slotNumber, amount, reason);
  }));

  app.get("/api/group-world/logs", guard(async (uid, req) => {
    const groupId = groupIdFrom(req);
    await requirePermission(uid, groupId, "logs");
    return groupWorldService.getLogs(
      groupId,
      String(req.query?.kind || "all"),
      intLimit(req.query?.limit, 100, 500),
    );
  }));

  app.post("/api/group-world/data", parseJson, guard(async (uid, req) => {
    const { groupId, collection, data } = req.body || {};
    await requirePermission(uid, groupId, "settings");
    return groupWorldService.updateGroupData(groupId, collection, data, uid);
  }));

  app.post("/api/group-world/challenge/settle", parseJson, guard(async (uid, req) => {
    const { groupId, challengeId, winnerId } = req.body || {};
    await requirePermission(uid, groupId, "points");
    return groupWorldService.settleChallenge(groupId, challengeId, winnerId, uid);
  }));

  app.post("/api/group-world/season/settle", parseJson, guard(async (uid, req) => {
    const { groupId } = req.body || {};
    await requirePermission(uid, groupId, "settings");
    return groupWorldService.settleSeason(groupId, uid);
  }));

  app.post("/api/group-world/event/publish", parseJson, guard(async (uid, req) => {
    const { groupId, phoneNumber, text } = req.body || {};
    await requirePermission(uid, groupId, "messages");
    return sendGroupWorldAnnouncement(uid, groupId, phoneNumber, text);
  }));

  app.post("/api/group-world/template/preview", parseJson, guard(async (uid, req) => {
    const { groupId, template, values } = req.body || {};
    await requirePermission(uid, groupId, "messages");
    return renderMessageTemplate(template, values || {});
  }));

  app.get("/api/group-world/backup", guard(async (uid, req) => {
    const groupId = groupIdFrom(req);
    await requirePermission(uid, groupId, "settings");
    const backup = await groupWorldService.getGroup(groupId);
    return {
      version: 1,
      exportedAt: new Date().toISOString(),
      data: backup,
    };
  }));
}
