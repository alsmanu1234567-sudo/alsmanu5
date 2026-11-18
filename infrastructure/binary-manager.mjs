/**
 * infrastructure/binary-manager.mjs
 * ────────────────────────────────────────────────────────────────
 * المسؤولية الوحيدة: إدارة الثنائيات الخارجية المطلوبة للبوت.
 *
 * حالياً: اكتشاف yt-dlp المثبت مسبقاً فقط؛ لا يُنزّل الأداة مطلقاً.
 *
 * استراتيجية yt-dlp:
 *   1. bin/yt-dlp محلياً (مثبّت مسبقاً)
 *   2. yt-dlp في PATH
 *   3. إن لم يوجد، تخطي الميزات التي تعتمد عليه دون تنزيل.
 *
 * تعتمد على: core/logger.mjs
 */

import { execSync, execFile } from "child_process";
import { promisify }          from "util";
import { existsSync } from "fs";
import { join }               from "path";
import { ok, wrn }            from "../core/logger.mjs";

const execFileAsync = promisify(execFile);

// ── ffmpeg-static ────────────────────────────────────────────

/**
 * يتأكد أن ثنائي ffmpeg-static مُنزَّل فعلاً.
 * مدراء الحزم (خصوصاً pnpm) يتخطون سكربت postinstall الذي ينزّل الثنائي،
 * فتبقى الحزمة "مثبتة" لكن بلا ffmpeg حقيقي — ما يكسر دمج الفيديو
 * وتحويل الصوت. لا يفعل شيئاً إن كان ffmpeg موجوداً في النظام (يوفر ~80MB).
 * @param {string} baseDir — جذر المشروع
 */
export async function ensureFfmpegStatic(baseDir, { allowDownload = true } = {}) {
  // ffmpeg النظام موجود؟ لا حاجة للثنائي المرفق
  try {
    execSync("ffmpeg -version", { stdio: "ignore", timeout: 5_000 });
    ok("ffmpeg: موجود في النظام");
    return { ok: true, source: "system" };
  } catch {}
  try {
    const { createRequire } = await import("module");
    const req = createRequire(join(baseDir, "package.json"));
    let binPath = null;
    try { binPath = req("ffmpeg-static"); } catch {}
    if (binPath && existsSync(binPath)) {
      ok("ffmpeg-static: الثنائي جاهز");
      return { ok: true, source: "static" };
    }
    if (binPath) {
      if (!allowDownload) {
        wrn("ffmpeg-static: الثنائي غائب — لن يتم تنزيله في وضع التشغيل دون تثبيت");
        return { ok: false };
      }
      // الحزمة موجودة لكن الثنائي غائب → شغّل سكربت التنزيل الخاص بها
      const { dirname } = await import("path");
      const pkgDir = dirname(req.resolve("ffmpeg-static/package.json"));
      wrn("ffmpeg-static: الثنائي غائب — جارٍ تنزيله...");
      execSync("node install.js", { cwd: pkgDir, stdio: "ignore", timeout: 300_000 });
      if (existsSync(binPath)) {
        ok("ffmpeg-static: تم تنزيل الثنائي ✔");
        return { ok: true, source: "static-downloaded" };
      }
    }
  } catch (e) {
    wrn("ffmpeg-static: فشل التنزيل — " + String(e?.message || e).slice(0, 80));
  }
  return { ok: false };
}

// ── yt-dlp ───────────────────────────────────────────────────

/**
 * يكتشف yt-dlp إن كان مثبتاً مسبقاً، ولا ينزّله مطلقاً.
 * @param {string} baseDir — جذر المشروع (alsmanu5/)
 */
export async function ensureYtDlp(baseDir) {
  const binPath = join(baseDir, "bin", "yt-dlp");

  // استخدام مسار صريح أو ثنائي محلي موجود دون تنزيل أو استبدال.
  const candidates = [process.env.YTDLP_PATH, binPath].filter(Boolean);
  for (const candidate of candidates) {
    if (!existsSync(candidate)) continue;
    try {
      const { stdout } = await execFileAsync(candidate, ["--version"], { timeout: 8_000 });
      ok("yt-dlp: v" + stdout.trim() + " (موجود مسبقاً)");
      process.env.YTDLP_PATH = candidate;
      return { ok: true, source: candidate };
    } catch {
      wrn("yt-dlp: الملف الموجود لا يعمل — تم تخطيه ولن يُنزّل بديل.");
    }
  }

  // اكتشاف نسخة نظام موجودة مسبقاً فقط.
  try {
    const sys = execSync("which yt-dlp 2>/dev/null", { timeout: 3_000 }).toString().trim();
    if (sys && existsSync(sys)) {
      const { stdout } = await execFileAsync(sys, ["--version"], { timeout: 5_000 });
      ok("yt-dlp: v" + stdout.trim() + " (PATH)");
      process.env.YTDLP_PATH = sys;
      return { ok: true, source: sys };
    }
  } catch {}

  wrn("yt-dlp غير موجود مسبقاً — تم تخطيه ولن يُنزّل.");
  return { ok: false, source: "missing" };
}
