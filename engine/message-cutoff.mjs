// A clean restart drops queued and replayed messages without touching WhatsApp chats.
const cutoffs = new Map();
export function setMessageCutoff(userId, at = Date.now()) {
  const key = String(userId);
  const cutoff = Math.max(cutoffs.get(key) || 0, Number(at) || 0);
  cutoffs.set(key, cutoff);
  return cutoff;
}
export function getMessageCutoff(userId) { return cutoffs.get(String(userId)) || 0; }
export function isMessageAfterCutoff(userId, message) {
  const cutoff = getMessageCutoff(userId);
  if (!cutoff) return true;
  const seconds = Number(message?.messageTimestamp);
  // Timestamp precision is seconds: discard the boundary second conservatively.
  return Number.isFinite(seconds) && seconds > Math.floor(cutoff / 1000);
}
export function guardMessageSocket(sock, userId, message, generation) {
  return new Proxy(sock, {
    get(target, prop) {
      const value = Reflect.get(target, prop, target);
      if (typeof value !== 'function') return value;
      if (prop === 'sendMessage' || prop === 'relayMessage' || prop === 'groupParticipantsUpdate') {
        return (...args) => {
          if (getMessageCutoff(userId) !== generation || !isMessageAfterCutoff(userId, message)) return Promise.resolve(undefined);
          return value.apply(target, args);
        };
      }
      return value.bind(target);
    },
  });
}
