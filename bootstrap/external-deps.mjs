import {
  chmodSync,
  existsSync,
  lstatSync,
  mkdirSync,
  readdirSync,
  readlinkSync,
  realpathSync,
  renameSync,
  symlinkSync,
} from "node:fs";
import { basename, dirname, isAbsolute, join, relative, resolve, sep } from "node:path";

function lstatOrNull(path) {
  try {
    return lstatSync(path);
  } catch (error) {
    if (error.code === "ENOENT") return null;
    throw error;
  }
}

export function getExternalDepsDir(baseDir) {
  const configured = process.env.BOT_EXTERNAL_DEPS_DIR?.trim();
  return resolve(configured || join(resolve(baseDir), "..", "bol"));
}

export function prepareExternalNodeModules(baseDir, externalDir = getExternalDepsDir(baseDir)) {
  const projectRoot = resolve(baseDir);
  const externalRoot = resolve(externalDir);
  const relativeExternalPath = relative(projectRoot, externalRoot);
  const externalIsInsideProject =
    relativeExternalPath === "" ||
    (relativeExternalPath !== ".." &&
      !relativeExternalPath.startsWith(`..${sep}`) &&
      !isAbsolute(relativeExternalPath));

  if (externalIsInsideProject) {
    throw new Error("مجلد المكتبات يجب أن يكون خارج مجلد البوت.");
  }

  const projectNodeModules = join(projectRoot, "node_modules");
  const externalNodeModules = join(externalRoot, "node_modules");
  mkdirSync(externalRoot, { recursive: true });

  const localInfo = lstatOrNull(projectNodeModules);
  const externalInfo = lstatOrNull(externalNodeModules);

  if (localInfo?.isSymbolicLink()) {
    const target = resolve(dirname(projectNodeModules), readlinkSync(projectNodeModules));
    if (target !== externalNodeModules) {
      throw new Error(
        `node_modules يشير إلى مسار مختلف (${target})؛ لم أغيّر الرابط الموجود.`
      );
    }
  } else if (localInfo) {
    if (!localInfo.isDirectory()) {
      throw new Error("node_modules داخل المشروع ليس مجلداً؛ لم أغيّره.");
    }
    if (externalInfo) {
      throw new Error(
        `يوجد node_modules داخل البوت وخارجه معاً؛ لم أحذف أياً منهما. انقل القديم يدوياً إلى ${externalRoot}.`
      );
    }
    renameSync(projectNodeModules, externalNodeModules);
  }

  const installedInfo = lstatOrNull(externalNodeModules);
  if (installedInfo && !installedInfo.isDirectory()) {
    throw new Error(`المسار الخارجي ليس مجلداً: ${externalNodeModules}`);
  }

  if (!existsSync(projectNodeModules) && !lstatOrNull(projectNodeModules)) {
    symlinkSync(externalNodeModules, projectNodeModules, process.platform === "win32" ? "junction" : "dir");
  }

  return { externalRoot, externalNodeModules, projectNodeModules };
}

function isInside(parent, candidate) {
  const rel = relative(parent, candidate);
  return rel === "" || (rel !== ".." && !rel.startsWith(`..${sep}`) && !isAbsolute(rel));
}

function secureSessionTree(directory) {
  chmodSync(directory, 0o700);
  for (const entry of readdirSync(directory, { withFileTypes: true })) {
    const path = join(directory, entry.name);
    const info = lstatSync(path);
    if (info.isSymbolicLink()) {
      throw new Error(`رُفض رابط رمزي داخل مخزن الجلسات: ${entry.name}`);
    }
    if (info.isDirectory()) {
      secureSessionTree(path);
    } else if (info.isFile()) {
      chmodSync(path, 0o600);
    } else {
      throw new Error(`نوع ملف غير مدعوم داخل مخزن الجلسات: ${entry.name}`);
    }
  }
}

/**
 * Uses one external, private session directory while keeping the bot's existing
 * wa-sessions path working through a symlink. Existing local data is moved,
 * never copied or overwritten.
 */
export function prepareExternalSessionStorage(baseDir, externalDir = getExternalDepsDir(baseDir)) {
  const projectRoot = resolve(baseDir);
  const projectSessions = join(projectRoot, "wa-sessions");
  const externalRoot = resolve(externalDir);
  const configuredSessions = process.env.BOT_EXTERNAL_SESSIONS_DIR?.trim();
  const externalSessions = resolve(configuredSessions || join(externalRoot, "wa-sessions"));

  mkdirSync(externalRoot, { recursive: true });
  mkdirSync(dirname(externalSessions), { recursive: true, mode: 0o700 });
  const realProjectRoot = realpathSync(projectRoot);
  const realSessionsParent = realpathSync(dirname(externalSessions));
  const realExternalSessions = join(realSessionsParent, basename(externalSessions));

  if (
    realExternalSessions === resolve(sep) ||
    isInside(realProjectRoot, realExternalSessions) ||
    isInside(realExternalSessions, realProjectRoot)
  ) {
    throw new Error("مخزن الجلسات يجب أن يكون خارج مجلد البوت.");
  }

  const localInfo = lstatOrNull(projectSessions);
  const externalInfo = lstatOrNull(externalSessions);

  if (externalInfo?.isSymbolicLink()) {
    throw new Error("مخزن الجلسات الخارجي لا يمكن أن يكون رابطاً رمزياً.");
  }
  if (externalInfo && !externalInfo.isDirectory()) {
    throw new Error("مسار مخزن الجلسات الخارجي موجود لكنه ليس مجلداً.");
  }

  if (localInfo?.isSymbolicLink()) {
    const currentTarget = resolve(dirname(projectSessions), readlinkSync(projectSessions));
    if (currentTarget !== externalSessions) {
      throw new Error(`wa-sessions يشير لمسار مختلف (${currentTarget})؛ لم أغيّره.`);
    }
  } else if (localInfo) {
    if (!localInfo.isDirectory()) {
      throw new Error("wa-sessions داخل المشروع ليس مجلداً؛ لم أغيّره.");
    }
    if (externalInfo) {
      throw new Error(
        `توجد جلسات داخل البوت وخارجه معاً؛ لم أدمج أو أحذف أياً منهما. راجع ${externalSessions} يدوياً.`
      );
    }
    secureSessionTree(projectSessions);
    try {
      renameSync(projectSessions, externalSessions);
    } catch (error) {
      throw new Error(
        `تعذر نقل مجلد الجلسات بأمان إلى ${externalSessions} (${error.code ?? error.message}). ` +
          "لم تُحذف الجلسات الأصلية."
      );
    }
  }

  if (!lstatOrNull(externalSessions)) {
    mkdirSync(externalSessions, { recursive: true, mode: 0o700 });
  }
  secureSessionTree(externalSessions);

  if (!lstatOrNull(projectSessions)) {
    symlinkSync(externalSessions, projectSessions, process.platform === "win32" ? "junction" : "dir");
  }

  // Baileys creates and updates auth files after this setup.
  process.umask(0o077);
  return { externalSessions, projectSessions };
}
