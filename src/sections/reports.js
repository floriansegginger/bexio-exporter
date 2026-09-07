import { buildLedger, accountSheet } from '../reports/ledger.js';
import {
  balanceSheetRows,
  bananaChartRows,
  bananaRows,
  chartRows,
  incomeStatementRows,
  journalRows,
  openInvoiceRows,
  openingRows,
  renderIndexHtml,
  renderYearHtml,
  sheetRows,
  summaryRows,
  trialBalanceRows,
  vatRows,
} from '../reports/render.js';
import { safeName } from '../store.js';

const FILES = [
  ['index.html', "Vue d'ensemble: exercices, résultats, débiteurs ouverts"],
  ['synthese_exercices.csv', 'Chiffres clés par exercice'],
  ['plan_comptable.csv', 'Plan comptable complet avec types et groupes'],
  ['journal_complet.csv', 'Toutes les écritures, tous exercices, avec comptes, devise, code TVA et pièce'],
  ['debiteurs_ouverts.csv', 'Factures clients non soldées'],
  ['import/journal_banana.csv', 'Journal au format des colonnes de Banana Comptabilité'],
  ['import/plan_comptable_banana.csv', 'Plan comptable au format des colonnes de Banana Comptabilité'],
  ['exercice_<AAAA-AAAA>/rapport.html', 'Rapport complet de l’exercice (bilan, compte de résultat, balance, feuilles de compte, journal, TVA)'],
  ['exercice_<AAAA-AAAA>/bilan.csv', 'Bilan à la clôture'],
  ['exercice_<AAAA-AAAA>/compte_de_resultat.csv', 'Compte de résultat'],
  ['exercice_<AAAA-AAAA>/balance_de_verification.csv', 'Balance: ouverture, mouvements, soldes'],
  ['exercice_<AAAA-AAAA>/soldes_ouverture.csv', "Soldes d'ouverture de l'exercice (à reprendre dans un nouveau logiciel)"],
  ['exercice_<AAAA-AAAA>/journal.csv', "Journal de l'exercice"],
  ['exercice_<AAAA-AAAA>/grand_livre.csv', 'Toutes les feuilles de compte en un fichier'],
  ['exercice_<AAAA-AAAA>/feuilles_de_compte/<compte>.csv', 'Une feuille de compte par compte'],
  ['exercice_<AAAA-AAAA>/tva.csv', 'Éléments TVA (indicatif)'],
];

export default {
  name: 'reports',
  offline: true,
  description: 'Bilan, compte de résultat, balance, feuilles de compte, journal, soldes d’ouverture, débiteurs ouverts (computed offline from the export)',
  async run(ctx) {
    const { store, log } = ctx;
    const read = async (rel) => (store.exists(rel) ? store.readJson(rel) : null);
    const accounts = await read('accounting/accounts.json');
    const journal = await read('accounting/journal.json');
    const businessYears = await read('accounting/business_years.json');
    if (!accounts?.length || !journal || !businessYears?.length) {
      log('reports: needs accounting/accounts.json, accounting/journal.json and accounting/business_years.json; run the accounting section first');
      return;
    }
    const ledger = buildLedger({
      accounts,
      groups: (await read('accounting/account_groups.json')) ?? [],
      journal,
      businessYears,
      taxes: (await read('accounting/taxes.json')) ?? [],
      manualEntries: (await read('accounting/manual_entries.json')) ?? [],
      currencies: (await read('accounting/currencies.json')) ?? [],
      invoices: (await read('sales/invoices.json')) ?? [],
    });
    const contacts = (await read('contacts/contacts.json')) ?? [];
    const profile = await read('company/company_profile.json');
    const company = (Array.isArray(profile) ? profile[0]?.name : profile?.name) ?? 'Entreprise';
    const generatedAt = new Date().toISOString().slice(0, 10);

    await store.writeCsv('reports/plan_comptable.csv', chartRows(ledger));
    await store.writeCsv('reports/import/plan_comptable_banana.csv', bananaChartRows(ledger));
    const allJournal = [];
    const allBanana = [];

    for (const y of ledger.years) {
      const dir = `reports/exercice_${y.label}`;
      await store.writeCsv(`${dir}/bilan.csv`, balanceSheetRows(ledger, y));
      await store.writeCsv(`${dir}/compte_de_resultat.csv`, incomeStatementRows(ledger, y));
      await store.writeCsv(`${dir}/balance_de_verification.csv`, trialBalanceRows(ledger, y));
      const opening = openingRows(ledger, y);
      if (opening.length) await store.writeCsv(`${dir}/soldes_ouverture.csv`, opening);
      const rows = journalRows(y.entries, y.label);
      allJournal.push(...rows);
      allBanana.push(...bananaRows(y.entries));
      if (rows.length) await store.writeCsv(`${dir}/journal.csv`, rows);
      const sheets = y.activeAccounts.map((a) => accountSheet(y, a)).filter((s) => s.rows.length);
      const ledgerRows = [];
      for (const s of sheets) {
        await store.writeCsv(`${dir}/feuilles_de_compte/${safeName(`${s.account.account_no}_${s.account.name}`)}.csv`, sheetRows(s));
        ledgerRows.push(...sheetRows(s, true));
      }
      if (ledgerRows.length) await store.writeCsv(`${dir}/grand_livre.csv`, ledgerRows);
      const vat = vatRows(ledger, y);
      if (vat.length) await store.writeCsv(`${dir}/tva.csv`, vat);
      await store.writeText(`${dir}/rapport.html`, renderYearHtml(ledger, y, company, generatedAt));
      const flag = y.openingSource === 'computed' ? ' (ouverture calculée)' : y.openingSource === 'none' ? ' (sans ouverture)' : '';
      log(`reports: exercice ${y.label}: ${y.movements.length} écritures, bilan ${(y.totalAssets / 100).toFixed(2)}, résultat ${(y.plNet / 100).toFixed(2)}${flag}${y.difference ? `, ÉCART ${(y.difference / 100).toFixed(2)}` : ''}`);
    }
    if (ledger.orphans.length) {
      log(`! reports: ${ledger.orphans.length} journal entries fall outside every business year and were left out of the yearly reports`);
      await store.writeCsv('reports/journal_hors_exercice.csv', journalRows(ledger.orphans, ''));
    }

    await store.writeCsv('reports/journal_complet.csv', allJournal);
    await store.writeCsv('reports/import/journal_banana.csv', allBanana);
    await store.writeCsv('reports/synthese_exercices.csv', summaryRows(ledger));
    const open = openInvoiceRows(ledger, contacts);
    await store.writeCsv('reports/debiteurs_ouverts.csv', open);
    await store.writeText('reports/index.html', renderIndexHtml(ledger, company, generatedAt, open, FILES));
    log(`reports: ${ledger.years.length} exercices, ${allJournal.length} écritures, ${open.length} factures ouvertes → reports/index.html`);
  },
};
