/**
 * services/auto-reply-buttons.mjs
 * ─────────────────────────
 * المسؤولية: إعداد وإرسال ردود واتسآب تفاعلية للأزرار، واختيار هدف الرد.
 * تعتمد على: services/interactive.js
 * Exports: parseAutoReplyButtonConfig, matchesAutoReplyTarget, sendAutoReplyButtons
 */

import { quickReply, sendInteractive } from "./interactive.js";

function normalizeJid(value) {
  return String(value || "").replace(/:[^@]+@/, "@").replace(/@c\.us$/u, "@s.whatsapp.net");
}

export function parseAutoReplyButtonConfig(text) {
  const lines = String(text || "")
    .replace(/\r\n?/gu, "\n")
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean);

  if (lines.length < 2) {
    throw new Error("أدخل نص الرد في السطر الأول، ثم زرًا واحدًا لكل سطر: عنوان|معرف");
  }

  const body = lines.shift();
  if (body.length > 3500) throw new Error("نص الرد يتجاوز 3500 حرف");
  if (lines.length > 10) throw new Error("الحد الأقصى 10 أزرار");

  const buttons = lines.map((line, index) => {
    const separator = line.indexOf("|");
    if (separator < 1) throw new Error(`تنسيق الزر رقم ${index + 1} غير صحيح: عنوان|معرف`);
    const label = line.slice(0, separator).trim();
    const id = line.slice(separator + 1).trim();
    if (!label || !id) throw new Error(`الزر رقم ${index + 1} يحتاج عنوانًا ومعرفًا`);
    return quickReply(label, `ar:${id}`);
  });

  return { text: body, buttons };
}

export function matchesAutoReplyTarget(rule, message, ownerJid = "") {
  const target = rule?.target || "all";
  const senderJid = normalizeJid(message?.key?.participant || message?.key?.participantAlt || message?.key?.remoteJid);

  if (target === "self") return Boolean(message?.key?.fromMe);
  if (target === "specific") {
    const numbers = Array.isArray(rule?.targetNumbers) ? rule.targetNumbers : [];
    return numbers.some((number) => senderJid === normalizeJid(`${number}@s.whatsapp.net`));
  }
  if (target === "multiple") {
    const numbers = Array.isArray(rule?.targetNumbers) ? rule.targetNumbers : [];
    return numbers.some((number) => senderJid === normalizeJid(`${number}@s.whatsapp.net`));
  }
  if (target === "all") return true;

  if (ownerJid) return senderJid === normalizeJid(ownerJid);
  return false;
}

export async function sendAutoReplyButtons(sock, chatId, text, { headerTitle = "⚡ الرد التلقائي", footer = "اختر أحد الخيارات" } = {}) {
  const config = parseAutoReplyButtonConfig(text);
  return sendInteractive(sock, chatId, {
    headerTitle,
    text: config.text,
    footer,
    buttons: config.buttons,
  });
}
