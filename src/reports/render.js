import { TYPES, TYPE_LABELS, accountSheet, groupedRows, naturalSign } from './ledger.js';

/** 1'234.56 style, minus sign for negatives. */
export function fmt(c) {
  if (c === null || c === undefined) return '';
  const neg = c < 0;
  const abs = Math.abs(c);
  const int = Math.floor(abs / 100).toString().replace(/\B(?=(\d{3})+(?!\d))/g, "'");
  return `${neg ? '-' : ''}${int}.${String(abs % 100).padStart(2, '0')}`;
}
/** Plain decimal for CSV import. */
export const num = (c) => (c === null || c === undefined ? '' : (c / 100).toFixed(2));
const orBlank = (c) => (c ? num(c) : '');

export const esc = (s) =>
  String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

const groupPathOf = (a) => a.groups.map((g) => g.account_no).join('/');
const asset = (y, a) => (y.closing.get(a.id) ?? 0) * naturalSign(a);

// ---------------------------------------------------------------- CSV rows

export function chartRows(ledger) {
  return ledger.accounts.map((a) => ({
    compte: a.account_no,
    libelle: a.name,
    type: TYPE_LABELS[a.account_type] ?? a.account_type,
    type_bexio: a.account_type,
    groupe: a.groups.length ? a.groups[a.groups.length - 1].account_no : '',
    groupe_libelle: a.groups.length ? a.groups[a.groups.length - 1].name : '',
    chemin_groupes: groupPathOf(a),
    actif: a.is_active ? 'oui' : 'non',
    id_bexio: a.id,
  }));
}

export function journalRows(entries, yearLabel) {
  return entries.map((e) => ({
    exercice: yearLabel ?? '',
    date: e.date,
    piece: e.piece,
    libelle: e.description,
    compte_debit: e.debit.account_no,
    compte_debit_libelle: e.debit.name,
    compte_credit: e.credit.account_no,
    compte_credit_libelle: e.credit.name,
    montant_chf: num(e.amount),
    monnaie: e.currency || 'CHF',
    montant_devise: e.foreignAmount !== null ? e.foreignAmount : '',
    cours: e.rate ?? '',
    code_tva: e.taxCode,
    taux_tva: e.taxRate ?? '',
    type_ecriture: e.kind,
    source: e.source,
    ref_bexio: e.refClass ? `${e.refClass}:${e.refId}` : e.manualEntryId ? `ManualEntry:${e.manualEntryId}` : '',
    id_journal_bexio: e.id,
  }));
}

/** Column names of Banana Accounting's transactions table. */
export function bananaRows(entries) {
  return entries.map((e) => ({
    Date: e.date,
    Doc: e.piece,
    Description: e.description,
    AccountDebit: e.debit.account_no,
    AccountCredit: e.credit.account_no,
    Amount: num(e.amount),
    VatCode: e.taxCode,
    Notes: [e.source, e.kind !== 'mouvement' ? e.kind : ''].filter(Boolean).join(' / '),
  }));
}

export function bananaChartRows(ledger) {
  const bclass = { 3: '1', 4: '2', 2: '3', 1: '4', 5: '' };
  const rows = [];
  const seen = new Set();
  for (const a of ledger.accounts) {
    for (const g of a.groups) {
      if (seen.has(g.id)) continue;
      seen.add(g.id);
      const parent = ledger.accounts.find((x) => x.groups.some((p) => p.id === g.parent_fibu_account_group_id));
      const parentNo = parent ? parent.groups.find((p) => p.id === g.parent_fibu_account_group_id)?.account_no ?? '' : '';
      rows.push({ Section: '', Group: g.account_no, Account: '', Description: g.name, BClass: '', Gr: parentNo });
    }
    rows.push({ Section: '', Group: '', Account: a.account_no, Description: a.name, BClass: bclass[a.account_type] ?? '', Gr: a.groups.at(-1)?.account_no ?? '' });
  }
  return rows;
}

export function trialBalanceRows(ledger, y) {
  return y.activeAccounts.map((a) => {
    const open = y.opening.get(a.id) ?? 0;
    const close = y.closing.get(a.id) ?? 0;
    return {
      compte: a.account_no,
      libelle: a.name,
      type: TYPE_LABELS[a.account_type] ?? '',
      ouverture_debit: orBlank(open > 0 ? open : 0),
      ouverture_credit: orBlank(open < 0 ? -open : 0),
      mouvements_debit: orBlank(y.mvDebit.get(a.id) ?? 0),
      mouvements_credit: orBlank(y.mvCredit.get(a.id) ?? 0),
      solde_debit: orBlank(close > 0 ? close : 0),
      solde_credit: orBlank(close < 0 ? -close : 0),
    };
  });
}

export function openingRows(ledger, y) {
  return y.activeAccounts
    .map((a) => ({ a, v: y.opening.get(a.id) ?? 0 }))
    .filter(({ a, v }) => v && a.account_type !== TYPES.CLOSING)
    .map(({ a, v }) => ({
      date: y.start,
      compte: a.account_no,
      libelle: a.name,
      debit: orBlank(v > 0 ? v : 0),
      credit: orBlank(v < 0 ? -v : 0),
      origine: y.openingSource === 'computed' ? 'calculé (clôture exercice précédent)' : 'report bexio',
    }));
}

export function balanceSheet(ledger, y) {
  const actifs = groupedRows(y.activeAccounts.filter((a) => a.account_type === TYPES.ASSETS && (y.closing.get(a.id) ?? 0) !== 0), (a) => asset(y, a));
  const passifs = groupedRows(y.activeAccounts.filter((a) => a.account_type === TYPES.LIABILITIES && (y.closing.get(a.id) ?? 0) !== 0), (a) => asset(y, a));
  const extra = [{ kind: 'account', level: 0, no: '', name: y.plNet >= 0 ? "Bénéfice de l'exercice" : "Perte de l'exercice", amount: y.plNet }];
  for (const c of y.closingAccounts) extra.push({ kind: 'account', level: 0, no: c.account.account_no, name: `${c.account.name} (compte de clôture)`, amount: c.credit });
  return { actifs, passifs, extra };
}

export function balanceSheetRows(ledger, y) {
  const { actifs, passifs, extra } = balanceSheet(ledger, y);
  const out = [];
  const push = (section, r) => out.push({ section, type: r.kind, niveau: r.level, compte: r.no, libelle: r.name, montant: r.amount === null ? '' : num(r.amount) });
  for (const r of actifs.rows) push('Actifs', r);
  push('Actifs', { kind: 'total', level: 0, no: '', name: "TOTAL DE L'ACTIF", amount: y.totalAssets });
  for (const r of passifs.rows) push('Passifs', r);
  for (const r of extra) push('Passifs', r);
  push('Passifs', { kind: 'total', level: 0, no: '', name: 'TOTAL DU PASSIF', amount: y.totalPassifs });
  return out;
}

export function incomeStatement(ledger, y) {
  const produits = groupedRows(y.activeAccounts.filter((a) => a.account_type === TYPES.EARNINGS && (y.closing.get(a.id) ?? 0) !== 0), (a) => -(y.closing.get(a.id) ?? 0));
  const charges = groupedRows(y.activeAccounts.filter((a) => a.account_type === TYPES.EXPENSES && (y.closing.get(a.id) ?? 0) !== 0), (a) => y.closing.get(a.id) ?? 0);
  return { produits, charges };
}

export function incomeStatementRows(ledger, y) {
  const { produits, charges } = incomeStatement(ledger, y);
  const out = [];
  const push = (section, r) => out.push({ section, type: r.kind, niveau: r.level, compte: r.no, libelle: r.name, montant: r.amount === null ? '' : num(r.amount) });
  for (const r of produits.rows) push('Produits', r);
  push('Produits', { kind: 'total', level: 0, no: '', name: 'TOTAL PRODUITS', amount: y.revenue });
  for (const r of charges.rows) push('Charges', r);
  push('Charges', { kind: 'total', level: 0, no: '', name: 'TOTAL CHARGES', amount: y.expenses });
  push('Résultat', { kind: 'total', level: 0, no: '', name: y.plNet >= 0 ? "BÉNÉFICE DE L'EXERCICE" : "PERTE DE L'EXERCICE", amount: y.plNet });
  return out;
}

export function sheetRows(sheet, withAccount = false) {
  return sheet.rows.map((r) => ({
    ...(withAccount ? { compte: sheet.account.account_no, compte_libelle: sheet.account.name } : {}),
    date: r.date,
    piece: r.piece,
    libelle: r.description,
    contrepartie: r.counter,
    debit: orBlank(r.debit),
    credit: orBlank(r.credit),
    solde: num(r.balance),
    type_ecriture: r.kind,
  }));
}

export function vatRows(ledger, y) {
  const out = [];
  const seen = new Set();
  for (const t of ledger.taxes) {
    if (!t.account_id || seen.has(t.account_id)) continue;
    seen.add(t.account_id);
    const a = ledger.acc(t.account_id);
    if (!y.activeAccounts.includes(a)) continue;
    out.push({
      source: 'Compte TVA',
      code: a.account_no,
      libelle: a.name,
      base: '',
      tva: num((y.closing.get(a.id) ?? 0) * naturalSign(a)),
      nombre: (y.mvDebit.get(a.id) ? 1 : 0) + (y.mvCredit.get(a.id) ? 1 : 0) ? '' : '',
      remarque: 'solde du compte à la clôture (débit positif pour les actifs, crédit positif pour les passifs)',
    });
  }
  const byCode = new Map();
  for (const e of y.movements) {
    if (!e.taxCode) continue;
    const k = e.taxCode;
    if (!byCode.has(k)) byCode.set(k, { base: 0, n: 0, rate: e.taxRate });
    const v = byCode.get(k);
    v.base += e.amount;
    v.n++;
  }
  for (const [code, v] of byCode) {
    out.push({ source: 'Écritures manuelles', code, libelle: v.rate !== null ? `TVA ${v.rate}%` : '', base: num(v.base), tva: v.rate ? num(Math.round((v.base * v.rate) / (100 + v.rate))) : '', nombre: v.n, remarque: 'montant comptabilisé (TTC présumé); TVA incluse calculée à titre indicatif' });
  }
  const byRate = new Map();
  for (const inv of ledger.invoices) {
    const d = String(inv.is_valid_from ?? '').slice(0, 10);
    if (d < y.start || d > y.end || inv.kb_item_status_id === 19) continue;
    for (const t of inv.taxs ?? []) {
      const rate = String(t.percentage ?? '');
      if (!byRate.has(rate)) byRate.set(rate, { tax: 0, n: 0 });
      const v = byRate.get(rate);
      v.tax += Math.round(Number(t.value ?? 0) * 100);
      v.n++;
    }
  }
  for (const [rate, v] of byRate) {
    const r = Number(rate);
    out.push({ source: 'Factures clients', code: `${rate}%`, libelle: `TVA ${rate}% sur factures émises`, base: r ? num(Math.round((v.tax * 100) / r)) : '', tva: num(v.tax), nombre: v.n, remarque: 'selon les totaux TVA des factures (annulées exclues)' });
  }
  return out;
}

export function openInvoiceRows(ledger, contacts = []) {
  const contactById = new Map(contacts.map((c) => [c.id, c]));
  const status = { 7: 'Brouillon', 8: 'En attente', 9: 'Payée', 16: 'Partiellement payée', 19: 'Annulée', 31: 'Impayée' };
  return ledger.invoices
    .filter((i) => Number(i.total_remaining_payments ?? 0) > 0 && i.kb_item_status_id !== 19 && i.kb_item_status_id !== 7)
    .sort((a, b) => String(a.is_valid_from).localeCompare(String(b.is_valid_from)))
    .map((i) => {
      const c = contactById.get(i.contact_id);
      return {
        facture: i.document_nr,
        date: String(i.is_valid_from ?? '').slice(0, 10),
        echeance: String(i.is_valid_to ?? '').slice(0, 10),
        client: c ? [c.name_1, c.name_2].filter(Boolean).join(' ') : `contact #${i.contact_id}`,
        titre: i.title ?? '',
        statut: status[i.kb_item_status_id] ?? i.kb_item_status_id,
        total: Number(i.total ?? 0).toFixed(2),
        paye: Number(i.total_received_payments ?? 0).toFixed(2),
        solde_ouvert: Number(i.total_remaining_payments ?? 0).toFixed(2),
        monnaie: i.currency_id === 1 ? 'CHF' : String(i.currency_id),
      };
    });
}

export function summaryRows(ledger) {
  return ledger.years.map((y) => ({
    exercice: y.label,
    debut: y.start,
    fin: y.end,
    statut_bexio: y.status,
    ecritures: y.movements.length,
    ouverture: y.openingSource === 'bexio' ? 'report bexio' : y.openingSource === 'computed' ? 'calculée' : 'aucune',
    total_actifs: num(y.totalAssets),
    total_passifs: num(y.totalPassifs),
    produits: num(y.revenue),
    charges: num(y.expenses),
    resultat: num(y.plNet),
    ecart: num(y.difference),
  }));
}

// ---------------------------------------------------------------- HTML

const CSS = `
  :root { color-scheme: light; }
  body { font: 13px/1.45 -apple-system, "Segoe UI", Helvetica, Arial, sans-serif; color: #1a1a1a; background: #fff; margin: 0; padding: 24px 32px 64px; max-width: 1180px; }
  h1 { font-size: 22px; margin: 0 0 4px; } h2 { font-size: 17px; margin: 40px 0 10px; padding-top: 12px; border-top: 2px solid #1a1a1a; } h3 { font-size: 14px; margin: 24px 0 6px; }
  .meta { color: #555; margin-bottom: 16px; } .note { background: #fff7e0; border-left: 3px solid #e0a800; padding: 8px 12px; margin: 10px 0; }
  .toc a { margin-right: 14px; } a { color: #0b57d0; text-decoration: none; } a:hover { text-decoration: underline; }
  table { border-collapse: collapse; width: 100%; margin: 6px 0 14px; font-variant-numeric: tabular-nums; }
  th, td { padding: 3px 8px; border-bottom: 1px solid #e3e3e3; vertical-align: top; text-align: left; }
  th { background: #f3f3f3; font-weight: 600; } td.n, th.n { text-align: right; white-space: nowrap; }
  tr.group td { font-weight: 600; background: #fafafa; } tr.subtotal td { font-weight: 600; border-top: 1px solid #bbb; } tr.total td { font-weight: 700; border-top: 2px solid #1a1a1a; border-bottom: 2px solid #1a1a1a; }
  tr.report td { color: #555; font-style: italic; } .lvl1 { padding-left: 16px; } .lvl2 { padding-left: 32px; } .lvl3 { padding-left: 48px; } .lvl4 { padding-left: 64px; }
  .cols { display: grid; grid-template-columns: 1fr 1fr; gap: 24px; } .kpi { display: flex; gap: 24px; flex-wrap: wrap; margin: 12px 0; }
  .kpi div { border: 1px solid #ddd; border-radius: 6px; padding: 8px 14px; min-width: 150px; } .kpi b { display: block; font-size: 16px; }
  .small { color: #666; font-size: 12px; } .neg { color: #a40000; }
  @media print { body { padding: 0; } h2 { break-before: page; } .toc { display: none; } table { font-size: 11px; } }
`;

const page = (title, body) => `<!doctype html>
<html lang="fr"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>${esc(title)}</title><style>${CSS}</style></head>
<body>${body}</body></html>
`;
const cell = (c) => `<td class="n${c < 0 ? ' neg' : ''}">${fmt(c)}</td>`;

function groupedTable(rows, total, totalLabel) {
  const body = rows
    .map((r) => {
      if (r.kind === 'group') return `<tr class="group"><td class="lvl${Math.min(r.level, 4)}" colspan="2">${esc(r.no)} ${esc(r.name)}</td><td></td></tr>`;
      if (r.kind === 'subtotal') return `<tr class="subtotal"><td class="lvl${Math.min(r.level, 4)}" colspan="2">${esc(r.name)}</td>${cell(r.amount)}</tr>`;
      return `<tr><td class="lvl${Math.min(r.level, 4)}">${esc(r.no)}</td><td>${esc(r.name)}</td>${cell(r.amount)}</tr>`;
    })
    .join('\n');
  return `<table><thead><tr><th style="width:70px">Compte</th><th>Libellé</th><th class="n">CHF</th></tr></thead><tbody>${body}
<tr class="total"><td colspan="2">${esc(totalLabel)}</td>${cell(total)}</tr></tbody></table>`;
}

export function renderYearHtml(ledger, y, company, generatedAt) {
  const { actifs, passifs, extra } = balanceSheet(ledger, y);
  const { produits, charges } = incomeStatement(ledger, y);
  const sheets = y.activeAccounts.map((a) => accountSheet(y, a)).filter((s) => s.rows.length);
  const notes = [];
  if (y.openingSource === 'computed') notes.push("bexio n'a pas comptabilisé de report de soldes pour cet exercice. Les soldes d'ouverture ont été calculés à partir de la clôture de l'exercice précédent.");
  notes.push(...y.openingNotes);
  if (y.openingSource === 'none') notes.push("Aucun solde d'ouverture: premier exercice ou données absentes.");
  if (Math.abs(y.difference) > 0) notes.push(`Écart entre actifs et passifs: ${fmt(y.difference)} CHF.`);
  if (!y.closingAccounts.length && y.plNet !== 0) notes.push("Le résultat de l'exercice n'a pas encore été transféré aux fonds propres dans bexio (aucune écriture 9200).");

  const passifExtra = extra.map((r) => `<tr><td>${esc(r.no)}</td><td>${esc(r.name)}</td>${cell(r.amount)}</tr>`).join('\n');
  const bilanPassifs = groupedTable(passifs.rows, y.totalPassifs, 'TOTAL DU PASSIF').replace('<tr class="total">', `${passifExtra}\n<tr class="total">`);

  const tb = trialBalanceRows(ledger, y)
    .map((r) => `<tr><td>${esc(r.compte)}</td><td>${esc(r.libelle)}</td><td class="n">${r.ouverture_debit && fmt(Math.round(r.ouverture_debit * 100))}</td><td class="n">${r.ouverture_credit && fmt(Math.round(r.ouverture_credit * 100))}</td><td class="n">${r.mouvements_debit && fmt(Math.round(r.mouvements_debit * 100))}</td><td class="n">${r.mouvements_credit && fmt(Math.round(r.mouvements_credit * 100))}</td><td class="n">${r.solde_debit && fmt(Math.round(r.solde_debit * 100))}</td><td class="n">${r.solde_credit && fmt(Math.round(r.solde_credit * 100))}</td></tr>`)
    .join('\n');
  const tbTotals = (key) => y.activeAccounts.reduce((s, a) => s + key(a), 0);
  const od = tbTotals((a) => Math.max(y.opening.get(a.id) ?? 0, 0)), oc = tbTotals((a) => Math.max(-(y.opening.get(a.id) ?? 0), 0));
  const md = tbTotals((a) => y.mvDebit.get(a.id) ?? 0), mc = tbTotals((a) => y.mvCredit.get(a.id) ?? 0);
  const cd = tbTotals((a) => Math.max(y.closing.get(a.id) ?? 0, 0)), cc = tbTotals((a) => Math.max(-(y.closing.get(a.id) ?? 0), 0));

  const sheetsHtml = sheets
    .map(
      (s) => `<h3 id="c${esc(s.account.account_no)}">${esc(s.account.account_no)} ${esc(s.account.name)} <span class="small">(${TYPE_LABELS[s.account.account_type]}, solde ${s.sign > 0 ? 'débiteur' : 'créditeur'} positif)</span></h3>
<table><thead><tr><th style="width:90px">Date</th><th style="width:90px">Pièce</th><th>Libellé</th><th>Contrepartie</th><th class="n">Débit</th><th class="n">Crédit</th><th class="n">Solde</th></tr></thead><tbody>
${s.rows.map((r) => `<tr class="${r.kind === 'report' ? 'report' : ''}"><td>${r.date}</td><td>${esc(r.piece)}</td><td>${esc(r.description)}</td><td>${esc(r.counter)}</td><td class="n">${r.debit ? fmt(r.debit) : ''}</td><td class="n">${r.credit ? fmt(r.credit) : ''}</td>${cell(r.balance)}</tr>`).join('\n')}
<tr class="total"><td colspan="4">Solde au ${y.end}</td><td class="n">${fmt(s.rows.reduce((t, r) => t + r.debit, 0))}</td><td class="n">${fmt(s.rows.reduce((t, r) => t + r.credit, 0))}</td>${cell(s.closingNatural)}</tr></tbody></table>`,
    )
    .join('\n');

  const journalHtml = y.entries
    .map((e) => `<tr class="${e.kind === 'report' ? 'report' : ''}"><td>${e.date}</td><td>${esc(e.piece)}</td><td>${esc(e.description)}</td><td>${esc(e.debit.account_no)}</td><td>${esc(e.credit.account_no)}</td>${cell(e.amount)}<td>${e.foreignAmount !== null ? `${e.foreignAmount} ${esc(e.currency)}` : ''}</td><td>${esc(e.taxCode)}</td><td class="small">${esc(e.source)}</td></tr>`)
    .join('\n');

  const vat = vatRows(ledger, y);
  const vatHtml = vat.length
    ? `<table><thead><tr><th>Source</th><th>Code / compte</th><th>Libellé</th><th class="n">Base</th><th class="n">TVA</th><th class="n">Nb</th><th>Remarque</th></tr></thead><tbody>${vat.map((r) => `<tr><td>${esc(r.source)}</td><td>${esc(r.code)}</td><td>${esc(r.libelle)}</td><td class="n">${r.base && fmt(Math.round(r.base * 100))}</td><td class="n">${r.tva && fmt(Math.round(r.tva * 100))}</td><td class="n">${r.nombre ?? ''}</td><td class="small">${esc(r.remarque)}</td></tr>`).join('\n')}</tbody></table>`
    : '<p class="small">Aucune information TVA pour cet exercice.</p>';

  const body = `
<h1>${esc(company)} — Exercice ${esc(y.label)}</h1>
<div class="meta">Du ${y.start} au ${y.end} · statut bexio: ${esc(y.status || 'n/a')} · ${y.movements.length} écritures · généré le ${generatedAt} par bexio-export à partir du journal bexio</div>
<div class="toc"><a href="#bilan">Bilan</a><a href="#resultat">Compte de résultat</a><a href="#balance">Balance de vérification</a><a href="#feuilles">Feuilles de compte</a><a href="#journal">Journal</a><a href="#tva">TVA</a><a href="index.html">← Vue d'ensemble</a></div>
${notes.map((n) => `<div class="note">${esc(n)}</div>`).join('\n')}
<div class="kpi"><div>Total du bilan<b>${fmt(y.totalAssets)}</b></div><div>Produits<b>${fmt(y.revenue)}</b></div><div>Charges<b>${fmt(y.expenses)}</b></div><div>${y.plNet >= 0 ? 'Bénéfice' : 'Perte'}<b class="${y.plNet < 0 ? 'neg' : ''}">${fmt(y.plNet)}</b></div></div>

<h2 id="bilan">Bilan au ${y.end}</h2>
<div class="cols"><div><h3>Actifs</h3>${groupedTable(actifs.rows, y.totalAssets, "TOTAL DE L'ACTIF")}</div><div><h3>Passifs</h3>${bilanPassifs}</div></div>

<h2 id="resultat">Compte de résultat du ${y.start} au ${y.end}</h2>
<div class="cols"><div><h3>Produits</h3>${groupedTable(produits.rows, y.revenue, 'TOTAL PRODUITS')}</div><div><h3>Charges</h3>${groupedTable(charges.rows, y.expenses, 'TOTAL CHARGES')}</div></div>
<table><tbody><tr class="total"><td>${y.plNet >= 0 ? "BÉNÉFICE DE L'EXERCICE" : "PERTE DE L'EXERCICE"} (produits ${fmt(y.revenue)} − charges ${fmt(y.expenses)})</td>${cell(y.plNet)}</tr></tbody></table>

<h2 id="balance">Balance de vérification</h2>
<table><thead><tr><th>Compte</th><th>Libellé</th><th class="n">Ouverture D</th><th class="n">Ouverture C</th><th class="n">Mouvements D</th><th class="n">Mouvements C</th><th class="n">Solde D</th><th class="n">Solde C</th></tr></thead><tbody>${tb}
<tr class="total"><td colspan="2">Totaux</td>${cell(od)}${cell(oc)}${cell(md)}${cell(mc)}${cell(cd)}${cell(cc)}</tr></tbody></table>

<h2 id="feuilles">Feuilles de compte</h2>
<p class="small">Comptes: ${sheets.map((s) => `<a href="#c${esc(s.account.account_no)}">${esc(s.account.account_no)}</a>`).join(' · ')}</p>
${sheetsHtml}

<h2 id="journal">Journal des écritures</h2>
<table><thead><tr><th>Date</th><th>Pièce</th><th>Libellé</th><th>Débit</th><th>Crédit</th><th class="n">CHF</th><th>Devise</th><th>TVA</th><th>Source</th></tr></thead><tbody>${journalHtml}</tbody></table>

<h2 id="tva">TVA (indicatif)</h2>
<p class="small">Le journal bexio ne porte pas de code TVA sur les écritures générées par les factures; les montants ci-dessous sont déduits des comptes TVA, des écritures manuelles et des totaux de factures. À contrôler avec les décomptes TVA déposés.</p>
${vatHtml}
`;
  return page(`${company} — Exercice ${y.label}`, body);
}

export function renderIndexHtml(ledger, company, generatedAt, openInvoices, files) {
  const rows = ledger.years
    .map((y) => `<tr><td><a href="exercice_${esc(y.label)}/rapport.html">${esc(y.label)}</a></td><td>${y.start} → ${y.end}</td><td>${esc(y.status)}</td><td class="n">${y.movements.length}</td><td>${y.openingSource === 'bexio' ? 'report bexio' : y.openingSource === 'computed' ? 'calculée' : '—'}</td>${cell(y.totalAssets)}${cell(y.revenue)}${cell(y.expenses)}${cell(y.plNet)}${cell(y.difference)}</tr>`)
    .join('\n');
  const open = openInvoices.length
    ? `<table><thead><tr><th>Facture</th><th>Date</th><th>Échéance</th><th>Client</th><th>Statut</th><th class="n">Total</th><th class="n">Payé</th><th class="n">Solde ouvert</th></tr></thead><tbody>${openInvoices.map((i) => `<tr><td>${esc(i.facture)}</td><td>${i.date}</td><td>${i.echeance}</td><td>${esc(i.client)}</td><td>${esc(i.statut)}</td><td class="n">${i.total}</td><td class="n">${i.paye}</td><td class="n">${i.solde_ouvert}</td></tr>`).join('\n')}
<tr class="total"><td colspan="7">Total débiteurs ouverts</td><td class="n">${openInvoices.reduce((s, i) => s + Number(i.solde_ouvert), 0).toFixed(2)}</td></tr></tbody></table>`
    : '<p class="small">Aucune facture client ouverte.</p>';
  const body = `
<h1>${esc(company)} — Dossier comptable</h1>
<div class="meta">Généré le ${generatedAt} par bexio-export à partir des données exportées de bexio. Plan comptable: ${ledger.accounts.length} comptes. Journal: ${ledger.entries.length} écritures${ledger.orphans.length ? ` (${ledger.orphans.length} hors exercice)` : ''}.</div>
<h2>Exercices</h2>
<table><thead><tr><th>Exercice</th><th>Période</th><th>Statut</th><th class="n">Écritures</th><th>Ouverture</th><th class="n">Total bilan</th><th class="n">Produits</th><th class="n">Charges</th><th class="n">Résultat</th><th class="n">Écart</th></tr></thead><tbody>${rows}</tbody></table>
<p class="small">Chaque exercice contient: bilan, compte de résultat, balance de vérification, feuilles de compte, journal et TVA, en HTML (rapport.html) et en CSV.</p>
<h2>Débiteurs ouverts (factures clients non soldées)</h2>
${open}
<h2>Fichiers</h2>
<table><thead><tr><th>Fichier</th><th>Contenu</th></tr></thead><tbody>${files.map(([f, d]) => `<tr><td><a href="${esc(f)}">${esc(f)}</a></td><td>${esc(d)}</td></tr>`).join('\n')}</tbody></table>
`;
  return page(`${company} — Dossier comptable`, body);
}
