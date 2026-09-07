import { setTimeout as sleep } from 'node:timers/promises';

export const DEFAULT_BASE_URL = 'https://api.bexio.com';

export class BexioError extends Error {
  constructor(message, { status, url, body } = {}) {
    super(message);
    this.name = 'BexioError';
    this.status = status;
    this.url = url;
    this.body = body;
  }
}

function rowsOf(data) {
  if (Array.isArray(data)) return data;
  if (data && Array.isArray(data.data)) return data.data;
  if (data && Array.isArray(data.results)) return data.results;
  if (data && typeof data === 'object') return [data];
  return [];
}

/**
 * Small bexio REST client: bearer auth, RateLimit-* aware throttling, retries with
 * backoff, a concurrency gate, and the three pagination styles used by API 2.0/3.0/4.0.
 */
export class BexioClient {
  constructor({
    token,
    baseUrl = DEFAULT_BASE_URL,
    concurrency = 3,
    pageSize = 500,
    maxRetries = 5,
    log = () => {},
    verbose = false,
    fetchImpl = globalThis.fetch,
  } = {}) {
    if (!token) throw new Error('A bexio access token is required');
    this.token = token;
    this.baseUrl = baseUrl.replace(/\/+$/, '');
    this.concurrency = Math.max(1, Number(concurrency) || 1);
    this.pageSize = Math.min(2000, Math.max(1, Number(pageSize) || 500));
    this.maxRetries = maxRetries;
    this.log = log;
    this.verbose = verbose;
    this.fetch = fetchImpl;
    this.stats = { requests: 0, retries: 0, rateLimitWaits: 0, bytes: 0 };
    this.rateLimit = { limit: null, remaining: null, reset: null };
    this.pauseUntil = 0;
    this.active = 0;
    this.queue = [];
  }

  buildUrl(path, query) {
    const url = new URL(this.baseUrl + (path.startsWith('/') ? path : `/${path}`));
    for (const [key, value] of Object.entries(query ?? {})) {
      if (value !== undefined && value !== null) url.searchParams.set(key, String(value));
    }
    return url;
  }

  async #acquire() {
    if (this.active < this.concurrency) {
      this.active++;
      return;
    }
    await new Promise((resolve) => this.queue.push(resolve));
    this.active++;
  }

  #release() {
    this.active--;
    const next = this.queue.shift();
    if (next) next();
  }

  #observeRateLimit(headers) {
    if (headers.has('ratelimit-limit')) this.rateLimit.limit = Number(headers.get('ratelimit-limit'));
    if (headers.has('ratelimit-remaining')) this.rateLimit.remaining = Number(headers.get('ratelimit-remaining'));
    if (headers.has('ratelimit-reset')) this.rateLimit.reset = Number(headers.get('ratelimit-reset'));
    const { remaining, reset } = this.rateLimit;
    // Keep a small reserve so in-flight concurrent requests do not tip us into 429s.
    if (headers.has('ratelimit-remaining') && remaining <= this.concurrency && reset > 0) {
      this.pauseUntil = Math.max(this.pauseUntil, Date.now() + reset * 1000 + 250);
    }
  }

  #retryDelayMs(headers, attempt, status) {
    let secs = Number(headers?.get('retry-after'));
    // RateLimit-Reset only says something about 429s; for 5xx use plain exponential backoff.
    if ((!Number.isFinite(secs) || secs <= 0) && status === 429) secs = Number(headers?.get('ratelimit-reset'));
    if (!Number.isFinite(secs) || secs <= 0) secs = Math.min(30, 2 ** attempt);
    return secs * 1000 + 250;
  }

  /**
   * Perform one GET. Retries on network errors, 429 and 5xx. Statuses listed in
   * `allow` are returned with `data: null` instead of throwing.
   */
  async request(path, { query, accept = 'application/json', binary = false, allow = [] } = {}) {
    const url = this.buildUrl(path, query);
    const headers = {
      Accept: accept,
      Authorization: `Bearer ${this.token}`,
      'User-Agent': 'bexio-export/1.0 (+https://github.com/)',
    };
    for (let attempt = 0; ; attempt++) {
      let res;
      let netErr;
      await this.#acquire();
      try {
        const wait = this.pauseUntil - Date.now();
        if (wait > 0) {
          this.stats.rateLimitWaits++;
          this.log(`rate limit: waiting ${Math.ceil(wait / 1000)}s before continuing`);
          await sleep(wait);
        }
        this.stats.requests++;
        if (this.verbose) this.log(`GET ${url.pathname}${url.search}`);
        res = await this.fetch(url, { headers });
      } catch (err) {
        netErr = err;
      } finally {
        this.#release();
      }

      if (netErr) {
        if (attempt >= this.maxRetries) {
          throw new BexioError(`Network error for ${url.pathname}: ${netErr.message}`, { url: url.toString() });
        }
        const delay = Math.min(30, 2 ** attempt) * 1000;
        this.stats.retries++;
        this.log(`network error on ${url.pathname} (${netErr.message}); retrying in ${delay / 1000}s`);
        await sleep(delay);
        continue;
      }

      this.#observeRateLimit(res.headers);

      if (res.status === 429 || res.status >= 500) {
        const body = await res.text().catch(() => '');
        if (attempt >= this.maxRetries) {
          throw new BexioError(
            `HTTP ${res.status} for ${url.pathname} after ${attempt} retries${body ? `: ${body.slice(0, 200)}` : ''}`,
            { status: res.status, url: url.toString(), body },
          );
        }
        const delay = this.#retryDelayMs(res.headers, attempt, res.status);
        if (res.status === 429) this.pauseUntil = Math.max(this.pauseUntil, Date.now() + delay);
        this.stats.retries++;
        this.log(`HTTP ${res.status} on ${url.pathname}; retrying in ${Math.ceil(delay / 1000)}s`);
        await sleep(delay);
        continue;
      }

      if (allow.includes(res.status)) {
        await res.arrayBuffer().catch(() => {});
        return { status: res.status, headers: res.headers, data: null };
      }

      if (!res.ok) {
        const body = await res.text().catch(() => '');
        throw new BexioError(
          `HTTP ${res.status} for ${url.pathname}${body ? `: ${body.slice(0, 300)}` : ''}`,
          { status: res.status, url: url.toString(), body },
        );
      }

      if (binary) {
        const data = Buffer.from(await res.arrayBuffer());
        this.stats.bytes += data.length;
        return { status: res.status, headers: res.headers, data };
      }

      const text = await res.text();
      this.stats.bytes += Buffer.byteLength(text);
      if (!text.trim()) return { status: res.status, headers: res.headers, data: null };
      try {
        return { status: res.status, headers: res.headers, data: JSON.parse(text) };
      } catch {
        throw new BexioError(`Invalid JSON from ${url.pathname}`, {
          status: res.status,
          url: url.toString(),
          body: text.slice(0, 300),
        });
      }
    }
  }

  async getJson(path, query, opts = {}) {
    return (await this.request(path, { ...opts, query })).data;
  }

  /** Binary download. If the API rejects the Accept header (415) retry once with the alternative. */
  async getBinary(path, { query, accept = 'application/json', allow = [] } = {}) {
    try {
      return (await this.request(path, { query, accept, binary: true, allow })).data;
    } catch (err) {
      if (err instanceof BexioError && err.status === 415) {
        const alt = accept === 'application/json' ? '*/*' : 'application/json';
        return (await this.request(path, { query, accept: alt, binary: true, allow })).data;
      }
      throw err;
    }
  }

  /** API 2.0 / 3.0 lists: `limit` + `offset`, bare JSON array. */
  async listOffset(path, query = {}, { limit = this.pageSize, sendLimit = true, allow = [], onPage } = {}) {
    const items = [];
    let offset = 0;
    for (let guard = 0; guard < 100000; guard++) {
      const q = { ...query, offset };
      if (sendLimit) q.limit = limit;
      const { data, headers } = await this.request(path, { query: q, allow });
      if (data === null) break;
      if (!Array.isArray(data)) {
        items.push(...rowsOf(data));
        break;
      }
      items.push(...data);
      onPage?.(items.length);
      if (data.length === 0) break;
      const applied = Number(headers.get('x-limit')) || (sendLimit ? limit : 0);
      if (applied && data.length < applied) break;
      const total = Number(headers.get('x-total-count'));
      if (total > 0 && items.length >= total) break;
      offset += data.length;
    }
    return items;
  }

  /** API 4.0 purchase/expense lists: `limit` + 1-based `page`, `{ data, paging }` envelope. */
  async listPaged(path, query = {}, { limit = 100, allow = [], onPage } = {}) {
    const items = [];
    for (let page = 1; page < 100000; page++) {
      const data = await this.getJson(path, { ...query, limit, page }, { allow });
      if (data === null) break;
      const rows = rowsOf(data);
      items.push(...rows);
      onPage?.(items.length);
      if (rows.length === 0) break;
      const pageCount = Number(data?.paging?.page_count);
      if (pageCount > 0) {
        if (page >= pageCount) break;
      } else if (rows.length < limit) {
        break;
      }
    }
    return items;
  }

  /**
   * API 4.0 banking lists: `page` + `per-page`, answered as
   * `{ query, sort-by, pagination: { page, per-page, max-results }, results }`. De-duplicates defensively.
   */
  async listPerPage(path, query = {}, { perPage = this.pageSize, allow = [], onPage } = {}) {
    const items = [];
    const seen = new Set();
    for (let page = 0; page < 100000; page++) {
      const data = await this.getJson(path, { ...query, page, 'per-page': perPage }, { allow });
      if (data === null) break;
      const rows = rowsOf(data);
      let fresh = 0;
      for (const row of rows) {
        const key = row?.id ?? row?.uuid ?? JSON.stringify(row);
        if (seen.has(key)) continue;
        seen.add(key);
        items.push(row);
        fresh++;
      }
      onPage?.(items.length);
      const maxResults = Number(data?.pagination?.['max-results']);
      if (Number.isFinite(maxResults) && items.length >= maxResults) break;
      if (rows.length === 0 || fresh === 0 || rows.length < perPage) break;
    }
    return items;
  }
}
