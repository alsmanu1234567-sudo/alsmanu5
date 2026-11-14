#!/usr/bin/env node
/**
 * تشغيل البوت باستخدام المكتبات الموجودة في المجلد الخارجي فقط.
 * لا يثبت حزم npm ولا ينزّل الثنائيات المفقودة.
 */
process.argv.push("--no-install");
await import("./bootstrap/index.mjs");
