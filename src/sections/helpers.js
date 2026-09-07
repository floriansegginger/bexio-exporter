import { safeName } from '../store.js';
import { fileName } from '../util.js';

/** Run `fn`, recording (not raising) any error against the current section. */
export async function safe(ctx, context, fn) {
  try {
    return await fn();
  } catch (err) {
    ctx.store.recordError(ctx.section, context, err);
    ctx.log(`! ${context}: ${err.message}`);
    return undefined;
  }
}

/**
 * Resume-aware JSON fetch: if the file already exists it is read back instead of
 * fetched. Empty results are not written unless `writeEmpty` is set, so they are
 * re-checked on the next run.
 */
export async function fetchOrRead(ctx, rel, fetcher, { writeEmpty = false, csv = false } = {}) {
  const { store } = ctx;
  if (store.shouldSkip(rel)) return store.readJson(rel);
  const data = await fetcher();
  const empty = data === null || data === undefined || (Array.isArray(data) && data.length === 0);
  if (!empty || writeEmpty) {
    await store.writeJson(rel, data);
    if (csv && Array.isArray(data) && data.length) await store.writeCsv(rel.replace(/\.json$/, '.csv'), data);
  }
  return data;
}

/** fetchOrRead + logging + error capture. Returns `[]` (or `null`) on failure. */
export async function collect(ctx, base, fetcher, { csv = false, writeEmpty = true } = {}) {
  const rel = `${base}.json`;
  try {
    const data = await fetchOrRead(ctx, rel, fetcher, { writeEmpty, csv });
    const count = Array.isArray(data) ? data.length : data && typeof data === 'object' ? Object.keys(data).length : data ? 1 : 0;
    ctx.log(`${base}: ${count}`);
    return data ?? [];
  } catch (err) {
    ctx.store.recordError(ctx.section, base, err);
    ctx.log(`! ${base}: ${err.message}`);
    return [];
  }
}

/** Fetch a whole list endpoint into `<base>.json` (+ `.csv` when asked). */
export async function simpleList(ctx, path, base, { query, csv = false, style = 'offset', limit, allow = [] } = {}) {
  const { client } = ctx;
  return collect(
    ctx,
    base,
    async () => {
      switch (style) {
        case 'offset':
          return client.listOffset(path, query, { limit: limit ?? client.pageSize, allow });
        case 'paged':
          return client.listPaged(path, query, { limit: limit ?? 100, allow });
        case 'perpage':
          return client.listPerPage(path, query, { perPage: limit ?? client.pageSize, allow });
        case 'single':
          return client.getJson(path, query, { allow });
        default:
          throw new Error(`Unknown list style ${style}`);
      }
    },
    { csv },
  );
}

/** Choose a unique, human-readable folder name per record. */
export function folderNames(items, keyOf) {
  const used = new Set();
  const out = new Map();
  for (const item of items) {
    const key = keyOf(item);
    let name = key === null || key === undefined || String(key).trim() === '' ? `id_${item.id}` : safeName(String(key));
    if (used.has(name)) name = `${name}_${safeName(String(item.id))}`;
    used.add(name);
    out.set(item, name);
  }
  return out;
}

/**
 * The file inbox index (all files, archived included), keyed by id and uuid.
 * Read from `files/index.json` when the files section already ran, otherwise
 * fetched (metadata only) on demand.
 */
export async function ensureFilesIndex(ctx) {
  if (ctx.cache.files) return ctx.cache.files;
  const { client, store } = ctx;
  let list;
  if (store.exists('files/index.json')) {
    list = await store.readJson('files/index.json');
  } else {
    list = await client.listOffset('/3.0/files', { archived_state: 'all' }, { sendLimit: false });
  }
  for (const file of list) if (!file._path) file._path = `files/${fileName(file)}`;
  ctx.cache.files = {
    list,
    byId: new Map(list.map((f) => [String(f.id), f])),
    byUuid: new Map(list.filter((f) => f.uuid).map((f) => [String(f.uuid).toLowerCase(), f])),
  };
  return ctx.cache.files;
}

/**
 * Save the files referenced by `ids` (uuids or numeric ids) into `dirRel`.
 * Uses the already-downloaded copy from `files/` when present, otherwise downloads.
 */
export async function saveAttachments(ctx, ids, dirRel) {
  const unique = [...new Set((ids ?? []).filter((id) => id !== null && id !== undefined).map(String))];
  if (unique.length === 0) return [];
  const { client, store } = ctx;
  const index = await ensureFilesIndex(ctx);
  const saved = [];
  for (const id of unique) {
    const meta = index.byUuid.get(id.toLowerCase()) ?? index.byId.get(id);
    const name = meta ? fileName(meta) : safeName(id);
    const rel = `${dirRel}/${name}`;
    if (!store.shouldSkip(rel)) {
      if (meta?._path && store.exists(meta._path)) {
        await store.copy(meta._path, rel);
      } else {
        const fileId = meta?.id ?? (/^\d+$/.test(id) ? id : null);
        const buf = fileId === null ? null : await client.getBinary(`/3.0/files/${fileId}/download`, { allow: [404] });
        if (!buf) {
          saved.push({ id, file_id: meta?.id ?? null, missing: true });
          ctx.log(`! attachment ${id} could not be resolved (not in the file inbox)`);
          continue;
        }
        await store.writeBinary(rel, buf);
      }
    }
    saved.push({
      id,
      file_id: meta?.id ?? null,
      uuid: meta?.uuid ?? null,
      name: meta?.name ?? null,
      extension: meta?.extension ?? null,
      mime_type: meta?.mime_type ?? null,
      path: rel,
    });
  }
  await store.writeJson(`${dirRel}/attachments.json`, saved);
  return saved;
}
