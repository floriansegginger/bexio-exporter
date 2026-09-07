import { collect, fetchOrRead, folderNames, safe, saveAttachments, simpleList } from './helpers.js';
import { pMap, progress } from '../util.js';

export default {
  name: 'purchase',
  description: 'Supplier bills and expenses with their receipts, outgoing payments, purchase orders',
  async run(ctx) {
    const { client, opts } = ctx;

    // Bills (API 4.0): list is capped at 500 per page.
    const bills = await simpleList(ctx, '/4.0/purchase/bills', 'purchase/bills', { csv: true, style: 'paged', limit: 500 });
    const billNames = folderNames(bills, (b) => b.document_no);
    const outgoing = [];
    let tick = progress(ctx, 'purchase: bills', bills.length);
    await pMap(
      bills,
      async (bill) => {
        const dir = `purchase/bills/${billNames.get(bill)}`;
        await safe(ctx, `bills/${bill.document_no ?? bill.id}`, async () => {
          const full = await fetchOrRead(ctx, `${dir}/bill.json`, () => client.getJson(`/4.0/purchase/bills/${bill.id}`), {
            writeEmpty: true,
          });
          const payments = await fetchOrRead(ctx, `${dir}/outgoing_payments.json`, () =>
            client.listPaged('/4.0/purchase/outgoing-payments', { bill_id: bill.id }, { limit: 100, allow: [404] }),
          );
          for (const p of payments ?? []) outgoing.push({ bill_document_no: bill.document_no, ...p });
          await saveAttachments(ctx, full?.attachment_ids ?? bill.attachment_ids, `${dir}/attachments`);
        });
        tick();
      },
      opts.concurrency,
      { shouldStop: () => ctx.aborted },
    );
    await collect(ctx, 'purchase/outgoing_payments', async () => outgoing, { csv: true });

    // Expenses (API 4.0)
    const expenses = await simpleList(ctx, '/4.0/expenses', 'purchase/expenses', { csv: true, style: 'paged', limit: 100 });
    const expenseNames = folderNames(expenses, (e) => e.document_no);
    tick = progress(ctx, 'purchase: expenses', expenses.length);
    await pMap(
      expenses,
      async (expense) => {
        const dir = `purchase/expenses/${expenseNames.get(expense)}`;
        await safe(ctx, `expenses/${expense.document_no ?? expense.id}`, async () => {
          const full = await fetchOrRead(ctx, `${dir}/expense.json`, () => client.getJson(`/4.0/expenses/${expense.id}`), {
            writeEmpty: true,
          });
          await saveAttachments(ctx, full?.attachment_ids ?? expense.attachment_ids, `${dir}/attachments`);
        });
        tick();
      },
      opts.concurrency,
      { shouldStop: () => ctx.aborted },
    );

    // Purchase orders (API 3.0)
    const orders = await simpleList(ctx, '/3.0/purchase_orders', 'purchase/purchase_orders', { csv: true });
    const orderNames = folderNames(orders, (o) => o.document_nr);
    tick = progress(ctx, 'purchase: purchase orders', orders.length);
    await pMap(
      orders,
      async (order) => {
        const dir = `purchase/purchase_orders/${orderNames.get(order)}`;
        await safe(ctx, `purchase_orders/${order.document_nr ?? order.id}`, () =>
          fetchOrRead(ctx, `${dir}/purchase_order.json`, () => client.getJson(`/3.0/purchase_orders/${order.id}`), {
            writeEmpty: true,
          }),
        );
        tick();
      },
      opts.concurrency,
      { shouldStop: () => ctx.aborted },
    );
  },
};
