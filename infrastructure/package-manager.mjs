/** Install and repair the bot's dependencies in the dedicated external directory. */
import { spawnSync } from 'node:child_process';
import { existsSync, lstatSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { isAbsolute, join, relative, resolve, sep } from 'node:path';
import { ok, wrn, section } from '../core/logger.mjs';

// Search is bundled into dist/index.mjs; do not fetch a duplicate npm copy.
const OMITTED_EXTERNAL_PACKAGES = new Set(['yt-search']);
const VALID_NAME = /^(?:@[a-z0-9][a-z0-9._-]*\/)?[a-z0-9][a-z0-9._-]*$/;

export function createExternalInstallManifest(manifest) {
  const result = {...manifest, dependencies:{...(manifest.dependencies ?? {})}, optionalDependencies:{...(manifest.optionalDependencies ?? {})}};
  for (const name of OMITTED_EXTERNAL_PACKAGES) { delete result.dependencies[name]; delete result.optionalDependencies[name]; }
  return result;
}
function readManifest(baseDir) { return JSON.parse(readFileSync(join(baseDir, 'package.json'), 'utf8')); }
function syncExternalManifest(baseDir, externalDir) {
  mkdirSync(externalDir, {recursive:true});
  const manifest=readManifest(baseDir), destination=join(externalDir,'package.json');
  if (existsSync(destination)) {
    const existing=JSON.parse(readFileSync(destination,'utf8'));
    if (existing.name !== manifest.name) throw new Error(`مجلد المكتبات الخارجي مستخدم لمشروع آخر (${existing.name ?? 'بدون اسم'}). اختر مجلداً مخصصاً للبوت.`);
  }
  writeFileSync(destination, JSON.stringify(createExternalInstallManifest(manifest),null,2)+'\n',{mode:0o600});
}
function packagePath(root, name) {
  if (!VALID_NAME.test(name)) throw new Error(`اسم حزمة غير صالح: ${name}`);
  return join(root, ...name.split('/'));
}
function packageProblem(root, name, expected) {
  const dir=packagePath(root,name);
  let meta;
  try { meta=JSON.parse(readFileSync(join(dir,'package.json'),'utf8')); }
  catch { return 'مجلد أو package.json ناقص أو تالف'; }
  if (meta.name !== name || typeof meta.version !== 'string' || !meta.version.trim()) return 'بيانات الحزمة غير صالحة';
  if (name === '@whiskeysockets/baileys' && expected && meta.version !== expected) return `الإصدار ${meta.version} لا يطابق ${expected}`;
  // Check concrete package-root exports too; a folder and package.json alone do not
  // prove that an interrupted extraction contains the exported entry point.
  const rootExport = meta.exports && (typeof meta.exports === 'string' || Array.isArray(meta.exports) ? meta.exports : (meta.exports['.'] ?? (Object.keys(meta.exports).some(k=>k.startsWith('.')) ? null : meta.exports)));
  function exportPaths(value) {
    if (typeof value === 'string') return value.startsWith('./') && !value.includes('*') ? [value] : [];
    if (!value || typeof value !== 'object') return [];
    return Object.values(value).flatMap(exportPaths);
  }
  const exports = exportPaths(rootExport);
  if (exports.length && !exports.some(entry=>{
    const file=resolve(dir,entry), rel=relative(dir,file);
    return rel !== '..' && !rel.startsWith('..'+sep) && existsSync(file);
  })) return 'ملفات التصدير الرئيسية ناقصة';
  // A declared main that does not exist is a common sign of an interrupted install.
  // Packages with an exports map may intentionally have a legacy main, so avoid false positives.
  if (!meta.exports && typeof meta.main === 'string' && meta.main && !isAbsolute(meta.main)) {
    const main=resolve(dir,meta.main), rel=relative(dir,main);
    if (rel === '..' || rel.startsWith('..'+sep)) return 'مسار الحزمة غير صالح';
    if (![main,main+'.js',main+'.json',main+'.node',join(main,'index.js'),join(main,'index.json')].some(existsSync)) return 'ملف الدخول الرئيسي ناقص';
  }
  return null;
}
export function declaredPackageProblems(baseDir, externalDir) {
  const manifest=readManifest(baseDir), root=join(externalDir,'node_modules');
  return Object.entries(manifest.dependencies ?? {}).filter(([name])=>!OMITTED_EXTERNAL_PACKAGES.has(name)).flatMap(([name, version])=>{
    const reason=packageProblem(root,name,version); return reason ? [{name,reason}] : [];
  });
}
export function missingDeclaredPackages(baseDir, externalDir) {
  return declaredPackageProblems(baseDir,externalDir).map(p=>p.name);
}
function removeDamagedPackage(root,name) {
  const target=packagePath(root,name);
  // Never traverse a symlinked scope directory into some other location.
  if (name.startsWith('@')) {
    const scope=join(root,name.split('/')[0]);
    try { if (lstatSync(scope).isSymbolicLink()) throw new Error(`رُفض إصلاح ${name}: مجلد النطاق رابط رمزي`); }
    catch(error) { if (error.code !== 'ENOENT') throw error; }
  }
  rmSync(target,{recursive:true,force:true});
}
function failurePackage(output, root) {
  for (const line of String(output||'').split(/\r?\n/)) {
    const match=line.match(/(?:npm\s+(?:ERR!|error)\s+path\s+)(.+?)\s*$/i);
    if (!match) continue;
    const rel=relative(resolve(root),resolve(match[1]));
    if (!rel || rel==='..' || rel.startsWith('..'+sep) || isAbsolute(rel)) continue;
    const parts=rel.split(sep), name=parts[0]?.startsWith('@') ? parts.slice(0,2).join('/') : parts[0];
    if (VALID_NAME.test(name)) return name;
  }
  return null;
}
function runNpm(externalDir) {
  return spawnSync(process.platform==='win32'?'npm.cmd':'npm', ['install','--no-package-lock','--no-audit','--no-fund','--prefer-online'], {
    cwd:externalDir, encoding:'utf8', timeout:600_000, maxBuffer:8*1024*1024,
  });
}
/** Repair interrupted installs, retrying once; never remove the complete node_modules tree. */
export async function ensure(baseDir, externalDir=join(baseDir,'..','bol'), {npmRunner=runNpm}={}) {
  syncExternalManifest(baseDir,externalDir);
  section('التبعيات الخارجية');
  const root=join(externalDir,'node_modules');
  let problems=declaredPackageProblems(baseDir,externalDir);
  if (problems.length) wrn('حزم ناقصة أو تالفة: '+problems.map(x=>`${x.name} (${x.reason})`).join('، '));
  // Remove only incomplete directories, not sessions, tokens, or unrelated packages.
  for (const {name} of problems) removeDamagedPackage(root,name);
  // npm's hidden lock may otherwise make an interrupted tree look complete.
  if (problems.length) rmSync(join(root,'.package-lock.json'),{force:true});
  let lastError='';
  for (let attempt=1; attempt<=2; attempt++) {
    wrn(`تثبيت التبعيات من npm — المحاولة ${attempt} من 2`);
    let result;
    try { result=await npmRunner(externalDir); }
    catch (error) { result={status:1,error}; }
    const output=[result?.stdout,result?.stderr].filter(Boolean).join('\n');
    if (result?.status === 0 && !result?.error) {
      problems=declaredPackageProblems(baseDir,externalDir);
      if (!problems.length) { ok('اكتمل تثبيت الحزم والتحقق منها ✔'); return; }
      lastError='حزم ما زالت ناقصة أو تالفة: '+problems.map(x=>x.name).join('، ');
    } else {
      lastError=result?.error?.message || output.slice(-2000).trim() || `npm خرج بالرمز ${result?.status ?? 'غير معروف'}`;
      problems=declaredPackageProblems(baseDir,externalDir);
    }
    if (attempt===1) {
      const failed=failurePackage(output,root);
      const repair=new Set([...problems.map(x=>x.name),...(failed?[failed]:[])]);
      if (repair.size) {
        wrn('إزالة النسخ الناقصة وإعادة تثبيتها: '+[...repair].join('، '));
        for (const name of repair) removeDamagedPackage(root,name);
        rmSync(join(root,'.package-lock.json'),{force:true});
      }
      wrn('فشل التثبيت أو لم يكتمل؛ إعادة المحاولة من جديد.');
    }
  }
  throw new Error(`تعذر تثبيت الحزم بعد محاولتين. تحقق من الإنترنت والمساحة وسجل npm: ${lastError}`);
}
