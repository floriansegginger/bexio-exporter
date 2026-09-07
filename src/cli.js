import { parseArgs } from 'node:util';
import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { runExport, selectSections, VERSION } from './run.js';
import { SECTIONS } from './sections/index.js';
import { BexioClient, BexioError, DEFAULT_BASE_URL } from './client.js';
import { formatBytes, todayStamp } from './util.js';

const HELP = `bexio-export ${VERSION} - download everything from a bexio account

Usage:
  bexio-export [options]

Authentication (one of):
  --token <pat>            Personal Access Token
  BEXIO_TOKEN=<pat>        environment variable, or a line in a .env file in the current directory
  Create a token at https://developer.bexio.com/pat (valid for 60 days, full read access).

Options:
  -o, --out <dir>          Output directory (default: ./bexio-export-YYYY-MM-DD)
      --only <a,b>         Export only these sections
      --skip <a,b>         Skip these sections
      --no-pdf             Do not generate PDFs (invoices, quotes, orders, reminders, paystubs)
      --fast               Skip per-record extras: comments, additional addresses, manual entry
                           attachments, file usage lookups, paystubs
      --overwrite          Re-download files that already exist (default: resume, skip existing)
      --concurrency <n>    Parallel requests (default: 3)
      --page-size <n>      Page size for list endpoints, max 2000 (default: 500)
      --base-url <url>     API base URL (default: ${DEFAULT_BASE_URL})
      --list-sections      Print the available sections and exit
  -v, --verbose            Log every request
  -h, --help               Show this help

Re-running with the same --out directory resumes: files that already exist are not fetched again.
The reports section needs no token: "bexio-export --only reports --out <export dir>" recomputes
the accounting reports from an existing export.
`;

const NO_TOKEN = `No bexio token found.

1. Open https://developer.bexio.com/pat and create a Personal Access Token.
2. Run:  BEXIO_TOKEN=<token> bexio-export
   or put  BEXIO_TOKEN=<token>  into a .env file next to where you run the command,
   or pass  --token <token>.
`;

export function loadDotEnv(file = path.resolve('.env')) {
  const out = {};
  if (!existsSync(file)) return out;
  for (const rawLine of readFileSync(file, 'utf8').split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line || line.startsWith('#')) continue;
    const eq = line.indexOf('=');
    if (eq === -1) continue;
    const key = line.slice(0, eq).trim().replace(/^export\s+/, '');
    let value = line.slice(eq + 1).trim();
    if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
      value = value.slice(1, -1);
    }
    out[key] = value;
  }
  return out;
}

function timestamp() {
  return new Date().toTimeString().slice(0, 8);
}

export async function main(argv) {
  let values;
  try {
    ({ values } = parseArgs({
      args: argv,
      allowNegative: true,
      options: {
        out: { type: 'string', short: 'o' },
        token: { type: 'string' },
        only: { type: 'string' },
        skip: { type: 'string' },
        pdf: { type: 'boolean', default: true },
        fast: { type: 'boolean', default: false },
        overwrite: { type: 'boolean', default: false },
        concurrency: { type: 'string', default: '3' },
        'page-size': { type: 'string', default: '500' },
        'base-url': { type: 'string', default: DEFAULT_BASE_URL },
        'list-sections': { type: 'boolean', default: false },
        verbose: { type: 'boolean', short: 'v', default: false },
        help: { type: 'boolean', short: 'h', default: false },
      },
    }));
  } catch (err) {
    console.error(`${err.message}\n`);
    console.error(HELP);
    return 1;
  }

  if (values.help) {
    console.log(HELP);
    return 0;
  }
  if (values['list-sections']) {
    for (const s of SECTIONS) console.log(`${s.name.padEnd(12)} ${s.description}`);
    return 0;
  }

  let selected;
  try {
    selected = selectSections({ only: values.only, skip: values.skip });
  } catch (err) {
    console.error(err.message);
    return 1;
  }
  const offline = selected.length > 0 && selected.every((s) => s.offline);

  let token = values.token || process.env.BEXIO_TOKEN || loadDotEnv().BEXIO_TOKEN;
  if (!token && offline) token = 'offline';
  if (!token) {
    console.error(NO_TOKEN);
    return 1;
  }

  const out = values.out || `bexio-export-${todayStamp()}`;
  const log = (message) => console.error(`[${timestamp()}] ${message}`);
  const baseUrl = values['base-url'];

  if (offline) {
    if (!existsSync(out)) {
      console.error(`Output directory ${out} does not exist. Offline sections work on an existing export; pass --out <export dir>.`);
      return 1;
    }
    log(`Offline: computing ${selected.map((s) => s.name).join(', ')} from ${path.resolve(out)}`);
  }

  // Preflight: validate the token and show who we are exporting for.
  const probe = new BexioClient({ token, baseUrl, log, maxRetries: 2 });
  if (!offline) try {
    const me = await probe.getJson('/3.0/users/me');
    const profiles = await probe.getJson('/2.0/company_profile').catch(() => null);
    const company = Array.isArray(profiles) && profiles[0]?.name ? ` of "${profiles[0].name}"` : '';
    log(`Authenticated as ${me?.firstname ?? ''} ${me?.lastname ?? ''} <${me?.email ?? '?'}>${company}`);
  } catch (err) {
    if (err instanceof BexioError && err.status === 401) {
      console.error('The token was rejected (HTTP 401). Personal Access Tokens expire after 60 days; create a new one at https://developer.bexio.com/pat');
      return 1;
    }
    throw err;
  }

  const controller = new AbortController();
  process.once('SIGINT', () => {
    log('Interrupted. Finishing requests in flight and writing manifest.json (press Ctrl+C again to quit immediately).');
    controller.abort();
    process.once('SIGINT', () => process.exit(130));
  });

  log(`Exporting to ${path.resolve(out)}`);
  const manifest = await runExport({
    token,
    out,
    baseUrl,
    only: values.only,
    skip: values.skip,
    pdf: values.pdf,
    fast: values.fast,
    overwrite: values.overwrite,
    concurrency: Number(values.concurrency) || 3,
    pageSize: Number(values['page-size']) || 500,
    verbose: values.verbose,
    log,
    signal: controller.signal,
  });

  const { stats } = manifest;
  log('');
  log(`Done${manifest.aborted ? ' (aborted)' : ''}: ${stats.requests} requests, ${formatBytes(stats.bytes)} downloaded, ${stats.files_written} files written, ${stats.files_skipped} already present.`);
  for (const s of manifest.sections) {
    log(`  ${s.name.padEnd(12)} ${s.status.padEnd(8)} ${String(s.requests).padStart(6)} requests ${String(s.seconds).padStart(7)}s${s.errors ? `  ${s.errors} errors` : ''}`);
  }
  if (manifest.errors.length) {
    log(`${manifest.errors.length} error(s) recorded in ${path.join(out, 'manifest.json')}. Re-run the same command to retry only what is missing.`);
    return 2;
  }
  log(`Manifest written to ${path.join(out, 'manifest.json')}`);
  return manifest.aborted ? 130 : 0;
}
