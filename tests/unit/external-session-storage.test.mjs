import assert from "node:assert/strict";
import test from "node:test";
import {
  chmodSync,
  existsSync,
  lstatSync,
  mkdirSync,
  readFileSync,
  readlinkSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { prepareExternalSessionStorage } from "../../bootstrap/external-deps.mjs";

test("external session storage migrates safely and keeps sessions private", async () => {
  const originalUmask = process.umask();
  const tempRoot = await mkdtemp(join(tmpdir(), "external-session-storage-"));

  try {
    const migratedProject = join(tempRoot, "migrated-project");
    const externalRoot = join(tempRoot, "outside", "bol");
    const originalSessionFile = join(
      migratedProject,
      "wa-sessions",
      "telegram-user",
      "auth_info_baileys",
      "creds.json"
    );
    mkdirSync(dirname(originalSessionFile), { recursive: true });
    writeFileSync(originalSessionFile, '{"credential":"preserved"}', { mode: 0o644 });

    const migrated = prepareExternalSessionStorage(migratedProject, externalRoot);
    assert.equal(readlinkSync(migrated.projectSessions), migrated.externalSessions);
    assert.equal(
      readFileSync(join(migrated.externalSessions, "telegram-user/auth_info_baileys/creds.json"), "utf8"),
      '{"credential":"preserved"}'
    );
    assert.equal(lstatSync(migrated.externalSessions).mode & 0o777, 0o700);
    assert.equal(
      lstatSync(join(migrated.externalSessions, "telegram-user/auth_info_baileys/creds.json")).mode & 0o777,
      0o600
    );
    assert.equal(
      lstatSync(join(migrated.externalSessions, "telegram-user/auth_info_baileys")).mode & 0o777,
      0o700
    );
    assert.equal(process.umask(), 0o077);
    assert.deepEqual(
      prepareExternalSessionStorage(migratedProject, externalRoot),
      migrated
    );

    const freshProject = join(tempRoot, "fresh-project");
    mkdirSync(freshProject);
    const fresh = prepareExternalSessionStorage(freshProject, join(tempRoot, "fresh-external"));
    assert.equal(existsSync(fresh.projectSessions), true);
    assert.equal(resolve(readlinkSync(fresh.projectSessions)), fresh.externalSessions);

    const conflictProject = join(tempRoot, "conflict-project");
    const conflictExternal = join(tempRoot, "conflict-external");
    mkdirSync(join(conflictProject, "wa-sessions"), { recursive: true });
    writeFileSync(join(conflictProject, "wa-sessions", "local.keep"), "local");
    mkdirSync(join(conflictExternal, "wa-sessions"), { recursive: true });
    writeFileSync(join(conflictExternal, "wa-sessions", "external.keep"), "external");
    assert.throws(
      () => prepareExternalSessionStorage(conflictProject, conflictExternal),
      /توجد جلسات داخل البوت وخارجه/
    );
    assert.equal(readFileSync(join(conflictProject, "wa-sessions", "local.keep"), "utf8"), "local");
    assert.equal(
      readFileSync(join(conflictExternal, "wa-sessions", "external.keep"), "utf8"),
      "external"
    );

    const unsafeProject = join(tempRoot, "unsafe-project");
    mkdirSync(unsafeProject);
    assert.throws(
      () => prepareExternalSessionStorage(unsafeProject, join(unsafeProject, "inside")),
      /خارج مجلد البوت/
    );

    const parentProject = join(tempRoot, "parent-storage", "wa-sessions", "project");
    mkdirSync(parentProject, { recursive: true });
    assert.throws(
      () => prepareExternalSessionStorage(parentProject, join(tempRoot, "parent-storage")),
      /خارج مجلد البوت/
    );

    const symlinkProject = join(tempRoot, "symlink-project");
    const externalSessionTarget = join(tempRoot, "symlink-external", "wa-sessions");
    mkdirSync(symlinkProject);
    mkdirSync(externalSessionTarget, { recursive: true });
    symlinkSync(externalSessionTarget, join(symlinkProject, "wa-sessions"), "dir");
    const linkedFile = join(externalSessionTarget, "unsafe-link");
    writeFileSync(join(tempRoot, "outside-file"), "untouched");
    symlinkSync(join(tempRoot, "outside-file"), linkedFile);
    chmodSync(externalSessionTarget, 0o755);
    assert.throws(
      () => prepareExternalSessionStorage(symlinkProject, join(tempRoot, "symlink-external")),
      /رابط رمزي داخل مخزن الجلسات/
    );
    assert.equal(readFileSync(join(tempRoot, "outside-file"), "utf8"), "untouched");
  } finally {
    process.umask(originalUmask);
    await rm(tempRoot, { recursive: true, force: true });
  }
});
