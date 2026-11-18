import assert from "node:assert/strict";
import test from "node:test";
import { existsSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { ensureYtDlp } from "../../infrastructure/binary-manager.mjs";

test("missing yt-dlp is skipped without installing or creating files", async () => {
  const baseDir = mkdtempSync(join(tmpdir(), "no-ytdlp-download-"));
  const originalPath = process.env.PATH;
  try {
    process.env.PATH = "";
    const result = await ensureYtDlp(baseDir);
    assert.deepEqual(result, { ok: false, source: "missing" });
    assert.equal(existsSync(join(baseDir, "bin", "yt-dlp")), false);
  } finally {
    if (originalPath === undefined) delete process.env.PATH;
    else process.env.PATH = originalPath;
    rmSync(baseDir, { recursive: true, force: true });
  }
});
