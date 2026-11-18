/**
 * infrastructure/package-manager.mjs
 * ────────────────────────────────────────────────────────────────
 * المسؤولية الوحيدة: ضمان توفر حزم npm اللازمة لتشغيل البوت.
 *
 * العمليات:
 *   1. تثبيت node_modules إذا كانت غائبة
 *   2. التحقق من الحزم الحرجة وتثبيتها منفردة إذا نقصت
 *
 * الحزم الحرجة = حزم تؤثر مباشرة على ميزات المستخدم (التنزيل، الإرسال).
 *
 * تعتمد على: core/logger.mjs
 */

import { execSync } from "child_process";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "fs";
import { join } from "path";
import { ok, wrn, section } from "../core/logger.mjs";

// ── الحزم التي يجب التحقق منها بشكل فردي ────────────────────
const CRITICAL_PACKAGES = [
  "@whiskeysockets/baileys",
  "node-telegram-bot-api",
  "sharp",
  // ffmpeg مرفق كحزمة احتياطية خفيفة (منصة واحدة، ~80MB) — يُستخدم فقط
  // إن لم يكن ffmpeg مثبتاً في النظام. أُزيلت ffprobe-static (351MB كانت
  // تملأ القرص وتوقف البوت) ونستخرج مدة الصوت من ffmpeg نفسه.
  "ffmpeg-static",
];
// Search is bundled into dist/index.mjs; do not fetch a duplicate npm copy.
const OMITTED_EXTERNAL_PACKAGES = new Set(["yt-search"]);

// ── تثبيت node_modules إذا غائبة ────────────────────────────
function ensureNodeModules(externalDir) {
  const nm = join(externalDir, "node_modules");
  if (existsSync(nm)) {
    ok("node_modules الخارجي: موجود");
    return true;
  }

  wrn("node_modules الخارجي: غائب — جارٍ npm install...");
  try {
    execSync("npm install --no-package-lock 2>&1 | tail -5", {
      stdio: "inherit",
      cwd:   externalDir,
      timeout: 180_000,
    });
    ok("تم تثبيت الحزم بنجاح");
    return true;
  } catch {
    wrn("فشل npm install — سأحاول تثبيت الحزم الحرجة منفردة");
    return false;
  }
}

// ── التحقق من الحزم الحرجة وتثبيت الناقص ────────────────────
function ensureCriticalPackages(baseDir, externalDir) {
  const manifest = JSON.parse(readFileSync(join(baseDir, "package.json"), "utf8"));
  const declared = {
    ...(manifest.dependencies ?? {}),
    ...(manifest.optionalDependencies ?? {}),
  };
  const missing = CRITICAL_PACKAGES.filter((pkg) => {
    const packageDir = join(externalDir, "node_modules", pkg);
    if (!existsSync(packageDir)) return true;
    if (pkg !== "@whiskeysockets/baileys") return false;
    try {
      const installed = JSON.parse(readFileSync(join(packageDir, "package.json"), "utf8")).version;
      return installed !== declared[pkg];
    } catch {
      return true;
    }
  });

  if (missing.length === 0) {
    ok("كل الحزم الحرجة مثبّتة ✔");
    return;
  }

  wrn(`حزم ناقصة: ${missing.join(", ")} — جارٍ التثبيت...`);
  try {
    execSync(
      `npm install --no-package-lock ${missing.map((pkg) => declared[pkg] && pkg === "@whiskeysockets/baileys" ? `${pkg}@${declared[pkg]}` : pkg).join(" ")} 2>&1 | tail -3`,
      { stdio: "inherit", cwd: externalDir, timeout: 120_000 }
    );
    ok("تم تثبيت الحزم الناقصة");
  } catch (e) {
    wrn("فشل تثبيت بعض الحزم: " + (e.message?.slice(0, 80) ?? ""));
  }
}

function syncExternalManifest(baseDir, externalDir) {
  mkdirSync(externalDir, { recursive: true });
  const source = join(baseDir, "package.json");
  const destination = join(externalDir, "package.json");
  const manifest = JSON.parse(readFileSync(source, "utf8"));

  if (existsSync(destination)) {
    const existing = JSON.parse(readFileSync(destination, "utf8"));
    if (existing.name !== manifest.name) {
      throw new Error(
        `مجلد المكتبات الخارجي مستخدم لمشروع آخر (${existing.name ?? "بدون اسم"}). اختر مجلداً مخصصاً للبوت.`
      );
    }
  }

  writeFileSync(
    destination,
    JSON.stringify(createExternalInstallManifest(manifest), null, 2) + "\n",
    { mode: 0o600 }
  );
}

export function createExternalInstallManifest(manifest) {
  const externalManifest = {
    ...manifest,
    dependencies: { ...(manifest.dependencies ?? {}) },
    optionalDependencies: { ...(manifest.optionalDependencies ?? {}) },
  };

  for (const packageName of OMITTED_EXTERNAL_PACKAGES) {
    delete externalManifest.dependencies[packageName];
    delete externalManifest.optionalDependencies[packageName];
  }

  return externalManifest;
}

export function missingDeclaredPackages(baseDir, externalDir) {
  const manifest = JSON.parse(readFileSync(join(baseDir, "package.json"), "utf8"));
  const nodeModules = join(externalDir, "node_modules");
  return Object.keys(manifest.dependencies ?? {}).filter(
    (pkg) =>
      !OMITTED_EXTERNAL_PACKAGES.has(pkg) &&
      !existsSync(join(nodeModules, pkg))
  );
}

// ── النقطة الرئيسية للاستدعاء ────────────────────────────────
/**
 * @param {string} baseDir — جذر المشروع
 * @param {string} externalDir — مجلد المكتبات الخارجي (يحوي package.json و node_modules)
 */
export async function ensure(baseDir, externalDir = join(baseDir, "..", "bol")) {
  syncExternalManifest(baseDir, externalDir);
  section("التبعيات الخارجية");
  const installed = ensureNodeModules(externalDir);
  if (!installed) {
    throw new Error("تعذر تثبيت node_modules — تحقق من اتصال npm ثم أعد التشغيل");
  }
  ensureCriticalPackages(baseDir, externalDir);
}
