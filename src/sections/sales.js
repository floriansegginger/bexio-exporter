import { collect, fetchOrRead, folderNames, safe, simpleList } from './helpers.js';
import { pMap, progress } from '../util.js';

const TYPES = [
  { key: 'quotes', singular: 'quote', kb: 'kb_offer', pdf: true, comments: true },
  { key: 'orders', singular: 'order', kb: 'kb_order', pdf: true, comments: true, repetition: true },
  { key: 'invoices', singular: 'invoice', kb: 'kb_invoice', pdf: true, comments: true, payments: true, reminders: true },
  { key: 'deliveries', singular: 'delivery', kb: 'kb_delivery', pdf: false, comments: false },
];

function pdfBuffer(doc) {
  if (!doc || typeof doc.content !== 'string') throw new Error('PDF response did not contain base64 content');
  return Buffer.from(doc.content, 'base64');
}

export default {
  name: 'sales',
  description: 'Quotes, orders, invoices and deliveries with positions, PDFs, payments, reminders and comments',
  async run(ctx) {
    const { client, store, opts } = ctx;
    for (const type of TYPES) {
      if (ctx.aborted) return;
      const list = await simpleList(ctx, `/2.0/${type.kb}`, `sales/${type.key}`, { csv: true });
      const names = folderNames(list, (doc) => doc.document_nr);
      const allPayments = [];
      const allReminders = [];
      const tick = progress(ctx, `sales: ${type.key}`, list.length);

      await pMap(
        list,
        async (item) => {
          const dir = `sales/${type.key}/${names.get(item)}`;
          await safe(ctx, `${type.key}/${item.document_nr ?? item.id}`, async () => {
            await fetchOrRead(ctx, `${dir}/${type.singular}.json`, () => client.getJson(`/2.0/${type.kb}/${item.id}`), {
              writeEmpty: true,
            });

            if (type.pdf && opts.pdf) {
              const rel = `${dir}/${type.singular}.pdf`;
              if (!store.shouldSkip(rel)) {
                const doc = await client.getJson(`/2.0/${type.kb}/${item.id}/pdf`);
                await store.writeBinary(rel, pdfBuffer(doc));
              }
            }

            if (type.comments && !opts.fast) {
              await fetchOrRead(ctx, `${dir}/comments.json`, () =>
                client.listOffset(`/2.0/${type.kb}/${item.id}/comment`, {}, { allow: [404] }),
              );
            }

            if (type.payments) {
              const payments = await fetchOrRead(ctx, `${dir}/payments.json`, () =>
                client.listOffset(`/2.0/kb_invoice/${item.id}/payment`, {}, { allow: [404] }),
              );
              for (const p of payments ?? []) allPayments.push({ invoice_document_nr: item.document_nr, ...p });
            }

            if (type.reminders) {
              const reminders = await fetchOrRead(ctx, `${dir}/reminders.json`, async () => {
                const data = await client.getJson(`/2.0/kb_invoice/${item.id}/kb_reminder`, undefined, { allow: [404] });
                return Array.isArray(data) ? data : [];
              });
              for (const r of reminders ?? []) {
                allReminders.push({ invoice_document_nr: item.document_nr, ...r });
                if (!opts.pdf) continue;
                const rel = `${dir}/reminder_${r.reminder_level ?? r.id}.pdf`;
                if (store.shouldSkip(rel)) continue;
                await safe(ctx, `${type.key}/${item.document_nr ?? item.id}/reminder/${r.id}`, async () => {
                  const doc = await client.getJson(`/2.0/kb_invoice/${item.id}/kb_reminder/${r.id}/pdf`);
                  await store.writeBinary(rel, pdfBuffer(doc));
                });
              }
            }

            if (type.repetition && item.is_recurring) {
              await fetchOrRead(ctx, `${dir}/repetition.json`, () =>
                client.getJson(`/2.0/kb_order/${item.id}/repetition`, undefined, { allow: [404] }),
              );
            }
          });
          tick();
        },
        opts.concurrency,
        { shouldStop: () => ctx.aborted },
      );

      if (type.payments) {
        await collect(ctx, 'sales/invoice_payments', async () => allPayments, { csv: true });
      }
      if (type.reminders) {
        await collect(ctx, 'sales/invoice_reminders', async () => allReminders, { csv: true });
      }
    }
  },
};
