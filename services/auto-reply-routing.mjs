import { randomBytes } from 'node:crypto';

// Keep our own replies out of the fromMe trigger path, even if WhatsApp
// subsequently emits them as notify events. Entries expire to bound memory.
const generated = new Map();
const TTL = 10 * 60 * 1000;
export function isGeneratedAutoReply(id, now = Date.now()) {
  for (const [key, expires] of generated) if (expires <= now) generated.delete(key);
  return !!id && generated.has(id);
}
export function protectAutoReplySocket(sock) {
  return new Proxy(sock, {
    get(target, prop) {
      if (prop === 'sendMessage') return async (jid, content, options = {}) => {
        const id = options.messageId || randomBytes(10).toString('hex').toUpperCase();
        isGeneratedAutoReply(null);
        generated.set(id, Date.now() + TTL);
        return target.sendMessage(jid, content, { ...options, messageId: id });
      };
      const value = Reflect.get(target, prop, target);
      return typeof value === 'function' ? value.bind(target) : value;
    },
  });
}
export function matchesReplyTarget(rule, msg) {
  if (msg?.key?.fromMe) return rule.target === 'self';
  if (rule.target === 'self') return false;
  if (!rule.target || rule.target === 'all') return true;
  if (rule.target === 'specific' || rule.target === 'multiple') {
    const jid = msg.key?.participantAlt || msg.key?.participant || msg.key?.remoteJid || '';
    const number = jid.split('@')[0].split(':')[0].replace(/\D/g, '');
    return !!number && (rule.targetNumbers || []).some(n => String(n).replace(/\D/g, '') === number);
  }
  return false;
}
