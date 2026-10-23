import { parseCSV, rankPairs, decide, undo, auditCSV } from './core.mjs';
import { MODEL, MODEL_REVISION } from './config.mjs';
const $ = id => document.getElementById(id);
const SAMPLE = 'id,text\r\n1,Please send me a copy of my receipt.\r\n2,Could you email my receipt to me?\r\n3,I want to cancel my subscription.\r\n4,Please cancel my membership.\r\n5,Do not cancel my subscription.\r\n6,How can I update my billing address?\r\n7,Where do I change the address on my bill?\r\n8,The package arrived damaged.\r\n9,"The parcel was broken when it arrived, sadly."\r\n10,My parcel has not arrived yet.\r\n11,Thank you for your help.\r\n12,I appreciate your assistance.\r\n';
let sourceText = '', dataset, column = 0, pairs = [], decisions = new Map(), history = [], worker, busy = false, hash = '', runId = 0;
function status(text) { $('status').textContent = text; }
function pending() { return pairs.filter(p => p.score >= Number($('floor').value)); }
function current() { return pending().find(p => !decisions.has(p.key)); }
function render() {
  const visible = pending(), done = visible.filter(p => decisions.has(p.key)).length, p = current();
  $('count').textContent = `${done} / ${visible.length} reviewed`;
  $('bar').style.width = `${visible.length ? done / visible.length * 100 : 100}%`;
  $('pair').hidden = $('decisions').hidden = !p; $('empty').hidden = !!p;
  $('score').textContent = p ? `Similarity ${p.score.toFixed(3)} · inspect the meaning, especially numbers and negation.` : 'Your source has not been changed.';
  if (p) { $('row-a').textContent = `SOURCE ROW ${p.a + 2}`; $('row-b').textContent = `SOURCE ROW ${p.b + 2}`; $('text-a').textContent = dataset.rows[p.a][column]; $('text-b').textContent = dataset.rows[p.b][column]; }
  $('undo').disabled = !history.length; $('export').disabled = !decisions.size;
}
function reset() { pairs = []; decisions.clear(); history = []; $('review').hidden = true; }
function prepare() {
  if (busy) return;
  if (decisions.size && !confirm('Start over? Export your audit first if you need to keep these decisions.')) return;
  try {
    if ($('source').value.length > 2 * 1024 * 1024 || new TextEncoder().encode($('source').value).length > 2 * 1024 * 1024) throw new Error('Use a CSV smaller than 2 MB.');
    const next = parseCSV($('source').value);
    reset(); dataset = next; sourceText = $('source').value;
    $('column').replaceChildren(...dataset.headers.map((name, index) => { const option = document.createElement('option'); option.value = index; option.textContent = `${index + 1}. ${name || '(unnamed)'}`; return option; }));
    $('column').value = Math.max(0, dataset.headers.findIndex(h => /text|description|message/i.test(h)));
    $('settings').hidden = false; status(`${dataset.rows.length} rows read. Choose the text column, then find pairs.`);
  } catch (e) { $('settings').hidden = true; status(e.message); }
}
$('prepare').onclick = prepare;
$('sample').onclick = () => { if (!busy) { $('source').value = SAMPLE; prepare(); } };
$('file').onchange = async e => { const file = e.target.files[0]; if (!file || busy) return; if (file.size > 2 * 1024 * 1024) { status('Choose a CSV smaller than 2 MB.'); return; } try { $('source').value = new TextDecoder('utf-8', { fatal: true }).decode(await file.arrayBuffer()); prepare(); } catch { status('Could not decode this file as UTF-8.'); } };
$('floor').oninput = () => { $('floor-label').textContent = Number($('floor').value).toFixed(2); if (pairs.length) render(); };
function setBusy(value) { busy = value; for (const id of ['run','prepare','sample','file','source','column']) $(id).disabled = value; $('cancel').hidden = !value; }
$('cancel').onclick = () => { runId++; worker?.terminate(); worker = null; setBusy(false); status('Stopped. Your source was not changed. You can retry.'); };
$('run').onclick = async () => {
  if (busy) return;
  if ($('source').value !== sourceText) { status('Your CSV changed. Read columns again before running.'); return; }
  if (decisions.size && !confirm('Re-run and reset the audit? Download it first if needed.')) return;
  column = Number($('column').value); const rowIds = [], texts = [];
  dataset.rows.forEach((r, i) => { if (r[column].trim()) { rowIds.push(i); texts.push(r[column]); } });
  if (texts.length < 2) { status('Choose a column with at least two non-empty cells.'); return; }
  if (texts.some(t => t.length > 500)) { status('A selected cell exceeds 500 characters. This edition is for short sentences.'); return; }
  reset(); setBusy(true); status('Starting local model. First download may take a little while…');
  const id = ++runId;
  try {
    hash = [...new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(sourceText)))].map(n => n.toString(16).padStart(2,'0')).join('');
    if (id !== runId) return; // A stop during digest must not start a worker afterward.
    worker ||= new Worker('./worker.mjs', { type: 'module' });
    worker.onmessage = ({data}) => {
      if (id !== runId) return;
      if (data.type === 'progress') status(data.message);
      else if (data.type === 'complete') {
        try { pairs = rankPairs(data.vectors, rowIds); $('review').hidden = false; render();
          $('metrics').textContent = `${texts.length} non-empty rows · ${pairs.length} possible pairs · model load ${(data.loadMs/1000).toFixed(2)} s · embedding ${(data.inferenceMs/1000).toFixed(2)} s. Timings are for this run, not a benchmark.`;
          status('Pairs are ready. The model suggests; you decide.'); $('review').scrollIntoView({behavior:'smooth', block:'start'});
        } catch(e) { status(e.message); } finally { setBusy(false); }
      } else if (data.type === 'error') { status(`Model could not run: ${data.message}`); setBusy(false); worker.terminate(); worker = null; }
    };
    worker.onerror = () => { status('The model worker failed to load. Check internet access to jsDelivr and Hugging Face, then retry.'); setBusy(false); worker.terminate(); worker = null; };
    worker.postMessage({texts});
  } catch(e) { status(e.message); setBusy(false); }
};
function vote(verdict) { const p = current(); if (!p || busy) return; decide(decisions, history, p, verdict); render(); }
document.querySelectorAll('[data-verdict]').forEach(button => { button.onclick = () => vote(button.dataset.verdict); });
$('undo').onclick = () => { undo(decisions, history); render(); };
$('export').onclick = () => { const blob = new Blob([auditCSV(decisions, dataset.rows, column, {model:MODEL, revision:MODEL_REVISION, hash})], {type:'text/csv;charset=utf-8'}); const url = URL.createObjectURL(blob); const a = document.createElement('a'); a.href = url; a.download = 'quiet-pair-audit.csv'; a.click(); setTimeout(() => URL.revokeObjectURL(url), 1000); };
document.addEventListener('keydown', e => { if (e.altKey || e.ctrlKey || e.metaKey || e.target.closest('input,textarea,select,summary') || $('review').hidden || busy) return; const key = e.key.toLowerCase(); if (key === 'z') { $('undo').click(); e.preventDefault(); } else if ({a:1,d:1,s:1}[key]) { vote({a:'same',d:'different',s:'skip'}[key]); e.preventDefault(); } });
window.addEventListener('beforeunload', e => { if (decisions.size) { e.preventDefault(); e.returnValue = ''; } });
