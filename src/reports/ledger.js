/**
 * Ledger model derived from the exported bexio accounting data.
 *
 * bexio books each business year as a self-contained window: at the start of a
 * year the balance-sheet accounts are re-opened with "Report de soldes" entries
 * against the opening account (9100 / 9901), and when a year is closed the
 * result is transferred from 9200 into equity. Years that bexio never carried
 * forward get their opening balances computed here from the previous closing.
 *
 * All amounts are integer cents in the base currency (CHF), debit positive.
 */

export const cents = (x) => Math.round((Number(x) || 0) * 100);

export const TYPES = { EARNINGS: 1, EXPENSES: 2, ASSETS: 3, LIABILITIES: 4, CLOSING: 5 };
export const TYPE_LABELS = { 1: 'Produit', 2: 'Charge', 3: 'Actif', 4: 'Passif', 5: 'Clôture' };

/** Natural sign of an account: +1 when a debit balance is "positive" for it. */
export const naturalSign = (a) => (a.account_type === 4 || a.account_type === 1 ? -1 : 1);

const add = (map, key, value) => map.set(key, (map.get(key) ?? 0) + value);
const isOpeningAccount = (a) => a.account_type === 5 && /^(91|99)/.test(String(a.account_no));
const byNo = (a, b) => String(a.account_no).localeCompare(String(b.account_no), 'fr', { numeric: true });

export function yearLabel(y) {
  const a = String(y.start).slice(0, 4);
  const b = String(y.end).slice(0, 4);
  return a === b ? a : `${a}-${b}`;
}

export function sumTypes(balances, acc, types) {
  let total = 0;
  for (const [id, v] of balances) if (types.includes(acc(id).account_type)) total += v;
  return total;
}

function taxCodeOf(tax) {
  if (!tax) return '';
  const code = String(tax.code ?? '');
  if (code && !code.startsWith('lib.')) return code;
  return [tax.digit, tax.value !== undefined && tax.value !== null ? `${tax.value}%` : null].filter(Boolean).join(' ');
}

export function buildLedger({
  accounts,
  groups = [],
  journal,
  businessYears,
  taxes = [],
  manualEntries = [],
  currencies = [],
  invoices = [],
}) {
  const grpById = new Map(groups.map((g) => [g.id, g]));
  const groupPath = (a) => {
    const out = [];
    let g = grpById.get(a.fibu_account_group_id);
    let guard = 0;
    while (g && guard++ < 20) {
      out.unshift(g);
      g = grpById.get(g.parent_fibu_account_group_id);
    }
    return out;
  };
  const info = new Map(accounts.map((a) => [a.id, { ...a, account_no: String(a.account_no), groups: groupPath(a) }]));
  const unknown = new Map();
  const acc = (id) => {
    if (info.has(id)) return info.get(id);
    if (!unknown.has(id)) unknown.set(id, { id, account_no: `?${id}`, name: `Compte inconnu ${id}`, account_type: 5, groups: [] });
    return unknown.get(id);
  };

  const currencyName = new Map(currencies.map((c) => [c.id, c.name]));
  const taxById = new Map(taxes.map((t) => [t.id, t]));
  const invoiceById = new Map(invoices.map((i) => [i.id, i]));

  // Index manual entry lines so journal rows can be enriched with reference and VAT code.
  const manualIndex = new Map();
  for (const me of manualEntries) {
    for (const line of me.entries ?? []) {
      const key = `${String(line.date).slice(0, 10)}|${cents(line.base_currency_amount ?? line.amount)}|${line.debit_account_id}|${line.credit_account_id}`;
      if (!manualIndex.has(key)) manualIndex.set(key, []);
      manualIndex.get(key).push({ me, line });
    }
  }

  const entries = journal
    .map((e) => {
      const date = String(e.date).slice(0, 10);
      const amount = cents(e.base_currency_amount ?? e.amount);
      const debit = acc(e.debit_account_id);
      const credit = acc(e.credit_account_id);
      const match = manualIndex.get(`${date}|${amount}|${e.debit_account_id}|${e.credit_account_id}`)?.shift();
      const tax = match?.line.tax_id ? taxById.get(match.line.tax_id) : null;
      let piece = match?.me.reference_nr ?? '';
      let source = match ? 'Écriture manuelle' : '';
      if (e.ref_class === 'KbInvoice') {
        piece = invoiceById.get(e.ref_id)?.document_nr ?? `Facture #${e.ref_id}`;
        source = 'Facture';
      } else if (e.ref_class === 'KbCreditVoucher') {
        piece = piece || `NC #${e.ref_id}`;
        source = 'Note de crédit';
      } else if (e.ref_class === 'KbClientAccountEntry') {
        piece = piece || `Paiement #${e.ref_id}`;
        source = 'Paiement client';
      } else if (e.ref_class === 'KbBill') {
        piece = piece || `Fournisseur #${e.ref_id}`;
        source = 'Facture fournisseur';
      } else if (e.ref_class) {
        source = e.ref_class;
      }
      const isForeign = e.currency_id && e.base_currency_id && e.currency_id !== e.base_currency_id;
      let kind = 'mouvement';
      if (isOpeningAccount(debit) || isOpeningAccount(credit)) kind = 'report';
      else if (debit.account_type === 5 || credit.account_type === 5) kind = 'cloture';
      return {
        id: e.id,
        date,
        amount,
        debit,
        credit,
        description: e.description ?? '',
        currency: currencyName.get(e.currency_id) ?? (e.currency_id ? String(e.currency_id) : ''),
        foreignAmount: isForeign ? Number(e.amount) : null,
        rate: isForeign ? e.currency_factor ?? null : null,
        piece,
        source,
        refClass: e.ref_class ?? null,
        refId: e.ref_id ?? null,
        taxCode: taxCodeOf(tax),
        taxRate: tax?.value ?? null,
        manualEntryId: match?.me.id ?? null,
        kind,
      };
    })
    .sort((a, b) => a.date.localeCompare(b.date) || a.id - b.id);

  const years = [...businessYears]
    .filter((y) => y.start && y.end)
    .sort((a, b) => String(a.start).localeCompare(String(b.start)))
    .map((y) => ({ start: String(y.start).slice(0, 10), end: String(y.end).slice(0, 10), status: y.status ?? '', label: yearLabel(y) }));
  const inYear = (e, y) => e.date >= y.start && e.date <= y.end;
  const orphans = entries.filter((e) => !years.some((y) => inYear(e, y)));

  const equityResult = [...info.values()].find((a) => a.account_no === '2979') ?? [...info.values()].find((a) => /^297/.test(a.account_no) && a.account_type === 4) ?? null;
  const openingAccount = [...info.values()].find((a) => a.account_no === '9100') ?? [...info.values()].find(isOpeningAccount) ?? null;

  let prev = null;
  for (const y of years) {
    y.entries = entries.filter((e) => inYear(e, y));
    y.reports = y.entries.filter((e) => e.kind === 'report');
    y.movements = y.entries.filter((e) => e.kind !== 'report');

    const opening = new Map();
    y.openingNotes = [];
    if (y.reports.length) {
      y.openingSource = 'bexio';
      for (const e of y.reports) {
        add(opening, e.debit.id, e.amount);
        add(opening, e.credit.id, -e.amount);
      }
    } else if (prev) {
      y.openingSource = 'computed';
      for (const [id, bal] of prev.closing) {
        const a = acc(id);
        if ((a.account_type === TYPES.ASSETS || a.account_type === TYPES.LIABILITIES) && bal) opening.set(id, bal);
      }
      let residual = 0;
      for (const v of opening.values()) residual += v;
      if (residual) {
        // Assets minus liabilities left over = result of earlier years that was never transferred to equity.
        const target = Math.abs(residual) >= 100 && equityResult ? equityResult : openingAccount ?? equityResult;
        if (target) {
          add(opening, target.id, -residual);
          y.openingNotes.push(
            `Résultat non transféré des exercices précédents (${(residual / 100).toFixed(2)} CHF) porté au compte ${target.account_no} ${target.name}.`,
          );
        } else {
          y.openingNotes.push(`Écart d'ouverture non affecté: ${(residual / 100).toFixed(2)} CHF.`);
        }
      }
    } else {
      y.openingSource = 'none';
    }

    const mv = new Map();
    y.mvDebit = new Map();
    y.mvCredit = new Map();
    for (const e of y.movements) {
      add(mv, e.debit.id, e.amount);
      add(mv, e.credit.id, -e.amount);
      add(y.mvDebit, e.debit.id, e.amount);
      add(y.mvCredit, e.credit.id, e.amount);
    }
    const closing = new Map();
    for (const [id, v] of opening) add(closing, id, v);
    for (const [id, v] of mv) add(closing, id, v);
    for (const [id, v] of [...closing]) if (v === 0 && !opening.has(id) && !mv.has(id)) closing.delete(id);

    y.opening = opening;
    y.mv = mv;
    y.closing = closing;
    // Result from closing balances: identical to the movements in a normal year, and also
    // right for a first year that bexio imported through 9901 together with its revenue and
    // expense balances, or for rounding corrections booked inside a carry-forward.
    y.plNet = -sumTypes(closing, acc, [TYPES.EARNINGS, TYPES.EXPENSES]); // profit positive
    y.revenue = -sumTypes(closing, acc, [TYPES.EARNINGS]);
    y.expenses = sumTypes(closing, acc, [TYPES.EXPENSES]);
    y.totalAssets = sumTypes(closing, acc, [TYPES.ASSETS]);
    y.totalLiabilities = -sumTypes(closing, acc, [TYPES.LIABILITIES]);
    y.closingAccounts = [...closing]
      .filter(([id, v]) => acc(id).account_type === TYPES.CLOSING && v !== 0)
      .map(([id, v]) => ({ account: acc(id), credit: -v }))
      .sort((a, b) => byNo(a.account, b.account));
    const closingCredit = y.closingAccounts.reduce((s, c) => s + c.credit, 0);
    y.totalPassifs = y.totalLiabilities + y.plNet + closingCredit;
    y.difference = y.totalAssets - y.totalPassifs;
    y.activeAccounts = [...new Set([...opening.keys(), ...mv.keys()])].map(acc).sort(byNo);
    prev = y;
  }

  return {
    accounts: [...info.values()].sort(byNo),
    acc,
    entries,
    years,
    orphans,
    invoices,
    taxes,
    equityResult,
  };
}

/**
 * Lay out accounts under their group hierarchy with subtotals.
 * `amountOf(account)` returns the display amount (cents) for that account.
 */
export function groupedRows(accounts, amountOf) {
  const root = { children: new Map(), accounts: [] };
  for (const a of accounts) {
    let node = root;
    for (const g of a.groups) {
      if (!node.children.has(g.id)) node.children.set(g.id, { group: g, children: new Map(), accounts: [] });
      node = node.children.get(g.id);
    }
    node.accounts.push(a);
  }
  const rows = [];
  const walk = (node, level) => {
    let total = 0;
    if (node.group) rows.push({ kind: 'group', level, no: String(node.group.account_no), name: node.group.name, amount: null });
    const header = rows.length - 1;
    for (const a of node.accounts.sort(byNo)) {
      const v = amountOf(a);
      rows.push({ kind: 'account', level: level + 1, no: a.account_no, name: a.name, amount: v });
      total += v;
    }
    const kids = [...node.children.values()].sort((x, y) => String(x.group.account_no).localeCompare(String(y.group.account_no), 'fr', { numeric: true }));
    for (const k of kids) total += walk(k, level + 1);
    if (node.group) {
      rows[header].amount = total;
      rows.push({ kind: 'subtotal', level, no: String(node.group.account_no), name: `Total ${node.group.name}`, amount: total });
    }
    return total;
  };
  const total = walk(root, -1);
  return { rows, total };
}

/** Account sheet: opening line + movements with running balance in the account's natural sign. */
export function accountSheet(year, account) {
  const sign = naturalSign(account);
  const rows = [];
  let balance = 0;
  const opening = year.opening.get(account.id) ?? 0;
  if (opening) {
    balance = opening;
    rows.push({
      date: year.start,
      piece: '',
      description: year.openingSource === 'computed' ? "Solde d'ouverture (calculé)" : "Solde d'ouverture (report)",
      counter: '',
      debit: opening > 0 ? opening : 0,
      credit: opening < 0 ? -opening : 0,
      balance: balance * sign,
      kind: 'report',
    });
  }
  for (const e of year.movements) {
    if (e.debit.id !== account.id && e.credit.id !== account.id) continue;
    const isDebit = e.debit.id === account.id;
    balance += isDebit ? e.amount : -e.amount;
    const other = isDebit ? e.credit : e.debit;
    rows.push({
      date: e.date,
      piece: e.piece,
      description: e.description,
      counter: `${other.account_no} ${other.name}`,
      debit: isDebit ? e.amount : 0,
      credit: isDebit ? 0 : e.amount,
      balance: balance * sign,
      kind: e.kind,
      entry: e,
    });
  }
  return { account, rows, closing: balance, closingNatural: balance * sign, sign };
}
