const MAWDOO3_ORIGIN = "https://mawdoo3.com";
const LISTING_PAGES = [
  `${MAWDOO3_ORIGIN}/خاص:أجدد_الصفحات`,
  `${MAWDOO3_ORIGIN}/خاص:الصفحات_الأكثر_مشاهدة`,
];
const CACHE_TTL_MS = 15 * 60_000;
const MAX_LISTING_BYTES = 2 * 1024 * 1024;
const MAX_ARTICLE_BYTES = 5 * 1024 * 1024;
const MAX_ARTICLE_CONTENT_CHARS = 12_000;

let cachedArticles = null;
let cacheExpiresAt = 0;
let pendingFetch = null;

function decodeHtmlEntities(value) {
  return String(value || "")
    .replace(/&amp;/gi, "&")
    .replace(/&quot;/gi, '"')
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">")
    .replace(/&#39;|&apos;/gi, "'")
    .replace(/&nbsp;/gi, " ")
    .replace(/&mdash;/gi, "—")
    .replace(/&ndash;/gi, "–")
    .replace(/&hellip;/gi, "…")
    .replace(/&#(\d+);/g, (match, digits) => {
      const codePoint = Number(digits);
      return Number.isInteger(codePoint) && codePoint >= 0 && codePoint <= 0x10ffff
        ? String.fromCodePoint(codePoint)
        : match;
    })
    .replace(/&#x([\da-f]+);/gi, (match, hex) => {
      const codePoint = parseInt(hex, 16);
      return Number.isInteger(codePoint) && codePoint >= 0 && codePoint <= 0x10ffff
        ? String.fromCodePoint(codePoint)
        : match;
    });
}

function titleFromPath(pathname) {
  const segment = String(pathname || "").split("/").filter(Boolean).at(-1) || "";
  try {
    return decodeHtmlEntities(decodeURIComponent(segment).replace(/_/g, " "))
      .replace(/\s+/g, " ")
      .trim();
  } catch {
    return "";
  }
}

function normalizeArabic(value) {
  return String(value || "")
    .normalize("NFKC")
    .replace(/[\u064b-\u065f\u0670\u0640]/g, "")
    .replace(/[أإآ]/g, "ا")
    .replace(/ى/g, "ي")
    .replace(/ة/g, "ه")
    .toLocaleLowerCase("ar")
    .replace(/\s+/g, " ")
    .trim();
}

export function parseMawdoo3Listing(html, baseUrl = MAWDOO3_ORIGIN) {
  const articles = new Map();
  const anchorPattern = /<a\b[^>]*?\bhref\s*=\s*(?:"([^"]+)"|'([^']+)')[^>]*>([\s\S]*?)<\/a>/giu;

  for (const match of String(html || "").matchAll(anchorPattern)) {
    const rawHref = decodeHtmlEntities(match[1] || match[2] || "").trim();
    if (!rawHref || rawHref.startsWith("#") || rawHref.startsWith("javascript:")) continue;

    let url;
    try {
      url = new URL(rawHref, baseUrl);
    } catch {
      continue;
    }

    if (
      !["http:", "https:"].includes(url.protocol) ||
      url.hostname.toLowerCase() !== "mawdoo3.com" ||
      url.username ||
      url.password ||
      url.port
    ) continue;

    const segments = url.pathname.split("/").filter(Boolean);
    if (segments.length !== 1) continue;
    const title = titleFromPath(url.pathname);
    if (
      title.length < 4 ||
      title.length > 180 ||
      /^(خاص|تصنيف|special|category):/iu.test(title) ||
      /^(index\.php|api\.php)$/iu.test(title)
    ) continue;

    url.protocol = "https:";
    url.search = "";
    url.hash = "";
    const canonicalUrl = url.href;
    if (!articles.has(canonicalUrl)) articles.set(canonicalUrl, { title, url: canonicalUrl });
    if (articles.size >= 1_000) break;
  }

  return [...articles.values()];
}

function balancedElementContents(html, tag, include = () => true) {
  const openingTags = new RegExp(`<${tag}\\b[^>]*>`, "giu");
  const allTags = new RegExp(`<\\/?${tag}\\b[^>]*>`, "giu");
  const blocks = [];
  let opening;

  while ((opening = openingTags.exec(html))) {
    if (!include(opening[0])) continue;
    allTags.lastIndex = openingTags.lastIndex;
    let depth = 1;
    let token;

    while ((token = allTags.exec(html))) {
      if (/^<\//u.test(token[0])) depth -= 1;
      else if (!/\/\s*>$/u.test(token[0])) depth += 1;

      if (depth === 0) {
        blocks.push(html.slice(openingTags.lastIndex, token.index));
        break;
      }
    }
  }

  return blocks;
}

function cleanArticleHtml(html) {
  return String(html || "")
    .replace(/<!--[\s\S]*?-->/gu, " ")
    .replace(/<(script|style|svg|noscript|form|iframe)\b[\s\S]*?<\/\1\s*>/giu, " ")
    .replace(/<(script|style|svg|noscript|form|iframe)\b[^>]*\/?>/giu, " ");
}

function articleTextFromMarkup(html) {
  return decodeHtmlEntities(String(html || "")
    .replace(/<(br|\/p|\/div|\/li|\/h[1-6])\b[^>]*>/giu, "\n")
    .replace(/<[^>]*>/gu, " ")
    .replace(/[\u200b\u200e\u200f\u202a-\u202e]/gu, "")
    .replace(/[ \t\f\v]+/gu, " ")
    .replace(/\s*\n\s*/gu, "\n")
    .replace(/\n{2,}/gu, "\n")
    .trim());
}

function articleTextBlocks(html) {
  const blocks = [];
  const blockPattern = /<(h2|h3|p|li)\b([^>]*)>([\s\S]*?)<\/\1>/giu;
  for (const match of String(html || "").matchAll(blockPattern)) {
    const tag = match[1].toLowerCase();
    const markup = match[3];
    const text = articleTextFromMarkup(markup);
    if (
      text.length < (tag === "li" ? 12 : 20) ||
      /^(?:اقرأ(?:\s|ً)|مواضيع ذات صلة|مقالات ذات صلة|قد يعجبك|المصدر|المراجع|تمت الكتابة بواسطة|آخر تحديث|آخر تعديل|تاريخ النشر|محتويات)\b/iu.test(text) ||
      (tag === "li" && text.length < 180 && /<a\b[^>]*\bhref\s*=\s*["']#/iu.test(markup))
    ) continue;
    if (blocks.at(-1) !== text) blocks.push(text);
  }
  return blocks;
}

function relevantArticleContainer(openingTag) {
  const id = openingTag.match(/\bid\s*=\s*["']([^"']+)["']/iu)?.[1] || "";
  const classes = openingTag.match(/\bclass\s*=\s*["']([^"']+)["']/iu)?.[1] || "";
  const itemprop = openingTag.match(/\bitemprop\s*=\s*["']([^"']+)["']/iu)?.[1] || "";
  const label = `${id} ${classes} ${itemprop}`.toLowerCase();
  return /(?:article|mw-content-text|entry[-_ ]?content|post[-_ ]?body)/u.test(label) &&
    !/(?:related|recommend|sidebar|navigation|footer|header|comment|advert)/u.test(label);
}

export function extractMawdoo3ArticleText(html) {
  const cleaned = cleanArticleHtml(html);
  const candidates = [
    ...balancedElementContents(cleaned, "article").map((content) => ({ content, priority: 8 })),
    ...balancedElementContents(cleaned, "main").map((content) => ({ content, priority: 5 })),
    ...balancedElementContents(cleaned, "div", relevantArticleContainer)
      .map((content) => ({ content, priority: 7 })),
  ];
  if (!candidates.length) candidates.push({ content: cleaned, priority: 0 });

  const ranked = candidates.map(({ content, priority }) => {
    let paragraphs = articleTextBlocks(content);
    if (!paragraphs.length) {
      const fallback = articleTextFromMarkup(content);
      paragraphs = fallback.length >= 40 ? [fallback] : [];
    }
    const relatedIndex = paragraphs.findIndex((paragraph) =>
      /^(?:اقرأ(?:\s|ً)|مواضيع ذات صلة|مقالات ذات صلة|قد يعجبك)\b/iu.test(paragraph)
    );
    if (relatedIndex >= 0) paragraphs = paragraphs.slice(0, relatedIndex);
    return {
      paragraphs,
      score: paragraphs.reduce((sum, paragraph) => sum + paragraph.length, priority * 100),
    };
  }).sort((left, right) => right.score - left.score);

  const content = ranked[0]?.paragraphs.join("\n\n").trim() || "";
  if (!content) throw new Error("تعذّر استخراج نص المقال من صفحة موضوع");
  if (content.length <= MAX_ARTICLE_CONTENT_CHARS) return content;
  return `${content.slice(0, MAX_ARTICLE_CONTENT_CHARS).trimEnd()}…`;
}

export async function fetchMawdoo3ArticleContent(url, { fetchImpl = globalThis.fetch } = {}) {
  if (typeof fetchImpl !== "function") throw new Error("جلب نص المقال غير متاح في بيئة التشغيل");

  let articleUrl;
  try {
    articleUrl = new URL(String(url || ""));
  } catch {
    throw new Error("رابط مقال موضوع غير صالح");
  }
  if (
    articleUrl.protocol !== "https:" ||
    !["mawdoo3.com", "www.mawdoo3.com"].includes(articleUrl.hostname.toLowerCase()) ||
    articleUrl.username ||
    articleUrl.password ||
    articleUrl.port ||
    articleUrl.pathname.split("/").filter(Boolean).length !== 1
  ) {
    throw new Error("يمكن جلب المقالات من روابط موضوع العامة فقط");
  }

  const response = await fetchImpl(articleUrl.href, {
    headers: { "User-Agent": "Mozilla/5.0 (compatible; GroupBot/1.0)" },
    signal: AbortSignal.timeout(15_000),
  });
  if (!response.ok) throw new Error(`تعذّر جلب نص المقال (${response.status})`);
  if (response.url) {
    let finalUrl;
    try {
      finalUrl = new URL(response.url);
    } catch {
      throw new Error("أعاد موقع موضوع رابطاً غير صالح");
    }
    if (!["mawdoo3.com", "www.mawdoo3.com"].includes(finalUrl.hostname.toLowerCase())) {
      throw new Error("رفض جلب المقال لأن الرابط انتقل إلى موقع آخر");
    }
  }
  const contentLength = Number(response.headers?.get?.("content-length") || 0);
  if (contentLength > MAX_ARTICLE_BYTES) throw new Error("حجم المقال أكبر من الحد المسموح");
  const html = await response.text();
  if (Buffer.byteLength(html, "utf8") > MAX_ARTICLE_BYTES) {
    throw new Error("حجم المقال أكبر من الحد المسموح");
  }
  const content = extractMawdoo3ArticleText(html);
  if (content.length < 40) throw new Error("لم يعرض موقع موضوع نص المقال؛ لم تُرسل رسالة تحتوي الرابط فقط");
  return content;
}

export function matchesMawdoo3Topic(title, topic) {
  const normalizedTitle = normalizeArabic(title);
  const normalizedTopic = normalizeArabic(topic);
  if (!normalizedTitle || normalizedTopic.length < 2) return false;

  const story = /(?:قصه|قصص|حكايه|حكايات|روايه|روايات)/u;
  const love = /(?:حب|عاطفيه|رومانسيه|غرام)/u;
  const jokes = /(?:نكت|نكات|طرائف|فكاهه|مزاح|مضحك|مضحكه)/u;

  if (/(?:نكت|نكات|طرائف|فكاهه|مزاح)/u.test(normalizedTopic)) return jokes.test(normalizedTitle);
  if (normalizedTopic.includes("حب") && story.test(normalizedTopic)) {
    return story.test(normalizedTitle) && love.test(normalizedTitle);
  }
  if (story.test(normalizedTopic)) return story.test(normalizedTitle);
  return normalizedTitle.includes(normalizedTopic);
}

async function fetchListingPage(url, fetchImpl) {
  const response = await fetchImpl(url, {
    headers: { "User-Agent": "Mozilla/5.0 (compatible; GroupBot/1.0)" },
    signal: AbortSignal.timeout(15_000),
  });
  if (!response.ok) throw new Error(`تعذّر جلب قائمة موضوع (${response.status})`);
  const contentLength = Number(response.headers?.get?.("content-length") || 0);
  if (contentLength > MAX_LISTING_BYTES) throw new Error("حجم قائمة موضوع أكبر من الحد المسموح");
  const html = await response.text();
  if (Buffer.byteLength(html, "utf8") > MAX_LISTING_BYTES) {
    throw new Error("حجم قائمة موضوع أكبر من الحد المسموح");
  }
  return parseMawdoo3Listing(html, url);
}

export async function getMawdoo3Articles({ fetchImpl = globalThis.fetch, forceRefresh = false } = {}) {
  if (typeof fetchImpl !== "function") throw new Error("الجلب من موضوع غير متاح في بيئة التشغيل");
  if (!forceRefresh && cachedArticles && cacheExpiresAt > Date.now()) return cachedArticles.map((article) => ({ ...article }));
  if (pendingFetch) return (await pendingFetch).map((article) => ({ ...article }));

  pendingFetch = (async () => {
    const results = await Promise.allSettled(LISTING_PAGES.map((url) => fetchListingPage(url, fetchImpl)));
    const articles = new Map();
    for (const result of results) {
      if (result.status !== "fulfilled") continue;
      for (const article of result.value) {
        if (!articles.has(article.url)) articles.set(article.url, article);
      }
    }
    if (!articles.size) {
      const failures = results.filter((result) => result.status === "rejected");
      const detail = failures[0]?.reason?.message;
      throw new Error(detail || "لم يعرض موقع موضوع أي عناوين عامة قابلة للاستخدام حالياً");
    }
    cachedArticles = [...articles.values()];
    cacheExpiresAt = Date.now() + CACHE_TTL_MS;
    return cachedArticles;
  })();

  try {
    return (await pendingFetch).map((article) => ({ ...article }));
  } finally {
    pendingFetch = null;
  }
}

export async function findNextMawdoo3Article(topic, {
  seenUrls = [],
  fetchImpl = globalThis.fetch,
  forceRefresh = false,
} = {}) {
  const normalizedTopic = String(topic || "").trim();
  if (normalizedTopic.length < 2 || normalizedTopic.length > 60) {
    throw new Error("اكتب موضوعاً من حرفين إلى 60 حرفاً");
  }

  const seen = new Set((Array.isArray(seenUrls) ? seenUrls : []).map((url) => String(url)));
  const candidates = (await getMawdoo3Articles({ fetchImpl, forceRefresh }))
    .filter((article) => matchesMawdoo3Topic(article.title, normalizedTopic));
  const article = candidates.find((candidate) => !seen.has(candidate.url));
  if (!article) {
    throw new Error(
      candidates.length
        ? `لا يوجد عنوان جديد غير مكرر لموضوع «${normalizedTopic}» حالياً`
        : `لم يعثر موقع موضوع على عنوان مناسب لموضوع «${normalizedTopic}» في القوائم العامة الحالية`
    );
  }
  return { ...article };
}

export function clearMawdoo3Cache() {
  cachedArticles = null;
  cacheExpiresAt = 0;
  pendingFetch = null;
}
