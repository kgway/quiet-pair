// Original application code. No grouping or destructive transformation.
export function parseCSV(source) {
  const text = source.replace(/^\uFEFF/, '');
  const rows = []; let row = [], cell = '', quoted = false, closed = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (quoted) {
      if (c === '"' && text[i + 1] === '"') { cell += '"'; i++; }
      else if (c === '"') { quoted = false; closed = true; }
      else cell += c;
    } else if (c === '"') {
      if (cell || closed) throw new Error('Unexpected quote in CSV.');
      quoted = true;
    } else if (c === ',') { row.push(cell); cell = ''; closed = false; }
    else if (c === '\r' || c === '\n') {
      if (c === '\r' && text[i + 1] === '\n') i++;
      row.push(cell); rows.push(row); row = []; cell = ''; closed = false;
    } else {
      if (closed) throw new Error('Unexpected text after a closing quote.');
      cell += c;
    }
  }
  if (quoted) throw new Error('Unclosed quote in CSV.');
  if (cell || closed || row.length) { row.push(cell); rows.push(row); }
  if (rows.length < 3) throw new Error('Use a header and at least two data rows.');
  const width = rows[0].length;
  if (rows.some(r => r.length !== width)) throw new Error('Every CSV row must have the same number of columns.');
  if (rows.length > 151) throw new Error('This small edition supports up to 150 data rows.');
  return { headers: rows[0], rows: rows.slice(1) };
}

export function cosine(a, b) {
  if (a.length !== b.length || !a.length) throw new Error('Invalid embedding dimensions.');
  let dot = 0, na = 0, nb = 0;
  for (let i = 0; i < a.length; i++) { dot += a[i] * b[i]; na += a[i] ** 2; nb += b[i] ** 2; }
  return na && nb ? Math.max(-1, Math.min(1, dot / Math.sqrt(na * nb))) : 0;
}

export function rankPairs(vectors, rowIds) {
  if (vectors.length !== rowIds.length) throw new Error('Embedding row count mismatch.');
  const pairs = [];
  for (let i = 0; i < vectors.length; i++) for (let j = i + 1; j < vectors.length; j++) {
    pairs.push({ a: rowIds[i], b: rowIds[j], score: cosine(vectors[i], vectors[j]), key: `${rowIds[i]}:${rowIds[j]}` });
  }
  return pairs.sort((a, b) => b.score - a.score || a.a - b.a || a.b - b.b);
}

// A pair decision never implies a decision about any other pair. No union-find.
export function decide(decisions, history, pair, verdict) {
  if (!['same', 'different', 'skip'].includes(verdict)) throw new Error('Invalid verdict.');
  history.push({ key: pair.key, before: decisions.get(pair.key) });
  decisions.set(pair.key, { ...pair, verdict, at: new Date().toISOString() });
}
export function undo(decisions, history) {
  const last = history.pop(); if (!last) return false;
  if (last.before) decisions.set(last.key, last.before); else decisions.delete(last.key);
  return true;
}

export function csvCell(value) {
  let text = String(value ?? '');
  // Prefix spreadsheet formula initiators, including those hidden by whitespace.
  if (/^[\s\u0000-\u001f]*[=+\-@]/.test(text) || /^[\t\r\n]/.test(text)) text = "'" + text;
  return '"' + text.replaceAll('"', '""') + '"';
}
export function auditCSV(decisions, rows, column, metadata) {
  const header = ['row_a', 'row_b', 'text_a', 'text_b', 'cosine_similarity', 'human_verdict', 'reviewed_at', 'model', 'model_revision', 'source_sha256', 'column_index'];
  const output = [...decisions.values()].map(d => [d.a + 2, d.b + 2, rows[d.a][column], rows[d.b][column], d.score.toFixed(6), d.verdict, d.at, metadata.model, metadata.revision, metadata.hash, column + 1]);
  return '\uFEFF' + [header, ...output].map(row => row.map(csvCell).join(',')).join('\r\n') + '\r\n';
}
