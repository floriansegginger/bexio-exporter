import { promises as fs, existsSync } from 'node:fs';
import path from 'node:path';
import { toCsv } from './csv.js';

/** Turn any string into a safe single path segment. */
export function safeName(input, max = 100) {
  let s = String(input ?? '')
    .normalize('NFC')
    .replace(/[\\/:*?"<>|]/g, '_')
    .replace(/\p{Cc}/gu, '_')
    .replace(/\s+/g, ' ')
    .trim()
    .replace(/^\.+/, '');
  if (s.length > max) s = s.slice(0, max).trim();
  return s || 'untitled';
}

/**
 * Output directory. Every write is atomic (write to `.part`, then rename) so a
 * file that exists is always complete, which is what makes resuming safe.
 */
export class Store {
  constructor(root, { overwrite = false } = {}) {
    this.root = path.resolve(root);
    this.overwrite = overwrite;
    this.errors = [];
    this.written = 0;
    this.skipped = 0;
  }

  abs(rel) {
    const resolved = path.resolve(this.root, rel);
    if (!resolved.startsWith(this.root + path.sep) && resolved !== this.root) {
      throw new Error(`Refusing to write outside the export directory: ${rel}`);
    }
    return resolved;
  }

  exists(rel) {
    return existsSync(this.abs(rel));
  }

  /** True when the file already exists and we are not overwriting. */
  shouldSkip(rel) {
    const skip = !this.overwrite && this.exists(rel);
    if (skip) this.skipped++;
    return skip;
  }

  async #write(rel, data) {
    const abs = this.abs(rel);
    await fs.mkdir(path.dirname(abs), { recursive: true });
    const tmp = `${abs}.part`;
    await fs.writeFile(tmp, data);
    await fs.rename(tmp, abs);
    this.written++;
  }

  async writeJson(rel, data) {
    await this.#write(rel, `${JSON.stringify(data, null, 2)}\n`);
  }

  async writeCsv(rel, rows) {
    await this.#write(rel, toCsv(rows));
  }

  async writeBinary(rel, buffer) {
    await this.#write(rel, buffer);
  }

  async readJson(rel) {
    return JSON.parse(await fs.readFile(this.abs(rel), 'utf8'));
  }

  async copy(srcRel, dstRel) {
    const dst = this.abs(dstRel);
    await fs.mkdir(path.dirname(dst), { recursive: true });
    await fs.copyFile(this.abs(srcRel), dst);
    this.written++;
  }

  recordError(section, context, err) {
    const entry = {
      section,
      context,
      message: err?.message ?? String(err),
      status: err?.status,
      url: err?.url,
    };
    this.errors.push(entry);
    return entry;
  }
}
