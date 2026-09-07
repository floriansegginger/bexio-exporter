import { safeName } from './store.js';

/** Run `fn` over `items` with at most `concurrency` in flight. Errors propagate. */
export async function pMap(items, fn, concurrency = 4, { shouldStop = () => false } = {}) {
  const results = new Array(items.length);
  let next = 0;
  const workers = Array.from({ length: Math.max(1, Math.min(concurrency, items.length)) }, async () => {
    while (next < items.length && !shouldStop()) {
      const i = next++;
      results[i] = await fn(items[i], i);
    }
  });
  await Promise.all(workers);
  return results;
}

/** Stable on-disk name for a bexio file record: `<id>_<name>.<ext>`. */
export function fileName(file) {
  const base = safeName(file.name || `file_${file.id}`);
  const ext = String(file.extension || '').replace(/^\./, '');
  const hasExt = ext && base.toLowerCase().endsWith(`.${ext.toLowerCase()}`);
  return `${file.id}_${base}${ext && !hasExt ? `.${ext}` : ''}`;
}

/** Guess an image extension from magic bytes (for the company logo). */
export function imageExt(buf) {
  if (buf.length >= 8 && buf[0] === 0x89 && buf[1] === 0x50 && buf[2] === 0x4e && buf[3] === 0x47) return 'png';
  if (buf.length >= 3 && buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff) return 'jpg';
  if (buf.length >= 4 && buf.toString('ascii', 0, 4) === 'GIF8') return 'gif';
  if (buf.length >= 12 && buf.toString('ascii', 0, 4) === 'RIFF' && buf.toString('ascii', 8, 12) === 'WEBP') return 'webp';
  const head = buf.toString('utf8', 0, Math.min(buf.length, 256)).trimStart();
  if (head.startsWith('<svg') || (head.startsWith('<?xml') && head.includes('<svg'))) return 'svg';
  return 'bin';
}

/** Returns a `tick()` that logs progress roughly every 10% (or every 10 seconds). */
export function progress(ctx, label, total) {
  let done = 0;
  let last = Date.now();
  const step = Math.max(1, Math.min(100, Math.ceil(total / 10)));
  return () => {
    done++;
    if (done === total || done % step === 0 || Date.now() - last > 10000) {
      last = Date.now();
      ctx.log(`${label}: ${done}/${total}`);
    }
  };
}

export function todayStamp(date = new Date()) {
  const pad = (n) => String(n).padStart(2, '0');
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
}

export function formatBytes(n) {
  if (n < 1024) return `${n} B`;
  if (n < 1024 ** 2) return `${(n / 1024).toFixed(1)} KB`;
  if (n < 1024 ** 3) return `${(n / 1024 ** 2).toFixed(1)} MB`;
  return `${(n / 1024 ** 3).toFixed(2)} GB`;
}
