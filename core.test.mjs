import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import { parseCSV, cosine, rankPairs, decide, undo, csvCell, auditCSV } from './core.mjs';

test('CSV preserves commas, escaped quotes, embedded CRLF, Unicode, empty fields', () => {
  const input = '\uFEFFid,text,note\r\n1,"a, b and ""c""",\r\n2,"one\r\ntwo",日本語\r\n';
  assert.deepEqual(parseCSV(input), {headers:['id','text','note'], rows:[['1','a, b and "c"',''],['2','one\r\ntwo','日本語']]});
});
test('malformed CSV fails explicitly instead of dropping or shifting cells', () => {
  for (const input of ['id,text\n1,"open\n2,x','id,text\n1,"x"oops\n2,y','id,text\n1,un"quoted\n2,y','id,text\n1,x,extra\n2,y']) assert.throws(() => parseCSV(input));
});
test('pair ranking uses cosine; zero vectors and stable ties are handled', () => {
  assert.equal(cosine([0,0],[1,0]),0);
  const pairs = rankPairs([[1,0],[1,0],[0,1]],[0,1,2]);
  assert.deepEqual(pairs.map(p=>p.key),['0:1','0:2','1:2']);
  assert.equal(pairs[0].score,1);
});
test('same-meaning decisions never transitively merge rows; undo restores previous decisions', () => {
  const ds=new Map(), history=[];
  decide(ds,history,{a:0,b:1,key:'0:1',score:.9},'same');
  decide(ds,history,{a:1,b:2,key:'1:2',score:.8},'same');
  assert.equal(ds.has('0:2'),false);
  decide(ds,history,{a:0,b:1,key:'0:1',score:.9},'different');
  undo(ds,history); assert.equal(ds.get('0:1').verdict,'same');
  undo(ds,history); assert.equal(ds.has('1:2'),false);
});
test('audit is escaped and spreadsheet formulas are neutralized without mutating originals', () => {
  for (const s of ['=1+1',' +SUM(A1:A2)','\t@SUM(1,2)','-1+2','\n=3']) assert.ok(csvCell(s).startsWith('"\''));
  assert.equal(csvCell('safe "quote", x'),'"safe ""quote"", x"');
  const rows=[['=HYPERLINK("bad")'],['<img src=x onerror=alert(1)>']]; const before=JSON.stringify(rows);
  const ds=new Map(),h=[]; decide(ds,h,{a:0,b:1,key:'0:1',score:.87654321},'different');
  const out=auditCSV(ds,rows,0,{model:'m',revision:'r',hash:'h'});
  assert.ok(out.startsWith('\uFEFF')); assert.ok(out.includes('0.876543')); assert.ok(out.includes("'=HYPERLINK"));
  assert.equal(JSON.stringify(rows),before);
});
test('imported cell rendering never uses HTML interpretation; app has no data upload call', () => {
  const app=readFileSync(new URL('./app.mjs',import.meta.url),'utf8');
  const worker=readFileSync(new URL('./worker.mjs',import.meta.url),'utf8');
  assert.ok(app.includes("$('text-a').textContent = dataset.rows[p.a][column]"));
  assert.ok(app.includes("$('text-b').textContent = dataset.rows[p.b][column]"));
  assert.doesNotMatch(app,/innerHTML|outerHTML|insertAdjacentHTML|eval\s*\(|fetch\s*\(|XMLHttpRequest|sendBeacon/);
  assert.doesNotMatch(worker,/fetch\s*\(|XMLHttpRequest|sendBeacon/);
});
