// Uses the same ORMBG model and ONNX Runtime Web as Kitlibre's background remover.
// The image is processed locally; only the fixed, hash-verified runtime and model
// are downloaded. Model: Apache-2.0, ONNX Runtime Web: MIT.
import { createHash, randomBytes } from 'node:crypto';
import { mkdir, readFile, rename, unlink, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const ROOT = dirname(dirname(fileURLToPath(import.meta.url)));
const CACHE = join(ROOT, '.cache', 'kitlibre-ormbg-ffbcae62');
const ORT_URL = 'https://kitlibre.com/engine/ort-1.30.0/';
const MODEL_URL = 'https://kitlibre.com/engine/models/ormbg-int8-ffbcae62/';
const FILES = [
  ['ort.wasm.min.mjs', '219e6a1fc8a9938268d18efca3c91d310bd2f4a59bbd13744df5b2b7fc6cee3b', 100000],
  ['ort-wasm-simd-threaded.mjs', 'e13f7f94fc51b4ca72b12faeb1ee95f4ace6dfbc8939bc718aabdc0a27c4299b', 100000],
  ['ort-wasm-simd-threaded.wasm', '3398c10d07d229bd91b364548e130e0e51a8e5704b88c7c083ebbeb78842dee2', 16000000],
];
const MODEL_HASH = 'ffbcae62a7b675d616e64cb392ee028786c4cf74f83596590fba13733ef00171';
const MODEL_SIZE = 44315205;
const hash = bytes => createHash('sha256').update(bytes).digest('hex');
async function verifiedFile(path, expected) {
  try { const bytes = await readFile(path); return hash(bytes) === expected ? bytes : null; } catch (error) { if (error.code === 'ENOENT') return null; throw error; }
}
async function download(url, limit) {
  const response = await fetch(url, {signal: AbortSignal.timeout(120000)});
  if (!response.ok) throw Error(`تعذر تنزيل نموذج إزالة الخلفية (HTTP ${response.status})`);
  if (Number(response.headers.get('content-length')) > limit) throw Error('حجم ملف النموذج غير متوقع');
  const chunks=[]; let size=0;
  for await (const chunk of response.body) { size+=chunk.length; if (size>limit) throw Error('حجم ملف النموذج غير متوقع'); chunks.push(chunk); }
  return Buffer.concat(chunks);
}
async function saveVerified(path, bytes, expected) {
  if (hash(bytes)!==expected) throw Error('فشل التحقق من سلامة نموذج إزالة الخلفية');
  const temp=path+'.'+randomBytes(8).toString('hex')+'.tmp';
  try { await writeFile(temp,bytes,{mode:0o600,flag:'wx'}); await rename(temp,path); } finally { await unlink(temp).catch(()=>{}); }
}
let sessionPromise;
async function getSession() {
  if (sessionPromise) return sessionPromise;
  sessionPromise=(async()=>{
    await mkdir(CACHE,{recursive:true,mode:0o700});
    for (const [name,digest,limit] of FILES) {
      const path=join(CACHE,name);
      if (!await verifiedFile(path,digest)) await saveVerified(path,await download(ORT_URL+name,limit),digest);
    }
    const modelPath=join(CACHE,'model.onnx'); let model=await verifiedFile(modelPath,MODEL_HASH);
    if (!model) {
      const parts=[]; for (let i=0;i<3;i++) parts.push(await download(MODEL_URL+`part-${i}.bin`,20971520));
      model=Buffer.concat(parts); if (model.length!==MODEL_SIZE) throw Error('حجم نموذج إزالة الخلفية غير صحيح');
      await saveVerified(modelPath,model,MODEL_HASH);
    }
    const ort=await import(pathToFileURL(join(CACHE,'ort.wasm.min.mjs')).href);
    ort.env.wasm.numThreads=1; ort.env.wasm.wasmPaths=pathToFileURL(CACHE+'/').href;
    const session=await ort.InferenceSession.create(model,{executionProviders:['wasm'],graphOptimizationLevel:'all'});
    return {ort,session};
  })().catch(error=>{sessionPromise=undefined;throw error});
  return sessionPromise;
}
let queue=Promise.resolve();
export function removeWithKitlibre(buffer) {
  // One inference at a time to avoid concurrent model executions exhausting RAM.
  const job=queue.then(()=>run(buffer)); queue=job.catch(()=>{}); return job;
}
async function run(buffer) {
  const {default:sharp}=await import('sharp');
  const input=sharp(buffer,{limitInputPixels:40_000_000}).rotate();
  const image=await input.clone().resize({width:4096,height:4096,fit:'inside',withoutEnlargement:true}).ensureAlpha().raw().toBuffer({resolveWithObject:true});
  const size=1024, pixels=size*size;
  const rgb=await input.clone().resize(size,size,{fit:'fill'}).removeAlpha().toColourspace('srgb').raw().toBuffer();
  const tensor=new Float32Array(pixels*3);
  for(let i=0;i<pixels;i++){tensor[i]=rgb[3*i]/255;tensor[pixels+i]=rgb[3*i+1]/255;tensor[2*pixels+i]=rgb[3*i+2]/255;}
  const {ort,session}=await getSession();
  const tensorInput=new ort.Tensor('float32',tensor,[1,3,size,size]);
  const outputs=await session.run({pixel_values:tensorInput});
  const alpha=outputs.alphas?.data;
  if (!alpha || alpha.length!==pixels) throw Error('نتيجة نموذج إزالة الخلفية غير صالحة');
  const mask=Buffer.allocUnsafe(pixels);
  for(let i=0;i<pixels;i++) mask[i]=Math.round(Math.max(0,Math.min(1,alpha[i]))*255);
  tensorInput.dispose?.(); outputs.alphas.dispose?.();
  const resizedMask=await sharp(mask,{raw:{width:size,height:size,channels:1}}).resize(image.info.width,image.info.height,{fit:'fill'}).greyscale().raw().toBuffer();
  for(let i=0;i<resizedMask.length;i++) image.data[i*4+3]=Math.round(image.data[i*4+3]*resizedMask[i]/255);
  return sharp(image.data,{raw:{width:image.info.width,height:image.info.height,channels:4}}).png().toBuffer();
}
