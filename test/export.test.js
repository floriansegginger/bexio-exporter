import { test } from 'node:test';
import assert from 'node:assert/strict';
import { promises as fs } from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { startMockServer, MOCK_PNG } from './mock-server.js';
import { runExport, selectSections } from '../src/run.js';
import { toCsv, flatten } from '../src/csv.js';
import { safeName } from '../src/store.js';
import { fileName } from '../src/util.js';

test('csv flattening and quoting', () => {
  assert.deepEqual(flatten({ a: 1, b: { c: 'x', d: null }, e: [1, 2], f: [] }), { a: 1, 'b.c': 'x', 'b.d': '', e: '[1,2]', f: '' });
  const csv = toCsv([{ id: 1, name: 'Say "hi", ok' }, { id: 2, extra: true }]);
  assert.equal(csv, '\uFEFFid,name,extra\r\n1,"Say ""hi"", ok",\r\n2,,true\r\n');
});

test('safe names and file names', () => {
  assert.equal(safeName('RE-00001'), 'RE-00001');
  assert.equal(safeName(' a/b:c*d?e"f<g>h|i '), 'a_b_c_d_e_f_g_h_i');
  assert.equal(safeName(''), 'untitled');
  assert.equal(fileName({ id: 4, name: 'photo.JPG', extension: 'jpg' }), '4_photo.JPG');
  assert.equal(fileName({ id: 5, name: 'scan', extension: 'pdf' }), '5_scan.pdf');
});

test('section selection', () => {
  assert.deepEqual(selectSections({ only: 'sales,files' }).map((s) => s.name), ['files', 'sales']);
  assert.ok(!selectSections({ skip: 'payroll' }).some((s) => s.name === 'payroll'));
  assert.throws(() => selectSections({ only: 'nope' }), /Unknown section/);
});

test('full export against a mock bexio API, then resume', async (t) => {
  const server = await startMockServer();
  t.after(() => server.close());
  const out = await fs.mkdtemp(path.join(os.tmpdir(), 'bexio-export-test-'));
  t.after(() => fs.rm(out, { recursive: true, force: true }));
  const logs = [];
  const log = (m) => logs.push(m);

  const manifest = await runExport({ token: 'test-token', baseUrl: server.url, out, concurrency: 4, log });
  const read = (rel) => fs.readFile(path.join(out, rel));
  const readJson = async (rel) => JSON.parse(await read(rel));
  const exists = (rel) => fs.access(path.join(out, rel)).then(() => true, () => false);

  // company
  assert.equal(Buffer.compare(await read('company/logo_1.png'), MOCK_PNG), 0);

  // contacts: offset pagination (3 pages) + archived + additional addresses
  const contacts = await readJson('contacts/contacts.json');
  assert.equal(contacts.length, 1202);
  assert.equal(contacts.filter((c) => c._archived).length, 2);
  assert.equal(server.hits.get('/2.0/contact'), 4);
  assert.ok((await read('contacts/contacts.csv')).toString('utf8').startsWith('\uFEFFid,nr,name_1'));
  const addresses = await readJson('contacts/additional_addresses.json');
  assert.deepEqual(addresses, [{ contact_id: 1, id: 5, name: 'Warehouse', city: 'Bern' }]);

  // sales: show + pdf + payments + reminders + repetition; 429 retried
  assert.equal((await readJson('sales/invoices/RE-00001/invoice.json')).positions.length, 1);
  assert.equal((await read('sales/invoices/RE-00001/invoice.pdf')).toString(), '%PDF-1.4 mock invoice 1');
  assert.equal((await readJson('sales/invoices/RE-00001/payments.json')).length, 1);
  assert.equal((await read('sales/invoices/RE-00002/reminder_1.pdf')).toString(), '%PDF-1.4 mock reminder 9');
  assert.ok(await exists('sales/invoices/id_3/invoice.json'));
  assert.equal((await readJson('sales/invoice_payments.json'))[0].invoice_document_nr, 'RE-00001');
  assert.equal((await readJson('sales/orders/AB-00007/repetition.json')).repetition.type, 'monthly');
  assert.equal(server.hits.get('/2.0/kb_invoice'), 2);

  // purchase: page-based pagination, attachments resolved by uuid via the file inbox (case-insensitive)
  assert.equal((await readJson('purchase/bills.json')).length, 3);
  assert.equal(server.hits.get('/4.0/purchase/bills'), 2);
  assert.equal((await read('purchase/bills/ER-1/attachments/1_receipt.pdf')).toString(), 'FILE-1');
  assert.equal((await read('purchase/bills/ER-3/attachments/3_old.jpg')).toString(), 'FILE-3');
  assert.equal((await readJson('purchase/bills/ER-1/attachments/attachments.json'))[0].file_id, 1);
  assert.equal((await readJson('purchase/outgoing_payments.json')).length, 1);

  // files: X-Limit driven offset pagination, downloads, usage
  const index = await readJson('files/index.json');
  assert.equal(index.length, 3);
  assert.equal(server.hits.get('/3.0/files'), 2);
  assert.ok(index.every((f) => f._path));
  assert.equal(index[0]._usage.ref_class, 'Bill');
  assert.equal(index[1]._usage, null);
  assert.equal((await read('files/2_journal-note.png')).toString(), 'FILE-2');

  // accounting: manual entry attachments, taxes merged, journal after a 500
  assert.equal((await read('accounting/manual_entries/1/attachments/2_journal-note.png')).toString(), 'FILE-2');
  assert.equal((await readJson('accounting/taxes.json')).length, 2);
  assert.equal((await readJson('accounting/journal.json')).length, 2);
  assert.equal((await readJson('accounting/manual_entry_lines.json')).length, 3);

  // banking: page/per-page
  assert.equal((await readJson('banking/payments.json')).length, 2);

  // payroll not available -> handled, not an error
  assert.equal(manifest.sections.find((s) => s.name === 'payroll').status, 'ok');
  assert.ok(!(await exists('payroll/employees.json')));

  assert.deepEqual(manifest.errors, []);
  assert.ok(manifest.stats.retries >= 2, `expected retries, got ${manifest.stats.retries}`);
  assert.ok(manifest.sections.every((s) => s.status === 'ok'));
  assert.ok(logs.some((l) => /retrying/.test(l)));

  // resume: a second run must not re-fetch what exists
  const firstRequests = manifest.stats.requests;
  const second = await runExport({ token: 'test-token', baseUrl: server.url, out, concurrency: 4, log });
  assert.deepEqual(second.errors, []);
  assert.ok(second.stats.requests < firstRequests / 10, `resume made ${second.stats.requests} requests vs ${firstRequests}`);
  assert.equal(server.hits.get('/2.0/contact'), 4, 'contact list must not be fetched again');
  assert.equal(server.hits.get('/3.0/files/1/download'), 1, 'files must not be downloaded again');
});

test('invalid token is reported as a 401 error', async (t) => {
  const server = await startMockServer();
  t.after(() => server.close());
  const out = await fs.mkdtemp(path.join(os.tmpdir(), 'bexio-export-test-'));
  t.after(() => fs.rm(out, { recursive: true, force: true }));
  const manifest = await runExport({ token: 'wrong', baseUrl: server.url, out, only: 'banking' });
  assert.ok(manifest.errors.length > 0);
  assert.ok(manifest.errors.every((e) => e.status === 401));
});
