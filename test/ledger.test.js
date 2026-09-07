import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildLedger, accountSheet, groupedRows } from '../src/reports/ledger.js';
import { balanceSheetRows, incomeStatementRows, trialBalanceRows, openingRows, bananaRows } from '../src/reports/render.js';

const groups = [
  { id: 1, account_no: '1', name: 'Actifs', parent_fibu_account_group_id: null },
  { id: 10, account_no: '10', name: 'Actifs circulants', parent_fibu_account_group_id: 1 },
  { id: 2, account_no: '2', name: 'Passifs', parent_fibu_account_group_id: null },
  { id: 28, account_no: '28', name: 'Fonds propres', parent_fibu_account_group_id: 2 },
  { id: 3, account_no: '3', name: 'Produits', parent_fibu_account_group_id: null },
  { id: 4, account_no: '4', name: 'Charges', parent_fibu_account_group_id: null },
  { id: 9, account_no: '9', name: 'Clôture', parent_fibu_account_group_id: null },
];
const accounts = [
  { id: 1, account_no: '1020', name: 'Banque', account_type: 3, fibu_account_group_id: 10, is_active: true },
  { id: 2, account_no: '1100', name: 'Débiteurs', account_type: 3, fibu_account_group_id: 10, is_active: true },
  { id: 3, account_no: '2800', name: 'Capital', account_type: 4, fibu_account_group_id: 28, is_active: true },
  { id: 4, account_no: '2979', name: 'Résultat reporté', account_type: 4, fibu_account_group_id: 28, is_active: true },
  { id: 5, account_no: '3000', name: 'Ventes', account_type: 1, fibu_account_group_id: 3, is_active: true },
  { id: 6, account_no: '4000', name: 'Achats', account_type: 2, fibu_account_group_id: 4, is_active: true },
  { id: 7, account_no: '9100', name: "Bilan d'ouverture", account_type: 5, fibu_account_group_id: 9, is_active: true },
  { id: 8, account_no: '9200', name: 'Résultat', account_type: 5, fibu_account_group_id: 9, is_active: true },
  { id: 9, account_no: '9901', name: 'Transfert de solde', account_type: 5, fibu_account_group_id: 9, is_active: true },
];
let id = 0;
const e = (date, debit, credit, amount, description, extra = {}) => ({ id: ++id, date, debit_account_id: debit, credit_account_id: credit, amount, base_currency_amount: amount, currency_id: 1, base_currency_id: 1, currency_factor: 1, description, ref_class: null, ref_id: null, ...extra });
const journal = [
  // 2019: first year, imported into bexio through 9901 together with the P&L balances
  e('2019-12-31', 1, 9, 1000, 'Solde reporté 31.12.2019'),
  e('2019-12-31', 9, 3, 1000, 'Solde reporté 31.12.2019'),
  e('2019-12-31', 9, 5, 400, 'Solde reporté 31.12.2019'),
  e('2019-12-31', 6, 9, 300, 'Solde reporté 31.12.2019'),
  e('2019-12-31', 8, 9, 100, 'Solde reporté 31.12.2019'),
  // 2020: carried forward by bexio, profit 300 transferred to equity
  e('2020-01-01T00:00:00+01:00', 1, 7, 1000, 'Report de soldes 1.1.2020'),
  e('2020-01-01T00:00:00+01:00', 7, 3, 1000, 'Report de soldes 1.1.2020'),
  e('2020-03-01', 2, 5, 500, 'Vente', { ref_class: 'KbInvoice', ref_id: 42 }),
  e('2020-04-01', 6, 1, 200, 'Achat'),
  e('2020-12-31', 8, 4, 300, 'Résultat exercice 2020'),
  // 2021: carried forward by bexio, loss 100 not transferred
  e('2021-01-01', 1, 7, 800, 'Report de soldes 1.1.2021'),
  e('2021-01-01', 2, 7, 500, 'Report de soldes 1.1.2021'),
  e('2021-01-01', 7, 3, 1000, 'Report de soldes 1.1.2021'),
  e('2021-01-01', 7, 4, 300, 'Report de soldes 1.1.2021'),
  e('2021-05-01', 6, 1, 100, 'Achat', { ref_class: null }),
  // 2022: nothing carried forward by bexio
  e('2022-02-01', 6, 1, 50, 'Achat'),
];
const businessYears = [
  { start: '2019-01-01', end: '2019-12-31', status: 'closed' },
  { start: '2020-01-01', end: '2020-12-31', status: 'closed' },
  { start: '2021-01-01', end: '2021-12-31', status: 'open' },
  { start: '2022-01-01', end: '2022-12-31', status: 'open' },
];
const invoices = [{ id: 42, document_nr: 'FA-00042', is_valid_from: '2020-03-01', kb_item_status_id: 9, taxs: [{ percentage: 7.7, value: 35.7 }] }];
const manualEntries = [{ id: 9, reference_nr: 'M-9', entries: [{ id: 91, date: '2020-04-01', debit_account_id: 6, credit_account_id: 1, amount: 200, tax_id: 3 }] }];
const taxes = [{ id: 3, code: 'lib.model.tax.ch.x', digit: '400', value: 7.7, account_id: null }];

test('ledger: yearly windows, carry-forward, computed openings and balance identity', () => {
  const L = buildLedger({ accounts, groups, journal, businessYears, invoices, manualEntries, taxes });
  const [y19, y20, y21, y22] = L.years;

  assert.equal(y19.openingSource, 'bexio');
  assert.equal(y19.revenue, 40000);
  assert.equal(y19.expenses, 30000);
  assert.equal(y19.plNet, 10000, 'P&L of an imported year comes from the 9901 entries');
  assert.equal(y19.totalAssets, 100000);
  assert.equal(y19.totalPassifs, 100000);
  assert.equal(y19.difference, 0);

  assert.equal(y20.openingSource, 'bexio');
  assert.equal(y20.plNet, 30000);
  assert.equal(y20.totalAssets, 130000);
  assert.equal(y20.totalLiabilities, 130000); // capital 1000 + result 300 already transferred
  assert.deepEqual(y20.closingAccounts.map((c) => [c.account.account_no, c.credit]), [['9200', -30000]]);
  assert.equal(y20.difference, 0);

  assert.equal(y21.openingSource, 'bexio');
  assert.equal(y21.plNet, -10000);
  assert.equal(y21.totalAssets, 120000);
  assert.equal(y21.totalPassifs, 120000);
  assert.equal(y21.difference, 0);

  assert.equal(y22.openingSource, 'computed');
  assert.equal(y22.opening.get(1), 70000);
  assert.equal(y22.opening.get(2), 50000);
  assert.equal(y22.opening.get(4), -20000, 'untransferred loss of 2021 lands in 2979');
  assert.equal(y22.plNet, -5000);
  assert.equal(y22.totalAssets, 115000);
  assert.equal(y22.totalPassifs, 115000);
  assert.equal(y22.difference, 0);
  assert.ok(y22.openingNotes[0].includes('2979'));

  // enrichment
  const sale = L.entries.find((x) => x.refClass === 'KbInvoice');
  assert.equal(sale.piece, 'FA-00042');
  assert.equal(sale.source, 'Facture');
  const manual = L.entries.find((x) => x.manualEntryId === 9);
  assert.equal(manual.piece, 'M-9');
  assert.equal(manual.taxCode, '400 7.7%');
  assert.equal(L.entries.filter((x) => x.kind === 'report').length, 11);
});

test('ledger: account sheets, grouped rows and CSV row builders', () => {
  const L = buildLedger({ accounts, groups, journal, businessYears });
  const y20 = L.years[1];
  const bank = accountSheet(y20, L.accounts.find((a) => a.account_no === '1020'));
  assert.deepEqual(bank.rows.map((r) => [r.debit, r.credit, r.balance]), [[100000, 0, 100000], [0, 20000, 80000]]);
  const capital = accountSheet(y20, L.accounts.find((a) => a.account_no === '2800'));
  assert.equal(capital.closingNatural, 100000, 'liabilities are shown credit-positive');

  const { rows, total } = groupedRows(L.accounts.filter((a) => a.account_type === 3), (a) => y20.closing.get(a.id) ?? 0);
  assert.equal(total, 130000);
  assert.deepEqual(rows.map((r) => r.kind), ['group', 'group', 'account', 'account', 'subtotal', 'subtotal']);

  const bilan = balanceSheetRows(L, y20);
  assert.equal(bilan.find((r) => r.libelle === "TOTAL DE L'ACTIF").montant, '1300.00');
  assert.equal(bilan.find((r) => r.libelle === 'TOTAL DU PASSIF').montant, '1300.00');
  assert.ok(bilan.some((r) => r.libelle === "Bénéfice de l'exercice" && r.montant === '300.00'));
  const pl = incomeStatementRows(L, y20);
  assert.equal(pl.at(-1).montant, '300.00');
  const tb = trialBalanceRows(L, y20).find((r) => r.compte === '1020');
  assert.deepEqual([tb.ouverture_debit, tb.mouvements_credit, tb.solde_debit], ['1000.00', '200.00', '800.00']);
  const opening22 = openingRows(L, L.years[3]);
  assert.ok(opening22.every((r) => r.origine.startsWith('calculé')));
  assert.equal(opening22.find((r) => r.compte === '2979').credit, '200.00');
  const banana = bananaRows(y20.entries);
  assert.deepEqual(Object.keys(banana[0]), ['Date', 'Doc', 'Description', 'AccountDebit', 'AccountCredit', 'Amount', 'VatCode', 'Notes']);
});
