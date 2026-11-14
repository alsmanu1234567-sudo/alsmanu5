import { randomUUID } from "node:crypto";

function shortText(value, maxLength, field) {
  const text = String(value || "").trim();
  if (!text || text.length > maxLength) throw new Error(`${field} must be between 1 and ${maxLength} characters`);
  return text;
}

export function quickReply(displayText, id) {
  const buttonId = shortText(id, 256, "Quick reply ID");
  return {
    name: "quick_reply",
    buttonParamsJson: JSON.stringify({
      display_text: shortText(displayText, 25, "Quick reply label"),
      id: buttonId,
    }),
  };
}

export function listButton(displayText, sections) {
  if (!Array.isArray(sections) || sections.length < 1 || sections.length > 10) {
    throw new Error("A list needs between 1 and 10 sections");
  }
  const normalizedSections = sections.map((section) => {
    if (!Array.isArray(section?.rows) || section.rows.length < 1 || section.rows.length > 10) {
      throw new Error("Each list section needs between 1 and 10 rows");
    }
    return {
      title: shortText(section.title || "الخيارات", 24, "List section title"),
      rows: section.rows.map((row) => ({
        id: shortText(row.id, 256, "List row ID"),
        title: shortText(row.title, 24, "List row title"),
        description: String(row.description || "").slice(0, 72),
      })),
    };
  });
  return {
    name: "single_select",
    buttonParamsJson: JSON.stringify({
      title: shortText(displayText, 24, "List button label"),
      sections: normalizedSections,
    }),
  };
}

export function urlButton(displayText, url) {
  const label = shortText(displayText, 25, "URL button label");
  const parsed = new URL(String(url || ""));
  if (!["http:", "https:"].includes(parsed.protocol)) throw new Error("URL buttons only support HTTP or HTTPS links");
  return {
    name: "cta_url",
    buttonParamsJson: JSON.stringify({
      display_text: label,
      url: parsed.toString(),
    }),
  };
}

async function prepareImage(sock, chatId, image) {
  if (!image) return null;
  const { prepareWAMessageMedia } = await import("@whiskeysockets/baileys");
  if (typeof sock?.waUploadToServer !== "function") {
    throw new Error("The Baileys socket does not expose waUploadToServer for interactive images");
  }
  const media = await prepareWAMessageMedia(
    { image },
    { upload: sock.waUploadToServer.bind(sock), jid: chatId },
  );
  if (!media?.imageMessage) throw new Error("Baileys could not prepare the interactive image");
  return media.imageMessage;
}

export async function sendInteractive(sock, chatId, options = {}) {
  if (typeof sock?.relayMessage !== "function") {
    throw new Error("This Baileys socket cannot send interactive messages");
  }
  const buttons = Array.isArray(options.buttons) ? options.buttons : [];
  if (buttons.length < 1 || buttons.length > 10) {
    throw new Error("Interactive messages need between 1 and 10 buttons");
  }
  for (const button of buttons) {
    if (!button || typeof button.name !== "string" || typeof button.buttonParamsJson !== "string") {
      throw new Error("Use quickReply(), listButton(), or urlButton() to build each button");
    }
    JSON.parse(button.buttonParamsJson);
  }
  const imageMessage = options.imageMessage || await prepareImage(sock, chatId, options.image);
  const contextInfo = options.quoted?.key?.id
    ? {
        stanzaId: String(options.quoted.key.id),
        participant: options.quoted.key.participant || undefined,
        remoteJid: options.quoted.key.remoteJid || chatId,
      }
    : undefined;
  const messageId = randomUUID().replaceAll("-", "").slice(0, 20);
  const message = {
    viewOnceMessage: {
      message: {
        messageContextInfo: { deviceListMetadata: {}, deviceListMetadataVersion: 2 },
        interactiveMessage: {
          header: {
            title: String(options.headerTitle || "عالم المجموعات").slice(0, 60),
            hasMediaAttachment: Boolean(imageMessage),
            ...(imageMessage ? { imageMessage } : {}),
          },
          body: { text: String(options.text || "اختر من الخيارات").slice(0, 3_500) },
          footer: { text: String(options.footer || "عالم المجموعات").slice(0, 60) },
          nativeFlowMessage: { buttons },
          ...(contextInfo ? { contextInfo } : {}),
        },
      },
    },
  };
  await sock.relayMessage(chatId, message, { messageId });
  return { sent: true, interactive: true, messageId };
}
