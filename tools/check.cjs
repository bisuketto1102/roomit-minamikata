// push前チェック：node tools/check.cjs
// 構文エラー、画面から呼んでる関数の存在、HTML内の意図しない「<?」、
// 同じ名前の関数・定数がファイルをまたいで2つないか（GASは全部が1つの場所に入るので、あとのほうが黙って勝つ）、
// 画面から `_` 付き（非公開）を呼んでいないか、管理画面が暗証番号なしで呼んでいないか、を確認する。
const fs = require('fs');
const path = require('path');
process.chdir(path.join(__dirname, '..'));

let ng = 0;
const NG = (...a) => { ng++; console.log('NG', ...a); };
const files = fs.readdirSync('.');
const read = f => fs.readFileSync(f, 'utf8');

// サーバー側
const serverFiles = files.filter(f => /\.(js|gs)$/.test(f));
for (const f of serverFiles) {
  try { new Function(read(f)); } catch (e) { NG(f, e.message); }
}
const server = serverFiles.map(read).join('\n');

// 同じ名前の関数・定数（いちばん外側）
const top = {};
for (const f of serverFiles) {
  for (const m of read(f).matchAll(/^(?:function\s+([\w$]+)\s*\(|(?:const|let|var)\s+([\w$]+)\s*=)/gm)) {
    const n = m[1] || m[2];
    (top[n] = top[n] || []).push(f);
  }
}
for (const n of Object.keys(top)) if (top[n].length > 1) NG('同じ名前が2つある:', n, top[n].join(' / '));
// 暗証番号の入口（needAdmin_ を通す関数）
const adminFns = new Set([...server.matchAll(/^function\s+([\w$]+)\s*\([^)]*\)\s*\{\s*needAdmin_\(/gm)].map(m => m[1]));
const serverFns = new Set([...server.matchAll(/function\s+([\w$]+)\s*\(/g)].map(m => m[1]));

// google.script.run.withX(...).withY(...).fn(...) の fn を集める。
// const g = google.script.run....; g.fn(...) の形も拾う。
const HANDLERS = ['withSuccessHandler', 'withFailureHandler', 'withUserObject'];
function skipParens(js, i) {          // js[i] === '(' → 対応する ')' の次の位置
  let d = 0, q = null;
  for (; i < js.length; i++) {
    const c = js[i];
    if (q) { if (c === '\\') i++; else if (c === q) q = null; continue; }
    if (c === '"' || c === "'" || c === '`') q = c;
    else if (c === '(') d++;
    else if (c === ')' && --d === 0) return i + 1;
  }
  return i;
}
function walkChain(js, i, out) {       // i は '.' の手前。最後まで行ったら終端位置を返す
  for (;;) {
    const m = /^\s*\.\s*([\w$]+)\s*\(/.exec(js.slice(i));
    if (!m) return i;
    const end = skipParens(js, i + m[0].length - 1);
    if (!HANDLERS.includes(m[1])) { out.push(m[1]); return end; }
    i = end;
  }
}
function serverCalls(js) {
  const out = [];
  for (const m of js.matchAll(/google\.script\.run|adminRun\(\)/g)) {   // adminRun() は管理画面の暗証番号つき
    const before = js.slice(Math.max(0, m.index - 40), m.index);
    const v = /(?:const|let|var)\s+([\w$]+)\s*=\s*$/.exec(before);
    const n = out.length;
    walkChain(js, m.index + m[0].length, out);
    if (v && out.length === n) {       // ハンドラだけ付けて変数に入れた場合
      for (const c of js.matchAll(new RegExp('\\b' + v[1] + '\\s*\\.\\s*([\\w$]+)\\s*\\(', 'g')))
        if (!HANDLERS.includes(c[1])) out.push(c[1]);
    }
  }
  return out;
}

// HTML（include('X') で読み込むファイルの中身も合わせて見る）
const html = {};
for (const f of files.filter(f => f.endsWith('.html'))) html[f] = read(f);
const expand = h => h.replace(/<\?!?=\s*include\(['"]([\w-]+)['"]\)\s*;?\s*\?>/g, (_, n) => html[n + '.html'] || '');
const scriptsOf = h => [...h.matchAll(/<script[^>]*>([\s\S]*?)<\/script>/g)]
  .map(m => m[1].replace(/<\?[\s\S]*?\?>/g, '""'));

for (const f of Object.keys(html)) {
  const raw = html[f];
  const h = expand(raw);
  const scripts = scriptsOf(raw);
  scripts.forEach((s, i) => { try { new Function(s); } catch (e) { NG(f, 'script#' + i, e.message); } });

  const js = scriptsOf(h).join('\n');
  const clientFns = new Set([
    ...js.matchAll(/function\s+([\w$]+)\s*\(/g),
    ...js.matchAll(/(?:const|let|var)\s+([\w$]+)\s*=\s*(?:async\s*)?(?:function\b|\([^)]*\)\s*=>|[\w$]+\s*=>)/g),
  ].map(m => m[1]));

  for (const m of h.matchAll(/on\w+=\\?["']([\w$]+)\(/g)) {
    if (!clientFns.has(m[1])) NG(f, 'onclick などから呼んでる関数が無い:', m[1]);
  }
  for (const name of serverCalls(js)) {
    if (!serverFns.has(name)) NG(f, 'google.script.run で呼んでるサーバー関数が無い:', name);
    if (/_$/.test(name)) NG(f, '画面から非公開（_ 付き）の関数は呼べない:', name);
    if (f === 'Index.html' && adminFns.has(name)) NG(f, '清掃員画面から暗証番号つきの関数を呼んでいる:', name);
  }
  // 管理画面は adminRun() で暗証番号を付けて送る。google.script.run を直接使うのは checkAdminPin だけ
  if (f === 'Admin.html') {
    const direct = [];
    for (const m of js.matchAll(/google\.script\.run/g)) { const o = []; walkChain(js, m.index + m[0].length, o); direct.push(...o); }
    for (const n of direct) if (n !== 'checkAdminPin' && serverFns.has(n) && adminFns.has(n)) NG(f, '暗証番号を付けずに呼んでいる:', n);
  }
  // scriptlet（<?= / <?!= / <? ）以外の「<?」は誤認されるので禁止
  for (const m of raw.matchAll(/<\?(?![=!\s])/g)) NG(f, '意図しない「<?」:', raw.slice(m.index, m.index + 20));
}

console.log(ng ? `NG ${ng}件` : 'OK');
process.exit(ng ? 1 : 0);
