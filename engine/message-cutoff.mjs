// A clean restart drops queued and replayed messages without touching WhatsApp chats.
const cutoffs = new Map();
export function setMessageCutoff(userId, at = Date.now()) {
  const key = String(userId);
  const cutoff = Math.max(cutoffs.get(key) || 0, Number(at) || 0);
  cutoffs.set(key, cutoff);
  return cutoff;
}
// A new cleanup must invalidate in-flight work even if two happen in the same millisecond.
export function advanceMessageCutoff(userId, at = Date.now()) {
  const old = getMessageCutoff(userId);
  return setMessageCutoff(userId, Math.max(Number(at) || 0, old + 1));
}
export function getMessageCutoff(userId) { return cutoffs.get(String(userId)) || 0; }
export function isMessageAfterCutoff(userId, message) {
  const cutoff = getMessageCutoff(userId);
  if (!cutoff) return true;
  const seconds = Number(message?.messageTimestamp);
  // Timestamp precision is seconds: discard the boundary second conservatively.
  return Number.isFinite(seconds) && seconds > Math.floor(cutoff / 1000);
}
// Best-effort fence against side effects from handlers that began before cleanup.
// Calls already sent to WhatsApp cannot be recalled.
const MUTATING_SOCKET_METHODS = new Set([
  'sendMessage', 'relayMessage', 'groupParticipantsUpdate', 'groupUpdateSubject',
  'groupUpdateDescription', 'groupSettingUpdate', 'groupToggleEphemeral',
  'groupRevokeInvite', 'groupAcceptInvite', 'groupLeave',
  'updateBlockStatus', 'updateProfilePicture', 'removeProfilePicture',
  'updateProfileName', 'updateProfileStatus', 'chatModify', 'sendPresenceUpdate',
  'readMessages', 'sendReceipt', 'sendReceipts',
]);
export function guardMessageSocket(sock, userId, message, generation) {
  return new Proxy(sock, {
    get(target, prop) {
      const value = Reflect.get(target, prop, target);
      if (typeof value !== 'function') return value;
      if (MUTATING_SOCKET_METHODS.has(prop)) {
        return (...args) => {
          if (getMessageCutoff(userId) !== generation || !isMessageAfterCutoff(userId, message)) return Promise.resolve(undefined);
          return value.apply(target, args);
        };
      }
      return value.bind(target);
    },
  });
}
