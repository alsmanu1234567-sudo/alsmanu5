import assert from "node:assert/strict";
import test from "node:test";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  createExternalInstallManifest,
  missingDeclaredPackages,
} from "../../infrastructure/package-manager.mjs";

test("external npm installs omit yt-search while retaining other dependencies", () => {
  const manifest = {
    name: "test-bot",
    dependencies: { "yt-search": "^2.13.1", express: "^5.0.0" },
    optionalDependencies: { "yt-search": "^2.13.1", qrcode: "^1.5.0" },
  };

  const externalManifest = createExternalInstallManifest(manifest);
  assert.deepEqual(externalManifest.dependencies, { express: "^5.0.0" });
  assert.deepEqual(externalManifest.optionalDependencies, { qrcode: "^1.5.0" });
  assert.equal(manifest.dependencies["yt-search"], "^2.13.1");
  assert.equal(manifest.optionalDependencies["yt-search"], "^2.13.1");

  const projectDir = mkdtempSync(join(tmpdir(), "package-manager-yt-search-"));
  try {
    const packageJson = join(projectDir, "package.json");
    writeFileSync(
      packageJson,
      JSON.stringify({ dependencies: { "yt-search": "^2.13.1", express: "^5.0.0" } })
    );
    assert.deepEqual(missingDeclaredPackages(projectDir, join(projectDir, "outside")), ["express"]);
  } finally {
    rmSync(projectDir, { recursive: true, force: true });
  }
});
