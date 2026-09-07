import { BexioClient } from './client.js';
import { Store } from './store.js';
import { SECTIONS } from './sections/index.js';

export const VERSION = '1.0.0';

export function selectSections({ only, skip } = {}) {
  const known = new Set(SECTIONS.map((s) => s.name));
  const parse = (value) =>
    (Array.isArray(value) ? value : String(value ?? '').split(','))
      .map((s) => s.trim().toLowerCase())
      .filter(Boolean);
  const onlyList = parse(only);
  const skipList = parse(skip);
  for (const name of [...onlyList, ...skipList]) {
    if (!known.has(name)) throw new Error(`Unknown section "${name}". Known sections: ${[...known].join(', ')}`);
  }
  return SECTIONS.filter((s) => (onlyList.length === 0 || onlyList.includes(s.name)) && !skipList.includes(s.name));
}

/**
 * Run the export. Returns the manifest that is also written to `<out>/manifest.json`.
 */
export async function runExport({
  token,
  out,
  baseUrl,
  only,
  skip,
  pdf = true,
  fast = false,
  overwrite = false,
  concurrency = 3,
  pageSize = 500,
  verbose = false,
  log = () => {},
  signal,
} = {}) {
  const client = new BexioClient({ token, baseUrl, concurrency, pageSize, log, verbose });
  const store = new Store(out, { overwrite });
  const selected = selectSections({ only, skip });
  const ctx = {
    client,
    store,
    log,
    opts: { pdf, fast, concurrency: Math.max(1, Number(concurrency) || 1), verbose },
    cache: {},
    section: null,
    aborted: false,
  };
  signal?.addEventListener('abort', () => {
    ctx.aborted = true;
  });

  const startedAt = new Date();
  const results = [];
  for (const section of selected) {
    if (ctx.aborted) break;
    ctx.section = section.name;
    const t0 = Date.now();
    const r0 = client.stats.requests;
    const e0 = store.errors.length;
    log(`== ${section.name}: ${section.description}`);
    let status = 'ok';
    try {
      await section.run(ctx);
    } catch (err) {
      status = 'failed';
      store.recordError(section.name, 'section', err);
      log(`! section ${section.name} failed: ${err.message}`);
    }
    if (ctx.aborted && status === 'ok') status = 'aborted';
    const seconds = Math.round((Date.now() - t0) / 100) / 10;
    const requests = client.stats.requests - r0;
    const errors = store.errors.length - e0;
    results.push({ name: section.name, status, seconds, requests, errors });
    log(`== ${section.name} ${status} (${seconds}s, ${requests} requests${errors ? `, ${errors} errors` : ''})`);
  }

  const manifest = {
    tool: 'bexio-export',
    version: VERSION,
    base_url: client.baseUrl,
    output_dir: store.root,
    started_at: startedAt.toISOString(),
    finished_at: new Date().toISOString(),
    aborted: ctx.aborted,
    options: { pdf, fast, overwrite, concurrency, pageSize, only: only ?? null, skip: skip ?? null },
    sections: results,
    stats: { ...client.stats, files_written: store.written, files_skipped: store.skipped },
    rate_limit: client.rateLimit,
    errors: store.errors,
  };
  await store.writeJson('manifest.json', manifest);
  return manifest;
}
