import { collect, fetchOrRead, safe, saveAttachments, simpleList } from './helpers.js';
import { pMap, progress } from '../util.js';

export default {
  name: 'accounting',
  description: 'Chart of accounts, account groups, years, currencies and exchange rates, taxes, VAT periods, manual entries with attachments, the full journal',
  async run(ctx) {
    const { client, opts } = ctx;
    await simpleList(ctx, '/2.0/accounts', 'accounting/accounts', { csv: true });
    await simpleList(ctx, '/2.0/account_groups', 'accounting/account_groups', { csv: true });
    ctx.cache.calendarYears = await simpleList(ctx, '/3.0/accounting/calendar_years', 'accounting/calendar_years');
    await simpleList(ctx, '/3.0/accounting/business_years', 'accounting/business_years');
    await simpleList(ctx, '/3.0/accounting/vat_periods', 'accounting/vat_periods');

    const currencies = await simpleList(ctx, '/3.0/currencies', 'accounting/currencies');
    await collect(ctx, 'accounting/exchange_rates', async () => {
      const out = {};
      for (const currency of currencies) {
        const rates = await safe(ctx, `currencies/${currency.id}/exchange_rates`, () =>
          client.getJson(`/3.0/currencies/${currency.id}/exchange_rates`, undefined, { allow: [404] }),
        );
        out[currency.name ?? currency.id] = rates ?? [];
      }
      return out;
    });

    await collect(
      ctx,
      'accounting/taxes',
      async () => {
        const active = await client.listOffset('/3.0/taxes', { scope: 'active' });
        const inactive = await client.listOffset('/3.0/taxes', { scope: 'inactive' });
        const byId = new Map();
        for (const tax of [...active, ...inactive]) byId.set(tax.id ?? tax.uuid, tax);
        return [...byId.values()];
      },
      { csv: true },
    );

    const entries = await simpleList(ctx, '/3.0/accounting/manual_entries', 'accounting/manual_entries');
    await collect(
      ctx,
      'accounting/manual_entry_lines',
      async () =>
        entries.flatMap((entry) =>
          (entry.entries ?? []).map((line) => ({
            manual_entry_id: entry.id,
            manual_entry_type: entry.type,
            manual_entry_date: entry.date,
            reference_nr: entry.reference_nr,
            ...line,
          })),
        ),
      { csv: true },
    );

    if (!opts.fast) {
      const allFiles = [];
      const tick = progress(ctx, 'accounting: manual entry attachments', entries.length);
      await pMap(
        entries,
        async (entry) => {
          await safe(ctx, `manual_entries/${entry.id}/files`, async () => {
            const dir = `accounting/manual_entries/${entry.id}`;
            const files = await fetchOrRead(ctx, `${dir}/files.json`, async () => {
              if (entry.type === 'manual_compound_entry') {
                return client.listOffset(`/3.0/accounting/manual_entries/${entry.id}/files`, {}, { allow: [400, 404, 422] });
              }
              const out = [];
              for (const line of entry.entries ?? []) {
                const rows = await client.listOffset(
                  `/3.0/accounting/manual_entries/${entry.id}/entries/${line.id}/files`,
                  {},
                  { allow: [400, 404, 422] },
                );
                out.push(...rows.map((f) => ({ entry_line_id: line.id, ...f })));
              }
              return out;
            });
            if (files?.length) {
              for (const f of files) allFiles.push({ manual_entry_id: entry.id, ...f });
              await saveAttachments(ctx, files.map((f) => f.uuid ?? f.id), `${dir}/attachments`);
            }
          });
          tick();
        },
        opts.concurrency,
        { shouldStop: () => ctx.aborted },
      );
      await collect(ctx, 'accounting/manual_entry_files', async () => allFiles, { csv: true });
    }

    await simpleList(ctx, '/3.0/accounting/journal', 'accounting/journal', { csv: true });
  },
};
