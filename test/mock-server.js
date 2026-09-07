import http from 'node:http';

const PNG = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==',
  'base64',
);
export const MOCK_PNG = PNG;

const RATE_HEADERS = { 'ratelimit-limit': '1000', 'ratelimit-remaining': '999', 'ratelimit-reset': '60' };

function json(res, status, body, headers = {}) {
  res.writeHead(status, { 'content-type': 'application/json', ...RATE_HEADERS, ...headers });
  res.end(JSON.stringify(body));
}

function pdfDoc(name, text) {
  const content = Buffer.from(text).toString('base64');
  return { name, size: text.length, mime: 'application/pdf', content };
}

/** A small stand-in for api.bexio.com covering every pagination style and edge case the exporter handles. */
export function startMockServer({ token = 'test-token' } = {}) {
  const hits = new Map();
  const once = new Set();
  const contacts = Array.from({ length: 1200 }, (_, i) => ({ id: i + 1, nr: String(i + 1), name_1: `Contact, "${i + 1}"`, contact_group_ids: null }));
  const archived = [
    { id: 9001, nr: '9001', name_1: 'Old Co', contact_group_ids: null },
    { id: 9002, nr: '9002', name_1: 'Gone GmbH', contact_group_ids: null },
  ];
  const invoices = [
    { id: 1, document_nr: 'RE-00001', title: 'Web', total: 100 },
    { id: 2, document_nr: 'RE-00002', title: 'Design', total: 200 },
    { id: 3, document_nr: null, title: 'Draft', total: 300 },
  ];
  const orders = [{ id: 7, document_nr: 'AB-00007', title: 'Hosting', is_recurring: true }];
  const bills = [
    { id: 'b-1', document_no: 'ER-1', title: 'Laptop', attachment_ids: ['UUID-1'] },
    { id: 'b-2', document_no: 'ER-2', title: 'Coffee', attachment_ids: [] },
    { id: 'b-3', document_no: 'ER-3', title: 'Desk', attachment_ids: ['uuid-3'] },
  ];
  const files = [
    { id: 1, uuid: 'uuid-1', name: 'receipt', extension: 'pdf', mime_type: 'application/pdf', is_archived: false },
    { id: 2, uuid: 'uuid-2', name: 'journal-note.png', extension: 'png', mime_type: 'image/png', is_archived: false },
    { id: 3, uuid: 'uuid-3', name: 'old', extension: 'jpg', mime_type: 'image/jpeg', is_archived: true },
  ];
  const manualEntries = [
    { id: 1, type: 'manual_compound_entry', date: '2024-01-05', reference_nr: 'M-1', entries: [{ id: 11, amount: 10 }, { id: 12, amount: 20 }] },
    { id: 2, type: 'manual_single_entry', date: '2024-02-05', reference_nr: 'M-2', entries: [{ id: 21, amount: 30 }] },
  ];

  const server = http.createServer(async (req, res) => {
    const url = new URL(req.url, 'http://localhost');
    const p = url.pathname;
    hits.set(p, (hits.get(p) ?? 0) + 1);
    if (req.headers.authorization !== `Bearer ${token}`) return json(res, 401, { error_code: 401, message: 'Invalid token' });
    if (req.headers.accept === undefined) return json(res, 415, { error_code: 415, message: 'Accept header missing' });

    const limit = Number(url.searchParams.get('limit') ?? 500);
    const offset = Number(url.searchParams.get('offset') ?? 0);
    const page = Number(url.searchParams.get('page') ?? 1);
    const slice = (arr) => arr.slice(offset, offset + limit);
    const envelope = (arr, size) => {
      const pageSize = Math.min(size ?? limit, 2);
      return {
        data: arr.slice((page - 1) * pageSize, page * pageSize),
        paging: { page, page_size: pageSize, page_count: Math.ceil(arr.length / pageSize), item_count: arr.length },
      };
    };

    // One-off failures to exercise retry logic.
    if (p === '/2.0/kb_invoice' && !once.has('429')) {
      once.add('429');
      return json(res, 429, { error_code: 429, message: 'Too many requests' }, { 'retry-after': '1', 'ratelimit-remaining': '0', 'ratelimit-reset': '1' });
    }
    if (p === '/3.0/accounting/journal' && !once.has('500')) {
      once.add('500');
      return json(res, 500, { error_code: 500, message: 'boom' });
    }

    let m;
    if (p === '/3.0/users/me') return json(res, 200, { id: 1, firstname: 'Test', lastname: 'User', email: 't@example.com' });
    if (p === '/2.0/company_profile') return json(res, 200, [{ id: 1, name: 'Mock AG', logo_base64: PNG.toString('base64') }]);
    if (p === '/2.0/contact') return json(res, 200, url.searchParams.get('show_archived') === 'true' ? archived : slice(contacts));
    if (p === '/2.0/contact/1/additional_address') return json(res, 200, [{ id: 5, name: 'Warehouse', city: 'Bern' }]);

    if (p === '/2.0/kb_invoice') return json(res, 200, slice(invoices));
    if ((m = p.match(/^\/2\.0\/kb_invoice\/(\d+)$/))) {
      const inv = invoices.find((i) => i.id === Number(m[1]));
      return inv ? json(res, 200, { ...inv, positions: [{ id: 1, text: 'Work', amount: '1' }] }) : json(res, 404, { message: 'nope' });
    }
    if ((m = p.match(/^\/2\.0\/kb_invoice\/(\d+)\/pdf$/))) return json(res, 200, pdfDoc(`RE-${m[1]}.pdf`, `%PDF-1.4 mock invoice ${m[1]}`));
    if (p === '/2.0/kb_invoice/1/payment') return json(res, 200, [{ id: 11, value: '100.00', kb_invoice_id: 1 }]);
    if (p === '/2.0/kb_invoice/2/kb_reminder') return json(res, 200, [{ id: 9, kb_invoice_id: 2, reminder_level: 1 }]);
    if (p === '/2.0/kb_invoice/2/kb_reminder/9/pdf') return json(res, 200, pdfDoc('reminder.pdf', '%PDF-1.4 mock reminder 9'));
    if (p.match(/^\/2\.0\/kb_invoice\/\d+\/kb_reminder$/)) return json(res, 200, []);

    if (p === '/2.0/kb_order') return json(res, 200, slice(orders));
    if (p === '/2.0/kb_order/7') return json(res, 200, { ...orders[0], positions: [] });
    if (p === '/2.0/kb_order/7/pdf') return json(res, 200, pdfDoc('AB.pdf', '%PDF-1.4 mock order 7'));
    if (p === '/2.0/kb_order/7/repetition') return json(res, 200, { start: '2024-01-01', end: null, repetition: { type: 'monthly' } });

    if (p === '/4.0/purchase/bills') return json(res, 200, envelope(bills));
    if ((m = p.match(/^\/4\.0\/purchase\/bills\/([\w-]+)$/))) {
      const bill = bills.find((b) => b.id === m[1]);
      return bill ? json(res, 200, { ...bill, line_items: [{ id: 'l1', amount: 1 }] }) : json(res, 404, { message: 'nope' });
    }
    if (p === '/4.0/purchase/outgoing-payments') {
      const rows = url.searchParams.get('bill_id') === 'b-1' ? [{ id: 'op-1', bill_id: 'b-1', amount: 50 }] : [];
      return json(res, 200, { data: rows, paging: { page: 1, page_size: 100, page_count: rows.length ? 1 : 0, item_count: rows.length } });
    }

    if (p === '/3.0/files') {
      const rows = files.slice(offset, offset + 2);
      return json(res, 200, rows, { 'x-limit': '2', 'x-offset': String(offset), 'x-total-count': String(files.length) });
    }
    if ((m = p.match(/^\/3\.0\/files\/(\d+)\/download$/))) {
      res.writeHead(200, { 'content-type': 'application/octet-stream', ...RATE_HEADERS });
      return res.end(Buffer.from(`FILE-${m[1]}`));
    }
    if (p === '/3.0/files/1/usage') return json(res, 200, { id: 'b-1', ref_class: 'Bill', title: 'ER-1', document_nr: 'ER-1' });
    if (p.match(/^\/3\.0\/files\/\d+\/usage$/)) return json(res, 404, { message: 'unused' });

    if (p === '/4.0/banking/payments') {
      const perPage = Number(url.searchParams.get('per-page') ?? 500);
      const bankPage = Number(url.searchParams.get('page') ?? 0);
      const rows = [{ id: 100, amount: 10 }, { id: 101, amount: 20 }];
      return json(res, 200, bankPage === 0 ? rows.slice(0, perPage) : []);
    }

    if (p === '/3.0/accounting/manual_entries') return json(res, 200, slice(manualEntries));
    if (p === '/3.0/accounting/manual_entries/1/files') return json(res, 200, [files[1]]);
    if (p === '/3.0/accounting/manual_entries/2/entries/21/files') return json(res, 200, []);
    if (p === '/3.0/accounting/journal') return json(res, 200, slice([{ id: 1, amount: 1 }, { id: 2, amount: 2 }]));
    if (p === '/3.0/taxes') return json(res, 200, url.searchParams.get('scope') === 'inactive' ? [{ id: 2, name: 'old' }] : [{ id: 1, name: 'UN77' }]);

    if (p === '/4.0/payroll/employees') return json(res, 403, { error_code: 403, message: 'No payroll' });

    if (p.startsWith('/4.0/')) return json(res, 200, { data: [], paging: { page: 1, page_size: 100, page_count: 0, item_count: 0 } });
    return json(res, 200, []);
  });

  return new Promise((resolve) => {
    server.listen(0, '127.0.0.1', () => {
      const { port } = server.address();
      resolve({
        url: `http://127.0.0.1:${port}`,
        hits,
        close: () => new Promise((r) => server.close(r)),
      });
    });
  });
}
