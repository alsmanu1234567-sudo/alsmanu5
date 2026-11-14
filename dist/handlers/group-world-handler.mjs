/**
 * WhatsApp group event and command handler for Group World.
 * Dependencies: the shared group-world service and a Baileys socket.
 * Exports: setGroupWorldDeps, handleGroupWorldMessage, handleGroupWorldParticipants.
 */

import { randomUUID } from "node:crypto";
import { listButton, quickReply, sendInteractive } from "../../services/interactive.js";
import {
  groupWorldService as defaultGroupWorldService,
  groupWorldDayKey,
  groupWorldWeekKey,
  renderMessageTemplate,
} from "../services/groups/group-world-service.mjs";

let _deps = {};
const groupWorldService = new Proxy(defaultGroupWorldService, {
  get(target, property) {
    const source = _deps.groupWorldServiceOverride || target;
    const value = Reflect.get(source, property, source);
    return typeof value === "function" ? value.bind(source) : value;
  },
});
const GROUP_ID_PATTERN = /^[A-Za-z0-9._:-]{3,128}@g\.us$/;
const MAX_REPLY_LENGTH = 3_500;
const commandEvents = new Map();
const participantEvents = new Map();
const interactiveActions = new Map();

export function setGroupWorldDeps(deps = {}) {
  _deps = { ..._deps, ...deps };
}

function messageText(message) {
  let content = unwrappedMessageContent(message);
  return [
    content.conversation,
    content.extendedTextMessage?.text,
    content.imageMessage?.caption,
    content.videoMessage?.caption,
    content.documentMessage?.caption,
  ].filter(Boolean).join("\n").trim();
}

function unwrappedMessageContent(message) {
  let content = message?.message || {};
  for (let index = 0; index < 5; index += 1) {
    const wrapped =
      content.ephemeralMessage?.message ||
      content.viewOnceMessage?.message ||
      content.viewOnceMessageV2?.message ||
      content.documentWithCaptionMessage?.message;
    if (!wrapped) break;
    content = wrapped;
  }
  return content;
}

function messageInteractionId(message) {
  const content = unwrappedMessageContent(message);
  const direct = [
    content.buttonsResponseMessage?.selectedButtonId,
    content.listResponseMessage?.singleSelectReply?.selectedRowId,
    content.listResponseMessage?.title,
    content.interactiveResponseMessage?.nativeFlowResponseMessage?.name,
  ].filter(Boolean);
  for (const value of direct) {
    const text = String(value);
    if (text.startsWith("gw:")) return text;
  }
  const rawParams = content.interactiveResponseMessage?.nativeFlowResponseMessage?.paramsJson;
  if (typeof rawParams === "string") {
    try {
      const params = JSON.parse(rawParams);
      for (const value of [params.id, params.row_id, params.selected_id, params.button_id, params.selection_id]) {
        if (typeof value === "string" && value.startsWith("gw:")) return value;
      }
    } catch {
      return null;
    }
  }
  return null;
}

function participantId(message) {
  const key = message?.key || {};
  return key.participant || key.participantAlt || key.participantPn || message?.participant || "";
}

function normalizeWhatsAppAddress(value) {
  const address = String(value || "").trim().toLowerCase();
  const separator = address.lastIndexOf("@");
  if (separator <= 0 || separator === address.length - 1) return address;
  const user = address.slice(0, separator).replace(/:\d+$/, "");
  const domain = address.slice(separator + 1) === "c.us"
    ? "s.whatsapp.net"
    : address.slice(separator + 1);
  return `${user}@${domain}`;
}

function phoneDigits(value) {
  const address = String(value || "").trim().toLowerCase();
  const separator = address.lastIndexOf("@");
  if (separator < 0) {
    return /^\+?[\d\s()-]+$/.test(address) ? address.replace(/\D/g, "") : "";
  }
  const domain = address.slice(separator + 1);
  if (!["s.whatsapp.net", "c.us"].includes(domain)) return "";
  const user = address.slice(0, separator).replace(/:\d+$/, "");
  return /^\+?\d+$/.test(user) ? user.replace(/\D/g, "") : "";
}

export function sameWhatsAppIdentity(left, right) {
  const a = normalizeWhatsAppAddress(left);
  const b = normalizeWhatsAppAddress(right);
  if (!a || !b) return false;
  if (a === b) return true;
  const leftPhone = phoneDigits(left);
  const rightPhone = phoneDigits(right);
  return Boolean(leftPhone && rightPhone && leftPhone === rightPhone);
}

function sameMember(left, right) {
  return sameWhatsAppIdentity(left, right);
}

function participantIdentityValues(participant) {
  if (!participant || typeof participant !== "object") return [];
  return [participant.id, participant.jid, participant.pn, participant.phoneNumber, participant.lid]
    .filter(Boolean)
    .map(String);
}

function socketIdentityValues(sock) {
  const user = sock?.user || {};
  return [user.id, user.jid, user.pn, user.lid, user.phoneNumber]
    .filter(Boolean)
    .map(String);
}

async function resolvedMessageSenderIds(message, memberId, sock) {
  const ids = messageSenderIds(message, memberId);
  const mapping = sock?.signalRepository?.lidMapping;
  if (typeof mapping?.getPNForLID !== "function") return ids;
  for (const id of ids) {
    if (!String(id).toLowerCase().endsWith("@lid")) continue;
    try {
      const phoneJid = await mapping.getPNForLID(id);
      if (phoneJid) ids.push(String(phoneJid));
    } catch {
      // The alternate participant JID remains usable when the local mapping is absent.
    }
  }
  return [...new Set(ids)];
}

function socketPhoneNumber(sock) {
  const user = sock?.user || {};
  return [
    phoneDigits(user.pn),
    phoneDigits(user.phoneNumber),
    phoneDigits(user.jid),
    phoneDigits(user.id),
  ].find(Boolean) || "";
}

async function isCurrentSocketOwnerMessage(groupId, sock, message) {
  const ownIds = socketIdentityValues(sock);
  if (message?.key?.fromMe !== true || !ownIds.length) return false;
  const senderIds = messageSenderIds(message, "");
  if (!senderIds.length) return true;
  const resolved = await resolvedMessageSenderIds(message, "", sock);
  if (resolved.some((sender) => ownIds.some((own) => sameWhatsAppIdentity(sender, own)))) return true;

  if (typeof sock?.groupMetadata !== "function") return false;
  try {
    const metadata = await sock.groupMetadata(groupId);
    return (metadata?.participants || []).some((participant) => {
      const identities = participantIdentityValues(participant);
      return identities.some((identity) => senderIds.some((sender) => sameWhatsAppIdentity(identity, sender))) &&
        identities.some((identity) => ownIds.some((own) => sameWhatsAppIdentity(identity, own)));
    });
  } catch {
    return false;
  }
}

async function ownerMemberId(groupId, sock, message) {
  const ownIds = socketIdentityValues(sock);
  const senderIds = await resolvedMessageSenderIds(message, "", sock);
  const primarySender = participantId(message);
  if (primarySender && senderIds.some((sender) => ownIds.some((own) => sameWhatsAppIdentity(sender, own)))) {
    return normalizeWhatsAppAddress(primarySender);
  }

  if (typeof sock?.groupMetadata === "function") {
    try {
      const metadata = await sock.groupMetadata(groupId);
      const participant = (metadata?.participants || []).find((entry) =>
        participantIdentityValues(entry).some((identity) =>
          ownIds.some((own) => sameWhatsAppIdentity(identity, own))
        )
      );
      const id = participant?.id || participant?.jid || participant?.pn || participant?.lid;
      if (id) return normalizeWhatsAppAddress(id);
    } catch {
      // Fall through to the linked socket identity so a metadata outage does not block commands.
    }
  }

  const linkedId = [sock?.user?.pn, sock?.user?.id, sock?.user?.jid, sock?.user?.lid]
    .find(Boolean);
  return normalizeWhatsAppAddress(linkedId);
}

async function isGroupWorldOwner(groupId, userId, sock) {
  const group = await groupWorldService.getGroup(groupId);
  if (group.ownerId && String(group.ownerId) === String(userId || "")) return true;
  const savedPhone = String(group.ownerPhoneNumber || "").replace(/\D/g, "");
  const linkedPhone = socketPhoneNumber(sock);
  return Boolean(savedPhone && linkedPhone && savedPhone === linkedPhone);
}

async function handleWorldToggle(userId, sock, message, groupId, memberId, text, fromMe) {
  const token = String(text || "").trim();
  const enable = token === ".تفعيل العالم";
  const disable = token === ".تعطيل العالم";
  if (!enable && !disable) return null;
  const authorized = fromMe || await groupWorldService.hasPermission(groupId, memberId, "settings");
  if (!authorized) {
    return sendText(sock, groupId, "تفعيل أو تعطيل العالم متاح لمالك البوت أو للمشغّل المخوّل فقط.");
  }
  if (enable) {
    if (typeof sock?.groupMetadata !== "function") throw new Error("تعذّر قراءة أعضاء المجموعة");
    const metadata = await sock.groupMetadata(groupId);
    const members = (metadata?.participants || []).map((participant) => ({
      memberId: participant.id || participant.jid || participant.pn || participant.lid,
      name: participant.notify || participant.name || "",
    })).filter((member) => member.memberId);
    const current = await groupWorldService.getGroup(groupId);
    const result = await groupWorldService.activateGroup({
      groupId,
      ownerId: current.ownerId || String(userId),
      ownerPhoneNumber: current.ownerPhoneNumber || socketPhoneNumber(sock),
      members,
      actor: memberId,
    });
    return sendText(sock, groupId, `تم تفعيل عالم المجموعة. لا يحتاج التفعيل إلى أن يكون البوت مشرفاً. رصيد الأعضاء السابق محفوظ. (${result.seededMembers} عضو تمت تهيئته)`);
  }
  await groupWorldService.setEnabled(groupId, false, memberId, "تعطيل عالم المجموعة");
  return sendText(sock, groupId, "تم تعطيل عالم المجموعة لهذه المجموعة فقط. الأرصدة والبيانات محفوظة.");
}

function groupAdmin(metadata, memberId) {
  const participants = Array.isArray(metadata?.participants) ? metadata.participants : [];
  const participant = participants.find((item) =>
    [item?.id, item?.jid, item?.pn, item?.phoneNumber, item?.lid].some((value) => sameMember(value, memberId))
  );
  return participant?.admin === "admin" || participant?.admin === "superadmin" || participant?.isAdmin === true;
}

function messageSenderIds(message, primaryId) {
  const key = message?.key || {};
  return [...new Set([
    primaryId,
    key.participant,
    key.participantAlt,
    key.participantPn,
    message?.participant,
  ].filter(Boolean).map(String))];
}

async function canManageFromChat(groupId, message, memberId, metadata, permission, sock, isBotOwner = false) {
  if (isBotOwner) return true;
  const candidates = await resolvedMessageSenderIds(message, memberId, sock);
  if (candidates.some((candidate) => groupAdmin(metadata, candidate))) return true;
  for (const candidate of candidates) {
    if (await groupWorldService.hasPermission(groupId, candidate, permission)) return true;
  }
  return false;
}

function ownAccountIsAdmin(sock, metadata) {
  const own = [sock?.user?.id, sock?.user?.jid, sock?.user?.pn, sock?.user?.lid].filter(Boolean);
  return own.some((id) => groupAdmin(metadata, id));
}

async function sendText(sock, groupId, text) {
  const content = String(text || "").trim();
  if (!content) return;
  let remaining = content;
  const chunks = [];
  while (remaining.length > MAX_REPLY_LENGTH && chunks.length < 19) {
    let cut = remaining.lastIndexOf("\n", MAX_REPLY_LENGTH);
    if (cut < Math.floor(MAX_REPLY_LENGTH * 0.55)) cut = MAX_REPLY_LENGTH;
    chunks.push(remaining.slice(0, cut));
    remaining = remaining.slice(cut).replace(/^\n/, "");
  }
  if (remaining.length > MAX_REPLY_LENGTH) {
    remaining = `${remaining.slice(0, MAX_REPLY_LENGTH - 35)}\n… تم اختصار بقية النتائج.`;
  }
  if (remaining) chunks.push(remaining);
  for (const chunk of chunks) await sock.sendMessage(groupId, { text: chunk });
}

async function sendNativeInteractive(sock, groupId, { text, buttons = [], imageMessage = null, image = null, footer = "" }) {
  if (!Array.isArray(buttons) || !buttons.length || buttons.length > 10) {
    throw new Error("عدد الأزرار التفاعلية يجب أن يكون بين 1 و10");
  }
  const nativeButtons = buttons.map((button) => {
    if (button.type === "list") {
      return listButton(button.title || "اختر", [{
        title: button.sectionTitle || "الخيارات",
        rows: (button.rows || []).slice(0, 10),
      }]);
    }
    return quickReply(button.title || "اختيار", button.id);
  });
  return sendInteractive(sock, groupId, {
    text,
    footer,
    buttons: nativeButtons,
    imageMessage,
    image,
  });
}

async function sendInteractiveList(sock, groupId, text, title, rows, options = {}) {
  return sendInteractive(sock, groupId, {
    text,
    footer: options.footer,
    imageMessage: options.imageMessage,
    buttons: [listButton(title, [{
      title: options.sectionTitle || "الخيارات",
      rows,
    }])],
  });
}

function rememberInteractiveAction(action) {
  const id = `gw:template:${randomUUID()}`;
  interactiveActions.set(id, { ...action, expiresAt: Date.now() + 30 * 60_000 });
  if (interactiveActions.size > 2_000) {
    const now = Date.now();
    for (const [key, value] of interactiveActions) if (value.expiresAt < now) interactiveActions.delete(key);
    while (interactiveActions.size > 2_000) interactiveActions.delete(interactiveActions.keys().next().value);
  }
  return id;
}

async function sendTemplate(sock, groupId, template, values) {
  const rendered = renderMessageTemplate(template, values);
  if (rendered.buttons.length) {
    const buttons = rendered.buttons.slice(0, 10).map((button) => ({
      id: rememberInteractiveAction({ groupId, response: button.response }),
      title: button.label,
    }));
    return sendNativeInteractive(sock, groupId, {
      text: rendered.text,
      buttons,
      image: rendered.image,
    });
  }
  if (rendered.image) {
    await sock.sendMessage(groupId, {
      image: { url: rendered.image },
      caption: String(rendered.text || "").slice(0, MAX_REPLY_LENGTH),
    });
  } else {
    await sendText(sock, groupId, rendered.text);
  }
  return true;
}

function accountIdFromMessage(message) {
  return participantId(message);
}

async function getTemplateValues(sock, groupId, memberId, profile, includeImage = false) {
  const safeProfile = profile || {
    balance: 0,
    name: memberId.split("@")[0],
    rank: { name: "مبتدئ" },
    position: null,
    totalEarned: 0,
    totalSpent: 0,
    activePet: null,
    nextPoints: 0,
  };
  const all = await groupWorldService.getMembers(groupId);
  let image = null;
  if (includeImage && typeof sock?.profilePictureUrl === "function") {
    try {
      image = await sock.profilePictureUrl(memberId, "image");
    } catch {
      image = null;
    }
  }
  return {
    points: safeProfile.balance,
    name: safeProfile.name || memberId.split("@")[0],
    time: new Intl.DateTimeFormat("ar", {
      timeZone: "Africa/Khartoum",
      dateStyle: "medium",
      timeStyle: "short",
    }).format(new Date()),
    image,
    allMembers: all.map((entry, index) => `${index + 1}. ${entry.name}: ${entry.balance}`).join("\n"),
    rank: safeProfile.rank?.name || "مبتدئ",
    position: safeProfile.position || "—",
    earned: safeProfile.totalEarned,
    spent: safeProfile.totalSpent,
    pet: safeProfile.activePet?.catalog?.name || "لا يوجد",
    nextPoints: safeProfile.nextPoints || 0,
  };
}

function formatMemberLine(member, index) {
  const name = String(member.name || member.memberId.split("@")[0]).slice(0, 32);
  return `${index + 1}. ${name} — ${Number(member.balance).toLocaleString("ar")} نقطة · ${member.rank?.name || "مبتدئ"}`;
}

function xoBoardText(game) {
  const cells = game.board.map((cell, index) => cell || String(index + 1));
  return `${cells.slice(0, 3).join(" │ ")}\n───┼───┼───\n${cells.slice(3, 6).join(" │ ")}\n───┼───┼───\n${cells.slice(6, 9).join(" │ ")}`;
}

async function sendXoBoard(sock, groupId, game) {
  const playerName = (id) => game.names?.[id] || id?.split("@")[0] || "لاعب";
  let text = `🎮 مباراة X و O\nX: ${playerName(game.xPlayer)}\nO: ${playerName(game.oPlayer)}\n\n${xoBoardText(game)}\n\n`;
  const buttons = [];
  if (game.status === "active") {
    text += `الدور الآن: ${game.turn === game.xPlayer ? "X" : "O"} — ${playerName(game.turn)}`;
    for (let index = 0; index < 9; index += 1) {
      if (!game.board[index]) buttons.push({ id: `gw:xo:${game.id}:move:${index}`, title: `الخانة ${index + 1}` });
    }
    buttons.push({ id: `gw:xo:${game.id}:cancel`, title: "إلغاء المباراة" });
  } else if (game.status === "draw") {
    text += "انتهت المباراة بالتعادل.";
    buttons.push({ id: `gw:xo:${game.id}:replay`, title: "إعادة اللعب" });
  } else if (game.status === "finished") {
    text += `🏆 الفائز: ${playerName(game.winnerId)}`;
    buttons.push({ id: `gw:xo:${game.id}:replay`, title: "إعادة اللعب" });
  } else {
    text += "تم إلغاء المباراة.";
  }
  if (buttons.length) {
    return sendNativeInteractive(sock, groupId, {
      text,
      buttons,
      footer: "اضغط خانة للعب؛ لا تُقبل الحركة إلا من صاحب الدور.",
    });
  }
  return sendText(sock, groupId, text);
}

const HELP_SECTIONS = {
  points: {
    title: "أوامر النقاط",
    text: "• .نقاطي — رصيدك ومستواك\n• .صدارة — ترتيب الأعضاء\n• .هدية — الهدية اليدوية إن كانت مفعّلة\n• .متجر و .شراء <المعرّف> — المتجر",
  },
  pets: {
    title: "أوامر الحيوانات",
    text: "• .حيواني — حيوانك النشط\n• .قدرات الحيوان — قدرات حيوانك\n• .قدرات الحيوان التنين — تفاصيل حيوان من الكتالوج\n• .حيواناتي — حيواناتك المملوكة\n• .ترقية حيواني — ترقية الحيوان النشط",
  },
  games: {
    title: "أوامر الألعاب",
    text: "• .الألعاب — قائمة الألعاب\n• .اكس_او @الخصم — مباراة X و O\n• .تحدي @الخصم — تحدٍ آلي بين عضوين\n• .زعيم — حالة زعيم المجموعة\n• .صيد الكلمات — بدء صيد كلمة",
  },
  challenges: {
    title: "أوامر التحديات",
    text: "• .تحدي @الشخص — إنشاء تحدٍ\n• .قبول @المتحدي اسم_التحدي — قبول الاسم المطابق\n• .رفض @المتحدي — رفض الدعوة\n• .تحدياتي — عرض التحديات\n• .إلغاء التحدي — إلغاء تحديك\n• .إجابة اسم_التحدي الإجابة — إرسال إجابة",
  },
  social: {
    title: "أوامر العالم الاجتماعي",
    text: "• .فريقي و .الفرق — فرق الأعضاء\n• .نقابة إنشاء <اسم> و .نقابة انضمام <المعرّف>\n• .مغامرة — بدء مغامرة\n• .كنز — البحث عن الكنز\n• .كلمة <إجابة> — إجابة صيد الكلمات\n• .عجلة — عجلة الحظ المجانية",
  },
  admin: {
    title: "أوامر الإدارة",
    text: "• .تفعيل العالم و .تعطيل العالم — لمالك البوت أو المشرف المخوّل\n• .تحديث القائمة — تحديث خانات المجموعة\n• .تزويد <رقم> <مبلغ> — تعديل النقاط بصلاحية الإدارة\n• .حسم — تسوية تحدي الرهان القديم بصلاحية الإدارة",
  },
};

async function sendHelpMenu(sock, groupId) {
  const rows = Object.entries(HELP_SECTIONS).map(([id, section]) => ({
    id: `gw:help:${id}`,
    title: section.title,
  }));
  return sendInteractiveList(sock, groupId, "اختر القسم لعرض أوامر عالم المجموعات.", "أقسام المساعدة", rows);
}

async function sendGamesMenu(sock, groupId) {
  return sendInteractiveList(sock, groupId, "اختر لعبة أو نشاطاً لمعرفة طريقة تشغيله.", "الألعاب والأنشطة", [
    { id: "gw:games:xo", title: "لعبة X و O", description: "مباراة مباشرة بين عضوين" },
    { id: "gw:games:challenges", title: "تحديات الأعضاء", description: "15 نوعاً من التحديات الآلية" },
    { id: "gw:games:boss", title: "زعيم المجموعة", description: "هجوم جماعي على الزعيم" },
    { id: "gw:games:treasure", title: "البحث عن الكنز", description: "حل الألغاز للفوز" },
    { id: "gw:games:dungeon", title: "الأبراج المحصنة", description: "مراحل وألغاز متتابعة" },
    { id: "gw:games:word", title: "صيد الكلمات", description: "اكتشف الكلمة من التلميح" },
    { id: "gw:games:wheel", title: "عجلة الحظ", description: "مكافآت افتراضية محدودة" },
  ]);
}

async function handleGroupWorldInteraction(userId, sock, groupId, memberId, interactionId) {
  const templateAction = interactiveActions.get(interactionId);
  if (templateAction) {
    interactiveActions.delete(interactionId);
    if (templateAction.expiresAt < Date.now() || templateAction.groupId !== groupId) return null;
    return sendText(sock, groupId, templateAction.response);
  }
  if (interactionId === "gw:list:open") {
    return sendInteractiveList(sock, groupId, "قائمة عالم المجموعات — اختر ما تريد فتحه.", "قائمة العالم", [
      { id: "gw:list:points", title: "النقاط والصدارة" },
      { id: "gw:list:profile", title: "ملفي الشخصي" },
      { id: "gw:list:shop", title: "المتجر" },
      { id: "gw:list:pets", title: "الحيوانات" },
      { id: "gw:list:games", title: "الألعاب" },
      { id: "gw:list:help", title: "المساعدة" },
    ]);
  }
  if (interactionId.startsWith("gw:list:")) {
    const action = interactionId.slice("gw:list:".length);
    const command = {
      points: ".نقاطي",
      profile: ".ملفي",
      shop: ".متجر",
      pets: ".قدرات الحيوان",
    }[action];
    if (action === "games") return sendGamesMenu(sock, groupId);
    if (action === "help") return sendHelpMenu(sock, groupId);
    if (command) return commandReply(sock, groupId, memberId, { pushName: "" }, command, false);
  }
  if (interactionId.startsWith("gw:help:")) {
    const section = HELP_SECTIONS[interactionId.slice("gw:help:".length)];
    if (section) return sendText(sock, groupId, `${section.title}\n${section.text}`);
  }
  if (interactionId.startsWith("gw:games:")) {
    const action = interactionId.slice("gw:games:".length);
    const instructions = {
      xo: "لبدء مباراة: .اكس_او @الخصم",
      challenges: "لبدء تحدٍ: .تحدي @الخصم — ثم يقبل الخصم باسم التحدي",
      boss: "عرض حالة الزعيم: .زعيم · المساهمة في الهجوم: .زعيم هجوم",
      treasure: "بدء البحث عن الكنز أو عرض التلميح: .كنز · أرسل الحل: .حل <الإجابة>",
      dungeon: "بدء الأبراج المحصنة: .مغامرة · أرسل الحل: .حل_المغامرة <الإجابة>",
      word: "بدء صيد الكلمات: .صيد الكلمات · أرسل الحل: .كلمة <الإجابة>",
      wheel: "استخدم .عجلة للحصول على فرصة مجانية محدودة يومياً.",
    };
    if (instructions[action]) return sendText(sock, groupId, instructions[action]);
  }
  const gameMatch = interactionId.match(/^gw:xo:([^:]+):(move|cancel|replay)(?::(\d+))?$/);
  if (gameMatch) {
    const [, gameId, action, position] = gameMatch;
    if (action === "move") {
      const game = await groupWorldService.moveTicTacToe(groupId, gameId, memberId, Number(position));
      return sendXoBoard(sock, groupId, game);
    }
    if (action === "cancel") {
      const game = await groupWorldService.cancelTicTacToe(groupId, gameId, memberId);
      return sendXoBoard(sock, groupId, game);
    }
    const game = await groupWorldService.replayTicTacToe(groupId, gameId, memberId);
    return sendXoBoard(sock, groupId, game);
  }
  const challengeMatch = interactionId.match(/^gw:challenge:(accept|reject):(.+)$/);
  if (challengeMatch) {
    const [, action, challengeName] = challengeMatch;
    const challenge = action === "accept"
      ? await groupWorldService.acceptMemberChallenge(groupId, challengeName, memberId)
      : await groupWorldService.rejectMemberChallenge(groupId, challengeName, memberId);
    return sendText(sock, groupId, action === "accept"
      ? `قُبل ${challenge.name} (${challenge.typeLabel}).\n${challenge.prompt}\nأجب: .إجابة ${challenge.name} <إجابتك>`
      : `تم رفض ${challenge.name}.`);
  }
  return null;
}

async function commandReply(sock, groupId, memberId, message, text, isBotOwner = false) {
  const commandToken = text.trim().split(/\s+/)[0];
  const args = text.trim().slice(commandToken.length).trim();
  const name = message?.pushName || "";
  await groupWorldService.ensureMember(groupId, memberId, name);
  const profile = await groupWorldService.getMemberProfile(groupId, memberId);
  const argsList = args.split(/\s+/).filter(Boolean);

  if ([".الألعاب", ".العاب"].includes(commandToken)) {
    return sendGamesMenu(sock, groupId);
  }

  if (commandToken === ".مساعدة") {
    return sendHelpMenu(sock, groupId);
  }

  if (commandToken === ".اكس_او") {
    const mentioned = message?.message?.extendedTextMessage?.contextInfo?.mentionedJid || [];
    if (!mentioned.length) return sendText(sock, groupId, "استخدم: .اكس_او @الخصم");
    const metadata = await sock.groupMetadata(groupId);
    const opponent = (metadata.participants || []).find((item) =>
      [item.id, item.jid, item.pn, item.lid].some((value) => sameMember(value, mentioned[0]))
    );
    if (!opponent) return sendText(sock, groupId, "يجب أن يكون الخصم عضوًا حاليًا في المجموعة.");
    const opponentId = opponent.id || opponent.jid || opponent.pn || opponent.lid;
    const game = await groupWorldService.startTicTacToe(groupId, memberId, opponentId, {
      x: profile.name || name,
      o: opponent.notify || opponent.name || "",
    });
    return sendXoBoard(sock, groupId, game);
  }

  if (commandToken === ".نقاطي") {
    return sendText(sock, groupId, [
      `${profile.name || name || "عضو"}`,
      `الرصيد: ${profile.balance.toLocaleString("ar")} نقطة`,
      `الرتبة: ${profile.rank?.icon || "⭐"} ${profile.rank?.name || "مبتدئ"}`,
      `الترتيب: ${profile.position || "—"} · التالي بعد ${profile.nextPoints || 0} نقطة`,
      `المستوى: ${profile.level} · XP: ${profile.xp}`,
    ].join("\n"));
  }

  if (commandToken === ".نقاط" && args === "الكل") {
    const members = await groupWorldService.getMembers(groupId);
    return sendText(sock, groupId, members.length
      ? `نقاط أعضاء المجموعة:\n${members.map(formatMemberLine).join("\n")}`
      : "لا توجد أرصدة مسجّلة بعد.");
  }

  if (commandToken === ".هدية" && !args) {
    const gift = await groupWorldService.claimGiftForMember(groupId, memberId, "daily", name);
    return sendText(sock, groupId, `استلمت ${gift.amount.toLocaleString("ar")} نقطة. رصيدك الآن ${gift.balance.toLocaleString("ar")}.`);
  }

  if (commandToken === ".هدية" && ["اسبوعية", "أسبوعية"].includes(args)) {
    const gift = await groupWorldService.claimGiftForMember(groupId, memberId, "weekly", name);
    return sendText(sock, groupId, `استلمت ${gift.amount.toLocaleString("ar")} نقطة أسبوعية. رصيدك الآن ${gift.balance.toLocaleString("ar")}.`);
  }

  if (commandToken === ".صدارة") {
    const period = /شهر/i.test(args) ? "monthly" : /اسبوع|أسبوع/i.test(args) ? "weekly" : /يوم/i.test(args) ? "daily" : "all";
    const title = { daily: "اليومية", weekly: "الأسبوعية", monthly: "الشهرية", all: "العامة" }[period];
    const leaders = await groupWorldService.getLeaderboard(groupId, period, 10);
    return sendText(sock, groupId, leaders.length
      ? `الصدارة ${title}:\n${leaders.map((entry, index) => `${index + 1}. ${entry.name} — ${Number(entry.score).toLocaleString("ar")}`).join("\n")}`
      : `لا توجد نتائج للصدارة ${title} بعد.`);
  }

  if (commandToken === ".متجر") {
    const group = await groupWorldService.getGroup(groupId);
    const pets = group.catalogs.pets.filter((pet) => pet.enabled !== false);
    const items = group.catalogs.items.filter((item) => item.enabled !== false).slice(0, 10);
    return sendText(sock, groupId, [
      "متجر عالم المجموعة",
      "الحيوانات — للشراء اكتب .شراء <معرّف>",
      ...pets.map((pet) => `${pet.icon} ${pet.name} — ${Number(pet.price).toLocaleString("ar")} · ${pet.id}`),
      "العناصر",
      ...items.map((item) => `${item.icon} ${item.name} — ${Number(item.price).toLocaleString("ar")} · ${item.id}`),
    ].join("\n"));
  }

  if (commandToken === ".شراء" && args) {
    const pet = profile.pets.find((item) => item.petId === args);
    if (pet) return sendText(sock, groupId, "تملك هذا الحيوان بالفعل.");
    const group = await groupWorldService.getGroup(groupId);
    if (group.catalogs.pets.some((item) => item.id === args && item.enabled !== false)) {
      const result = await groupWorldService.purchasePet(groupId, memberId, args, name);
      return sendText(sock, groupId, `تم شراء ${result.pet.name}. رصيدك ${result.balance.toLocaleString("ar")}.`);
    }
    const result = await groupWorldService.purchaseItem(groupId, memberId, args);
    return sendText(sock, groupId, `تم شراء ${result.item.name}. رصيدك ${result.balance.toLocaleString("ar")}.`);
  }

  if (commandToken === ".حيواني") {
    const pet = profile.activePet;
    return sendText(sock, groupId, pet
      ? `${pet.catalog?.icon || "🐾"} ${pet.catalog?.name || pet.petId} · المستوى ${pet.level}\nالقدرة: ${pet.catalog?.ability || "نشاط"}`
      : "ليس لديك حيوان نشط. استخدم .متجر لعرض الحيوانات.");
  }

  if (commandToken === ".قدرات" && argsList[0] === "الحيوان") {
    const petName = argsList.slice(1).join(" ");
    const pet = await groupWorldService.getPetAbilities(groupId, memberId, petName);
    if (!pet) {
      return sendText(sock, groupId, petName
        ? "لم أجد هذا الحيوان في كتالوج المجموعة."
        : "لا تملك حيوانًا نشطًا. استخدم .قدرات الحيوان <اسم> لعرض قدرات حيوان من الكتالوج.");
    }
    const value = pet.ability === "periodic"
      ? `${Number(pet.value).toLocaleString("ar")} نقطة`
      : `${Math.round(Number(pet.value) * 100)}%`;
    return sendText(sock, groupId, [
      `${pet.icon || "🐾"} ${pet.name} · ${pet.owned ? `المستوى ${pet.level}/${pet.maxLevel}` : "معروض في الكتالوج"}`,
      `السعر: ${Number(pet.price).toLocaleString("ar")} نقطة`,
      `القدرة: ${pet.abilityDescription} (${value} في المستوى الأساسي)`,
      `مستويات القدرة: ${pet.levels.map((item) => `${item.level}: ${item.value}${pet.ability === "periodic" ? " نقطة" : ""}`).join(" · ")}`,
      pet.nextUpgradeCost ? `تكلفة الترقية التالية: ${pet.nextUpgradeCost.toLocaleString("ar")} نقطة` : "",
    ].filter(Boolean).join("\n"));
  }

  if (commandToken === ".حيواناتي") {
    return sendText(sock, groupId, profile.pets.length
      ? `حيواناتك:\n${profile.pets.map((pet) => `${pet.catalog?.icon || "🐾"} ${pet.catalog?.name || pet.petId} · مستوى ${pet.level}${profile.activePetId === pet.petId ? " (نشط)" : ""}`).join("\n")}`
      : "لا تملك حيوانات بعد.");
  }

  if (commandToken === ".تفعيل" && argsList[0] === "حيوان" && argsList[1]) {
    const result = await groupWorldService.activatePet(groupId, memberId, argsList[1]);
    return sendText(sock, groupId, `تم تغيير حيوانك النشط إلى ${result.activePetId}.`);
  }

  if (commandToken === ".ترقية" && ["حيواني", "حيوان"].includes(args)) {
    const result = await groupWorldService.upgradePet(groupId, memberId);
    return sendText(sock, groupId, `تمت الترقية إلى المستوى ${result.pet.level} مقابل ${result.cost.toLocaleString("ar")} نقطة.`);
  }

  if (commandToken === ".مهامي") {
    const group = await groupWorldService.getGroup(groupId);
    const dayKey = groupWorldDayKey(new Date());
    const weekKey = groupWorldWeekKey(new Date());
    const daily = group.settings.dailyTasks.map((task) => {
      const progress = profile.taskProgress?.daily?.[dayKey]?.[task.id]?.count || 0;
      return `• ${task.name}: ${Math.min(progress, task.target)}/${task.target} · ${task.reward} نقطة`;
    });
    const weekly = group.settings.weeklyTasks.map((task) => {
      const progress = profile.taskProgress?.weekly?.[weekKey]?.[task.id]?.count || 0;
      return `• ${task.name}: ${Math.min(progress, task.target)}/${task.target} · ${task.reward} نقطة`;
    });
    return sendText(sock, groupId, ["مهام اليوم:", ...daily, "مهام الأسبوع:", ...weekly].join("\n"));
  }

  if (commandToken === ".انجازاتي") {
    const names = {
      "first-message": "أول رسالة",
      "messages-100": "مئة رسالة",
      "messages-1000": "ألف رسالة",
      "streak-7": "سلسلة أسبوع",
      "pet-owner": "أول حيوان",
    };
    return sendText(sock, groupId, profile.achievements.length
      ? `إنجازاتك:\n${profile.achievements.map((item) => `🏅 ${names[item] || item}`).join("\n")}`
      : "لم تحصل على إنجازات بعد.");
  }

  if (commandToken === ".ملفي") {
    return sendText(sock, groupId, [
      `الملف الشخصي: ${profile.name || name || "عضو"}`,
      `${profile.rank?.icon || "⭐"} ${profile.rank?.name || "مبتدئ"} · المركز ${profile.position || "—"}`,
      `النقاط ${profile.balance} · XP ${profile.xp} · المستوى ${profile.level}`,
      `الرسائل ${profile.messages} · السلسلة ${profile.streak} يوم`,
      `المكتسب ${profile.totalEarned} · المصروف ${profile.totalSpent}`,
      `الحيوان ${profile.activePet?.catalog?.name || "لا يوجد"} · الإنجازات ${profile.achievements.length}`,
    ].join("\n"));
  }

  if (commandToken === ".عالمي") {
    const xo = profile.gameStats?.xo || { wins: 0, losses: 0, draws: 0 };
    const challenges = profile.gameStats?.challenges || { wins: 0, losses: 0, draws: 0 };
    const resources = Object.entries(profile.resources || {}).map(([key, value]) => `${key}: ${value}`).join(" · ") || "لا توجد موارد";
    return sendText(sock, groupId, [
      `🌍 عالم ${profile.name || name || "اللاعب"}`,
      `${profile.rank?.icon || "⭐"} ${profile.rank?.name || "مبتدئ"} · المركز ${profile.position || "—"}`,
      `النقاط ${profile.balance} · المستوى ${profile.level} · XP ${profile.xp}`,
      `الحيوان ${profile.activePet?.catalog?.name || "لا يوجد"} · النقابة ${profile.guildId || "لا يوجد"}`,
      `XO: ${xo.wins} فوز · ${xo.losses} خسارة · ${xo.draws} تعادل`,
      `التحديات: ${challenges.wins} فوز · ${challenges.losses} خسارة · ${challenges.draws} تعادل`,
      `الموارد: ${resources}`,
    ].join("\n"));
  }

  if (commandToken === ".حقيبتي") {
    const items = profile.inventory.map((item) => `${item.itemId} ×${item.quantity}`);
    const pets = profile.pets.map((pet) => `${pet.catalog?.icon || "🐾"} ${pet.catalog?.name || pet.petId}`);
    return sendText(sock, groupId, [
      "حقيبتك:",
      `الحيوانات: ${pets.length ? pets.join("، ") : "لا يوجد"}`,
      `المقتنيات: ${items.length ? items.join("، ") : "لا يوجد"}`,
      `اللقب: ${profile.titleItemId || "لا يوجد"} · الإطار: ${profile.frameItemId || "لا يوجد"}`,
    ].join("\n"));
  }

  if (commandToken === ".فريقي") {
    const team = (await groupWorldService.getGroup(groupId)).teams.find((item) => item.id === profile.teamId);
    return sendText(sock, groupId, team ? `فريقك: ${team.title}` : "لست ضمن فريق حاليًا.");
  }

  if (commandToken === ".الفرق") {
    const teams = (await groupWorldService.getOverview(groupId)).teams
      .sort((a, b) => b.balance - a.balance || b.members - a.members)
      .slice(0, 10);
    return sendText(sock, groupId, teams.length
      ? `ترتيب الفرق:\n${teams.map((team, index) => `${index + 1}. ${team.icon || "🛡️"} ${team.title} — ${team.balance.toLocaleString("ar")} نقطة · ${team.members} عضو`).join("\n")}`
      : "لا توجد فرق مسجلة في المجموعة.");
  }

  if (commandToken === ".نقابة" && argsList[0] === "إنشاء") {
    const guild = await groupWorldService.createGuild(groupId, memberId, argsList.slice(1).join(" "));
    return sendText(sock, groupId, `تم إنشاء النقابة ${guild.icon} ${guild.title}\nالمعرّف: ${guild.id}\nيمكن للأعضاء الانضمام عبر .نقابة انضمام ${guild.id}`);
  }

  if (commandToken === ".نقابة" && ["انضمام", "انضم"].includes(argsList[0])) {
    if (!argsList[1]) return sendText(sock, groupId, "استخدم: .نقابة انضمام <معرّف النقابة>");
    const guild = await groupWorldService.joinGuild(groupId, memberId, argsList[1]);
    return sendText(sock, groupId, `انضممت إلى ${guild.icon} ${guild.title}.`);
  }

  if (commandToken === ".نقابتي") {
    const guild = (await groupWorldService.getGuilds(groupId)).find((item) => item.members.includes(memberId));
    return sendText(sock, groupId, guild
      ? `${guild.icon} ${guild.title}\nالمستوى ${guild.level} · الأعضاء ${guild.membersCount} · الترتيب ${guild.score.toLocaleString("ar")} نقطة`
      : "لست في نقابة. استخدم .النقابات لعرض النقابات المتاحة.");
  }

  if (commandToken === ".النقابات") {
    const guilds = await groupWorldService.getGuilds(groupId);
    return sendText(sock, groupId, guilds.length
      ? `ترتيب النقابات:\n${guilds.slice(0, 10).map((guild, index) => `${index + 1}. ${guild.icon} ${guild.title} · ${guild.membersCount} عضو · ${guild.score.toLocaleString("ar")} نقطة · ${guild.id}`).join("\n")}`
      : "لا توجد نقابات حتى الآن. أنشئ واحدة عبر .نقابة إنشاء <الاسم>.");
  }

  if (commandToken === ".صناعة") {
    const group = await groupWorldService.getGroup(groupId);
    const recipes = group.settings.gameplay.crafting.recipes || [];
    if (!args) {
      return sendText(sock, groupId, [
        `مواردك: ${Object.entries(profile.resources || {}).map(([key, value]) => `${key} ${value}`).join(" · ") || "لا توجد"}`,
        "الوصفات:",
        ...recipes.map((recipe) => `${recipe.name} — .صناعة ${recipe.id} · يحتاج ${Object.entries(recipe.costs).map(([key, value]) => `${key} ${value}`).join(" و ")}`),
      ].join("\n"));
    }
    const result = await groupWorldService.craftItem(groupId, memberId, argsList[0]);
    return sendText(sock, groupId, `صنعت ${result.recipe.name} بنجاح.`);
  }

  if (commandToken === ".تحدي") {
    const mentioned = message?.message?.extendedTextMessage?.contextInfo?.mentionedJid || [];
    if (!mentioned.length) return sendText(sock, groupId, "استخدم: .تحدي @الشخص");
    const metadata = await sock.groupMetadata(groupId);
    const opponent = (metadata.participants || []).find((item) =>
      [item.id, item.jid, item.pn, item.lid].some((value) => sameMember(value, mentioned[0]))
    );
    if (!opponent) return sendText(sock, groupId, "يجب أن يكون الخصم عضوًا حاليًا في المجموعة.");
    const opponentId = opponent.id || opponent.jid || opponent.pn || opponent.lid;
    await groupWorldService.ensureMember(groupId, opponentId, opponent.notify || opponent.name || "");
    const stake = Number(argsList.find((item) => /^\d+$/.test(item)));
    if (Number.isInteger(stake) && stake > 0) {
      const challenge = await groupWorldService.createChallenge(groupId, memberId, opponentId, stake, memberId);
      return sendText(sock, groupId, `تم إنشاء تحدي الرهان ${challenge.id} بمبلغ ${stake}. اكتب .قبول ${challenge.id} لقبوله.`);
    }
    const challenge = await groupWorldService.createMemberChallenge(groupId, memberId, opponentId, {
      challenger: profile.name || name,
      opponent: opponent.notify || opponent.name || "",
    });
    return sendNativeInteractive(sock, groupId, {
      text: `تحدي جديد: ${challenge.typeLabel}\n${challenge.name}\n${profile.name || "عضو"} تحدّى ${opponent.notify || opponent.name || "عضواً"}.\nعلى المستهدف القبول أو الرفض.`,
      buttons: [
        { id: `gw:challenge:accept:${challenge.name}`, title: "قبول التحدي" },
        { id: `gw:challenge:reject:${challenge.name}`, title: "رفض التحدي" },
      ],
    });
  }

  if (commandToken === ".قبول" && args) {
    const mentioned = message?.message?.extendedTextMessage?.contextInfo?.mentionedJid || [];
    const challengeName = argsList.find((item) => item.startsWith("THE_LEGENDARY_"));
    if (challengeName) {
      if (!mentioned.length) return sendText(sock, groupId, "استخدم: .قبول @المتحدي اسم_التحدي");
      const open = await groupWorldService.listMemberChallenges(groupId, memberId);
      const challengeFromMentioned = open.find((item) => item.name === challengeName && sameMember(item.challenger, mentioned[0]));
      if (!challengeFromMentioned) return sendText(sock, groupId, "اسم التحدي أو منشن المتحدي غير مطابق.");
      const challenge = await groupWorldService.acceptMemberChallenge(groupId, challengeName, memberId);
      return sendText(sock, groupId, `قُبل ${challenge.name} — ${challenge.typeLabel}.\n${challenge.prompt}\nأرسل: .إجابة ${challenge.name} <إجابتك>`);
    }
    const challenge = await groupWorldService.acceptChallenge(groupId, args, memberId);
    return sendText(sock, groupId, `قُبل تحدي الرهان ${challenge.id}. يستطيع المشرف تسويته بعد انتهائه.`);
  }

  if (commandToken === ".رفض") {
    const mentioned = message?.message?.extendedTextMessage?.contextInfo?.mentionedJid || [];
    if (!mentioned.length) return sendText(sock, groupId, "استخدم: .رفض @المتحدي");
    const open = await groupWorldService.listMemberChallenges(groupId, memberId);
    const challenge = open.find((item) => item.status === "open" && sameMember(item.challenger, mentioned[0]));
    if (!challenge) return sendText(sock, groupId, "لا يوجد تحدٍ مفتوح من هذا العضو.");
    await groupWorldService.rejectMemberChallenge(groupId, challenge.name, memberId);
    return sendText(sock, groupId, `تم رفض ${challenge.name}.`);
  }

  if (commandToken === ".تحدياتي") {
    const challenges = await groupWorldService.listMemberChallenges(groupId, memberId);
    if (!challenges.length) return sendText(sock, groupId, "لا توجد تحديات مفتوحة لك.");
    for (const challenge of challenges) {
      const text = `${challenge.name}\n${challenge.typeLabel} · الحالة: ${challenge.status}\n${challenge.prompt || ""}`;
      if (challenge.status === "open" && challenge.opponent === memberId) {
        await sendNativeInteractive(sock, groupId, {
          text,
          buttons: [
            { id: `gw:challenge:accept:${challenge.name}`, title: "قبول التحدي" },
            { id: `gw:challenge:reject:${challenge.name}`, title: "رفض التحدي" },
          ],
        });
      } else {
        await sendText(sock, groupId, text);
      }
    }
    return { sent: true };
  }

  if (commandToken === ".إلغاء" && argsList[0] === "التحدي") {
    const challenge = await groupWorldService.cancelMemberChallenge(groupId, memberId, argsList[1] || "");
    return sendText(sock, groupId, `تم إلغاء ${challenge.name}.`);
  }

  if (commandToken === ".إجابة" && args) {
    const challengeName = argsList[0];
    if (!challengeName?.startsWith("THE_LEGENDARY_") || argsList.length < 2) {
      return sendText(sock, groupId, "استخدم: .إجابة اسم_التحدي إجابتك");
    }
    const answer = argsList.slice(1).join(" ");
    const result = await groupWorldService.answerMemberChallenge(groupId, challengeName, memberId, answer);
    if (result.expired) return sendText(sock, groupId, "انتهى الوقت؛ انتهى التحدي بالتعادل.");
    return sendText(sock, groupId, result.correct
      ? `إجابة صحيحة! فزت بالتحدي ${challengeName} وحصلت على ${result.challenge.rewards?.points || 0} نقطة و${result.challenge.rewards?.xp || 0} XP.`
      : "إجابة غير صحيحة. بقي وقت للمحاولة بإجابة مختلفة.");
  }

  if (commandToken === ".زعيم") {
    if (argsList[0] === "هجوم") {
      const result = await groupWorldService.attackBoss(groupId, memberId, profile.name || name);
      return sendText(sock, groupId, result.defeated
        ? `🏆 هُزم ${result.boss.title} المستوى ${result.boss.level}! شارك ${result.boss.winnerIds.length} أعضاء وحصلوا على مكافآتهم.`
        : `⚔️ ساهمت بـ${result.damage} ضرر على ${result.boss.title}.\nالصحة: ${result.boss.health}/${result.boss.maxHealth}\nللمساهمة اكتب .زعيم هجوم`);
    }
    const boss = await groupWorldService.getBossRaid(groupId);
    return sendText(sock, groupId, `👹 ${boss.title} · المستوى ${boss.level}\nالصحة: ${boss.health}/${boss.maxHealth}\nالمساهمون: ${Object.keys(boss.contributions || {}).length}\nاكتب .زعيم هجوم للمشاركة.`);
  }

  if (commandToken === ".كنز") {
    const hunt = await groupWorldService.startTreasureHunt(groupId, memberId);
    return sendText(sock, groupId, `🗺️ البحث عن الكنز بدأ!\n${hunt.prompt}\nأرسل الحل عبر: .حل <الإجابة>`);
  }

  if (commandToken === ".حل" && args) {
    const result = await groupWorldService.solveTreasureHunt(groupId, memberId, args);
    return sendText(sock, groupId, result.correct
      ? `🎉 عثرت على الكنز! حصلت على ${result.reward.points} نقطة و${result.reward.xp} XP.`
      : "ليست الإجابة الصحيحة. جرّب حلاً مختلفاً.");
  }

  if (commandToken === ".مغامرة") {
    const dungeon = await groupWorldService.startDungeon(groupId, memberId);
    return sendText(sock, groupId, `🏰 مغامرتك بدأت — المرحلة ${dungeon.stage}/${dungeon.totalStages}\n${dungeon.prompt}\nأرسل: .حل_المغامرة <الإجابة>`);
  }

  if (commandToken === ".حل_المغامرة" && args) {
    const result = await groupWorldService.answerDungeon(groupId, memberId, args);
    if (!result.correct) return sendText(sock, groupId, "إجابة غير صحيحة. جرّب إجابة مختلفة قبل انتهاء المغامرة.");
    if (result.completed) return sendText(sock, groupId, `🏆 أكملت الأبراج المحصنة وحصلت على ${result.reward.points} نقطة و${result.reward.xp} XP.`);
    return sendText(sock, groupId, `✅ نجحت! المرحلة ${result.stage}/${result.totalStages}\n${result.prompt}\nأرسل: .حل_المغامرة <الإجابة>`);
  }

  if (commandToken === ".صيد" && argsList[0] === "الكلمات") {
    const hunt = await groupWorldService.startWordHunt(groupId, memberId);
    return sendText(sock, groupId, `🔎 صيد الكلمات بدأ!\nالتلميح: ${hunt.clue}\nأرسل: .كلمة <الإجابة>`);
  }

  if (commandToken === ".كلمة" && args) {
    const result = await groupWorldService.answerWordHunt(groupId, memberId, args);
    return sendText(sock, groupId, result.correct
      ? `🎉 اكتشفت الكلمة وحصلت على ${result.reward.points} نقطة و${result.reward.xp} XP.`
      : "ليست الكلمة الصحيحة. جرّب كلمة مختلفة.");
  }

  if (commandToken === ".عجلة") {
    const result = await groupWorldService.spinLuckyWheel(groupId, memberId);
    return sendText(sock, groupId, `🎡 جائزة افتراضية: ${result.prize} نقطة · أضيف إلى رصيدك ${result.credited} نقطة. المحاولات المتبقية اليوم: ${result.remaining}.`);
  }

  if (commandToken === ".بطولتي") {
    if (argsList[0] === "إنشاء") {
      const permitted = isBotOwner || await groupWorldService.hasPermission(groupId, memberId, "settings");
      if (!permitted) return sendText(sock, groupId, "إنشاء البطولة متاح لمالك البوت أو للمشغّل المخوّل.");
      const mode = argsList[1] === "جماعية" ? "guild" : "individual";
      const title = argsList.slice(mode === "guild" ? 2 : 1).join(" ") || "دوري الأبطال";
      const tournament = await groupWorldService.createTournament(groupId, title, memberId, mode);
      return sendText(sock, groupId, `تم إنشاء ${mode === "guild" ? "بطولة نقابات" : "بطولة فردية"}: ${tournament.title}\nالمعرّف: ${tournament.id}\nالتسجيل: .بطولتي تسجيل`);
    }
    if (argsList[0] === "تسجيل") {
      const tournament = await groupWorldService.joinTournament(groupId, argsList[1] || null, memberId);
      return sendText(sock, groupId, `تم تسجيلك في ${tournament.title}.`);
    }
    if (argsList[0] === "بدء") {
      const permitted = isBotOwner || await groupWorldService.hasPermission(groupId, memberId, "settings");
      if (!permitted) return sendText(sock, groupId, "بدء البطولة متاح لمالك البوت أو للمشغّل المخوّل.");
      const tournament = await groupWorldService.startTournament(groupId, argsList[1], memberId);
      return sendText(sock, groupId, `انطلقت ${tournament.title}. اكتب .بطولتي لعب لبدء مباراتك.`);
    }
    if (argsList[0] === "لعب") {
      const current = await groupWorldService.getTournamentMatchForMember(groupId, memberId);
      if (!current) return sendText(sock, groupId, "لا توجد لك مباراة حالية في بطولة نشطة.");
      if (current.match.status === "active") {
        const activeGame = (await groupWorldService.getGroup(groupId)).games.find((item) => item.id === current.match.gameId);
        return activeGame ? sendXoBoard(sock, groupId, activeGame) : sendText(sock, groupId, "تعذّر استعادة لوحة المباراة.");
      }
      const [firstId, secondId] = current.match.players;
      const entries = current.tournament.entries;
      const first = entries.find((entry) => entry.id === firstId);
      const second = entries.find((entry) => entry.id === secondId);
      if (!first || !second) return sendText(sock, groupId, "بيانات طرفي المباراة غير مكتملة.");
      const xPlayer = first.captain;
      const oPlayer = second.captain;
      if (![xPlayer, oPlayer].includes(memberId)) return sendText(sock, groupId, "بدء مباراة النقابة متاح لقائد كل نقابة.");
      const game = await groupWorldService.startTicTacToe(groupId, xPlayer, oPlayer, { x: first.label, o: second.label });
      await groupWorldService.attachTournamentGame(groupId, current.tournament.id, current.match.id, game.id, {
        [xPlayer]: first.id,
        [oPlayer]: second.id,
      });
      return sendXoBoard(sock, groupId, game);
    }
    const tournaments = await groupWorldService.getTournamentStatus(groupId);
    return sendText(sock, groupId, tournaments.length
      ? tournaments.slice(-5).reverse().map((item) => `${item.title} · ${item.mode === "guild" ? "جماعية" : "فردية"} · ${item.status} · ${item.entries.length} مشارك · ${item.championId ? `البطل ${item.championId}` : item.status === "registration" ? `سجّل عبر .بطولتي تسجيل` : "اكتب .بطولتي لعب"}`).join("\n")
      : "لا توجد بطولات. يستطيع مالك البوت إنشاء بطولة من الأمر أو لوحة المطور.");
  }

  if (commandToken === ".حسم" && args) {
    const mentioned = message?.message?.extendedTextMessage?.contextInfo?.mentionedJid || [];
    if (!mentioned.length) return sendText(sock, groupId, "استخدم منشن الفائز، مثل: .حسم <معرّف التحدي> @الفائز");
    const metadata = await sock.groupMetadata(groupId);
    if (!(await canManageFromChat(groupId, message, memberId, metadata, "points", sock, isBotOwner))) {
      return sendText(sock, groupId, "تسوية التحدي متاحة لمشرفي المجموعة أو المشرفين المخوّلين فقط.");
    }
    const challengeId = argsList.find((item) => item.startsWith("challenge-"));
    if (!challengeId) return sendText(sock, groupId, "أضف معرّف التحدي قبل منشن الفائز.");
    const settled = await groupWorldService.settleChallenge(groupId, challengeId, mentioned[0], memberId);
    return sendText(sock, groupId, `تمت تسوية ${settled.challenge.id} لصالح الفائز.`);
  }

  if (commandToken === ".قائمة") {
    return sendNativeInteractive(sock, groupId, {
      text: "اضغط الزر لفتح قائمة عالم المجموعات التفاعلية.",
      buttons: [{ id: "gw:list:open", title: "📋 فتح القائمة" }],
    });
  }

  if (commandToken === ".تحديث" && args === "القائمة") {
    const metadata = await sock.groupMetadata(groupId);
    if (!(await canManageFromChat(groupId, message, memberId, metadata, "members", sock, isBotOwner))) {
      return sendText(sock, groupId, "هذا الأمر متاح لمشرفي المجموعة فقط.");
    }
    const members = (metadata.participants || []).map((item) => ({
      memberId: item.id || item.jid || item.pn || item.lid,
      name: item.notify || item.name || "",
    })).filter((item) => item.memberId);
    const result = await groupWorldService.refreshSlots(groupId, members, memberId);
    return sendText(sock, groupId, `تم تحديث القائمة وإعادة ترقيم ${result.slots.length} عضوًا.`);
  }

  if (commandToken === ".تزويد") {
    const [slotNumber, rawAmount, ...reasonParts] = argsList;
    const amount = Number(rawAmount);
    if (!/^\d+$/.test(slotNumber || "") || !Number.isInteger(amount) || amount === 0) {
      return sendText(sock, groupId, "استخدم: .تزويد <رقم الخانة> <المبلغ>، ويمكن أن يكون المبلغ سالبًا للخصم.");
    }
    const metadata = await sock.groupMetadata(groupId);
    const permitted = await canManageFromChat(groupId, message, memberId, metadata, "points", sock, isBotOwner);
    if (!permitted) return sendText(sock, groupId, "هذا الأمر متاح لمشرفي المجموعة أو المشرفين المخوّلين فقط.");
    const target = await groupWorldService.getSlotMember(groupId, Number(slotNumber));
    const current = (metadata.participants || []).some((item) =>
      [item.id, item.jid, item.pn, item.phoneNumber, item.lid].some((value) => sameMember(value, target.memberId))
    );
    if (!current) {
      await groupWorldService.markMemberLeft(groupId, target.memberId);
      return sendText(sock, groupId, "الخانة فارغة لأن صاحبها غادر المجموعة؛ لم تُنفّذ العملية.");
    }
    const result = await groupWorldService.adjustSlot(
      groupId,
      Number(slotNumber),
      amount,
      memberId,
      reasonParts.join(" ") || "تعديل عبر أمر القائمة",
    );
    return sendText(sock, groupId, `${amount > 0 ? "أُضيفت" : "خُصمت"} ${Math.abs(amount)} نقطة من الخانة ${slotNumber}. الرصيد ${result.member.balance}.`);
  }

  if (commandToken === ".كل" && args === "الاكواد") {
    const commands = await groupWorldService.getPublicCommands(groupId);
    return sendText(sock, groupId, `الأوامر:\n${commands.join(" · ")}`);
  }

  const group = await groupWorldService.getGroup(groupId);
  const customDefinition = group.commands.find((item) =>
    item.enabled && item.name.toLowerCase() === commandToken.toLowerCase()
  );
  const custom = await groupWorldService.runCustomCommand(
    groupId,
    commandToken,
    await getTemplateValues(
      sock,
      groupId,
      memberId,
      profile,
      Boolean(customDefinition?.response?.includes("_img")),
    ),
  );
  if (custom) {
    if (custom.buttons.length) {
      const buttons = custom.buttons.slice(0, 10).map((button) => ({
        id: rememberInteractiveAction({ groupId, response: button.response }),
        title: button.label,
      }));
      return sendNativeInteractive(sock, groupId, {
        text: custom.text,
        buttons,
        image: custom.image,
      });
    }
    if (custom.image) {
      await sock.sendMessage(groupId, {
        image: { url: custom.image },
        caption: String(custom.text || "").slice(0, MAX_REPLY_LENGTH),
      });
      return { sent: true, image: true };
    }
    return sendText(sock, groupId, custom.text);
  }
  return null;
}

export async function handleGroupWorldMessage(userId, sock, message, eventType = "") {
  const groupId = String(message?.key?.remoteJid || "");
  if (!GROUP_ID_PATTERN.test(groupId)) return null;
  const text = messageText(message);
  const interactionId = messageInteractionId(message);
  const fromMe = message?.key?.fromMe === true;
  if (fromMe && (eventType !== "notify" || !text.startsWith("."))) return null;
  if (fromMe && !(await isCurrentSocketOwnerMessage(groupId, sock, message))) return null;
  const memberId = fromMe
    ? await ownerMemberId(groupId, sock, message)
    : accountIdFromMessage(message);
  if (!memberId || (!text && !interactionId)) return null;

  try {
    if (interactionId) {
      const eventId = String(message?.key?.id || "");
      const dedupeKey = `${groupId}:${eventId}`;
      if (eventId && commandEvents.has(dedupeKey)) return { duplicate: true };
      if (eventId) {
        commandEvents.set(dedupeKey, Date.now());
        if (commandEvents.size > 10_000) {
          const cutoff = Date.now() - 10 * 60_000;
          for (const [key, at] of commandEvents) if (at < cutoff) commandEvents.delete(key);
        }
      }
      return await handleGroupWorldInteraction(String(userId), sock, groupId, memberId, interactionId);
    }
    if ([".تفعيل العالم", ".تعطيل العالم"].includes(text.trim())) {
      return await handleWorldToggle(userId, sock, message, groupId, memberId, text, fromMe);
    }
    if (text.startsWith(".")) {
      const eventId = String(message?.key?.id || "");
      const dedupeKey = `${groupId}:${eventId}`;
      if (eventId && commandEvents.has(dedupeKey)) return { duplicate: true };
      if (eventId) {
        commandEvents.set(dedupeKey, Date.now());
        if (commandEvents.size > 10_000) {
          const cutoff = Date.now() - 10 * 60_000;
          for (const [key, at] of commandEvents) {
            if (at < cutoff) commandEvents.delete(key);
          }
          while (commandEvents.size > 10_000) commandEvents.delete(commandEvents.keys().next().value);
        }
      }
      const group = await groupWorldService.getGroup(groupId);
      const commandParts = text.trim().split(/\s+/);
      const commandToken = commandParts[0];
      const commandName = commandParts.slice(0, 2).join(" ");
      if (group.commandSettings?.[commandName] === false || group.commandSettings?.[commandToken] === false) {
        return sendText(sock, groupId, `الأمر ${commandToken} متوقف لهذه المجموعة.`);
      }
      const botOwner = fromMe && await isGroupWorldOwner(groupId, userId, sock);
      return await commandReply(sock, groupId, memberId, message, text, botOwner);
    }
    const result = await groupWorldService.processMessage({
      groupId,
      memberId,
      name: message?.pushName || "",
      text,
      messageId: message?.key?.id,
      timestamp: message?.messageTimestamp
        ? new Date(Number(message.messageTimestamp) * 1_000)
        : new Date(),
      fromMe: false,
    });
    if (result?.shouldWarn) {
      const group = await groupWorldService.getGroup(groupId);
      const template = group.settings.messageTemplates?.spamWarning;
      if (template) {
        const profile = await groupWorldService.getMemberProfile(groupId, memberId);
        await sendTemplate(
          sock,
          groupId,
          template,
          await getTemplateValues(sock, groupId, memberId, profile, template.includes("_img")),
        );
      } else {
        await sendText(sock, groupId, `تنبيه: تكرار رسائل غير طبيعي. تم تسجيل المخالفة وخصم ${result.penalty} نقطة.`);
      }
    }
    if (result?.shouldKick && typeof sock.groupParticipantsUpdate === "function") {
      try {
        const metadata = await sock.groupMetadata(groupId);
        if (ownAccountIsAdmin(sock, metadata)) {
          await sock.groupParticipantsUpdate(groupId, [memberId], "remove");
          await sendText(sock, groupId, "تمت محاولة إزالة عضو بعد تجاوز حد مخالفات السبام.");
        }
      } catch {
        // Do not stop message processing when the current account lacks group moderation rights.
      }
    }
    return result;
  } catch (error) {
    if (text.startsWith(".") || interactionId) {
      await sendText(sock, groupId, error?.message || "تعذّر تنفيذ الأمر.");
    }
    _deps.logger?.warn?.({ err: String(error), userId, groupId }, "Group World message failed");
    return null;
  }
}

export async function handleGroupWorldParticipants(userId, sock, event) {
  const groupId = String(event?.id || "");
  if (!GROUP_ID_PATTERN.test(groupId)) return;
  const action = String(event?.action || "");
  const participants = Array.isArray(event?.participants) ? event.participants : [];
  try {
    if (action === "add") {
      const author = event?.author || event?.participant || null;
      for (const participant of participants) {
        const memberId = typeof participant === "string"
          ? participant
          : participant?.id || participant?.jid || participant?.pn || participant?.lid;
        if (!memberId) continue;
        const dedupeKey = `${groupId}:${action}:${memberId}:${author || ""}`;
        const previous = participantEvents.get(dedupeKey);
        if (previous && Date.now() - previous < 60_000) continue;
        participantEvents.set(dedupeKey, Date.now());
        if (participantEvents.size > 10_000) {
          const cutoff = Date.now() - 60_000;
          for (const [key, at] of participantEvents) if (at < cutoff) participantEvents.delete(key);
          while (participantEvents.size > 10_000) participantEvents.delete(participantEvents.keys().next().value);
        }
        await groupWorldService.markMemberJoined(groupId, {
          memberId,
          name: typeof participant === "object" ? participant.notify || participant.name || "" : "",
        });
        if (author && !sameMember(author, memberId)) {
          await groupWorldService.rewardInvite({
            groupId,
            inviterId: author,
            invitedId: memberId,
            eventId: event?.id ? `${event.id}:${memberId}` : null,
          });
        }
        const group = await groupWorldService.getGroup(groupId);
        const welcome = group.settings.messageTemplates?.welcome;
        if (group.enabled && group.modules.messageTemplates && welcome) {
          await groupWorldService.ensureMember(groupId, memberId, typeof participant === "object" ? participant.notify || participant.name || "" : "");
          const profile = await groupWorldService.getMemberProfile(groupId, memberId);
          await sendTemplate(
            sock,
            groupId,
            welcome,
            await getTemplateValues(sock, groupId, memberId, profile, welcome.includes("_img")),
          );
        }
      }
    } else if (action === "remove" || action === "leave") {
      for (const participant of participants) {
        const memberId = typeof participant === "string"
          ? participant
          : participant?.id || participant?.jid || participant?.pn || participant?.lid;
        if (memberId) {
          const dedupeKey = `${groupId}:${action}:${memberId}`;
          const previous = participantEvents.get(dedupeKey);
          if (previous && Date.now() - previous < 60_000) continue;
          participantEvents.set(dedupeKey, Date.now());
          if (participantEvents.size > 10_000) {
            const cutoff = Date.now() - 60_000;
            for (const [key, at] of participantEvents) if (at < cutoff) participantEvents.delete(key);
            while (participantEvents.size > 10_000) participantEvents.delete(participantEvents.keys().next().value);
          }
          await groupWorldService.markMemberLeft(groupId, memberId);
        }
      }
    }
  } catch (error) {
    _deps.logger?.warn?.({ err: String(error), userId, groupId, action }, "Group World participant update failed");
  }
}

export { groupWorldService };
