import { fetchOrRead, safe } from './helpers.js';
import { safeName } from '../store.js';
import { pMap, progress } from '../util.js';

async function exportYears(ctx) {
  let years = ctx.cache.calendarYears;
  if (!Array.isArray(years) || years.length === 0) {
    years = (await safe(ctx, 'payroll/calendar_years', () => ctx.client.listOffset('/3.0/accounting/calendar_years'))) ?? [];
  }
  const set = new Set();
  for (const y of years) {
    const start = new Date(y.start).getFullYear();
    const end = new Date(y.end ?? y.start).getFullYear();
    if (Number.isFinite(start)) for (let year = start; year <= (Number.isFinite(end) ? end : start); year++) set.add(year);
  }
  if (set.size === 0) {
    const now = new Date().getFullYear();
    for (let year = now - 5; year <= now; year++) set.add(year);
  }
  return [...set].sort();
}

export default {
  name: 'payroll',
  description: 'Employees, absences and monthly paystub PDFs (only when the payroll module is available)',
  async run(ctx) {
    const { client, store, opts } = ctx;
    const res = await client.request('/4.0/payroll/employees', { allow: [401, 403, 404] });
    if (res.data === null) {
      ctx.log(`payroll: not available (HTTP ${res.status}); skipping`);
      return;
    }
    const employees = Array.isArray(res.data) ? res.data : (res.data.data ?? []);
    await store.writeJson('payroll/employees.json', employees);
    if (employees.length) await store.writeCsv('payroll/employees.csv', employees);
    ctx.log(`payroll/employees: ${employees.length}`);
    if (employees.length === 0) return;

    const years = await exportYears(ctx);
    const now = new Date();
    const tick = progress(ctx, 'payroll: employees', employees.length);
    await pMap(
      employees,
      async (employee) => {
        const label = safeName(`${employee.last_name ?? ''}_${employee.first_name ?? ''}`.replace(/^_|_$/g, '') || 'employee');
        const dir = `payroll/employees/${label}_${safeName(String(employee.id))}`;
        await safe(ctx, `payroll/${employee.id}`, async () => {
          await store.writeJson(`${dir}/employee.json`, employee);
          for (const year of years) {
            if (ctx.aborted) return;
            await fetchOrRead(ctx, `${dir}/absences_${year}.json`, async () => {
              const data = await client.getJson(`/4.0/payroll/employees/${employee.id}/absences`, { businessYear: year }, {
                allow: [400, 403, 404, 422],
              });
              return Array.isArray(data) ? data : (data?.data ?? (data ? [data] : []));
            });
            if (!opts.pdf || opts.fast) continue;
            for (let month = 1; month <= 12; month++) {
              if (ctx.aborted) return;
              if (year > now.getFullYear() || (year === now.getFullYear() && month > now.getMonth() + 1)) break;
              const rel = `${dir}/paystubs/${year}-${String(month).padStart(2, '0')}.pdf`;
              if (store.shouldSkip(rel)) continue;
              const buf = await client.getBinary(`/4.0/payroll/employees/${employee.id}/paystub-pdf-download/${year}/${month}`, {
                accept: 'application/pdf',
                allow: [400, 403, 404, 422],
              });
              if (buf?.length) await store.writeBinary(rel, buf);
            }
          }
        });
        tick();
      },
      opts.concurrency,
      { shouldStop: () => ctx.aborted },
    );
  },
};
