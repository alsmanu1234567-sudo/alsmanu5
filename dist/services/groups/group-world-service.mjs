/**
 * Group World domain service: economy, profiles, pets, leaderboards and admin data.
 * Dependencies: group-world-store.mjs.
 * Exports: createGroupWorldService and safe template helpers.
 */

import { createGroupWorldStore, normalizeGroupId } from "./group-world-store.mjs";
import { randomUUID } from "node:crypto";

const TIME_ZONE = "Africa/Khartoum";
const MAX_LEDGER = 30_000;
const MAX_EVENT_IDS = 30_000;
const MAX_AUDIT = 10_000;
const MAX_VIOLATIONS = 5_000;
const LAUGHING_EMOJI = /[😂🤣😹😆😄😁]/u;
const BUILTIN_COMMANDS = [
  ".نقاطي", ".نقاط الكل", ".هدية", ".هدية اسبوعية", ".صدارة", ".متجر",
  ".حيواني", ".حيواناتي", ".ترقية حيواني", ".مهامي", ".انجازاتي", ".ملفي",
  ".حقيبتي", ".كل الاكواد", ".شراء", ".تفعيل حيوان", ".فريقي", ".تحدي",
  ".قبول", ".رفض", ".تحدياتي", ".إلغاء التحدي", ".إجابة", ".حسم",
  ".قائمة", ".مساعدة", ".العاب", ".الألعاب", ".اكس_او", ".عالمي",
  ".قدرات الحيوان", ".الفرق", ".مغامرة", ".كنز", ".زعيم",
  ".بطولتي", ".بطولة", ".نقابة", ".نقابتي", ".النقابات", ".صناعة", ".صيد الكلمات",
  ".كلمة", ".حل", ".حل_المغامرة", ".عجلة", ".تعطيل العالم", ".تفعيل العالم", ".تحديث القائمة", ".تزويد",
];

const DEFAULT_CHALLENGE_QUESTIONS = [
  { type: "trivia", label: "معلومات عامة", prompt: "ما عاصمة كندا؟", answer: "اوتاوا" },
  { type: "math", label: "سرعة الرياضيات", prompt: "احسب بسرعة: 7 × 8 + 4", answer: "60" },
  { type: "riddle", label: "ألغاز", prompt: "شيء كلما أخذت منه كبر، ما هو؟", answer: "الحفره" },
  { type: "emoji", label: "تخمين الإيموجي", prompt: "خمّن الكلمة: 🐝 + 🍯", answer: "عسل" },
  { type: "scramble", label: "الكلمات المبعثرة", prompt: "رتّب الحروف لتكوّن كلمة: باتك", answer: "كتاب" },
  { type: "memory", label: "الذاكرة", prompt: "ما الكلمة الثانية في هذا التسلسل؟ شمس — قمر — نجم", answer: "قمر" },
  { type: "speed", label: "سرعة الإجابة", prompt: "ما العدد الذي يأتي بعد 99؟", answer: "100" },
  { type: "letters", label: "ترتيب الحروف", prompt: "رتّب الحروف لتكوّن لوناً: ر — ض — خ — أ", answer: "اخضر" },
  { type: "hidden", label: "الكلمة المخفية", prompt: "أكمل الكلمة: م _ ت _ ب ة", answer: "مكتبه" },
  { type: "quiz", label: "أسئلة متتالية", prompt: "كم ضلعاً للمثلث؟", answer: "3" },
  { type: "geography", label: "المعرفة الجغرافية", prompt: "ما النهر الذي يمر في مصر والسودان؟", answer: "النيل" },
  { type: "english", label: "الكلمات الإنجليزية", prompt: "اكتب كلمة cat بالعربية.", answer: "قطه" },
  { type: "cipher", label: "حل الشيفرات", prompt: "شفرة A1Z26: 3-1-20. ما الكلمة الإنجليزية؟", answer: "cat" },
  { type: "logic", label: "التفكير المنطقي", prompt: "لدى سارة 3 تفاحات وأخذت تفاحتين. كم تفاحة معها؟", answer: "2" },
  { type: "sequence", label: "السلاسل والتتابعات", prompt: "أكمل السلسلة: 2، 4، 8، 16، ؟", answer: "32" },
].map((question, index) => ({
  ...question,
  difficulty: index < 5 ? "easy" : index < 10 ? "normal" : "hard",
}));

const DEFAULT_GUILD_RECIPES = [
  { id: "healing-potion", name: "جرعة الشفاء", costs: { herb: 2, crystal: 1 }, item: "healing-potion" },
  { id: "lucky-charm", name: "تعويذة الحظ", costs: { herb: 1, crystal: 2 }, item: "lucky-charm" },
];

export const DEFAULT_RANKS = [
  { id: "beginner", name: "مبتدئ", icon: "🌱", color: "#94a3b8", minPoints: 0 },
  { id: "active", name: "متفاعل", icon: "💬", color: "#38bdf8", minPoints: 500 },
  { id: "regular", name: "منتظم", icon: "⭐", color: "#22c55e", minPoints: 2_000 },
  { id: "adventurer", name: "مغامر", icon: "🧭", color: "#14b8a6", minPoints: 5_000 },
  { id: "expert", name: "خبير", icon: "🛡️", color: "#6366f1", minPoints: 10_000 },
  { id: "elite", name: "نخبة", icon: "💎", color: "#8b5cf6", minPoints: 20_000 },
  { id: "hero", name: "بطل", icon: "🏆", color: "#f59e0b", minPoints: 35_000 },
  { id: "legend", name: "أسطورة", icon: "🌠", color: "#ec4899", minPoints: 55_000 },
  { id: "king", name: "ملك", icon: "👑", color: "#f97316", minPoints: 80_000 },
  { id: "emperor", name: "الإمبراطور", icon: "♛", color: "#facc15", minPoints: 0 },
];

export const DEFAULT_PETS = [
  { id: "cat", name: "القط", icon: "🐈", price: 2_000, ability: "chat", value: 0.03 },
  { id: "dog", name: "الكلب", icon: "🐕", price: 3_000, ability: "gift", value: 0.04 },
  { id: "rabbit", name: "الأرنب", icon: "🐇", price: 4_000, ability: "tasks", value: 0.05 },
  { id: "fox", name: "الثعلب", icon: "🦊", price: 6_000, ability: "chat", value: 0.06 },
  { id: "wolf", name: "الذئب", icon: "🐺", price: 8_000, ability: "challenge", value: 0.07 },
  { id: "lion", name: "الأسد", icon: "🦁", price: 10_000, ability: "gift", value: 0.08 },
  { id: "tiger", name: "النمر", icon: "🐅", price: 12_000, ability: "chat", value: 0.09 },
  { id: "eagle", name: "النسر", icon: "🦅", price: 14_000, ability: "periodic", value: 20 },
  { id: "owl", name: "البومة", icon: "🦉", price: 16_000, ability: "tasks", value: 0.1 },
  { id: "horse", name: "الحصان", icon: "🐎", price: 18_000, ability: "activity", value: 0.1 },
  { id: "panda", name: "الباندا", icon: "🐼", price: 20_000, ability: "gift", value: 0.1 },
  { id: "dolphin", name: "الدلفين", icon: "🐬", price: 22_000, ability: "challenge", value: 0.12 },
  { id: "bear", name: "الدب", icon: "🐻", price: 25_000, ability: "chat", value: 0.12 },
  { id: "deer", name: "الغزال", icon: "🦌", price: 28_000, ability: "tasks", value: 0.13 },
  { id: "peacock", name: "الطاووس", icon: "🦚", price: 31_000, ability: "activity", value: 0.14 },
  { id: "falcon", name: "الصقر", icon: "🦅", price: 35_000, ability: "periodic", value: 35 },
  { id: "phoenix", name: "العنقاء", icon: "🔥", price: 40_000, ability: "gift", value: 0.16 },
  { id: "unicorn", name: "اليونيكورن", icon: "🦄", price: 46_000, ability: "challenge", value: 0.18 },
  { id: "dragon", name: "التنين", icon: "🐉", price: 53_000, ability: "chat", value: 0.2 },
  { id: "leviathan", name: "ليفياثان", icon: "🐲", price: 60_000, ability: "periodic", value: 60 },
];

export const DEFAULT_SHOP_ITEMS = [
  { id: "title-veteran", name: "لقب المخضرم", category: "title", icon: "🏅", price: 2_500, durationDays: 0 },
  { id: "frame-aurora", name: "إطار الشفق", category: "frame", icon: "🌌", price: 4_000, durationDays: 0 },
  { id: "badge-first", name: "شارة السبّاق", category: "badge", icon: "⚡", price: 3_000, durationDays: 0 },
  { id: "collectible-crystal", name: "بلورة نادرة", category: "collectible", icon: "🔮", price: 7_500, durationDays: 0 },
  { id: "power-chat", name: "دفعة نشاط", category: "power", icon: "🚀", price: 1_500, durationDays: 1, value: 0.15 },
  { id: "title-champion", name: "لقب البطل", category: "title", icon: "🥇", price: 10_000, durationDays: 0 },
];

const DEFAULT_MODULES = {
  economy: true,
  progression: true,
  antiSpam: true,
  pets: true,
  shops: true,
  tasks: true,
  achievements: true,
  challenges: true,
  teams: true,
  seasons: true,
  events: true,
  messageTemplates: true,
  customCommands: true,
  ticTacToe: true,
  bossRaid: true,
  treasure: true,
  guilds: true,
  crafting: true,
  dungeons: true,
  tournaments: true,
  wordHunt: true,
  luckyWheel: true,
};

const DEFAULT_SETTINGS = {
  rewards: {
    startingBalance: 500,
    dailyGift: 200,
    weeklyGift: 1_000,
    inviteReward: 100,
    messageReward: 2,
    laughReward: 3,
    dailyEarnCap: 1_500,
  },
  antiSpam: {
    enabled: true,
    repeatThreshold: 5,
    windowSeconds: 30,
    floodThreshold: 18,
    floodDuplicateRatio: 0.65,
    penaltyPoints: 200,
    penaltyCooldownSeconds: 60,
    warningEvery: 3,
    kickAfterSpamMessages: 51,
  },
  ranks: DEFAULT_RANKS,
  dailyTasks: [
    { id: "chat-15", name: "شارك في الحديث", target: 15, reward: 50, kind: "messages" },
    { id: "chat-30", name: "كن حاضرًا اليوم", target: 30, reward: 100, kind: "messages" },
  ],
  weeklyTasks: [
    { id: "week-chat-100", name: "نشاط الأسبوع", target: 100, reward: 400, kind: "messages" },
  ],
  achievementRules: [
    { id: "first-message", name: "أول رسالة", kind: "messages", target: 1, badge: "💬" },
    { id: "messages-100", name: "مئة رسالة", kind: "messages", target: 100, badge: "💯" },
    { id: "messages-1000", name: "ألف رسالة", kind: "messages", target: 1_000, badge: "🏅" },
    { id: "streak-7", name: "سلسلة أسبوع", kind: "streak", target: 7, badge: "🔥" },
    { id: "pet-owner", name: "أول حيوان", kind: "pets", target: 1, badge: "🐾" },
  ],
  season: null,
  messageTemplates: {},
  scheduledRewards: {
    dailyEnabled: true,
    dailyTime: "08:00",
    weeklyEnabled: true,
    weeklyDay: 5,
    weeklyTime: "08:00",
  },
  gameplay: {
    xo: { winPoints: 100, winXp: 25, drawPoints: 25, drawXp: 5 },
    challenges: { rewardPoints: 100, rewardXp: 25, drawPoints: 25, drawXp: 5, durationMinutes: 5, difficulty: "mixed", questions: [] },
    bossRaid: { baseHealth: 1_000, damagePerAction: 25, rewardPoints: 250, rewardXp: 50 },
    treasure: { rewardPoints: 200, rewardXp: 20, durationMinutes: 20 },
    guilds: { createCost: 100, initialLevel: 1 },
    crafting: { recipes: DEFAULT_GUILD_RECIPES },
    dungeons: { rewardPoints: 150, rewardXp: 30, stages: 3 },
    tournaments: { rewardPoints: 500, rewardXp: 100 },
    wordHunt: { rewardPoints: 75, rewardXp: 15, durationMinutes: 10 },
    luckyWheel: { dailyLimit: 1, prizes: [0, 10, 25, 50, 100] },
  },
};

function deepClone(value) {
  return structuredClone(value);
}

function cleanMemberId(value) {
  const id = String(value || "").trim();
  if (!id || id.length > 180 || !/^[A-Za-z0-9._:-]+@[A-Za-z0-9.-]+$/.test(id)) {
    throw new Error("معرّف عضو واتساب غير صالح");
  }
  return id;
}

function localDateParts(date = new Date()) {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: TIME_ZONE,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(date);
  return Object.fromEntries(parts.map((part) => [part.type, part.value]));
}

export function groupWorldDayKey(date = new Date()) {
  const p = localDateParts(date);
  return `${p.year}-${p.month}-${p.day}`;
}

export function groupWorldWeekKey(date = new Date()) {
  const p = localDateParts(date);
  const day = new Date(Date.UTC(Number(p.year), Number(p.month) - 1, Number(p.day)));
  day.setUTCDate(day.getUTCDate() + 4 - (day.getUTCDay() || 7));
  const year = day.getUTCFullYear();
  const yearStart = new Date(Date.UTC(year, 0, 1));
  const week = Math.ceil(((day - yearStart) / 86_400_000 + 1) / 7);
  return `${year}-W${String(week).padStart(2, "0")}`;
}

function groupWorldMonthKey(date = new Date()) {
  const p = localDateParts(date);
  return `${p.year}-${p.month}`;
}

function ensureDefaults(state) {
  state.modules = { ...DEFAULT_MODULES, ...(state.modules || {}) };
  state.settings = {
    ...deepClone(DEFAULT_SETTINGS),
    ...(state.settings || {}),
    rewards: {
      ...DEFAULT_SETTINGS.rewards,
      ...(state.settings?.rewards || {}),
    },
    antiSpam: {
      ...DEFAULT_SETTINGS.antiSpam,
      ...(state.settings?.antiSpam || {}),
    },
    ranks: Array.isArray(state.settings?.ranks)
      ? state.settings.ranks
      : deepClone(DEFAULT_RANKS),
    dailyTasks: Array.isArray(state.settings?.dailyTasks)
      ? state.settings.dailyTasks
      : deepClone(DEFAULT_SETTINGS.dailyTasks),
    weeklyTasks: Array.isArray(state.settings?.weeklyTasks)
      ? state.settings.weeklyTasks
      : deepClone(DEFAULT_SETTINGS.weeklyTasks),
    achievementRules: Array.isArray(state.settings?.achievementRules)
      ? state.settings.achievementRules
      : deepClone(DEFAULT_SETTINGS.achievementRules),
    messageTemplates: state.settings?.messageTemplates || {},
    scheduledRewards: {
      ...deepClone(DEFAULT_SETTINGS.scheduledRewards),
      ...(state.settings?.scheduledRewards || {}),
    },
    gameplay: {
      ...deepClone(DEFAULT_SETTINGS.gameplay),
      ...(state.settings?.gameplay || {}),
    },
  };
  for (const key of Object.keys(DEFAULT_SETTINGS.gameplay)) {
    state.settings.gameplay[key] = {
      ...deepClone(DEFAULT_SETTINGS.gameplay[key]),
      ...(state.settings?.gameplay?.[key] || {}),
    };
  }
  state.catalogs = {
    pets: Array.isArray(state.catalogs?.pets) ? state.catalogs.pets : deepClone(DEFAULT_PETS),
    items: Array.isArray(state.catalogs?.items) ? state.catalogs.items : deepClone(DEFAULT_SHOP_ITEMS),
  };
  for (const key of [
    "commands", "administrators", "slots", "inviteRewards", "processedMessages",
    "transactions", "auditLog", "violations", "teams", "challenges", "events",
    "games", "gameHistory", "gameBans", "rewardReports", "guilds", "tournaments",
    "treasureHunts", "bossRaids", "dungeons", "wordHunts",
  ]) {
    if (!Array.isArray(state[key])) state[key] = [];
  }
  if (!state.commandSettings || typeof state.commandSettings !== "object") state.commandSettings = {};
  if (!state.accounts || typeof state.accounts !== "object") state.accounts = {};
  return state;
}

function ensureAccount(state, memberId, name = "") {
  const id = cleanMemberId(memberId);
  let account = state.accounts[id];
  if (!account) {
    account = state.accounts[id] = {
      memberId: id,
      name: String(name || "").slice(0, 80),
      enabled: true,
      initialized: false,
      balance: 0,
      rankOverrideId: null,
      totalEarned: 0,
      totalSpent: 0,
      xp: 0,
      level: 1,
      messages: 0,
      activePetId: null,
      pets: [],
      inventory: [],
      resources: {},
      achievements: [],
      gameStats: {},
      activityByDay: {},
      streak: 0,
      lastActiveDay: null,
      lastDailyGiftDay: null,
      lastWeeklyGiftWeek: null,
      lastDailyAutoPeriod: null,
      lastWeeklyAutoPeriod: null,
      lastWheelDay: null,
      taskProgress: {},
      spamMessages: 0,
      lastSpamPenaltyAt: null,
      lastSpamWarningAt: null,
      teamId: null,
      guildId: null,
      titleItemId: null,
      frameItemId: null,
      createdAt: new Date().toISOString(),
    };
  } else if (name) {
    account.name = String(name).slice(0, 80);
  }
  return account;
}

function addAudit(state, actor, action, target, reason, details = {}) {
  state.auditLog.push({
    id: `${Date.now()}-${Math.random().toString(36).slice(2, 10)}`,
    actor: String(actor || "system").slice(0, 180),
    action: String(action).slice(0, 80),
    target: String(target || "").slice(0, 180),
    reason: String(reason || "").slice(0, 300),
    details: deepClone(details),
    timestamp: new Date().toISOString(),
  });
  if (state.auditLog.length > MAX_AUDIT) state.auditLog.splice(0, state.auditLog.length - MAX_AUDIT);
}

function appendTransaction(state, account, amount, kind, reason, actor = "system", eventId = null, timestamp = new Date()) {
  const delta = Math.trunc(Number(amount));
  if (!Number.isSafeInteger(delta) || delta === 0) return null;
  if (account.balance + delta < 0) throw new Error("الرصيد لا يكفي لهذه العملية");
  account.balance += delta;
  if (delta > 0) account.totalEarned += delta;
  else account.totalSpent += Math.abs(delta);
  const transaction = {
    id: `${timestamp.getTime()}-${Math.random().toString(36).slice(2, 10)}`,
    memberId: account.memberId,
    amount: delta,
    kind: String(kind).slice(0, 48),
    reason: String(reason || "").slice(0, 300),
    actor: String(actor || "system").slice(0, 180),
    eventId: eventId ? String(eventId).slice(0, 180) : null,
    timestamp: timestamp.toISOString(),
  };
  state.transactions.push(transaction);
  if (state.transactions.length > MAX_LEDGER) {
    state.transactions.splice(0, state.transactions.length - MAX_LEDGER);
  }
  return transaction;
}

function initializeAccount(state, account, timestamp = new Date()) {
  if (account.initialized) return false;
  account.initialized = true;
  account.balance = 0;
  appendTransaction(
    state,
    account,
    Number(state.settings.rewards.startingBalance),
    "starting_balance",
    "رصيد بداية العضو",
    "system",
    `start:${state.groupId}:${account.memberId}`,
    timestamp,
  );
  return true;
}

function clampInt(value, min, max, field) {
  const number = Number(value);
  if (!Number.isInteger(number) || number < min || number > max) {
    throw new Error(`${field} خارج الحدود المسموح بها`);
  }
  return number;
}

function normalizeGameAnswer(value) {
  return String(value || "")
    .normalize("NFKD")
    .replace(/[\u064B-\u065F\u0670\u0640]/g, "")
    .toLocaleLowerCase("ar")
    .replace(/[^\p{L}\p{N}]+/gu, "")
    .trim();
}

function gameId(prefix) {
  return `${prefix}-${randomUUID()}`;
}

function gameIsBanned(state, memberId, game) {
  return state.gameBans.some((entry) =>
    entry.memberId === memberId && (entry.game === game || entry.game === "*") && entry.enabled !== false
  );
}

function applyGameReward(state, account, points, xp, reason, eventId, timestamp = new Date()) {
  const credited = grantCappedReward(
    state,
    account,
    Math.max(0, Math.trunc(Number(points) || 0)),
    "game_reward",
    reason,
    "system",
    eventId,
    timestamp,
  );
  account.xp = Math.max(0, Number(account.xp) || 0) + Math.max(0, Math.trunc(Number(xp) || 0));
  account.level = Math.max(1, Math.floor(Math.sqrt(account.xp / 10)) + 1);
  account.xpByDay ||= {};
  const day = groupWorldDayKey(timestamp);
  account.xpByDay[day] = Number(account.xpByDay[day] || 0) + Math.max(0, Math.trunc(Number(xp) || 0));
  if (credited > 0) {
    account.resources ||= {};
    account.resources.herb = Number(account.resources.herb || 0) + 1;
  }
  return { points: credited, xp: Math.max(0, Math.trunc(Number(xp) || 0)) };
}

function petFor(state, petId) {
  return state.catalogs.pets.find((pet) => pet.id === petId && pet.enabled !== false) || null;
}

function activePet(state, account) {
  if (!state.modules.pets || !account.activePetId) return null;
  return account.pets.find((pet) => pet.id === account.activePetId) || null;
}

function petMultiplier(state, account, ability) {
  const owned = activePet(state, account);
  if (!owned) return 1;
  const pet = petFor(state, owned.petId);
  if (!pet || pet.ability !== ability) return 1;
  return Math.min(2, 1 + Number(pet.value || 0) * (1 + (owned.level - 1) * 0.2));
}

function temporaryPowerMultiplier(state, account, timestamp = new Date()) {
  let multiplier = 1;
  for (const owned of account.inventory || []) {
    if (owned.expiresAt && Date.parse(owned.expiresAt) <= timestamp.getTime()) continue;
    const item = state.catalogs.items.find((candidate) => candidate.id === owned.itemId);
    if (item?.category === "power" && item.enabled !== false) {
      multiplier *= 1 + Math.min(0.5, Math.max(0, Number(item.value) || 0.15));
    }
  }
  return Math.min(2, multiplier);
}

function memberRank(state, memberId) {
  const accounts = Object.values(state.accounts).filter((account) => account.enabled !== false);
  const sorted = [...accounts].sort((a, b) => b.balance - a.balance || a.memberId.localeCompare(b.memberId));
  const position = sorted.findIndex((account) => account.memberId === memberId) + 1;
  const rankDefs = [...state.settings.ranks].sort((a, b) => a.minPoints - b.minPoints);
  if (position === 1 && sorted.length > 0) {
    return { rank: rankDefs.find((rank) => rank.id === "emperor") || DEFAULT_RANKS.at(-1), position, nextPoints: 0 };
  }
  const account = state.accounts[memberId];
  const override = rankDefs.find((rank) => rank.id === account?.rankOverrideId && rank.id !== "emperor");
  if (override) return { rank: override, position: position || null, nextPoints: 0 };
  const eligible = rankDefs.filter((rank) => rank.id !== "emperor" && rank.minPoints <= (account?.balance || 0));
  const rank = eligible.at(-1) || rankDefs[0];
  const next = rankDefs.find((item) => item.id !== "emperor" && item.minPoints > (account?.balance || 0));
  return {
    rank,
    position: position || null,
    nextPoints: next ? Math.max(0, next.minPoints - (account?.balance || 0)) : 0,
  };
}

function grantCappedReward(state, account, requested, kind, reason, actor, eventId, timestamp) {
  const dayKey = groupWorldDayKey(timestamp);
  account.dailyEarned ||= {};
  const earnedToday = Number(account.dailyEarned[dayKey] || 0);
  const dailyCap = Math.max(0, Number(state.settings.rewards.dailyEarnCap) || 0);
  const amount = Math.max(0, Math.min(Math.trunc(requested), dailyCap - earnedToday));
  if (amount > 0) {
    appendTransaction(state, account, amount, kind, reason, actor, eventId, timestamp);
    account.dailyEarned[dayKey] = earnedToday + amount;
  }
  for (const oldDay of Object.keys(account.dailyEarned)) {
    if (oldDay < groupWorldDayKey(new Date(timestamp.getTime() - 8 * 86_400_000))) delete account.dailyEarned[oldDay];
  }
  return amount;
}

function unlockAchievements(state, account, timestamp) {
  if (!state.modules.achievements) return [];
  const unlocked = [];
  for (const rule of state.settings.achievementRules || []) {
    const value = rule.kind === "messages"
      ? account.messages
      : rule.kind === "streak"
        ? account.streak
        : rule.kind === "pets"
          ? account.pets.length
          : rule.kind === "level"
            ? account.level
            : rule.kind === "earned"
              ? account.totalEarned
              : rule.kind === "spent"
                ? account.totalSpent
                : 0;
    if (value < Number(rule.target) || account.achievements.includes(rule.id)) continue;
    account.achievements.push(rule.id);
    unlocked.push(String(rule.name || rule.id));
  }
  return unlocked;
}

function updateTasks(state, account, timestamp) {
  if (!state.modules.tasks) return [];
  const completed = [];
  const dailyKey = groupWorldDayKey(timestamp);
  const weekKey = groupWorldWeekKey(timestamp);
  account.taskProgress ||= {};
  const lists = [
    { scope: "daily", key: dailyKey, tasks: state.settings.dailyTasks || [] },
    { scope: "weekly", key: weekKey, tasks: state.settings.weeklyTasks || [] },
  ];
  for (const list of lists) {
    account.taskProgress[list.scope] ||= {};
    const scoped = account.taskProgress[list.scope];
    if (!scoped[list.key]) scoped[list.key] = {};
    for (const task of list.tasks) {
      const progress = scoped[list.key][task.id] || { count: 0, claimed: false };
      if (task.kind === "messages") progress.count += 1;
      if (!progress.claimed && progress.count >= Number(task.target) && state.modules.economy) {
        progress.claimed = true;
        const reward = clampInt(task.reward, 0, 100_000, "مكافأة المهمة");
        const boostedReward = Math.round(
          reward * petMultiplier(state, account, "tasks") * temporaryPowerMultiplier(state, account, timestamp),
        );
        grantCappedReward(state, account, boostedReward, "task", `مهمة: ${task.name}`, "system", null, timestamp);
        completed.push(String(task.name));
      }
      scoped[list.key][task.id] = progress;
    }
  }
  return completed;
}

function normalizeSpamText(text) {
  return String(text || "").toLowerCase().replace(/\s+/g, " ").trim().slice(0, 500);
}

function spamSignature(text) {
  return normalizeSpamText(text)
    .replace(/(?:https?:\/\/|www\.)\S+/giu, "_url_")
    .replace(/(?:\+?\d[\d\s().-]{5,}\d)/gu, "_number_")
    .replace(/@\d{5,}/gu, "@_member_")
    .trim();
}

function detectSpam(state, memberId, text, timestamp) {
  const settings = state.settings.antiSpam;
  if (!state.modules.antiSpam || settings.enabled === false) return null;
  const normalized = normalizeSpamText(text);
  if (normalized.length < 2) return null;
  const signature = spamSignature(normalized);
  const windowMs = clampInt(settings.windowSeconds, 10, 300, "نافذة السبام") * 1_000;
  const windows = state.spamWindows ||= {};
  const recent = (windows[memberId] || []).filter((item) => timestamp.getTime() - item.time <= windowMs);
  recent.push({ text: normalized, signature, time: timestamp.getTime() });
  if (recent.length > 100) recent.splice(0, recent.length - 100);
  windows[memberId] = recent;

  const repeated = recent.filter((item) => item.signature === signature).length;
  const counts = new Map();
  for (const item of recent) counts.set(item.signature, (counts.get(item.signature) || 0) + 1);
  const duplicateRatio = recent.length ? Math.max(...counts.values()) / recent.length : 0;
  const repeatThreshold = clampInt(settings.repeatThreshold, 3, 30, "حد التكرار");
  const floodThreshold = clampInt(settings.floodThreshold, 8, 100, "حد الإرسال المكثف");
  if (repeated >= repeatThreshold) return { kind: "repeated", repeated, count: recent.length };
  if (recent.length >= floodThreshold && duplicateRatio >= Number(settings.floodDuplicateRatio || 0.65)) {
    return { kind: "flood", repeated, count: recent.length };
  }
  return null;
}

function safeCommand(command) {
  const name = String(command?.name || "").trim();
  if (!/^\.[\p{L}\p{N}_-]{1,32}$/u.test(name)) {
    throw new Error("الأمر يجب أن يبدأ بنقطة ويحتوي حتى 32 حرفًا");
  }
  const normalized = name.toLowerCase();
  if (BUILTIN_COMMANDS.includes(normalized)) throw new Error("لا يمكن استبدال أمر أساسي");
  const response = String(command?.response || "");
  if (!response.trim() || response.length > 2_000) throw new Error("نص الرد مطلوب وبحد أقصى 2000 حرف");
  if (/<script\b|javascript:|data:text\/html/i.test(response)) {
    throw new Error("الأوامر تقبل نصوصًا فقط ولا تقبل شيفرة");
  }
  return {
    id: String(command.id || name.slice(1)).replace(/[^A-Za-z0-9_-]/g, "").slice(0, 40) || name.slice(1),
    name,
    response,
    enabled: command.enabled !== false,
    createdAt: command.createdAt || new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  };
}

export function parseMessageTemplate(template) {
  const source = String(template || "");
  const buttons = [];
  const parts = source.split("_boton_");
  const textParts = [parts[0]];
  for (let index = 1; index < parts.length; index += 1) {
    const item = parts[index];
    const separator = item.indexOf("_");
    if (separator <= 0) {
      textParts.push("_boton_", item);
      continue;
    }
    const label = item.slice(0, separator).trim();
    const rest = item.slice(separator + 1);
    if (!label || !rest.trim()) {
      textParts.push("_boton_", item);
      continue;
    }
    buttons.push({ label: label.slice(0, 40), response: rest.trim().slice(0, 300) });
  }
  return { text: textParts.join("").trim(), buttons };
}

export function renderMessageTemplate(template, values = {}) {
  const source = String(template || "");
  const aliases = {
    _cone: values.points,
    _neam: values.name,
    _time: values.time,
    _img: "",
    _allcon: values.allMembers,
    _rank: values.rank,
    _position: values.position,
    _earned: values.earned,
    _spent: values.spent,
    _pet: values.pet,
    _next: values.nextPoints,
  };
  const parsed = parseMessageTemplate(source);
  let text = parsed.text;
  for (const [key, value] of Object.entries(aliases)) {
    text = text.split(key).join(value == null ? "" : String(value));
  }
  const buttons = parsed.buttons.map((button) => ({
    label: button.label,
    response: Object.entries(aliases).reduce(
      (result, [key, value]) => result.split(key).join(value == null ? "" : String(value)),
      button.response,
    ),
  }));
  return {
    text,
    buttons,
    image: values.image || null,
    includesImage: source.includes("_img"),
  };
}

function serializedMember(state, account) {
  const rank = memberRank(state, account.memberId);
  return {
    memberId: account.memberId,
    name: account.name || account.memberId.split("@")[0],
    enabled: account.enabled !== false,
    balance: account.balance,
    xp: account.xp,
    level: account.level,
    messages: account.messages,
    totalEarned: account.totalEarned,
    totalSpent: account.totalSpent,
    rank: rank.rank,
    position: rank.position,
    nextPoints: rank.nextPoints,
    rankOverrideId: account.rankOverrideId || null,
    activePetId: account.activePetId,
    petCount: account.pets.length,
    achievements: account.achievements.length,
    streak: account.streak,
    spamMessages: account.spamMessages,
    teamId: account.teamId,
  };
}

export function createGroupWorldService(options = {}) {
  const store = options.store || createGroupWorldStore(options);
  const now = options.now || (() => new Date());

  async function getGroup(groupId) {
    return ensureDefaults(await store.loadGroup(normalizeGroupId(groupId)));
  }

  async function transact(groupId, operation) {
    return store.updateGroup(normalizeGroupId(groupId), async (raw) => {
      const state = ensureDefaults(raw);
      return operation(state);
    });
  }

  async function audit(groupId, actor, action, target, reason, details) {
    return transact(groupId, (state) => {
      addAudit(state, actor, action, target, reason, details);
      return { ok: true };
    });
  }

  async function activateGroup({ groupId, ownerId, ownerPhoneNumber = "", members = [], actor = ownerId }) {
    const owner = String(ownerId || "").trim();
    if (!owner) throw new Error("تعذّر تحديد مالك تفعيل النظام");
    return transact(groupId, (state) => {
      if (state.enabled && state.ownerId && state.ownerId !== owner) {
        throw new Error("هذه المجموعة مفعّلة بواسطة مالك آخر");
      }
      const firstActivation = !state.enabled;
      state.enabled = true;
      state.ownerId ||= owner;
      state.ownerPhoneNumber ||= String(ownerPhoneNumber || "").replace(/\D/g, "") || null;
      state.activatedAt ||= now().toISOString();
      const seeded = [];
      for (const member of members) {
        const account = ensureAccount(state, member.memberId || member.id, member.name || member.notify);
        if (!account.initialized) {
          initializeAccount(state, account, now());
          seeded.push(account.memberId);
        }
      }
      if (firstActivation && state.slots.length === 0) {
        state.slots = members.map((member, index) => ({
          slot: index + 1,
          memberId: cleanMemberId(member.memberId || member.id),
          name: String(member.name || member.notify || "").slice(0, 80),
          active: true,
        }));
      }
      if (firstActivation) addAudit(state, actor, "activate", state.groupId, "تفعيل عالم المجموعة", { seeded: seeded.length });
      return { ok: true, enabled: true, seededMembers: seeded.length, modules: deepClone(state.modules) };
    });
  }

  async function setEnabled(groupId, enabled, actor, reason = "") {
    if (typeof enabled !== "boolean") throw new Error("حالة التفعيل غير صالحة");
    return transact(groupId, (state) => {
      state.enabled = enabled;
      addAudit(state, actor, enabled ? "enable" : "disable", groupId, reason || "تغيير حالة المجموعة");
      return { ok: true, enabled };
    });
  }

  async function setModule(groupId, moduleName, enabled, actor) {
    if (!(moduleName in DEFAULT_MODULES) || typeof enabled !== "boolean") {
      throw new Error("وحدة النظام غير صالحة");
    }
    return transact(groupId, (state) => {
      state.modules[moduleName] = enabled;
      addAudit(state, actor, "module_toggle", moduleName, enabled ? "تفعيل الوحدة" : "إيقاف الوحدة", { enabled });
      return { ok: true, modules: deepClone(state.modules) };
    });
  }

  async function processMessage({
    groupId,
    memberId,
    name = "",
    text = "",
    messageId,
    timestamp = now(),
    fromMe = false,
  }) {
    const normalizedGroupId = normalizeGroupId(groupId);
    const normalizedMemberId = cleanMemberId(memberId);
    const date = timestamp instanceof Date ? timestamp : new Date(timestamp);
    const eventId = String(messageId || "");
    if (!eventId || eventId.length > 180) return { ignored: true, reason: "missing_message_id" };
    if (fromMe) return { ignored: true, reason: "from_me" };

    return transact(normalizedGroupId, (state) => {
      if (state.processedMessages.includes(eventId)) return { duplicate: true };
      state.processedMessages.push(eventId);
      if (state.processedMessages.length > MAX_EVENT_IDS) {
        state.processedMessages.splice(0, state.processedMessages.length - MAX_EVENT_IDS);
      }
      if (!state.enabled) return { ignored: true, reason: "disabled" };

      const account = ensureAccount(state, normalizedMemberId, name);
      if (account.enabled === false) return { ignored: true, reason: "member_disabled" };
      if (state.modules.economy) initializeAccount(state, account, date);

      const content = String(text || "").trim();
      if (!content || content.startsWith(".")) return { ignored: true, reason: "command_or_empty" };

      const spam = detectSpam(state, normalizedMemberId, content, date);
      if (spam) {
        account.spamMessages += 1;
        const spamSettings = state.settings.antiSpam;
        const lastPenalty = account.lastSpamPenaltyAt ? Date.parse(account.lastSpamPenaltyAt) : 0;
        const penaltyReady = date.getTime() - lastPenalty >= Number(spamSettings.penaltyCooldownSeconds) * 1_000;
        let penalty = 0;
        if (penaltyReady && account.balance > 0) {
          penalty = Math.min(account.balance, Number(spamSettings.penaltyPoints));
          if (penalty > 0) {
            appendTransaction(state, account, -penalty, "spam_penalty", "خصم بسبب سبام مؤكد", "system", eventId, date);
            account.lastSpamPenaltyAt = date.toISOString();
          }
        }
        const shouldWarn = account.spamMessages === 1 ||
          account.spamMessages % Math.max(1, Number(spamSettings.warningEvery)) === 0;
        const warningCooldown = date.getTime() - Date.parse(account.lastSpamWarningAt || "1970-01-01") > 30_000;
        if (shouldWarn && warningCooldown) account.lastSpamWarningAt = date.toISOString();
        state.violations.push({
          id: eventId,
          memberId: normalizedMemberId,
          kind: spam.kind,
          messageCount: spam.count,
          confirmedTotal: account.spamMessages,
          penalty,
          timestamp: date.toISOString(),
        });
        if (state.violations.length > MAX_VIOLATIONS) {
          state.violations.splice(0, state.violations.length - MAX_VIOLATIONS);
        }
        const shouldKick = account.spamMessages >= Number(spamSettings.kickAfterSpamMessages) &&
          !account.spamKickAttempted;
        if (shouldKick) account.spamKickAttempted = true;
        return {
          spam: true,
          kind: spam.kind,
          penalty,
          confirmedSpamMessages: account.spamMessages,
          shouldWarn: shouldWarn && warningCooldown,
          shouldKick,
          balance: account.balance,
        };
      }

      if (!state.modules.economy && !state.modules.progression) {
        return { ignored: true, reason: "economy_and_progression_disabled" };
      }

      const trackActivity = state.modules.progression || state.modules.economy;
      if (trackActivity) {
        const previousDay = account.lastActiveDay;
        const today = groupWorldDayKey(date);
        account.activityByDay ||= {};
        account.activityByDay[today] = Number(account.activityByDay[today] || 0) + 1;
        for (const key of Object.keys(account.activityByDay)) {
          if (Date.parse(`${key}T00:00:00Z`) < date.getTime() - 62 * 86_400_000) {
            delete account.activityByDay[key];
          }
        }
        if (previousDay !== today) {
          const yesterday = groupWorldDayKey(new Date(date.getTime() - 86_400_000));
          account.streak = previousDay === yesterday ? account.streak + 1 : 1;
          account.lastActiveDay = today;
        }
        account.messages += 1;
        if (state.modules.progression) {
          const earnedXp = 1 + Math.floor((petMultiplier(state, account, "activity") - 1) * 10);
          account.xp += earnedXp;
          account.xpByDay ||= {};
          account.xpByDay[today] = Number(account.xpByDay[today] || 0) + earnedXp;
          account.level = Math.max(1, Math.floor(Math.sqrt(account.xp / 10)) + 1);
        }
      }
      let credited = 0;
      if (state.modules.economy) {
        const baseReward = LAUGHING_EMOJI.test(content)
          ? Number(state.settings.rewards.laughReward)
          : Number(state.settings.rewards.messageReward);
        const chatMultiplier = petMultiplier(state, account, "chat") * temporaryPowerMultiplier(state, account, date);
        const periodicPet = activePet(state, account);
        const periodicSpec = periodicPet && petFor(state, periodicPet.petId);
        const periodicDue = periodicSpec?.ability === "periodic" &&
          date.getTime() - Date.parse(periodicPet.lastPeriodicAt || "1970-01-01") >= 24 * 60 * 60 * 1_000;
        let reward = Math.max(0, Math.round(baseReward * chatMultiplier));
        if (periodicDue) {
          reward += Math.max(0, Math.trunc(Number(periodicSpec.value)));
          periodicPet.lastPeriodicAt = date.toISOString();
        }
        credited = grantCappedReward(state, account, reward, "message", "مكافأة رسالة طبيعية", "system", eventId, date);
      }
      const completedTasks = updateTasks(state, account, date);
      const unlocked = unlockAchievements(state, account, date);
      return { rewarded: credited, balance: account.balance, xp: account.xp, level: account.level, completedTasks, unlocked };
    });
  }

  async function rewardInvite({ groupId, inviterId, invitedId, inviterName = "", eventId = null }) {
    const inviter = cleanMemberId(inviterId);
    const invited = cleanMemberId(invitedId);
    return transact(groupId, (state) => {
      if (!state.enabled || !state.modules.economy) return { ignored: true };
      if (state.inviteRewards.includes(invited)) return { duplicate: true };
      state.inviteRewards.push(invited);
      if (state.inviteRewards.length > 50_000) state.inviteRewards.shift();
      const account = ensureAccount(state, inviter, inviterName);
      initializeAccount(state, account, now());
      const amount = grantCappedReward(
        state,
        account,
        Number(state.settings.rewards.inviteReward),
        "invite_reward",
        "مكافأة دعوة عضو جديد",
        "system",
        eventId,
        now(),
      );
      return { rewarded: amount, inviter, invited };
    });
  }

  async function claimGift(groupId, memberId, type, name = "") {
    const id = cleanMemberId(memberId);
    return transact(groupId, (state) => {
      if (!state.enabled || !state.modules.economy) throw new Error("نظام النقاط غير مفعّل لهذه المجموعة");
      const account = ensureAccount(state, id, name);
      initializeAccount(state, account, now());
      if (account.enabled === false) throw new Error("حسابك معطّل في نظام النقاط");
      const date = now();
      let amount;
      let kind;
      if (type === "daily") {
        const key = groupWorldDayKey(date);
        if (account.lastDailyGiftDay === key) throw new Error("استلمت هديتك اليومية بالفعل");
        account.lastDailyGiftDay = key;
        amount = Number(state.settings.rewards.dailyGift) * petMultiplier(state, account, "gift");
        kind = "daily_gift";
      } else if (type === "weekly") {
        const key = groupWorldWeekKey(date);
        if (account.lastWeeklyGiftWeek === key) throw new Error("استلمت هديتك الأسبوعية بالفعل");
        account.lastWeeklyGiftWeek = key;
        amount = Number(state.settings.rewards.weeklyGift) * petMultiplier(state, account, "gift");
        kind = "weekly_gift";
      } else {
        throw new Error("نوع الهدية غير صالح");
      }
      const credited = grantCappedReward(state, account, amount, kind, type === "daily" ? "الهدية اليومية" : "الهدية الأسبوعية", "system", `${kind}:${id}:${type === "daily" ? groupWorldDayKey(date) : groupWorldWeekKey(date)}`, date);
      return { amount: credited, balance: account.balance, type };
    });
  }

  async function getLeaderboard(groupId, period = "all", limit = 10) {
    const state = await getGroup(groupId);
    const count = clampInt(limit, 1, 100, "عدد أعضاء الصدارة");
    const nowDate = now();
    const day = groupWorldDayKey(nowDate);
    const week = groupWorldWeekKey(nowDate);
    const month = groupWorldMonthKey(nowDate);
    const values = new Map();
    if (period === "all") {
      for (const account of Object.values(state.accounts)) {
        if (account.enabled !== false) values.set(account.memberId, account.balance);
      }
    } else {
      for (const entry of state.transactions) {
        const date = new Date(entry.timestamp);
        const matches = period === "daily"
          ? groupWorldDayKey(date) === day
          : period === "weekly"
            ? groupWorldWeekKey(date) === week
            : period === "monthly"
              ? groupWorldMonthKey(date) === month
              : false;
        if (matches && entry.amount > 0) values.set(entry.memberId, (values.get(entry.memberId) || 0) + entry.amount);
      }
      if (!["daily", "weekly", "monthly"].includes(period)) throw new Error("فترة الصدارة غير صالحة");
    }
    return [...values.entries()]
      .map(([memberId, score]) => {
        const account = state.accounts[memberId];
        return { ...serializedMember(state, account), score };
      })
      .sort((a, b) => b.score - a.score || a.memberId.localeCompare(b.memberId))
      .slice(0, count);
  }

  async function getMemberProfile(groupId, memberId) {
    const state = await getGroup(groupId);
    const id = cleanMemberId(memberId);
    const account = state.accounts[id];
    if (!account) return null;
    const rank = memberRank(state, id);
    const pet = activePet(state, account);
    return {
      ...serializedMember(state, account),
      activePet: pet ? { ...pet, catalog: petFor(state, pet.petId) } : null,
      pets: account.pets.map((owned) => ({ ...owned, catalog: petFor(state, owned.petId) })),
      inventory: deepClone(account.inventory),
      resources: deepClone(account.resources || {}),
      gameStats: deepClone(account.gameStats || {}),
      guildId: account.guildId || null,
      achievements: deepClone(account.achievements),
      taskProgress: deepClone(account.taskProgress),
      rank: rank.rank,
      nextPoints: rank.nextPoints,
      lastActiveDay: account.lastActiveDay,
    };
  }

  async function ensureMember(groupId, memberId, name = "") {
    const id = cleanMemberId(memberId);
    return transact(groupId, (state) => {
      if (!state.enabled) throw new Error("عالم المجموعة غير مفعّل");
      const account = ensureAccount(state, id, name);
      if (!account.initialized && state.modules.economy) initializeAccount(state, account, now());
      return serializedMember(state, account);
    });
  }

  async function getMembers(groupId, search = "") {
    const state = await getGroup(groupId);
    const query = String(search || "").trim().toLowerCase();
    return Object.values(state.accounts)
      .filter((account) => !query || `${account.name} ${account.memberId}`.toLowerCase().includes(query))
      .map((account) => serializedMember(state, account))
      .sort((a, b) => b.balance - a.balance || a.memberId.localeCompare(b.memberId));
  }

  async function adjustBalance(groupId, memberId, amount, actor, reason) {
    const id = cleanMemberId(memberId);
    const delta = clampInt(amount, -1_000_000, 1_000_000, "مقدار النقاط");
    if (!delta) throw new Error("أدخل مبلغًا غير صفري");
    const why = String(reason || "").trim();
    if (why.length < 3) throw new Error("اكتب سببًا واضحًا للعملية");
    return transact(groupId, (state) => {
      const account = ensureAccount(state, id);
      initializeAccount(state, account, now());
      if (account.balance + delta < 0) throw new Error("لا يمكن أن يصبح الرصيد سالبًا");
      const transaction = appendTransaction(state, account, delta, "admin_adjustment", why, actor, null, now());
      addAudit(state, actor, "balance_adjust", id, why, { amount: delta, transactionId: transaction.id });
      return { ok: true, member: serializedMember(state, account), transaction };
    });
  }

  async function setMemberEnabled(groupId, memberId, enabled, actor, reason = "") {
    const id = cleanMemberId(memberId);
    if (typeof enabled !== "boolean") throw new Error("حالة العضو غير صالحة");
    return transact(groupId, (state) => {
      const account = ensureAccount(state, id);
      account.enabled = enabled;
      addAudit(state, actor, enabled ? "member_enable" : "member_disable", id, reason || "تغيير حالة العضو");
      return { ok: true, member: serializedMember(state, account) };
    });
  }

  async function adminUpdateMember(groupId, memberId, patch, actor, reason) {
    const id = cleanMemberId(memberId);
    const why = String(reason || "").trim();
    if (why.length < 3) throw new Error("اكتب سببًا واضحًا للتعديل");
    if (!patch || typeof patch !== "object" || Array.isArray(patch)) throw new Error("بيانات التعديل غير صالحة");
    return transact(groupId, (state) => {
      const account = ensureAccount(state, id);
      const changed = [];
      if (patch.xp !== undefined) {
        account.xp = clampInt(patch.xp, 0, 1_000_000_000, "XP");
        changed.push("xp");
      }
      if (patch.level !== undefined) {
        account.level = clampInt(patch.level, 1, 1_000_000, "المستوى");
        changed.push("level");
      }
      if (patch.rankOverrideId !== undefined) {
        const rankId = patch.rankOverrideId ? String(patch.rankOverrideId) : null;
        if (rankId && !state.settings.ranks.some((rank) => rank.id === rankId)) {
          throw new Error("الرتبة المختارة غير موجودة");
        }
        if (rankId === "emperor") {
          const sorted = Object.values(state.accounts)
            .filter((candidate) => candidate.enabled !== false)
            .sort((a, b) => b.balance - a.balance || a.memberId.localeCompare(b.memberId));
          if (sorted[0]?.memberId !== id) throw new Error("رتبة الإمبراطور محفوظة لصاحب أعلى رصيد");
        }
        account.rankOverrideId = rankId;
        changed.push("rank");
      }
      if (patch.activePetId !== undefined) {
        const petId = patch.activePetId ? String(patch.activePetId) : null;
        if (petId && !account.pets.some((pet) => pet.petId === petId)) {
          throw new Error("لا يمكن تفعيل حيوان لا يملكه العضو");
        }
        account.activePetId = petId;
        changed.push("pet");
      }
      if (patch.enabled !== undefined) {
        if (typeof patch.enabled !== "boolean") throw new Error("حالة العضو غير صالحة");
        account.enabled = patch.enabled;
        changed.push("enabled");
      }
      if (!changed.length) throw new Error("لم يتم تحديد أي حقل للتعديل");
      addAudit(state, actor, "member_profile_update", id, why, { fields: changed });
      return { ok: true, member: serializedMember(state, account) };
    });
  }

  async function purchasePet(groupId, memberId, petId, name = "") {
    const id = cleanMemberId(memberId);
    return transact(groupId, (state) => {
      if (!state.enabled || !state.modules.pets || !state.modules.shops) throw new Error("متجر الحيوانات غير مفعّل");
      const pet = petFor(state, String(petId));
      if (!pet) throw new Error("الحيوان غير موجود في المتجر");
      const account = ensureAccount(state, id, name);
      initializeAccount(state, account, now());
      if (account.enabled === false) throw new Error("حسابك معطّل في نظام النقاط");
      if (account.pets.some((owned) => owned.petId === pet.id)) throw new Error("هذا الحيوان موجود في حقيبتك بالفعل");
      if (account.balance < pet.price) throw new Error("رصيدك لا يكفي لشراء هذا الحيوان");
      appendTransaction(state, account, -Number(pet.price), "pet_purchase", `شراء ${pet.name}`, "member", null, now());
      account.pets.push({ id: pet.id, petId: pet.id, level: 1, acquiredAt: now().toISOString() });
      if (!account.activePetId) account.activePetId = pet.id;
      unlockAchievements(state, account, now());
      return { ok: true, pet, balance: account.balance };
    });
  }

  async function activatePet(groupId, memberId, petId) {
    const id = cleanMemberId(memberId);
    return transact(groupId, (state) => {
      const account = ensureAccount(state, id);
      if (!account.pets.some((owned) => owned.petId === petId)) throw new Error("لا تملك هذا الحيوان");
      account.activePetId = petId;
      return { ok: true, activePetId: petId };
    });
  }

  async function upgradePet(groupId, memberId, petId = null) {
    const id = cleanMemberId(memberId);
    return transact(groupId, (state) => {
      const account = ensureAccount(state, id);
      const selectedId = petId || account.activePetId;
      const owned = account.pets.find((pet) => pet.petId === selectedId);
      if (!owned) throw new Error("اختر حيوانًا تملكه للترقية");
      if (owned.level >= 5) throw new Error("وصل الحيوان إلى أعلى مستوى");
      const catalog = petFor(state, owned.petId);
      const cost = Math.ceil(Number(catalog.price) * 0.35 * owned.level);
      if (account.balance < cost) throw new Error("رصيدك لا يكفي للترقية");
      appendTransaction(state, account, -cost, "pet_upgrade", `ترقية ${catalog.name} إلى المستوى ${owned.level + 1}`, "member", null, now());
      owned.level += 1;
      return { ok: true, pet: owned, cost, balance: account.balance };
    });
  }

  async function purchaseItem(groupId, memberId, itemId) {
    const id = cleanMemberId(memberId);
    return transact(groupId, (state) => {
      if (!state.modules.shops) throw new Error("المتجر غير مفعّل");
      const item = state.catalogs.items.find((candidate) => candidate.id === itemId && candidate.enabled !== false);
      if (!item) throw new Error("العنصر غير موجود");
      const account = ensureAccount(state, id);
      initializeAccount(state, account, now());
      if (account.balance < Number(item.price)) throw new Error("رصيدك لا يكفي لهذا العنصر");
      appendTransaction(state, account, -Number(item.price), "item_purchase", `شراء ${item.name}`, "member", null, now());
      const existing = account.inventory.find((owned) => owned.itemId === itemId);
      if (existing && !item.durationDays) existing.quantity += 1;
      else account.inventory.push({
        itemId,
        quantity: 1,
        purchasedAt: now().toISOString(),
        expiresAt: item.durationDays ? new Date(now().getTime() + Number(item.durationDays) * 86_400_000).toISOString() : null,
      });
      if (item.category === "title") account.titleItemId = itemId;
      if (item.category === "frame") account.frameItemId = itemId;
      return { ok: true, item, balance: account.balance };
    });
  }

  async function claimDailyBonusIfReady(state, account, eventId, timestamp) {
    const pet = activePet(state, account);
    const catalog = pet && petFor(state, pet.petId);
    if (catalog?.ability !== "periodic") return 0;
    if (timestamp.getTime() - Date.parse(pet.lastPeriodicAt || "1970-01-01") < 24 * 60 * 60 * 1_000) return 0;
    pet.lastPeriodicAt = timestamp.toISOString();
    return grantCappedReward(state, account, Number(catalog.value), "pet_periodic", "مكافأة الحيوان الدورية", "system", eventId, timestamp);
  }

  async function claimGiftForMember(groupId, memberId, type, name) {
    return claimGift(groupId, memberId, type, name);
  }

  async function updateSettings(groupId, patch, actor) {
    if (!patch || typeof patch !== "object" || Array.isArray(patch)) throw new Error("الإعدادات غير صالحة");
    return transact(groupId, (state) => {
      if (patch.rewards) {
        for (const key of Object.keys(DEFAULT_SETTINGS.rewards)) {
          if (patch.rewards[key] === undefined) continue;
          state.settings.rewards[key] = clampInt(patch.rewards[key], 0, 100_000, `إعداد ${key}`);
        }
      }
      if (patch.antiSpam) {
        const ranges = {
          repeatThreshold: [3, 30],
          windowSeconds: [10, 300],
          floodThreshold: [8, 100],
          penaltyPoints: [0, 10_000],
          penaltyCooldownSeconds: [10, 3_600],
          warningEvery: [1, 100],
          kickAfterSpamMessages: [0, 10_000],
        };
        for (const [key, value] of Object.entries(patch.antiSpam)) {
          if (key === "enabled") {
            if (typeof value !== "boolean") throw new Error("حالة مكافحة السبام غير صالحة");
            state.settings.antiSpam.enabled = value;
            continue;
          }
          if (key === "floodDuplicateRatio") {
            const ratio = Number(value);
            if (!Number.isFinite(ratio) || ratio < 0.5 || ratio > 1) throw new Error("نسبة التكرار غير صالحة");
            state.settings.antiSpam[key] = ratio;
            continue;
          }
          if (!ranges[key]) throw new Error("إعداد مكافحة السبام غير معروف");
          state.settings.antiSpam[key] = clampInt(value, ...ranges[key], key);
        }
      }
      if (patch.ranks !== undefined) {
        if (!Array.isArray(patch.ranks) || patch.ranks.length < 2 || patch.ranks.length > 20) {
          throw new Error("يجب ضبط رتبتين إلى 20 رتبة");
        }
        const ids = new Set();
        state.settings.ranks = patch.ranks.map((rank) => {
          const id = String(rank.id || "").replace(/[^a-z0-9_-]/gi, "").slice(0, 40);
          const name = String(rank.name || "").trim().slice(0, 40);
          if (!id || !name || ids.has(id)) throw new Error("بيانات الرتب غير صالحة أو مكررة");
          ids.add(id);
          return {
            id,
            name,
            icon: String(rank.icon || "⭐").slice(0, 8),
            color: /^#[0-9a-f]{6}$/i.test(rank.color) ? rank.color : "#64748b",
            minPoints: clampInt(rank.minPoints ?? 0, 0, 1_000_000_000, "حد الرتبة"),
          };
        });
        if (!ids.has("emperor")) throw new Error("يجب إبقاء رتبة الإمبراطور");
      }
      if (patch.dailyTasks !== undefined || patch.weeklyTasks !== undefined) {
        for (const [key, list] of [["dailyTasks", patch.dailyTasks], ["weeklyTasks", patch.weeklyTasks]]) {
          if (list === undefined) continue;
          if (!Array.isArray(list) || list.length > 20) throw new Error("قائمة المهام غير صالحة");
          state.settings[key] = list.map((task, index) => {
            const id = String(task.id || `task-${index + 1}`).replace(/[^a-z0-9_-]/gi, "").slice(0, 40);
            const name = String(task.name || "").trim().slice(0, 80);
            if (!id || !name) throw new Error("اسم المهمة مطلوب");
            return {
              id,
              name,
              kind: task.kind === "messages" ? "messages" : "messages",
              target: clampInt(task.target, 1, 100_000, "هدف المهمة"),
              reward: clampInt(task.reward, 0, 100_000, "مكافأة المهمة"),
            };
          });
        }
      }
      if (patch.achievementRules !== undefined) {
        if (!Array.isArray(patch.achievementRules) || patch.achievementRules.length > 100) {
          throw new Error("قائمة الإنجازات غير صالحة");
        }
        const ids = new Set();
        state.settings.achievementRules = patch.achievementRules.map((rule, index) => {
          const id = String(rule.id || `achievement-${index + 1}`).replace(/[^a-z0-9_-]/gi, "").slice(0, 40);
          const name = String(rule.name || "").trim().slice(0, 80);
          const kind = ["messages", "streak", "pets", "level", "earned", "spent"].includes(rule.kind)
            ? rule.kind
            : "messages";
          if (!id || !name || ids.has(id)) throw new Error("بيانات الإنجاز غير صالحة أو مكررة");
          ids.add(id);
          return {
            id,
            name,
            kind,
            target: clampInt(rule.target, 1, 1_000_000_000, "هدف الإنجاز"),
            badge: String(rule.badge || "🏅").slice(0, 8),
          };
        });
      }
      if (patch.messageTemplates !== undefined) {
        if (!patch.messageTemplates || typeof patch.messageTemplates !== "object" || Array.isArray(patch.messageTemplates)) {
          throw new Error("قوالب الرسائل غير صالحة");
        }
        const next = {};
        for (const [key, value] of Object.entries(patch.messageTemplates)) {
          if (!/^[a-z0-9_-]{1,50}$/i.test(key) || typeof value !== "string" || value.length > 2_000) {
            throw new Error("قالب الرسالة غير صالح");
          }
          next[key] = value;
        }
        state.settings.messageTemplates = next;
      }
      if (patch.scheduledRewards !== undefined) {
        const schedule = patch.scheduledRewards;
        if (!schedule || typeof schedule !== "object" || Array.isArray(schedule)) {
          throw new Error("إعدادات مواعيد المكافآت غير صالحة");
        }
        for (const key of ["dailyEnabled", "weeklyEnabled"]) {
          if (schedule[key] === undefined) continue;
          if (typeof schedule[key] !== "boolean") throw new Error("حالة التوزيع التلقائي غير صالحة");
          state.settings.scheduledRewards[key] = schedule[key];
        }
        for (const key of ["dailyTime", "weeklyTime"]) {
          if (schedule[key] === undefined) continue;
          if (!/^(?:[01]\d|2[0-3]):[0-5]\d$/.test(String(schedule[key]))) {
            throw new Error("وقت التوزيع يجب أن يكون بصيغة HH:MM");
          }
          state.settings.scheduledRewards[key] = String(schedule[key]);
        }
        if (schedule.weeklyDay !== undefined) {
          state.settings.scheduledRewards.weeklyDay = clampInt(schedule.weeklyDay, 0, 6, "يوم التوزيع الأسبوعي");
        }
      }
      if (patch.modules !== undefined) {
        if (!patch.modules || typeof patch.modules !== "object" || Array.isArray(patch.modules)) {
          throw new Error("إعدادات الوحدات غير صالحة");
        }
        for (const [key, enabled] of Object.entries(patch.modules)) {
          if (!(key in DEFAULT_MODULES) || typeof enabled !== "boolean") {
            throw new Error(`إعداد الوحدة ${key} غير صالح`);
          }
          state.modules[key] = enabled;
        }
      }
      if (patch.commands !== undefined) {
        if (!patch.commands || typeof patch.commands !== "object" || Array.isArray(patch.commands)) {
          throw new Error("إعدادات الأوامر غير صالحة");
        }
        for (const [command, enabled] of Object.entries(patch.commands)) {
          const normalized = String(command).trim().slice(0, 80);
          if (!normalized.startsWith(".") || typeof enabled !== "boolean") {
            throw new Error("اسم الأمر أو حالته غير صالحة");
          }
          state.commandSettings[normalized] = enabled;
        }
      }
      if (patch.gameplay !== undefined) {
        if (!patch.gameplay || typeof patch.gameplay !== "object" || Array.isArray(patch.gameplay)) {
          throw new Error("إعدادات الألعاب غير صالحة");
        }
        const numericRanges = {
          xo: { winPoints: [0, 100_000], winXp: [0, 100_000], drawPoints: [0, 100_000], drawXp: [0, 100_000] },
          challenges: { rewardPoints: [0, 100_000], rewardXp: [0, 100_000], drawPoints: [0, 100_000], drawXp: [0, 100_000], durationMinutes: [1, 1_440] },
          bossRaid: { baseHealth: [1, 10_000_000], damagePerAction: [1, 1_000_000], rewardPoints: [0, 100_000], rewardXp: [0, 100_000] },
          treasure: { rewardPoints: [0, 100_000], rewardXp: [0, 100_000], durationMinutes: [1, 1_440] },
          guilds: { createCost: [0, 1_000_000], initialLevel: [1, 100] },
          dungeons: { rewardPoints: [0, 100_000], rewardXp: [0, 100_000], stages: [1, 20] },
          tournaments: { rewardPoints: [0, 1_000_000], rewardXp: [0, 100_000] },
          wordHunt: { rewardPoints: [0, 100_000], rewardXp: [0, 100_000], durationMinutes: [1, 1_440] },
          luckyWheel: { dailyLimit: [1, 20] },
        };
        for (const [feature, values] of Object.entries(patch.gameplay)) {
          if (!(feature in DEFAULT_SETTINGS.gameplay) || !values || typeof values !== "object" || Array.isArray(values)) {
            throw new Error(`إعداد اللعبة ${feature} غير صالح`);
          }
          for (const [key, value] of Object.entries(values)) {
            if (numericRanges[feature]?.[key]) {
              state.settings.gameplay[feature][key] = clampInt(value, ...numericRanges[feature][key], key);
            } else if (feature === "challenges" && key === "difficulty") {
              if (!["easy", "normal", "hard", "mixed"].includes(value)) throw new Error("مستوى التحدي غير صالح");
              state.settings.gameplay.challenges.difficulty = value;
            } else if (feature === "challenges" && key === "questions") {
              if (!Array.isArray(value) || value.length > 100) throw new Error("قائمة أسئلة التحدي غير صالحة");
              state.settings.gameplay.challenges.questions = value.map((question, index) => {
                const label = String(question?.label || question?.type || "").trim().slice(0, 60);
                const prompt = String(question?.prompt || "").trim().slice(0, 500);
                const answer = normalizeGameAnswer(question?.answer);
                if (!label || !prompt || !answer) throw new Error(`بيانات السؤال ${index + 1} غير مكتملة`);
                const difficulty = ["easy", "normal", "hard"].includes(question.difficulty)
                  ? question.difficulty
                  : "normal";
                return { type: String(question.type || `custom-${index + 1}`).slice(0, 50), label, prompt, answer, difficulty };
              });
            } else if (feature === "crafting" && key === "recipes") {
              if (!Array.isArray(value) || value.length > 100) throw new Error("وصفات الصناعة غير صالحة");
              state.settings.gameplay.crafting.recipes = value.map((recipe, index) => {
                const id = String(recipe?.id || `recipe-${index + 1}`).replace(/[^a-z0-9_-]/gi, "").slice(0, 50);
                const name = String(recipe?.name || "").trim().slice(0, 80);
                if (!id || !name || !recipe?.costs || typeof recipe.costs !== "object") throw new Error("بيانات الوصفة غير صالحة");
                const costs = {};
                for (const [resource, amount] of Object.entries(recipe.costs)) {
                  if (!/^[a-z0-9_-]{1,40}$/i.test(resource)) throw new Error("اسم المورد غير صالح");
                  costs[resource] = clampInt(amount, 1, 10_000, "كمية المورد");
                }
                return { id, name, costs, item: String(recipe.item || id).slice(0, 80) };
              });
            } else if (feature === "luckyWheel" && key === "prizes") {
              if (!Array.isArray(value) || value.length < 2 || value.length > 20) throw new Error("جوائز العجلة غير صالحة");
              state.settings.gameplay.luckyWheel.prizes = value.map((amount) => clampInt(amount, 0, 100_000, "جائزة العجلة"));
            } else {
              throw new Error(`إعداد اللعبة ${feature}.${key} غير معروف`);
            }
          }
        }
      }
      if (patch.season !== undefined) {
        if (patch.season === null || patch.season.enabled === false) {
          state.season = null;
        } else {
          const title = String(patch.season.title || "").trim().slice(0, 80);
          if (!title) throw new Error("اسم الموسم مطلوب");
          const startsAt = patch.season.startsAt ? new Date(patch.season.startsAt).toISOString() : null;
          const endsAt = patch.season.endsAt ? new Date(patch.season.endsAt).toISOString() : null;
          if (startsAt && endsAt && Date.parse(endsAt) <= Date.parse(startsAt)) {
            throw new Error("تاريخ نهاية الموسم يجب أن يأتي بعد بدايته");
          }
          state.season = {
            id: String(patch.season.id || `season-${groupWorldDayKey(now())}`).replace(/[^a-z0-9_-]/gi, "").slice(0, 50),
            title,
            startsAt: startsAt || now().toISOString(),
            endsAt,
            reward: clampInt(patch.season.reward ?? 0, 0, 1_000_000, "جائزة الموسم"),
            enabled: true,
            createdAt: now().toISOString(),
          };
        }
      }
      addAudit(state, actor, "settings_update", groupId, "تحديث إعدادات عالم المجموعة", { keys: Object.keys(patch) });
      return { ok: true, settings: deepClone(state.settings), modules: deepClone(state.modules) };
    });
  }

  async function upsertCatalogItem(groupId, collection, item, actor) {
    if (!["pets", "items"].includes(collection)) throw new Error("نوع المتجر غير صالح");
    if (!item || typeof item !== "object") throw new Error("بيانات العنصر غير صالحة");
    const id = String(item.id || "").replace(/[^a-z0-9_-]/gi, "").slice(0, 40);
    const name = String(item.name || "").trim().slice(0, 60);
    const price = clampInt(item.price, 1, 10_000_000, "السعر");
    if (!id || !name) throw new Error("معرّف العنصر واسمه مطلوبان");
    return transact(groupId, (state) => {
      const list = state.catalogs[collection];
      const existingIndex = list.findIndex((entry) => entry.id === id);
      const normalized = collection === "pets"
        ? {
            id,
            name,
            icon: String(item.icon || "🐾").slice(0, 8),
            price,
            ability: ["chat", "gift", "periodic", "tasks", "challenge", "activity"].includes(item.ability) ? item.ability : "activity",
            value: Math.max(0, Math.min(1, Number(item.value) || 0)),
            enabled: item.enabled !== false,
          }
        : {
            id,
            name,
            icon: String(item.icon || "🎁").slice(0, 8),
            price,
            category: ["title", "frame", "item", "collectible", "badge", "power"].includes(item.category) ? item.category : "item",
            durationDays: clampInt(item.durationDays ?? 0, 0, 365, "مدة العنصر"),
            value: Math.max(0, Math.min(0.5, Number(item.value) || 0)),
            enabled: item.enabled !== false,
          };
      if (existingIndex >= 0) list[existingIndex] = normalized;
      else if (list.length < 200) list.push(normalized);
      else throw new Error("وصل المتجر إلى الحد الأقصى للعناصر");
      addAudit(state, actor, existingIndex >= 0 ? "catalog_update" : "catalog_add", id, "تعديل عنصر المتجر", { collection });
      return { ok: true, item: normalized, catalog: deepClone(state.catalogs[collection]) };
    });
  }

  async function deleteCatalogItem(groupId, collection, itemId, actor) {
    if (!["pets", "items"].includes(collection)) throw new Error("نوع المتجر غير صالح");
    return transact(groupId, (state) => {
      const item = state.catalogs[collection].find((entry) => entry.id === itemId);
      if (!item) throw new Error("العنصر غير موجود");
      item.enabled = false;
      addAudit(state, actor, "catalog_disable", itemId, "إخفاء العنصر من المتجر", { collection });
      return { ok: true };
    });
  }

  async function addCustomCommand(groupId, command, actor) {
    const normalized = safeCommand(command);
    return transact(groupId, (state) => {
      if (state.commands.some((item) => item.name.toLowerCase() === normalized.name.toLowerCase())) {
        throw new Error("هذا الأمر موجود بالفعل");
      }
      state.commands.push(normalized);
      addAudit(state, actor, "command_add", normalized.name, "إضافة أمر نصي");
      return { ok: true, command: normalized };
    });
  }

  async function updateCustomCommand(groupId, commandId, patch, actor) {
    return transact(groupId, (state) => {
      const index = state.commands.findIndex((item) => item.id === commandId);
      if (index < 0) throw new Error("الأمر غير موجود");
      const next = safeCommand({ ...state.commands[index], ...patch, id: commandId });
      if (state.commands.some((item, itemIndex) =>
        itemIndex !== index && item.name.toLowerCase() === next.name.toLowerCase()
      )) throw new Error("اسم الأمر مستخدم بالفعل");
      state.commands[index] = next;
      addAudit(state, actor, "command_update", commandId, "تعديل أمر نصي");
      return { ok: true, command: next };
    });
  }

  async function deleteCustomCommand(groupId, commandId, actor) {
    return transact(groupId, (state) => {
      const command = state.commands.find((item) => item.id === commandId);
      if (!command) throw new Error("الأمر غير موجود");
      command.enabled = false;
      addAudit(state, actor, "command_disable", commandId, "تعطيل أمر نصي");
      return { ok: true };
    });
  }

  async function runCustomCommand(groupId, commandName, values) {
    const state = await getGroup(groupId);
    if (!state.enabled || !state.modules.customCommands) return null;
    const command = state.commands.find((item) =>
      item.enabled && item.name.toLowerCase() === String(commandName).toLowerCase()
    );
    if (!command) return null;
    return renderMessageTemplate(command.response, values);
  }

  async function addAdministrator(groupId, phoneNumber, permissions, actor, linkedUserId = null) {
    const phone = String(phoneNumber || "").replace(/\D/g, "");
    if (phone.length < 6 || phone.length > 20) throw new Error("رقم واتساب غير صالح");
    const allowed = new Set(["view", "points", "members", "catalog", "messages", "commands", "logs", "settings"]);
    const selected = [...new Set((Array.isArray(permissions) ? permissions : []).filter((item) => allowed.has(item)))];
    if (!selected.length) throw new Error("اختر صلاحية واحدة على الأقل");
    return transact(groupId, (state) => {
      const entry = {
        phoneNumber: phone,
        linkedUserId: linkedUserId ? String(linkedUserId) : null,
        permissions: selected,
        enabled: true,
        addedBy: String(actor),
        addedAt: now().toISOString(),
      };
      const index = state.administrators.findIndex((admin) => admin.phoneNumber === phone);
      if (index >= 0) state.administrators[index] = entry;
      else state.administrators.push(entry);
      addAudit(state, actor, "administrator_add", phone, "إضافة مشرف", { permissions: selected });
      return { ok: true, administrator: entry };
    });
  }

  async function removeAdministrator(groupId, phoneNumber, actor) {
    const phone = String(phoneNumber || "").replace(/\D/g, "");
    return transact(groupId, (state) => {
      const administrator = state.administrators.find((item) => item.phoneNumber === phone);
      if (!administrator) throw new Error("المشرف غير موجود");
      administrator.enabled = false;
      addAudit(state, actor, "administrator_disable", phone, "تعطيل مشرف");
      return { ok: true };
    });
  }

  async function hasPermission(groupId, actor, permission) {
    const state = await getGroup(groupId);
    const id = String(actor || "");
    if (state.ownerId === id) return true;
    const separator = id.lastIndexOf("@");
    const domain = separator < 0 ? "" : id.slice(separator + 1).toLowerCase();
    const local = separator < 0 ? "" : id.slice(0, separator).replace(/:\d+$/, "");
    const normalizedPhone = ["s.whatsapp.net", "c.us"].includes(domain) && /^\+?\d+$/.test(local)
      ? local.replace(/\D/g, "")
      : "";
    if (normalizedPhone && normalizedPhone === String(state.ownerPhoneNumber || "")) return true;
    return state.administrators.some((admin) =>
      admin.enabled &&
      (admin.linkedUserId === id || admin.phoneNumber === normalizedPhone) &&
      admin.permissions.includes(permission)
    );
  }

  async function getSlots(groupId) {
    const state = await getGroup(groupId);
    return deepClone(state.slots);
  }

  async function refreshSlots(groupId, members, actor) {
    return transact(groupId, (state) => {
      state.slots = members.map((member, index) => ({
        slot: index + 1,
        memberId: cleanMemberId(member.memberId || member.id),
        name: String(member.name || member.notify || "").slice(0, 80),
        active: true,
      }));
      addAudit(state, actor, "slots_refresh", groupId, "إعادة ترتيب قائمة الأعضاء", { count: state.slots.length });
      return { ok: true, slots: deepClone(state.slots) };
    });
  }

  async function markMemberLeft(groupId, memberId) {
    const id = cleanMemberId(memberId);
    return transact(groupId, (state) => {
      state.slots = state.slots.map((slot) =>
        slot.memberId === id ? { ...slot, memberId: null, name: "", active: false } : slot
      );
      return { ok: true };
    });
  }

  async function getSlotMember(groupId, slotNumber) {
    const state = await getGroup(groupId);
    const number = clampInt(slotNumber, 1, 10_000, "رقم الخانة");
    const slot = state.slots.find((item) => item.slot === number);
    if (!slot?.memberId || slot.active === false) throw new Error("الخانة فارغة أو لم تعد مرتبطة بعضو");
    const account = state.accounts[slot.memberId];
    if (!account || account.enabled === false) throw new Error("حساب صاحب الخانة غير نشط");
    return { ...slot, member: serializedMember(state, account) };
  }

  async function adjustSlot(groupId, slotNumber, amount, actor, reason) {
    const delta = clampInt(amount, -1_000_000, 1_000_000, "مقدار النقاط");
    if (!delta) throw new Error("أدخل مبلغًا غير صفري");
    const why = String(reason || "تعديل من قائمة الأعضاء").trim();
    return transact(groupId, (state) => {
      const number = clampInt(slotNumber, 1, 10_000, "رقم الخانة");
      const slot = state.slots.find((item) => item.slot === number);
      if (!slot?.memberId || slot.active === false) throw new Error("الخانة فارغة");
      const account = state.accounts[slot.memberId];
      if (!account || account.enabled === false) throw new Error("حساب صاحب الخانة غير نشط");
      if (account.balance + delta < 0) throw new Error("لا يمكن أن يصبح الرصيد سالبًا");
      appendTransaction(state, account, delta, "slot_adjustment", why, actor, null, now());
      addAudit(state, actor, "slot_adjust", slot.memberId, why, { slot: number, amount: delta });
      return { ok: true, slot: number, member: serializedMember(state, account), amount: delta };
    });
  }

  async function updateGroupData(groupId, collection, data, actor) {
    const allowed = new Set(["events", "teams", "challenges"]);
    if (!allowed.has(collection) || !Array.isArray(data) || data.length > 500) {
      throw new Error("بيانات النظام الإضافي غير صالحة");
    }
    return transact(groupId, (state) => {
      state[collection] = data.map((item, index) => {
        if (!item || typeof item !== "object" || Array.isArray(item)) throw new Error("عنصر غير صالح");
        const title = String(item.title || item.name || "").trim().slice(0, 100);
        const id = String(item.id || `${collection}-${index + 1}`).replace(/[^a-z0-9_-]/gi, "").slice(0, 50);
        if (!title || !id) throw new Error("المعرّف والاسم مطلوبان");
        return {
          id,
          title,
          description: String(item.description || "").slice(0, 500),
          enabled: item.enabled !== false,
          startsAt: item.startsAt ? String(item.startsAt) : null,
          endsAt: item.endsAt ? String(item.endsAt) : null,
          reward: clampInt(item.reward ?? 0, 0, 1_000_000, "المكافأة"),
        };
      });
      addAudit(state, actor, `${collection}_update`, groupId, `تحديث ${collection}`);
      return { ok: true, [collection]: deepClone(state[collection]) };
    });
  }

  async function assignMemberToTeam(groupId, memberId, teamId, actor) {
    const id = cleanMemberId(memberId);
    return transact(groupId, (state) => {
      if (!state.modules.teams) throw new Error("الفرق غير مفعّلة");
      const team = state.teams.find((item) => item.id === teamId && item.enabled !== false);
      if (!team) throw new Error("الفريق غير موجود أو متوقف");
      const account = ensureAccount(state, id);
      account.teamId = team.id;
      addAudit(state, actor, "team_assign", id, "تعيين عضو إلى فريق", { teamId: team.id });
      return { ok: true, member: serializedMember(state, account), team };
    });
  }

  async function getReport(groupId, days = 14) {
    const state = await getGroup(groupId);
    const count = clampInt(days, 7, 90, "عدد أيام التقرير");
    const end = now();
    const dailyMap = new Map();
    for (let offset = count - 1; offset >= 0; offset -= 1) {
      const date = new Date(end.getTime() - offset * 86_400_000);
      const key = groupWorldDayKey(date);
      if (!dailyMap.has(key)) dailyMap.set(key, { day: key, earned: 0, spent: 0, messages: 0 });
    }
    for (const transaction of state.transactions) {
      const day = groupWorldDayKey(new Date(transaction.timestamp));
      const entry = dailyMap.get(day);
      if (!entry) continue;
      if (transaction.amount > 0) entry.earned += transaction.amount;
      else entry.spent += Math.abs(transaction.amount);
      if (transaction.kind === "message") entry.messages += 1;
    }
    const daily = [...dailyMap.values()];
    return {
      days: count,
      daily,
      totals: {
        earned: daily.reduce((sum, entry) => sum + entry.earned, 0),
        spent: daily.reduce((sum, entry) => sum + entry.spent, 0),
        messages: daily.reduce((sum, entry) => sum + entry.messages, 0),
      },
    };
  }

  async function settleSeason(groupId, actor) {
    return transact(groupId, (state) => {
      const season = state.season;
      if (!season?.enabled) throw new Error("لا يوجد موسم نشط");
      if (season.settledAt) throw new Error("تم توزيع جوائز هذا الموسم بالفعل");
      const startsAt = Date.parse(season.startsAt || season.createdAt || "1970-01-01");
      const endsAt = season.endsAt ? Date.parse(season.endsAt) : now().getTime();
      if (endsAt > now().getTime()) throw new Error("لا يمكن توزيع الجوائز قبل نهاية الموسم");
      const scores = new Map();
      for (const transaction of state.transactions) {
        const at = Date.parse(transaction.timestamp);
        if (
          transaction.amount > 0 &&
          transaction.kind !== "starting_balance" &&
          at >= startsAt &&
          at <= endsAt
        ) {
          scores.set(transaction.memberId, (scores.get(transaction.memberId) || 0) + transaction.amount);
        }
      }
      const winners = [...scores.entries()]
        .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
        .slice(0, 3)
        .map(([memberId, score], index) => ({
          memberId,
          score,
          place: index + 1,
          share: [0.6, 0.25, 0.15][index],
        }));
      if (!winners.length) throw new Error("لا توجد نقاط مكتسبة في فترة الموسم");
      const reward = clampInt(season.reward, 0, 1_000_000, "جائزة الموسم");
      const awarded = [];
      for (const winner of winners) {
        const account = state.accounts[winner.memberId];
        if (!account) continue;
        const requested = winner.place === winners.length
          ? reward - awarded.reduce((sum, entry) => sum + entry.requested, 0)
          : Math.floor(reward * winner.share);
        const credited = grantCappedReward(
          state,
          account,
          requested,
          "season_reward",
          `جائزة الموسم — المركز ${winner.place}`,
          actor,
          `${season.id}:${winner.memberId}`,
          now(),
        );
        awarded.push({ ...winner, requested, credited });
      }
      season.settledAt = now().toISOString();
      season.winners = awarded;
      addAudit(state, actor, "season_settle", season.id, "توزيع جوائز الموسم", { winners: awarded });
      return { ok: true, season: deepClone(season), winners: awarded };
    });
  }

  async function getOverview(groupId) {
    const state = await getGroup(groupId);
    const members = Object.values(state.accounts).filter((account) => account.enabled !== false);
    const totalBalance = members.reduce((sum, account) => sum + account.balance, 0);
    const totalMessages = members.reduce((sum, account) => sum + account.messages, 0);
    const top = [...members].sort((a, b) => b.balance - a.balance).slice(0, 5);
    const recent = state.transactions.slice(-8).reverse();
    return {
      groupId: state.groupId,
      enabled: state.enabled,
      ownerId: state.ownerId,
      activatedAt: state.activatedAt,
      modules: deepClone(state.modules),
      members: members.length,
      totalBalance,
      totalMessages,
      totalEarned: members.reduce((sum, account) => sum + account.totalEarned, 0),
      totalSpent: members.reduce((sum, account) => sum + account.totalSpent, 0),
      spamViolations: state.violations.length,
      pets: state.catalogs.pets.filter((pet) => pet.enabled !== false).length,
      shopItems: state.catalogs.items.filter((item) => item.enabled !== false).length,
      topMembers: top.map((account) => serializedMember(state, account)),
      mostActiveMembers: [...members].sort((a, b) => b.messages - a.messages).slice(0, 5).map((account) => serializedMember(state, account)),
      topEarners: [...members].sort((a, b) => b.totalEarned - a.totalEarned).slice(0, 5).map((account) => serializedMember(state, account)),
      topSpenders: [...members].sort((a, b) => b.totalSpent - a.totalSpent).slice(0, 5).map((account) => serializedMember(state, account)),
      recentTransactions: recent,
      settings: deepClone(state.settings),
      catalogs: deepClone(state.catalogs),
      commands: deepClone(state.commands),
      commandSettings: deepClone(state.commandSettings),
      administrators: deepClone(state.administrators),
      slotsCount: state.slots.length,
      teams: state.teams.map((team) => ({
        ...deepClone(team),
        balance: members
          .filter((account) => account.teamId === team.id)
          .reduce((sum, account) => sum + account.balance, 0),
        members: members.filter((account) => account.teamId === team.id).length,
      })),
      challenges: deepClone(state.challenges),
      events: deepClone(state.events),
      season: deepClone(state.season),
      games: deepClone(state.games.filter((game) => game.status === "active")),
      gameHistory: deepClone(state.gameHistory.slice(-50).reverse()),
      gameBans: deepClone(state.gameBans),
      guilds: deepClone(state.guilds),
      tournaments: deepClone(state.tournaments),
      bossRaids: deepClone(state.bossRaids.slice(-10).reverse()),
      treasureHunts: deepClone(state.treasureHunts.slice(-10).reverse()),
      dungeons: deepClone(state.dungeons.slice(-30).reverse()),
      wordHunts: deepClone(state.wordHunts.slice(-10).reverse()),
      rewardReports: state.rewardReports.slice(-20).reverse().map(({ memberSnapshots, payouts, ...report }) => deepClone(report)),
    };
  }

  async function getLogs(groupId, kind = "all", limit = 100) {
    const state = await getGroup(groupId);
    const count = clampInt(limit, 1, 500, "عدد السجلات");
    const entries = kind === "audit"
      ? state.auditLog
      : kind === "violations"
        ? state.violations
        : state.transactions;
    return entries.slice(-count).reverse();
  }

  async function markMemberJoined(groupId, member) {
    const id = cleanMemberId(member.memberId || member.id);
    return transact(groupId, (state) => {
      if (!state.enabled) return { ignored: true };
      const account = ensureAccount(state, id, member.name || member.notify);
      if (state.modules.economy) initializeAccount(state, account, now());
      if (!state.slots.some((slot) => slot.memberId === id && slot.active !== false)) {
        const slot = state.slots.length + 1;
        state.slots.push({ slot, memberId: id, name: account.name, active: true });
      }
      return { ok: true };
    });
  }

  async function canKickAfterSpam(groupId) {
    const state = await getGroup(groupId);
    return Number(state.settings.antiSpam.kickAfterSpamMessages) > 0;
  }

  async function getPublicCommands(groupId) {
    const state = await getGroup(groupId);
    const custom = state.commands.filter((item) => item.enabled).map((item) => item.name);
    const builtin = BUILTIN_COMMANDS.filter((command) => state.commandSettings[command] !== false);
    return [...new Set([...builtin, ...custom])];
  }

  async function createChallenge(groupId, memberId, opponentId, stake, actor) {
    const challenger = cleanMemberId(memberId);
    const opponent = cleanMemberId(opponentId);
    const amount = clampInt(stake, 1, 100_000, "مبلغ التحدي");
    return transact(groupId, (state) => {
      if (!state.modules.challenges) throw new Error("التحديات غير مفعّلة");
      const a = ensureAccount(state, challenger);
      const b = ensureAccount(state, opponent);
      if (a.balance < amount || b.balance < amount) throw new Error("لا يملك أحد الطرفين رصيدًا كافيًا");
      const challenge = {
        id: `challenge-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
        challenger,
        opponent,
        stake: amount,
        status: "open",
        createdAt: now().toISOString(),
        createdBy: String(actor || challenger),
      };
      state.challenges.push(challenge);
      addAudit(state, actor, "challenge_create", challenge.id, "إنشاء تحدٍ", { challenger, opponent, stake: amount });
      return deepClone(challenge);
    });
  }

  async function acceptChallenge(groupId, challengeId, memberId) {
    const acceptingMember = cleanMemberId(memberId);
    return transact(groupId, (state) => {
      if (!state.modules.challenges) throw new Error("التحديات غير مفعّلة");
      const challenge = state.challenges.find((item) => item.id === challengeId);
      if (!challenge || challenge.status !== "open") throw new Error("التحدي غير متاح للقبول");
      if (challenge.opponent !== acceptingMember) throw new Error("هذا التحدي موجّه إلى عضو آخر");
      const challenger = ensureAccount(state, challenge.challenger);
      const opponent = ensureAccount(state, challenge.opponent);
      initializeAccount(state, challenger, now());
      initializeAccount(state, opponent, now());
      const stake = clampInt(challenge.stake, 1, 100_000, "رهان التحدي");
      if (challenger.balance < stake || opponent.balance < stake) {
        throw new Error("رصيد أحد الطرفين لم يعد كافيًا");
      }
      appendTransaction(state, challenger, -stake, "challenge_stake", "حجز رهان التحدي", acceptingMember, null, now());
      appendTransaction(state, opponent, -stake, "challenge_stake", "حجز رهان التحدي", acceptingMember, null, now());
      challenge.status = "accepted";
      challenge.acceptedAt = now().toISOString();
      addAudit(state, acceptingMember, "challenge_accept", challenge.id, "قبول تحدٍ", { stake });
      return deepClone(challenge);
    });
  }

  async function settleChallenge(groupId, challengeId, winnerId, actor) {
    const winner = cleanMemberId(winnerId);
    return transact(groupId, (state) => {
      const challenge = state.challenges.find((item) => item.id === challengeId);
      if (!challenge || challenge.status === "settled" || challenge.status === "cancelled") {
        throw new Error("التحدي غير مفتوح");
      }
      if (![challenge.challenger, challenge.opponent].includes(winner)) throw new Error("الفائز ليس طرفًا في التحدي");
      const loser = winner === challenge.challenger ? challenge.opponent : challenge.challenger;
      const winnerAccount = ensureAccount(state, winner);
      const stake = clampInt(challenge.stake, 1, 100_000, "رهان التحدي");
      if (challenge.status !== "accepted") throw new Error("يجب قبول التحدي قبل تسويته");
      const prize = stake * 2;
      appendTransaction(state, winnerAccount, prize, "challenge_win", "الفوز برهان التحدي", actor, null, now());
      const bonus = Math.round(prize * (petMultiplier(state, winnerAccount, "challenge") - 1));
      if (bonus > 0) {
        grantCappedReward(state, winnerAccount, bonus, "pet_challenge_bonus", "زيادة الحيوان على جائزة التحدي", actor, null, now());
      }
      challenge.status = "settled";
      challenge.winnerId = winner;
      challenge.settledAt = now().toISOString();
      addAudit(state, actor, "challenge_settle", challenge.id, "تسوية تحدٍ", { winner, loser, stake });
      return { ok: true, challenge: deepClone(challenge) };
    });
  }

  function requirePlayableMember(state, memberId, feature) {
    if (!state.enabled) throw new Error("عالم المجموعة غير مفعّل");
    if (!state.modules[feature]) throw new Error("هذه اللعبة متوقفة في المجموعة");
    const id = cleanMemberId(memberId);
    if (gameIsBanned(state, id, feature)) throw new Error("أنت محظور من هذه اللعبة في المجموعة");
    const account = ensureAccount(state, id);
    if (account.enabled === false) throw new Error("حسابك معطّل في العالم");
    if (state.modules.economy) initializeAccount(state, account, now());
    return account;
  }

  function storeFinishedGame(state, game) {
    game.finishedAt ||= now().toISOString();
    state.gameHistory.push(deepClone(game));
    if (state.gameHistory.length > 500) state.gameHistory.splice(0, state.gameHistory.length - 500);
  }

  function ticTacToeWinner(board) {
    const lines = [
      [0, 1, 2], [3, 4, 5], [6, 7, 8],
      [0, 3, 6], [1, 4, 7], [2, 5, 8],
      [0, 4, 8], [2, 4, 6],
    ];
    for (const [a, b, c] of lines) {
      if (board[a] && board[a] === board[b] && board[a] === board[c]) return board[a];
    }
    return board.every(Boolean) ? "draw" : null;
  }

  async function startTicTacToe(groupId, xPlayerId, oPlayerId, names = {}) {
    const xPlayer = cleanMemberId(xPlayerId);
    const oPlayer = cleanMemberId(oPlayerId);
    if (xPlayer === oPlayer) throw new Error("اختر خصمًا مختلفًا عنك");
    return transact(groupId, (state) => {
      requirePlayableMember(state, xPlayer, "ticTacToe");
      requirePlayableMember(state, oPlayer, "ticTacToe");
      const conflict = state.games.find((game) =>
        game.kind === "xo" && game.status === "active" &&
        [game.xPlayer, game.oPlayer].includes(xPlayer) &&
        [game.xPlayer, game.oPlayer].includes(oPlayer)
      );
      if (conflict) throw new Error("توجد مباراة نشطة بين هذين العضوين بالفعل");
      const game = {
        id: gameId("xo"),
        kind: "xo",
        xPlayer,
        oPlayer,
        players: [xPlayer, oPlayer],
        names: { [xPlayer]: String(names.x || "").slice(0, 80), [oPlayer]: String(names.o || "").slice(0, 80) },
        board: Array(9).fill(null),
        turn: xPlayer,
        status: "active",
        winnerId: null,
        createdAt: now().toISOString(),
        finishedAt: null,
      };
      state.games.push(game);
      return deepClone(game);
    });
  }

  async function moveTicTacToe(groupId, gameIdValue, memberId, position) {
    const actor = cleanMemberId(memberId);
    const cell = clampInt(position, 0, 8, "رقم الخانة");
    return transact(groupId, (state) => {
      const game = state.games.find((item) => item.id === gameIdValue && item.kind === "xo");
      if (!game || game.status !== "active") throw new Error("المباراة غير نشطة");
      if (![game.xPlayer, game.oPlayer].includes(actor)) throw new Error("أنت لست لاعبًا في هذه المباراة");
      if (game.turn !== actor) throw new Error("ليس دورك الآن");
      if (game.board[cell]) throw new Error("هذه الخانة مستخدمة بالفعل");
      const mark = actor === game.xPlayer ? "X" : "O";
      game.board[cell] = mark;
      game.turn = actor === game.xPlayer ? game.oPlayer : game.xPlayer;
      const result = ticTacToeWinner(game.board);
      if (result) {
        game.status = result === "draw" ? "draw" : "finished";
        game.winnerId = result === "draw" ? null : result === "X" ? game.xPlayer : game.oPlayer;
        game.finishedAt = now().toISOString();
        const xAccount = ensureAccount(state, game.xPlayer);
        const oAccount = ensureAccount(state, game.oPlayer);
        xAccount.gameStats ||= {};
        oAccount.gameStats ||= {};
        xAccount.gameStats.xo ||= { wins: 0, losses: 0, draws: 0 };
        oAccount.gameStats.xo ||= { wins: 0, losses: 0, draws: 0 };
        const rewards = state.settings.gameplay.xo;
        if (result === "draw") {
          xAccount.gameStats.xo.draws += 1;
          oAccount.gameStats.xo.draws += 1;
          game.rewards = {
            [game.xPlayer]: applyGameReward(state, xAccount, rewards.drawPoints, rewards.drawXp, "تعادل لعبة XO", `${game.id}:draw:${game.xPlayer}`, now()),
            [game.oPlayer]: applyGameReward(state, oAccount, rewards.drawPoints, rewards.drawXp, "تعادل لعبة XO", `${game.id}:draw:${game.oPlayer}`, now()),
          };
        } else {
          const winner = game.winnerId;
          const loser = winner === game.xPlayer ? game.oPlayer : game.xPlayer;
          const winnerAccount = winner === game.xPlayer ? xAccount : oAccount;
          const loserAccount = loser === game.xPlayer ? xAccount : oAccount;
          winnerAccount.gameStats.xo.wins += 1;
          loserAccount.gameStats.xo.losses += 1;
          game.rewards = {
            [winner]: applyGameReward(state, winnerAccount, rewards.winPoints, rewards.winXp, "الفوز في لعبة XO", `${game.id}:win:${winner}`, now()),
          };
        }
        storeFinishedGame(state, game);
        resolveTournamentGame(state, game);
      }
      return deepClone(game);
    });
  }

  async function cancelTicTacToe(groupId, gameIdValue, memberId) {
    const actor = cleanMemberId(memberId);
    return transact(groupId, (state) => {
      const game = state.games.find((item) => item.id === gameIdValue && item.kind === "xo");
      if (!game || game.status !== "active") throw new Error("المباراة غير نشطة");
      if (![game.xPlayer, game.oPlayer].includes(actor)) throw new Error("أنت لست لاعبًا في هذه المباراة");
      game.status = "cancelled";
      game.cancelledBy = actor;
      game.finishedAt = now().toISOString();
      storeFinishedGame(state, game);
      return deepClone(game);
    });
  }

  async function replayTicTacToe(groupId, gameIdValue, memberId) {
    const actor = cleanMemberId(memberId);
    const state = await getGroup(groupId);
    const game = state.games.find((item) => item.id === gameIdValue && item.kind === "xo");
    if (!game || !["finished", "draw", "cancelled"].includes(game.status)) throw new Error("لا يمكن إعادة هذه المباراة الآن");
    if (![game.xPlayer, game.oPlayer].includes(actor)) throw new Error("أنت لست لاعبًا في هذه المباراة");
    const replay = await startTicTacToe(groupId, game.xPlayer, game.oPlayer, {
      x: game.names?.[game.xPlayer],
      o: game.names?.[game.oPlayer],
    });
    const tournamentMatch = await getTournamentMatchForMember(groupId, actor);
    if (tournamentMatch?.match?.status === "pending") {
      const entries = tournamentMatch.tournament.entries;
      const xEntry = entries.find((entry) => entry.members?.includes(replay.xPlayer));
      const oEntry = entries.find((entry) => entry.members?.includes(replay.oPlayer));
      if (
        xEntry && oEntry &&
        tournamentMatch.match.players.includes(xEntry.id) &&
        tournamentMatch.match.players.includes(oEntry.id)
      ) {
        await attachTournamentGame(
          groupId,
          tournamentMatch.tournament.id,
          tournamentMatch.match.id,
          replay.id,
          { [replay.xPlayer]: xEntry.id, [replay.oPlayer]: oEntry.id },
        );
      }
    }
    return replay;
  }

  function publicMemberChallenge(challenge) {
    if (!challenge) return null;
    const { answer, ...publicValue } = challenge;
    return deepClone(publicValue);
  }

  async function createMemberChallenge(groupId, challengerId, opponentId, names = {}) {
    const challenger = cleanMemberId(challengerId);
    const opponent = cleanMemberId(opponentId);
    if (challenger === opponent) throw new Error("اختر عضوًا آخر للتحدي");
    return transact(groupId, (state) => {
      requirePlayableMember(state, challenger, "challenges");
      requirePlayableMember(state, opponent, "challenges");
      const conflict = state.challenges.find((item) =>
        item.mode === "game" && ["open", "active"].includes(item.status) &&
        [item.challenger, item.opponent].includes(challenger) &&
        [item.challenger, item.opponent].includes(opponent)
      );
      if (conflict) throw new Error("يوجد تحدٍ غير منتهٍ بين هذين العضوين بالفعل");
      const customQuestions = state.settings.gameplay.challenges.questions;
      const questions = customQuestions.length ? customQuestions : DEFAULT_CHALLENGE_QUESTIONS;
      const requestedDifficulty = state.settings.gameplay.challenges.difficulty;
      const matchingQuestions = requestedDifficulty === "mixed"
        ? questions
        : questions.filter((item) => item.difficulty === requestedDifficulty);
      const questionPool = matchingQuestions.length ? matchingQuestions : questions;
      const question = questionPool[Math.floor(Math.random() * questionPool.length)];
      const type = String(question.type || "custom").replace(/[^A-Z0-9]+/gi, "_").toUpperCase();
      const challenge = {
        id: gameId("challenge"),
        name: `THE_LEGENDARY_${type}_BATTLE_${now().getFullYear()}_${randomUUID().replaceAll("-", "").slice(0, 6).toUpperCase()}`,
        mode: "game",
        challenger,
        opponent,
        names: {
          [challenger]: String(names.challenger || "").slice(0, 80),
          [opponent]: String(names.opponent || "").slice(0, 80),
        },
        type: String(question.type || "custom"),
        typeLabel: String(question.label || question.type || "تحدٍ").slice(0, 60),
        prompt: String(question.prompt || "").slice(0, 500),
        answer: normalizeGameAnswer(question.answer),
        difficulty: state.settings.gameplay.challenges.difficulty,
        status: "open",
        answersUsed: [],
        expiresAt: new Date(now().getTime() + 5 * 60_000).toISOString(),
        createdAt: now().toISOString(),
      };
      state.challenges.push(challenge);
      if (state.challenges.length > 1_000) state.challenges.splice(0, state.challenges.length - 1_000);
      addAudit(state, challenger, "game_challenge_create", challenge.id, "إنشاء تحدي أعضاء", { type: challenge.type });
      return publicMemberChallenge(challenge);
    });
  }

  async function acceptMemberChallenge(groupId, challengeName, memberId, challengerId = null) {
    const accepting = cleanMemberId(memberId);
    const expectedChallenger = challengerId ? cleanMemberId(challengerId) : null;
    return transact(groupId, (state) => {
      const challenge = state.challenges.find((item) =>
        item.mode === "game" && item.name === String(challengeName || "")
      );
      if (!challenge || challenge.status !== "open") throw new Error("اسم التحدي غير صحيح أو لم يعد متاحًا");
      if (challenge.expiresAt && Date.parse(challenge.expiresAt) <= now().getTime()) throw new Error("انتهى وقت قبول هذا التحدي");
      if (challenge.opponent !== accepting) throw new Error("هذا التحدي موجّه إلى عضو آخر");
      if (expectedChallenger && challenge.challenger !== expectedChallenger) throw new Error("اسم المتحدي لا يطابق هذا التحدي");
      requirePlayableMember(state, accepting, "challenges");
      requirePlayableMember(state, challenge.challenger, "challenges");
      challenge.status = "active";
      challenge.acceptedAt = now().toISOString();
      challenge.expiresAt = new Date(now().getTime() + Number(state.settings.gameplay.challenges.durationMinutes) * 60_000).toISOString();
      addAudit(state, accepting, "game_challenge_accept", challenge.id, "قبول تحدي أعضاء");
      return publicMemberChallenge(challenge);
    });
  }

  async function rejectMemberChallenge(groupId, challengeName, memberId, challengerId = null) {
    const rejecting = cleanMemberId(memberId);
    const expectedChallenger = challengerId ? cleanMemberId(challengerId) : null;
    return transact(groupId, (state) => {
      const challenge = state.challenges.find((item) =>
        item.mode === "game" &&
        (!challengeName || item.name === String(challengeName)) &&
        item.opponent === rejecting &&
        (!expectedChallenger || item.challenger === expectedChallenger) &&
        item.status === "open"
      );
      if (!challenge || challenge.status !== "open") throw new Error("التحدي غير موجود أو لم يعد مفتوحًا");
      if (challenge.expiresAt && Date.parse(challenge.expiresAt) <= now().getTime()) throw new Error("انتهى وقت هذا التحدي");
      challenge.status = "rejected";
      challenge.finishedAt = now().toISOString();
      return publicMemberChallenge(challenge);
    });
  }

  async function listMemberChallenges(groupId, memberId) {
    const id = cleanMemberId(memberId);
    const state = await getGroup(groupId);
    return state.challenges
      .filter((item) => item.mode === "game" && [item.challenger, item.opponent].includes(id) &&
        ["open", "active"].includes(item.status))
      .map(publicMemberChallenge);
  }

  async function cancelMemberChallenge(groupId, memberId, challengeName = "") {
    const actor = cleanMemberId(memberId);
    return transact(groupId, (state) => {
      const challenge = state.challenges.find((item) =>
        item.mode === "game" &&
        (!challengeName || item.name === challengeName || item.id === challengeName) &&
        [item.challenger, item.opponent].includes(actor) &&
        ["open", "active"].includes(item.status)
      );
      if (!challenge) throw new Error("لا يوجد تحدٍ مفتوح يمكنك إلغاؤه");
      challenge.status = "cancelled";
      challenge.cancelledBy = actor;
      challenge.finishedAt = now().toISOString();
      return publicMemberChallenge(challenge);
    });
  }

  async function answerMemberChallenge(groupId, challengeName, memberId, answerValue) {
    const actor = cleanMemberId(memberId);
    const answer = normalizeGameAnswer(answerValue);
    if (!answer) throw new Error("اكتب إجابة بعد اسم التحدي");
    return transact(groupId, (state) => {
      const challenge = state.challenges.find((item) => item.mode === "game" && item.name === challengeName);
      if (!challenge || challenge.status !== "active") throw new Error("التحدي غير نشط");
      if (![challenge.challenger, challenge.opponent].includes(actor)) throw new Error("أنت لست طرفًا في هذا التحدي");
      if (Date.parse(challenge.expiresAt) <= now().getTime()) {
        challenge.status = "draw";
        challenge.finishedAt = now().toISOString();
        const rewards = state.settings.gameplay.challenges;
        for (const id of [challenge.challenger, challenge.opponent]) {
          const account = ensureAccount(state, id);
          account.gameStats ||= {};
          account.gameStats.challenges ||= { wins: 0, losses: 0, draws: 0 };
          account.gameStats.challenges.draws += 1;
          applyGameReward(state, account, rewards.drawPoints, rewards.drawXp, "تعادل تحدي أعضاء", `${challenge.id}:draw:${id}`, now());
        }
        storeFinishedGame(state, { id: challenge.id, kind: "challenge", status: "draw", players: [challenge.challenger, challenge.opponent], finishedAt: challenge.finishedAt });
        return { ok: false, expired: true, correct: false, challenge: publicMemberChallenge(challenge) };
      }
      if (challenge.answersUsed.includes(answer)) throw new Error("تم إرسال هذه الإجابة من قبل");
      challenge.answersUsed.push(answer);
      challenge.attempts ||= [];
      challenge.attempts.push({ memberId: actor, answer, at: now().toISOString() });
      if (answer !== challenge.answer) return { ok: false, correct: false, challenge: publicMemberChallenge(challenge) };
      challenge.status = "finished";
      challenge.winnerId = actor;
      challenge.finishedAt = now().toISOString();
      const winnerId = actor;
      const loserId = actor === challenge.challenger ? challenge.opponent : challenge.challenger;
      const winner = ensureAccount(state, winnerId);
      const loser = ensureAccount(state, loserId);
      winner.gameStats ||= {};
      loser.gameStats ||= {};
      winner.gameStats.challenges ||= { wins: 0, losses: 0, draws: 0 };
      loser.gameStats.challenges ||= { wins: 0, losses: 0, draws: 0 };
      winner.gameStats.challenges.wins += 1;
      loser.gameStats.challenges.losses += 1;
      const rewards = state.settings.gameplay.challenges;
      challenge.rewards = applyGameReward(
        state,
        winner,
        rewards.rewardPoints,
        rewards.rewardXp,
        `الفوز في ${challenge.typeLabel}`,
        `${challenge.id}:${winnerId}`,
        now(),
      );
      storeFinishedGame(state, { id: challenge.id, kind: "challenge", status: "finished", players: [challenge.challenger, challenge.opponent], winnerId, challengeName, type: challenge.type, finishedAt: challenge.finishedAt, rewards: challenge.rewards });
      addAudit(state, actor, "game_challenge_win", challenge.id, "الفوز بتحدي أعضاء", { winnerId });
      return { ok: true, correct: true, challenge: publicMemberChallenge(challenge) };
    });
  }

  async function expireMemberChallenges(groupId, at = now()) {
    return transact(groupId, (state) => {
      const expired = [];
      for (const challenge of state.challenges) {
        if (challenge.mode !== "game" || !["open", "active"].includes(challenge.status) || Date.parse(challenge.expiresAt) > at.getTime()) continue;
        challenge.status = challenge.status === "active" ? "draw" : "expired";
        challenge.finishedAt = at.toISOString();
        if (challenge.status === "draw") {
          const rewards = state.settings.gameplay.challenges;
          for (const id of [challenge.challenger, challenge.opponent]) {
            const account = ensureAccount(state, id);
            account.gameStats ||= {};
            account.gameStats.challenges ||= { wins: 0, losses: 0, draws: 0 };
            account.gameStats.challenges.draws += 1;
            applyGameReward(state, account, rewards.drawPoints, rewards.drawXp, "تعادل تحدي أعضاء", `${challenge.id}:draw:${id}`, at);
          }
          storeFinishedGame(state, { id: challenge.id, kind: "challenge", status: "draw", players: [challenge.challenger, challenge.opponent], finishedAt: challenge.finishedAt });
        }
        expired.push(publicMemberChallenge(challenge));
      }
      return expired;
    });
  }

  async function distributeScheduledReward(groupId, type, periodKey, at = now()) {
    if (!["daily", "weekly"].includes(type)) throw new Error("نوع التوزيع غير صالح");
    const period = String(periodKey || "").trim();
    if (!period || period.length > 40) throw new Error("معرّف فترة التوزيع غير صالح");
    const reportId = `${type}:${normalizeGroupId(groupId)}:${period}`;
    return transact(groupId, (state) => {
      const previousRun = state.rewardReports.find((report) => report.id === reportId);
      if (previousRun) return { ...deepClone(previousRun), duplicate: true };
      if (!state.enabled || !state.modules.economy) return { skipped: true, reason: "world_or_economy_disabled" };
      const today = groupWorldDayKey(at);
      const activityDays = type === "daily"
        ? [today]
        : Array.from({ length: 7 }, (_, offset) => {
            const date = new Date(at.getTime() - offset * 86_400_000);
            return groupWorldDayKey(date);
          });
      const eligible = Object.values(state.accounts).filter((account) => account.enabled !== false);
      const beforeRanks = new Map(eligible.map((account) => [account.memberId, memberRank(state, account.memberId).position]));
      const payouts = [];
      for (const account of eligible) {
        const alreadyClaimed = type === "daily"
          ? account.lastDailyAutoPeriod === period
          : account.lastWeeklyAutoPeriod === period;
        if (alreadyClaimed) continue;
        initializeAccount(state, account, at);
        if (type === "daily") account.lastDailyAutoPeriod = period;
        else account.lastWeeklyAutoPeriod = period;
        const base = Number(type === "daily"
          ? state.settings.rewards.dailyGift
          : state.settings.rewards.weeklyGift);
        const requested = Math.max(0, Math.round(base * petMultiplier(state, account, "gift")));
        const credited = grantCappedReward(
          state,
          account,
          requested,
          type === "daily" ? "daily_auto_reward" : "weekly_auto_reward",
          type === "daily" ? "مكافأة اليوم التلقائية" : "مكافأة الأسبوع التلقائية",
          "system",
          `${reportId}:${account.memberId}`,
          at,
        );
        payouts.push({ memberId: account.memberId, name: account.name || account.memberId.split("@")[0], requested, credited, balance: account.balance });
      }
      const snapshots = eligible.map((account) => ({
        memberId: account.memberId,
        name: account.name || account.memberId.split("@")[0],
        balance: account.balance,
        xp: account.xp,
        position: memberRank(state, account.memberId).position,
        messages: activityDays.reduce((sum, day) => sum + Number(account.activityByDay?.[day] || 0), 0),
        xpEarned: activityDays.reduce((sum, day) => sum + Number(account.xpByDay?.[day] || 0), 0),
      }));
      const previous = state.rewardReports
        .filter((report) => report.type === type && report.id !== reportId)
        .sort((a, b) => String(b.periodKey).localeCompare(String(a.periodKey)))[0] || null;
      const previousSnapshots = new Map((previous?.memberSnapshots || []).map((snapshot) => [snapshot.memberId, snapshot]));
      const rankJumps = snapshots.map((snapshot) => {
        const before = previousSnapshots.get(snapshot.memberId)?.position;
        return { ...snapshot, jump: Number.isFinite(before) ? before - snapshot.position : 0 };
      });
      const currentTop = [...snapshots].sort((a, b) => b.balance - a.balance).slice(0, 10);
      const previousTop = previous?.topTen || [];
      const biggestIncrease = [...payouts].sort((a, b) => b.credited - a.credited)[0] || null;
      const mostDeveloped = [...snapshots].sort((a, b) => b.xpEarned - a.xpEarned || b.messages - a.messages)[0] || null;
      const biggestRankJump = rankJumps.sort((a, b) => b.jump - a.jump)[0]?.jump > 0
        ? rankJumps.sort((a, b) => b.jump - a.jump)[0]
        : null;
      const mostActive = [...snapshots].sort((a, b) => b.messages - a.messages)[0] || null;
      const report = {
        id: reportId,
        type,
        groupId: state.groupId,
        periodKey: period,
        createdAt: at.toISOString(),
        totalDistributed: payouts.reduce((sum, payout) => sum + payout.credited, 0),
        requestedTotal: payouts.reduce((sum, payout) => sum + payout.requested, 0),
        beneficiaries: payouts.filter((payout) => payout.credited > 0).length,
        biggestIncrease,
        highestBalance: currentTop[0] || null,
        mostDeveloped,
        biggestRankJump,
        mostActive,
        topTen: currentTop,
        previousComparison: previous ? {
          periodKey: previous.periodKey,
          totalDistributed: previous.totalDistributed,
          beneficiaries: previous.beneficiaries,
          changeDistributed: payouts.reduce((sum, payout) => sum + payout.credited, 0) - Number(previous.totalDistributed || 0),
          changeBeneficiaries: payouts.filter((payout) => payout.credited > 0).length - Number(previous.beneficiaries || 0),
        } : null,
        payouts,
        memberSnapshots: snapshots,
        reportSentAt: null,
      };
      state.rewardReports.push(report);
      if (state.rewardReports.length > 520) state.rewardReports.splice(0, state.rewardReports.length - 520);
      return deepClone(report);
    });
  }

  async function claimRewardReportForDelivery(groupId, reportId) {
    return transact(groupId, (state) => {
      const report = state.rewardReports.find((item) => item.id === reportId);
      if (!report || report.reportSentAt) return null;
      report.reportSentAt = now().toISOString();
      return deepClone(report);
    });
  }

  async function getPetAbilities(groupId, memberId, petName = "") {
    const state = await getGroup(groupId);
    const query = normalizeGameAnswer(petName);
    const account = memberId ? state.accounts[cleanMemberId(memberId)] : null;
    let ownedPet = null;
    let catalog = null;
    if (!query && account?.activePetId) {
      ownedPet = account.pets.find((item) => item.petId === account.activePetId) || null;
      catalog = ownedPet ? petFor(state, ownedPet.petId) : null;
    } else if (query) {
      catalog = state.catalogs.pets.find((item) =>
        item.enabled !== false && (
          normalizeGameAnswer(item.id) === query ||
          normalizeGameAnswer(item.name).includes(query)
        )
      ) || null;
      ownedPet = account?.pets.find((item) => item.petId === catalog?.id) || null;
    }
    if (!catalog) return null;
    const abilityText = {
      chat: "يزيد نقاط الدردشة",
      gift: "يزيد مكافآت الهدايا",
      periodic: "يمنح مكافأة دورية",
      tasks: "يعزز مكافآت المهام",
      challenge: "يعزز مكافآت التحديات",
      activity: "يعزز نقاط النشاط وXP",
    };
    const level = Number(ownedPet?.level || 1);
    return {
      ...deepClone(catalog),
      owned: Boolean(ownedPet),
      level,
      maxLevel: 5,
      abilityDescription: abilityText[catalog.ability] || catalog.ability,
      nextUpgradeCost: ownedPet && level < 5 ? Math.ceil(Number(catalog.price) * 0.35 * level) : null,
      levels: Array.from({ length: 5 }, (_, index) => ({
        level: index + 1,
        value: catalog.ability === "periodic" ? Math.trunc(Number(catalog.value) * (index + 1)) : Number((Number(catalog.value) * (index + 1)).toFixed(2)),
      })),
    };
  }

  async function setGameBan(groupId, memberId, game, enabled, actor) {
    const id = cleanMemberId(memberId);
    const feature = String(game || "").trim();
    const available = new Set(["*", "ticTacToe", "challenges", "bossRaid", "treasure", "guilds", "crafting", "dungeons", "tournaments", "wordHunt", "luckyWheel"]);
    if (!available.has(feature) || typeof enabled !== "boolean") throw new Error("نوع حظر اللعبة غير صالح");
    return transact(groupId, (state) => {
      const existing = state.gameBans.find((entry) => entry.memberId === id && entry.game === feature);
      if (existing) existing.enabled = enabled;
      else state.gameBans.push({ memberId: id, game: feature, enabled, actor: String(actor || "system"), updatedAt: now().toISOString() });
      addAudit(state, actor, enabled ? "game_ban" : "game_unban", id, "تغيير حظر لعبة", { game: feature });
      return { ok: true, memberId: id, game: feature, enabled };
    });
  }

  async function getBossRaid(groupId) {
    return transact(groupId, (state) => {
      if (!state.enabled || !state.modules.bossRaid) throw new Error("زعيم المجموعة متوقف");
      let boss = state.bossRaids.find((item) => item.status === "active" && Date.parse(item.expiresAt) > now().getTime());
      if (!boss) {
        const level = state.bossRaids.length + 1;
        const maxHealth = Math.round(Number(state.settings.gameplay.bossRaid.baseHealth) * (1 + (level - 1) * 0.25));
        boss = {
          id: gameId("boss"),
          title: ["تنين الظلال", "حارس الأعماق", "ملك العواصف", "العملاق الحجري"][((level - 1) % 4)],
          level,
          health: maxHealth,
          maxHealth,
          damage: 0,
          contributions: {},
          status: "active",
          createdAt: now().toISOString(),
          expiresAt: new Date(now().getTime() + 24 * 60 * 60_000).toISOString(),
        };
        state.bossRaids.push(boss);
      }
      return deepClone(boss);
    });
  }

  async function attackBoss(groupId, memberId, name = "") {
    const id = cleanMemberId(memberId);
    return transact(groupId, (state) => {
      const account = requirePlayableMember(state, id, "bossRaid");
      let boss = state.bossRaids.find((item) => item.status === "active" && Date.parse(item.expiresAt) > now().getTime());
      if (!boss) {
        const level = state.bossRaids.length + 1;
        const maxHealth = Math.round(Number(state.settings.gameplay.bossRaid.baseHealth) * (1 + (level - 1) * 0.25));
        boss = {
          id: gameId("boss"),
          title: ["تنين الظلال", "حارس الأعماق", "ملك العواصف", "العملاق الحجري"][(level - 1) % 4],
          level,
          health: maxHealth,
          maxHealth,
          damage: 0,
          contributions: {},
          status: "active",
          createdAt: now().toISOString(),
          expiresAt: new Date(now().getTime() + 24 * 60 * 60_000).toISOString(),
        };
        state.bossRaids.push(boss);
      }
      const damage = Number(state.settings.gameplay.bossRaid.damagePerAction);
      boss.contributions[id] = Number(boss.contributions[id] || 0) + damage;
      boss.damage += damage;
      boss.health = Math.max(0, boss.health - damage);
      account.name ||= String(name || "").slice(0, 80);
      const defeated = boss.health <= 0;
      if (defeated) {
        boss.status = "defeated";
        boss.defeatedAt = now().toISOString();
        boss.winnerIds = Object.keys(boss.contributions);
        const rewards = state.settings.gameplay.bossRaid;
        for (const winnerId of boss.winnerIds) {
          const participant = ensureAccount(state, winnerId);
          applyGameReward(state, participant, rewards.rewardPoints, rewards.rewardXp, `مكافأة هزيمة ${boss.title}`, `${boss.id}:${winnerId}`, now());
        }
      }
      return { boss: deepClone(boss), damage, defeated };
    });
  }

  async function startTreasureHunt(groupId, memberId) {
    const id = cleanMemberId(memberId);
    return transact(groupId, (state) => {
      requirePlayableMember(state, id, "treasure");
      let hunt = state.treasureHunts.find((item) => item.status === "active" && Date.parse(item.expiresAt) > now().getTime());
      if (!hunt) {
        const riddle = DEFAULT_CHALLENGE_QUESTIONS.find((item) => item.type === "riddle");
        hunt = {
          id: gameId("treasure"),
          prompt: riddle.prompt,
          answer: normalizeGameAnswer(riddle.answer),
          status: "active",
          answersUsed: [],
          startedBy: id,
          createdAt: now().toISOString(),
          expiresAt: new Date(now().getTime() + Number(state.settings.gameplay.treasure.durationMinutes) * 60_000).toISOString(),
        };
        state.treasureHunts.push(hunt);
      }
      const { answer, ...publicHunt } = hunt;
      return deepClone(publicHunt);
    });
  }

  async function solveTreasureHunt(groupId, memberId, answerValue) {
    const id = cleanMemberId(memberId);
    const answer = normalizeGameAnswer(answerValue);
    return transact(groupId, (state) => {
      const account = requirePlayableMember(state, id, "treasure");
      const hunt = state.treasureHunts.find((item) => item.status === "active" && Date.parse(item.expiresAt) > now().getTime());
      if (!hunt) throw new Error("لا يوجد بحث عن كنز مفتوح؛ استخدم .كنز للبدء");
      if (hunt.answersUsed.includes(answer)) throw new Error("تمت تجربة هذه الإجابة من قبل");
      hunt.answersUsed.push(answer);
      if (answer !== hunt.answer) return { correct: false, huntId: hunt.id };
      hunt.status = "solved";
      hunt.winnerId = id;
      hunt.solvedAt = now().toISOString();
      const rewards = state.settings.gameplay.treasure;
      const reward = applyGameReward(state, account, rewards.rewardPoints, rewards.rewardXp, "العثور على الكنز", `${hunt.id}:${id}`, now());
      storeFinishedGame(state, { id: hunt.id, kind: "treasure", status: "solved", players: [id], winnerId: id, finishedAt: hunt.solvedAt, rewards: reward });
      return { correct: true, huntId: hunt.id, reward };
    });
  }

  async function startDungeon(groupId, memberId) {
    const id = cleanMemberId(memberId);
    return transact(groupId, (state) => {
      requirePlayableMember(state, id, "dungeons");
      const active = state.dungeons.find((item) => item.memberId === id && item.status === "active" && Date.parse(item.expiresAt) > now().getTime());
      if (active) return deepClone({ ...active, questions: undefined });
      const questions = DEFAULT_CHALLENGE_QUESTIONS.filter((item) => ["riddle", "math", "sequence"].includes(item.type));
      const stages = Number(state.settings.gameplay.dungeons.stages);
      const dungeon = {
        id: gameId("dungeon"),
        memberId: id,
        stage: 1,
        totalStages: stages,
        questions: Array.from({ length: stages }, (_, index) => {
          const question = questions[index % questions.length];
          return { prompt: question.prompt, answer: normalizeGameAnswer(question.answer) };
        }),
        answersUsed: [],
        status: "active",
        startedAt: now().toISOString(),
        expiresAt: new Date(now().getTime() + 30 * 60_000).toISOString(),
      };
      state.dungeons.push(dungeon);
      return deepClone({ ...dungeon, questions: undefined, prompt: dungeon.questions[0].prompt });
    });
  }

  async function answerDungeon(groupId, memberId, answerValue) {
    const id = cleanMemberId(memberId);
    const answer = normalizeGameAnswer(answerValue);
    return transact(groupId, (state) => {
      const account = requirePlayableMember(state, id, "dungeons");
      const dungeon = state.dungeons.find((item) => item.memberId === id && item.status === "active");
      if (!dungeon || Date.parse(dungeon.expiresAt) <= now().getTime()) throw new Error("لا توجد مغامرة نشطة؛ اكتب .مغامرة للبدء");
      if (dungeon.answersUsed.includes(answer)) throw new Error("هذه الإجابة جُرّبت من قبل في المغامرة");
      dungeon.answersUsed.push(answer);
      const question = dungeon.questions[dungeon.stage - 1];
      if (answer !== question.answer) return { correct: false, stage: dungeon.stage, totalStages: dungeon.totalStages };
      dungeon.stage += 1;
      if (dungeon.stage <= dungeon.totalStages) {
        return { correct: true, completed: false, stage: dungeon.stage, totalStages: dungeon.totalStages, prompt: dungeon.questions[dungeon.stage - 1].prompt };
      }
      dungeon.status = "completed";
      dungeon.finishedAt = now().toISOString();
      const reward = applyGameReward(
        state,
        account,
        state.settings.gameplay.dungeons.rewardPoints,
        state.settings.gameplay.dungeons.rewardXp,
        "إكمال الأبراج المحصنة",
        `${dungeon.id}:${id}`,
        now(),
      );
      account.resources ||= {};
      account.resources.crystal = Number(account.resources.crystal || 0) + 1;
      storeFinishedGame(state, { id: dungeon.id, kind: "dungeon", status: "completed", players: [id], winnerId: id, finishedAt: dungeon.finishedAt, rewards: reward });
      return { correct: true, completed: true, stage: dungeon.totalStages, totalStages: dungeon.totalStages, reward };
    });
  }

  async function startWordHunt(groupId, memberId) {
    const id = cleanMemberId(memberId);
    const words = [
      { word: "مغامرة", clue: "رحلة مليئة بالأحداث، تبدأ بحرف الميم وتنتهي بالتاء." },
      { word: "نجمة", clue: "جسم مضيء في السماء، من أربعة أحرف." },
      { word: "كتاب", clue: "تقرأه، من أربعة أحرف، يبدأ بالكاف." },
      { word: "سودان", clue: "اسم دولة عربية أفريقية." },
      { word: "تنين", clue: "مخلوق أسطوري يطير وينفث النار." },
    ];
    return transact(groupId, (state) => {
      requirePlayableMember(state, id, "wordHunt");
      let hunt = state.wordHunts.find((item) => item.status === "active" && Date.parse(item.expiresAt) > now().getTime());
      if (!hunt) {
        const item = words[Math.floor(Math.random() * words.length)];
        hunt = {
          id: gameId("word"),
          answer: normalizeGameAnswer(item.word),
          clue: item.clue,
          status: "active",
          answersUsed: [],
          startedBy: id,
          createdAt: now().toISOString(),
          expiresAt: new Date(now().getTime() + Number(state.settings.gameplay.wordHunt.durationMinutes) * 60_000).toISOString(),
        };
        state.wordHunts.push(hunt);
      }
      const { answer, ...publicHunt } = hunt;
      return deepClone(publicHunt);
    });
  }

  async function answerWordHunt(groupId, memberId, answerValue) {
    const id = cleanMemberId(memberId);
    const answer = normalizeGameAnswer(answerValue);
    return transact(groupId, (state) => {
      const account = requirePlayableMember(state, id, "wordHunt");
      const hunt = state.wordHunts.find((item) => item.status === "active" && Date.parse(item.expiresAt) > now().getTime());
      if (!hunt) throw new Error("لا يوجد صيد كلمات مفتوح؛ اكتب .صيد الكلمات للبدء");
      if (hunt.answersUsed.includes(answer)) throw new Error("تمت تجربة هذه الكلمة من قبل");
      hunt.answersUsed.push(answer);
      if (answer !== hunt.answer) return { correct: false, huntId: hunt.id };
      hunt.status = "found";
      hunt.winnerId = id;
      hunt.finishedAt = now().toISOString();
      const rewards = state.settings.gameplay.wordHunt;
      const reward = applyGameReward(state, account, rewards.rewardPoints, rewards.rewardXp, "الفوز بصيد الكلمات", `${hunt.id}:${id}`, now());
      storeFinishedGame(state, { id: hunt.id, kind: "wordHunt", status: "found", players: [id], winnerId: id, finishedAt: hunt.finishedAt, rewards: reward });
      return { correct: true, huntId: hunt.id, reward };
    });
  }

  async function createGuild(groupId, memberId, title, icon = "🛡️") {
    const id = cleanMemberId(memberId);
    const name = String(title || "").trim().slice(0, 40);
    if (!name) throw new Error("اكتب اسم النقابة");
    return transact(groupId, (state) => {
      const account = requirePlayableMember(state, id, "guilds");
      if (account.guildId) throw new Error("أنت عضو في نقابة بالفعل");
      if (state.guilds.some((guild) => normalizeGameAnswer(guild.title) === normalizeGameAnswer(name))) {
        throw new Error("اسم النقابة مستخدم بالفعل");
      }
      const cost = Number(state.settings.gameplay.guilds.createCost);
      if (account.balance < cost) throw new Error("رصيدك لا يكفي لتكوين النقابة");
      if (cost) appendTransaction(state, account, -cost, "guild_create", "تكلفة تكوين نقابة", id, null, now());
      const guild = {
        id: gameId("guild"),
        title: name,
        icon: String(icon || "🛡️").slice(0, 8),
        founderId: id,
        members: [id],
        level: Number(state.settings.gameplay.guilds.initialLevel),
        score: 0,
        inventory: {},
        createdAt: now().toISOString(),
      };
      account.guildId = guild.id;
      state.guilds.push(guild);
      return deepClone(guild);
    });
  }

  async function joinGuild(groupId, memberId, guildIdValue) {
    const id = cleanMemberId(memberId);
    return transact(groupId, (state) => {
      const account = requirePlayableMember(state, id, "guilds");
      if (account.guildId) throw new Error("غادر نقابتك الحالية قبل الانضمام إلى أخرى");
      const guild = state.guilds.find((item) => item.id === guildIdValue);
      if (!guild) throw new Error("النقابة غير موجودة");
      if (!guild.members.includes(id)) guild.members.push(id);
      account.guildId = guild.id;
      return deepClone(guild);
    });
  }

  async function getGuilds(groupId) {
    const state = await getGroup(groupId);
    return state.guilds.map((guild) => ({
      ...deepClone(guild),
      membersCount: guild.members.length,
      score: guild.members.reduce((sum, memberId) => sum + Number(state.accounts[memberId]?.totalEarned || 0), 0),
    })).sort((a, b) => b.score - a.score || b.membersCount - a.membersCount);
  }

  async function craftItem(groupId, memberId, recipeId) {
    const id = cleanMemberId(memberId);
    return transact(groupId, (state) => {
      const account = requirePlayableMember(state, id, "crafting");
      const recipe = state.settings.gameplay.crafting.recipes.find((item) => item.id === recipeId);
      if (!recipe) throw new Error("وصفة الصناعة غير موجودة");
      account.resources ||= {};
      for (const [resource, amount] of Object.entries(recipe.costs)) {
        if (Number(account.resources[resource] || 0) < Number(amount)) throw new Error(`الموارد غير كافية: ${resource}`);
      }
      for (const [resource, amount] of Object.entries(recipe.costs)) {
        account.resources[resource] = Number(account.resources[resource] || 0) - Number(amount);
      }
      const owned = account.inventory.find((item) => item.itemId === recipe.item);
      if (owned) owned.quantity += 1;
      else account.inventory.push({ itemId: recipe.item, quantity: 1, craftedAt: now().toISOString() });
      return { recipe: deepClone(recipe), resources: deepClone(account.resources), inventory: deepClone(account.inventory) };
    });
  }

  async function spinLuckyWheel(groupId, memberId) {
    const id = cleanMemberId(memberId);
    return transact(groupId, (state) => {
      const account = requirePlayableMember(state, id, "luckyWheel");
      const day = groupWorldDayKey(now());
      account.wheelUsesDay ||= {};
      const used = Number(account.wheelUsesDay[day] || 0);
      const limit = Number(state.settings.gameplay.luckyWheel.dailyLimit);
      if (used >= limit) throw new Error("استخدمت عدد محاولات عجلة الحظ المسموح لهذا اليوم");
      const prizes = state.settings.gameplay.luckyWheel.prizes;
      const prize = Number(prizes[Math.floor(Math.random() * prizes.length)]);
      account.wheelUsesDay[day] = used + 1;
      const credited = grantCappedReward(state, account, prize, "lucky_wheel", "جائزة عجلة الحظ الافتراضية", "system", `${day}:${id}:${used + 1}`, now());
      return { prize, credited, balance: account.balance, remaining: Math.max(0, limit - used - 1) };
    });
  }

  function tournamentEntry(state, id, mode) {
    if (mode === "guild") {
      const guild = state.guilds.find((item) => item.id === id);
      return guild ? {
        id: guild.id,
        type: "guild",
        label: guild.title,
        members: [...guild.members],
        captain: guild.founderId,
      } : null;
    }
    const account = state.accounts[id];
    return account ? { id, type: "member", label: account.name || id.split("@")[0], members: [id], captain: id } : null;
  }

  function advanceTournament(state, tournament) {
    if (tournament.status !== "in_progress") return;
    const currentRound = tournament.rounds.at(-1) || [];
    if (!currentRound.length || currentRound.some((match) => !["resolved", "bye"].includes(match.status))) return;
    const winners = currentRound.map((match) => match.winnerId).filter(Boolean);
    if (winners.length <= 1) {
      tournament.status = "completed";
      tournament.championId = winners[0] || null;
      tournament.completedAt = now().toISOString();
      const champion = tournament.entries.find((entry) => entry.id === tournament.championId);
      if (champion) {
        for (const memberId of champion.members) {
          const account = ensureAccount(state, memberId);
          applyGameReward(
            state,
            account,
            state.settings.gameplay.tournaments.rewardPoints,
            state.settings.gameplay.tournaments.rewardXp,
            `بطل بطولة ${tournament.title}`,
            `${tournament.id}:champion:${memberId}`,
            now(),
          );
        }
      }
      return;
    }
    const nextRound = [];
    for (let index = 0; index < winners.length; index += 2) {
      if (index + 1 >= winners.length) {
        nextRound.push({
          id: gameId("match"),
          players: [winners[index]],
          status: "bye",
          winnerId: winners[index],
          round: tournament.rounds.length + 1,
        });
      } else {
        nextRound.push({
          id: gameId("match"),
          players: [winners[index], winners[index + 1]],
          status: "pending",
          gameId: null,
          playerToEntry: {},
          round: tournament.rounds.length + 1,
        });
      }
    }
    tournament.rounds.push(nextRound);
    advanceTournament(state, tournament);
  }

  function resolveTournamentGame(state, game) {
    for (const tournament of state.tournaments) {
      if (tournament.status !== "in_progress") continue;
      const match = tournament.rounds.flat().find((item) => item.gameId === game.id);
      if (!match) continue;
      if (game.status === "draw") {
        match.status = "pending";
        match.gameId = null;
        match.playerToEntry = {};
        match.draws = Number(match.draws || 0) + 1;
        continue;
      }
      if (game.status !== "finished") continue;
      match.status = "resolved";
      match.winnerId = match.playerToEntry?.[game.winnerId] || game.winnerId;
      match.gameId = null;
      advanceTournament(state, tournament);
    }
  }

  async function createTournament(groupId, title, actor, mode = "individual") {
    const name = String(title || "").trim().slice(0, 80);
    if (!name || !["individual", "guild"].includes(mode)) throw new Error("بيانات البطولة غير صالحة");
    return transact(groupId, (state) => {
      if (!state.enabled || !state.modules.tournaments) throw new Error("البطولات متوقفة");
      if (state.tournaments.some((item) => ["registration", "in_progress"].includes(item.status))) {
        throw new Error("توجد بطولة لم تنته بعد");
      }
      const tournament = {
        id: gameId("tournament"),
        title: name,
        mode,
        status: "registration",
        entries: [],
        rounds: [],
        createdBy: String(actor || "system"),
        createdAt: now().toISOString(),
      };
      state.tournaments.push(tournament);
      addAudit(state, actor, "tournament_create", tournament.id, "إنشاء بطولة", { mode });
      return deepClone(tournament);
    });
  }

  async function joinTournament(groupId, tournamentId, memberId) {
    const id = cleanMemberId(memberId);
    return transact(groupId, (state) => {
      requirePlayableMember(state, id, "tournaments");
      const tournament = tournamentId
        ? state.tournaments.find((item) => item.id === tournamentId && item.status === "registration")
        : state.tournaments.find((item) => item.status === "registration");
      if (!tournament) throw new Error("لا توجد بطولة مفتوحة للتسجيل");
      const entry = tournamentEntry(state, tournament.mode === "guild" ? state.accounts[id].guildId : id, tournament.mode);
      if (!entry) throw new Error("يجب الانضمام إلى نقابة قبل التسجيل في البطولة الجماعية");
      if (tournament.entries.some((item) => item.id === entry.id)) throw new Error("أنت مسجل في البطولة بالفعل");
      if (tournament.entries.length >= 64) throw new Error("وصلت البطولة إلى الحد الأقصى للمشاركين");
      tournament.entries.push(entry);
      return deepClone(tournament);
    });
  }

  async function startTournament(groupId, tournamentId, actor) {
    return transact(groupId, (state) => {
      const tournament = state.tournaments.find((item) => item.id === tournamentId && item.status === "registration");
      if (!tournament) throw new Error("البطولة غير موجودة أو لم تعد مفتوحة للتسجيل");
      if (tournament.entries.length < 2) throw new Error("تحتاج البطولة إلى مشاركين اثنين على الأقل");
      tournament.status = "in_progress";
      tournament.startedAt = now().toISOString();
      const entries = [...tournament.entries];
      const firstRound = [];
      for (let index = 0; index < entries.length; index += 2) {
        if (index + 1 >= entries.length) {
          firstRound.push({ id: gameId("match"), players: [entries[index].id], status: "bye", winnerId: entries[index].id, round: 1 });
        } else {
          firstRound.push({ id: gameId("match"), players: [entries[index].id, entries[index + 1].id], status: "pending", gameId: null, playerToEntry: {}, round: 1 });
        }
      }
      tournament.rounds = [firstRound];
      tournament.startedBy = String(actor || "system");
      advanceTournament(state, tournament);
      return deepClone(tournament);
    });
  }

  async function getTournamentStatus(groupId) {
    const state = await getGroup(groupId);
    return deepClone(state.tournaments);
  }

  async function getTournamentMatchForMember(groupId, memberId) {
    const id = cleanMemberId(memberId);
    const state = await getGroup(groupId);
    for (const tournament of state.tournaments) {
      if (tournament.status !== "in_progress") continue;
      const match = tournament.rounds.flat().find((item) =>
        ["pending", "active"].includes(item.status) &&
        item.players.some((entryId) => {
          const entry = tournament.entries.find((item) => item.id === entryId);
          return entry?.members?.includes(id);
        })
      );
      if (match) return { tournament: deepClone(tournament), match: deepClone(match) };
    }
    return null;
  }

  async function attachTournamentGame(groupId, tournamentId, matchId, gameIdValue, playerToEntry = {}) {
    return transact(groupId, (state) => {
      const tournament = state.tournaments.find((item) => item.id === tournamentId && item.status === "in_progress");
      const match = tournament?.rounds.flat().find((item) => item.id === matchId && item.status === "pending");
      const game = state.games.find((item) => item.id === gameIdValue && item.kind === "xo" && item.status === "active");
      if (!match || !game) throw new Error("مباراة البطولة غير متاحة");
      match.status = "active";
      match.gameId = game.id;
      match.playerToEntry = deepClone(playerToEntry);
      return deepClone(match);
    });
  }

  return {
    store,
    getGroup,
    listGroups: () => store.listGroups().then((groups) => groups.map(ensureDefaults)),
    activateGroup,
    setEnabled,
    setModule,
    processMessage,
    rewardInvite,
    claimGift,
    claimGiftForMember,
    getLeaderboard,
    getMemberProfile,
    ensureMember,
    getMembers,
    adjustBalance,
    setMemberEnabled,
    adminUpdateMember,
    purchasePet,
    activatePet,
    upgradePet,
    purchaseItem,
    updateSettings,
    upsertCatalogItem,
    deleteCatalogItem,
    addCustomCommand,
    updateCustomCommand,
    deleteCustomCommand,
    runCustomCommand,
    addAdministrator,
    removeAdministrator,
    hasPermission,
    getSlots,
    refreshSlots,
    markMemberLeft,
    markMemberJoined,
    getSlotMember,
    adjustSlot,
    updateGroupData,
    assignMemberToTeam,
    getOverview,
    getReport,
    settleSeason,
    getLogs,
    canKickAfterSpam,
    getPublicCommands,
    createChallenge,
    acceptChallenge,
    settleChallenge,
    startTicTacToe,
    moveTicTacToe,
    cancelTicTacToe,
    replayTicTacToe,
    createMemberChallenge,
    acceptMemberChallenge,
    rejectMemberChallenge,
    listMemberChallenges,
    cancelMemberChallenge,
    answerMemberChallenge,
    expireMemberChallenges,
    distributeScheduledReward,
    claimRewardReportForDelivery,
    getPetAbilities,
    setGameBan,
    getBossRaid,
    attackBoss,
    startTreasureHunt,
    solveTreasureHunt,
    startDungeon,
    answerDungeon,
    startWordHunt,
    answerWordHunt,
    createGuild,
    joinGuild,
    getGuilds,
    craftItem,
    spinLuckyWheel,
    createTournament,
    joinTournament,
    startTournament,
    getTournamentStatus,
    getTournamentMatchForMember,
    attachTournamentGame,
    audit,
  };
}

export const groupWorldService = createGroupWorldService();
