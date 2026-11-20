let baileysForTests = null;

export function setInteractiveBaileysForTests(baileys) {
  baileysForTests = baileys;
}

function unwrapMessage(rawMessage) {
  let message = rawMessage?.message || rawMessage || {};
  for (let depth = 0; depth < 8; depth += 1) {
    const wrapped =
      message.ephemeralMessage?.message ||
      message.viewOnceMessage?.message ||
      message.viewOnceMessageV2?.message ||
      message.viewOnceMessageV2Extension?.message ||
      message.documentWithCaptionMessage?.message;
    if (!wrapped || wrapped === message) break;
    message = wrapped;
  }
  return message;
}

export function extractInteractiveResponseId(rawMessage) {
  const message = unwrapMessage(rawMessage);
  const nativeFlow = message.interactiveResponseMessage?.nativeFlowResponseMessage;
  let params = {};
  if (typeof nativeFlow?.paramsJson === "string") {
    try {
      params = JSON.parse(nativeFlow.paramsJson);
    } catch {
      params = {};
    }
  } else if (nativeFlow?.paramsJson && typeof nativeFlow.paramsJson === "object") {
    params = nativeFlow.paramsJson;
  }

  const candidates = [
    params.id,
    params.selectedRowId,
    params.selected_id,
    params.selectedId,
    params.row_id,
    params.button_id,
    params.selection_id,
    message.buttonsResponseMessage?.selectedButtonId,
    message.templateButtonReplyMessage?.selectedId,
    message.listResponseMessage?.singleSelectReply?.selectedRowId,
  ];
  return candidates.find((value) => typeof value === "string" && value.trim())?.trim() || "";
}

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
      merchant_url: parsed.toString(),
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

function buildBizNode() {
  return {
    tag: "biz",
    attrs: {
      actual_actors: "2",
      host_storage: "2",
      privacy_mode_ts: String(Math.floor(Date.now() / 1_000)),
    },
    content: [{
      tag: "interactive",
      attrs: { type: "native_flow", v: "1" },
      content: [{
        tag: "native_flow",
        attrs: { v: "9", name: "mixed" },
      }],
    }],
  };
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
  const { proto, generateWAMessageFromContent } = baileysForTests ||
    await import("@whiskeysockets/baileys");
  const interactiveMessage = proto.Message.InteractiveMessage.create({
    header: proto.Message.InteractiveMessage.Header.create({
      title: String(options.headerTitle || "عالم المجموعات").slice(0, 60),
      hasMediaAttachment: Boolean(imageMessage),
      ...(imageMessage ? { imageMessage } : {}),
    }),
    body: proto.Message.InteractiveMessage.Body.create({
      text: String(options.text || "اختر من الخيارات").slice(0, 3_500),
    }),
    footer: proto.Message.InteractiveMessage.Footer.create({
      text: String(options.footer || "عالم المجموعات").slice(0, 60),
    }),
    nativeFlowMessage: proto.Message.InteractiveMessage.NativeFlowMessage.create({
      buttons: buttons.map((button) =>
        proto.Message.InteractiveMessage.NativeFlowMessage.NativeFlowButton.create({
          name: button.name,
          buttonParamsJson: button.buttonParamsJson,
        })
      ),
      messageParamsJson: "{}",
      messageVersion: 1,
    }),
  });
  const generated = generateWAMessageFromContent(
    chatId,
    {
      viewOnceMessage: {
        message: {
          messageContextInfo: { deviceListMetadata: {}, deviceListMetadataVersion: 2 },
          interactiveMessage,
        },
      },
    },
    {
      userJid: sock.user?.id,
      quoted: options.quoted || undefined,
    },
  );
  if (!generated?.message || !generated?.key?.id) {
    throw new Error("Baileys could not generate the interactive message");
  }
  const additionalNodes = [buildBizNode()];
  if (!String(chatId).endsWith("@g.us")) {
    additionalNodes.unshift({ tag: "bot", attrs: { biz_bot: "1" } });
  }
  const messageId = generated.key.id;
  await sock.relayMessage(chatId, generated.message, { messageId, additionalNodes });
  return { sent: true, interactive: true, messageId };
}
