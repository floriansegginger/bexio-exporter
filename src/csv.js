const BOM = String.fromCharCode(0xfeff);

/** Flatten nested objects into dotted keys. Arrays are kept as JSON strings so nothing is lost. */
export function flatten(value, prefix = '', out = {}) {
  if (value === null || value === undefined) {
    if (prefix) out[prefix] = '';
    return out;
  }
  if (Array.isArray(value)) {
    if (prefix) out[prefix] = value.length ? JSON.stringify(value) : '';
    return out;
  }
  if (typeof value === 'object') {
    const keys = Object.keys(value);
    if (keys.length === 0) {
      if (prefix) out[prefix] = '';
      return out;
    }
    for (const key of keys) flatten(value[key], prefix ? `${prefix}.${key}` : key, out);
    return out;
  }
  out[prefix] = value;
  return out;
}

function cell(value) {
  if (value === null || value === undefined) return '';
  let s;
  if (typeof value === 'string') s = value;
  else if (typeof value === 'boolean') s = value ? 'true' : 'false';
  else s = String(value);
  if (/[",\r\n]/.test(s)) s = `"${s.replace(/"/g, '""')}"`;
  return s;
}

/** RFC 4180 CSV with a UTF-8 BOM so Excel and Numbers open it with the right encoding. */
export function toCsv(rows, { columns } = {}) {
  const flat = rows.map((row) => (row && typeof row === 'object' ? flatten(row) : { value: row }));
  const cols = columns ?? [...new Set(flat.flatMap((row) => Object.keys(row)))];
  const lines = [cols.map(cell).join(',')];
  for (const row of flat) lines.push(cols.map((col) => cell(row[col])).join(','));
  return `${BOM}${lines.join('\r\n')}\r\n`;
}
