// ダブルメイク指示書を、AI ではなくマスの色で読む（管理画面の dblGridColors）＋サーバーの突き合わせ（dblByColor_）
//   NODE_PATH=/opt/node-tools/node_modules node run_dbl.js [PDFのあるフォルダ]
// PDF のフォルダは引数か環境変数 DBL_DIR。dbl_1104.pdf・dbl_1105.pdf・dbl_1108.pdf を読む（実物の紙なのでリポジトリには入れていない。
// run_full.js と同じ扱い）。9/29 の紙（pdf0929/double_0929.pdf）はリポジトリにあるので、いつも見る。
// 1) ブラウザ（playwright + pdf.js）で Admin.html の色の測定をそのまま動かし、PDF の全マスを紙の正解と比べる
// 2) 写真のような画像（傾き 0.9〜1.5°を 0.05°刻みで両向き・色かぶり・影・JPEG）で、違う区分を ok:true で出さない
// 3) pdf.js が止まっても時間切れで「読めなかった」になる
// 4) サーバー：AI の返事を作り物にして、要確認が付く部屋・付かない部屋を確かめる
const fs = require('fs'), path = require('path'), vm = require('vm');
const { chromium } = require('playwright');
const ROOT = path.join(__dirname, '..');
const DIR = process.argv[2] || process.env.DBL_DIR || '';
let ng = 0;
const ok = (c, m) => { if (!c) ng++; console.log((c ? '  OK ' : '  NG ') + m); };

// pdf.js（管理画面は cdnjs から読む。テストは手元のファイルを返す）
const PDFJS_DIRS = [process.env.PDFJS_BUILD, path.join(__dirname, 'node_modules/pdfjs-dist/build')].filter(Boolean);
const pdfjsDir = PDFJS_DIRS.find(d => fs.existsSync(path.join(d, 'pdf.min.js')));
if (!pdfjsDir) { console.log('pdf.js（pdfjs-dist 3.11.174 の build）が見つからない。test/node_modules に入れるか PDFJS_BUILD で場所を教える'); process.exit(1); }

// 管理画面の pdf.js 読み込み〜色の測定（dblColorFromFile）までを、そのまま切り出して使う
const admin = fs.readFileSync(path.join(ROOT, 'Admin.html'), 'utf8');
const a0 = admin.indexOf('let PDFJS = null;'), a1 = admin.indexOf('/** ファイルをそのまま base64 にする（PDF用） */');
if (a0 < 0 || a1 < 0 || admin.indexOf('/* DBL_COLOR_BEGIN */') < a0) { console.log('Admin.html から色の測定を切り出せない'); process.exit(1); }
const adminCode = admin.slice(a0, a1);

/* 紙の正解（PDF を画像にして目で見て作った）。1文字＝1マス、左から列1〜17
 *  G 緑＝新規 / Y 黄＝継続 / R 赤＝解除 / P 薄ピンク・サーモン＝増設セット解除（取り込みでは解除） / O オレンジ＝常設 / B 青＝ベッド下収納 / . 白 / # 黒（部屋なし） */
const TOP = ['.........#.#.....', 'OOOOOOOOOOOOOOOOO', 'OOOOOOOOOOOOOOOOO', '........OO.......', '.................'];
const PAPERS = [
  { name: '9/29', file: path.join(__dirname, 'pdf0929/double_0929.pdf'), truth: TOP.concat(['BBBBBBBBBBBBBBBBB', 'BBBBBBBBBBBBBBBBB', 'BBBBBBBBBBBBBBBBB', 'BBBBBBBBBBBBBBBBB',
    'YYYYYYYYYYBYBBYB#', 'BBBB##BBBBBB##BB#']) },
  { name: '11/4', fname: 'dbl_1104.pdf', file: DIR && path.join(DIR, 'dbl_1104.pdf'), truth: TOP.concat(['.................', 'BBBBBBBBBBBBBBBBB', 'BBBBBBBBBBBBBBBBB', 'BBBBBBBBBBBBBBBBB',
    'BBBYBBPBBYYYBYYY#', 'YYBB##PYYBBB##YY#']) },
  { name: '11/5', fname: 'dbl_1105.pdf', file: DIR && path.join(DIR, 'dbl_1105.pdf'), truth: TOP.concat(['.................', 'BBBBBBBBBBBBBBBBB', 'BBBBBBBBBBBBBBBBB', 'BBBBBBBBBBBBBBBBB',
    'BBBPBBBBBPPPBPPP#', 'PYBB##BPPBBB##PP#']) },
  { name: '11/8', fname: 'dbl_1108.pdf', file: DIR && path.join(DIR, 'dbl_1108.pdf'), truth: TOP.concat(['.................', 'BBBBBBBBBBBBBBBBB', 'BBBBBBBBBBBBBBBBB', 'BBBBBBBBBBBBBBBBR',
    'RRRRBRRRRRRRRRRR#', 'YYYY##GYYYYG##BY#']) }
];
const LETTER = { G: '新規', Y: '継続', R: '解除', P: '解除→ベッド下収納', O: '常設', B: 'ベッド下収納', '.': '' };
const SHORT = { '新規': 'G', '継続': 'Y', '解除': 'R', '解除→ベッド下収納': 'P', '常設': 'O', 'ベッド下収納': 'B', '': '.', '?': '?' };
const truthMap = rows => {
  const m = {};
  rows.forEach((line, ri) => line.split('').forEach((ch, ci) => {
    if (ch !== '#') m[String((12 - ri) * 100 + ci + 1)] = LETTER[ch];
  }));
  return m;
};
const grid = map => {
  const out = [];
  for (let f = 12; f >= 2; f--) {
    let s = '';
    for (let c = 1; c <= 17; c++) { const k = map[String(f * 100 + c)]; s += k === undefined ? '#' : (SHORT[k] || '!'); }
    out.push(String(f).padStart(2) + ' ' + s);
  }
  return out.join('\n');
};
// 正解と比べる。wrong＝違う区分を出した（いちばん困る）、unk＝「?」（決められない）。
// same は区分を同じとみなす読み替え（写真では赤とピンクの取り違えは困らない：どちらも取り込みで解除）
const PINK = k => k === '解除→ベッド下収納' ? '解除' : k;
const compare = (map, want, same) => {
  const wrong = [], unk = [], eq = same || (k => k);
  Object.keys(want).forEach(no => {
    const k = map[no];
    if (k === '?') unk.push(no);
    else if (k === undefined || eq(k) !== eq(want[no])) wrong.push(no + '（正解 ' + (want[no] || '白') + ' / 色 ' + (k === undefined ? '無し' : (k || '白')) + '）');
  });
  Object.keys(map).forEach(no => { if (!(no in want)) wrong.push(no + '（部屋なしのはず）'); });
  return { wrong, unk };
};

(async () => {
  const exe = '/opt/pw-browsers/chromium-1194/chrome-linux/chrome';
  const br = await chromium.launch(fs.existsSync(exe) ? { executablePath: exe } : {});
  const pg = await br.newPage();
  await pg.route('https://cdnjs.cloudflare.com/**', r => {
    const f = r.request().url().split('/').pop();
    r.fulfill({ contentType: 'application/javascript', body: fs.readFileSync(path.join(pdfjsDir, f)) });
  });
  await pg.route('http://app.test/**', r => r.fulfill({ contentType: 'text/html', body: '<html><body></body></html>' }));
  await pg.goto('http://app.test/');
  await pg.addScriptTag({ content: adminCode + `
;window.__file = (b64, name, type) => {
  const bin = atob(b64), u = new Uint8Array(bin.length); for (let i = 0; i < bin.length; i++) u[i] = bin.charCodeAt(i);
  return new File([u], name, { type });
};
window.__dbl = async (b64, name, type) => {
  const t = Date.now(); const r = await dblColorFromFile(window.__file(b64, name, type));
  r.ms = Date.now() - t; return r;
};
/* pdf.js が読み込まれないまま止まったとき：時間切れで「読めなかった」になる */
window.__hang = async (b64, ms) => {
  const keep = PDFJS; PDFJS = new Promise(() => {});
  try { return await dblColorFromFile(window.__file(b64, 'a.pdf', 'application/pdf'), ms); } finally { PDFJS = keep; }
};
/* 写真のような画像を作る：PDF を画像にして、deg 度傾け（正は時計回り）、色かぶり（multiply）・右下の影を付け、JPEG にする */
window.__photo = async (b64, o) => {
  const lib = await loadPdfJs();
  const pdf = await lib.getDocument({ data: await window.__file(b64, 'a.pdf', 'application/pdf').arrayBuffer() }).promise, page = await pdf.getPage(1);
  const v1 = page.getViewport({ scale: 1 }), vp = page.getViewport({ scale: 2400 / Math.max(v1.width, v1.height) });
  const src = document.createElement('canvas'); src.width = Math.round(vp.width); src.height = Math.round(vp.height);
  const sg = src.getContext('2d'); sg.fillStyle = '#fff'; sg.fillRect(0, 0, src.width, src.height);
  await page.render({ canvasContext: sg, viewport: vp }).promise;
  const c = document.createElement('canvas'); c.width = src.width + 240; c.height = src.height + 240;
  const g = c.getContext('2d');
  g.fillStyle = '#5a5046'; g.fillRect(0, 0, c.width, c.height);               // 机
  g.translate(c.width / 2, c.height / 2); g.rotate((o.deg || 0) * Math.PI / 180);
  if (o.kx || o.ky) g.transform(1, o.ky || 0, o.kx || 0, 1, 0, 0);
  g.drawImage(src, -src.width / 2, -src.height / 2);
  g.setTransform(1, 0, 0, 1, 0, 0);
  if (o.tint) { g.globalCompositeOperation = 'multiply'; g.fillStyle = o.tint; g.fillRect(0, 0, c.width, c.height); g.globalCompositeOperation = 'source-over'; }
  if (o.shade) { const gr = g.createLinearGradient(0, 0, c.width, c.height); gr.addColorStop(0, 'rgba(0,0,0,0)'); gr.addColorStop(1, 'rgba(0,0,0,' + o.shade + ')');
    g.fillStyle = gr; g.fillRect(0, 0, c.width, c.height); }
  const blob = await new Promise(res => c.toBlob(res, 'image/jpeg', 0.85));
  const t = Date.now(); const r = await dblColorFromFile(new File([blob], 'photo.jpg', { type: 'image/jpeg' }));
  r.ms = Date.now() - t; return r;
};` });
  pg.on('pageerror', e => { ng++; console.log('  NG ページのエラー', e.message); });

  const b64 = f => fs.readFileSync(f).toString('base64');
  const have = PAPERS.filter(p => p.file && fs.existsSync(p.file));
  PAPERS.filter(p => have.indexOf(p) < 0).forEach(p => console.log('  -- ' + p.name + '：PDF が無いので飛ばす（引数か DBL_DIR で ' + p.fname + ' のあるフォルダを渡す）'));
  console.log('■ PDF（スキャン）を色で読む');
  const MAPS = {};
  for (const p of have) {
    const r = await pg.evaluate(([b, n]) => window.__dbl(b, n, 'application/pdf'), [b64(p.file), path.basename(p.file)]);
    if (!r.ok) { ok(false, p.name + ' 読めなかった：' + r.why); continue; }
    MAPS[p.name] = r.map;
    const want = truthMap(p.truth), cmp = compare(r.map, want);
    console.log(grid(r.map).split('\n').map(x => '      ' + x).join('\n'));
    ok(true, p.name + ' 外枠 ' + r.box.join(',') + '・黒マスと四隅の罫線が格子と一致（傾き ' + r.deg + '°）　' + r.ms + 'ms');
    ok(cmp.wrong.length === 0, p.name + ' 全' + Object.keys(want).length + '室が紙と一致' + (cmp.wrong.length ? '　違う：' + cmp.wrong.join('、') : ''));
    ok(cmp.unk.length === 0, p.name + ' 色が決まらないマス ' + cmp.unk.length + '室' + (cmp.unk.length ? '：' + cmp.unk.map(no => no + '=' + r.odd[no]).join(' ') : ''));
  }
  if (MAPS['11/8']) {
    const m8 = MAPS['11/8'];
    ok(m8['204'] === '継続', '11/8 204 は継続（黄。AI が返さなかった部屋）');
    ok(m8['207'] === '新規' && m8['212'] === '新規' && m8['215'] === 'ベッド下収納' && m8['417'] === '解除', '11/8 207・212 は新規、215 は青、417 は赤');
  }
  if (MAPS['11/5']) ok(MAPS['11/5']['201'] === '解除→ベッド下収納' && MAPS['11/5']['1101'] === '常設', '11/5 201 はサーモン（ピンク）、1101 はオレンジ（取り違えない）');

  console.log('■ 写真のような画像：傾き 0.9〜1.5°（0.05°刻み・両向き）。違う区分を ok:true で出さない');
  const degs = []; for (let d = 0.9; d <= 1.5001; d += 0.05) degs.push(Math.round(d * 100) / 100);
  for (const p of have) {
    const want = truthMap(p.truth), bad = [], off = [];
    let good = 0;
    for (const d of degs.concat(degs.map(x => -x))) {
      const r = await pg.evaluate(([b, o]) => window.__photo(b, o), [b64(p.file), { deg: d }]);
      if (!r.ok) { off.push(d + '°'); continue; }
      const cmp = compare(r.map, want, PINK);
      if (cmp.wrong.length) bad.push(d + '°：' + cmp.wrong.slice(0, 4).join('、')); else good++;
    }
    ok(bad.length === 0, p.name + ' ' + (degs.length * 2) + '通り：合った ' + good + '・読めなかった ' + off.length
      + (off.length ? '（' + off.join(' ') + '）' : '') + (bad.length ? '　違う区分：' + bad.join(' ／ ') : ''));
  }
  console.log('■ 写真のような画像：色かぶり・影・ゆがみ・大きい傾き');
  const cases = [
    { name: '傾き0.5°・暖色の照明', deg: 0.5, tint: '#ffe8c8', must: true },
    { name: '傾き1°・影', deg: -1, shade: 0.35, must: true },
    { name: '傾き0.8°・青っぽい照明・影', deg: 0.8, tint: '#dfe8ff', shade: 0.25, must: true },
    { name: '傾き2.5°', deg: 2.5 },
    { name: '傾き4°', deg: -4 },
    { name: '台形ぎみ（横に斜め）', kx: 0.02 },
    { name: '台形ぎみ（縦に斜め）', ky: 0.03 },
    { name: '強い影', shade: 0.6 }
  ];
  const p0 = have.find(p => p.name === '11/8') || have[0];
  for (const c of cases) {
    const r = await pg.evaluate(([b, o]) => window.__photo(b, o), [b64(p0.file), c]);
    if (!r.ok) { ok(!c.must, p0.name + ' ' + c.name + '：読めなかった（' + r.why + '）' + (c.must ? '' : '→ AI だけになる')); continue; }
    const cmp = compare(r.map, truthMap(p0.truth), PINK);
    ok(cmp.wrong.length === 0, p0.name + ' ' + c.name + '：違う区分なし' + (cmp.wrong.length ? '　違う：' + cmp.wrong.join('、') : '') + '　決まらない ' + cmp.unk.length + '室　' + r.ms + 'ms');
  }

  console.log('■ ダブルメイク指示書でない紙・pdf.js が止まったとき');
  for (const f of ['pdf0929/indicator_0929.pdf', 'pdf0929/order_0929.pdf']) {
    const r = await pg.evaluate(([b, n]) => window.__dbl(b, n, 'application/pdf'), [b64(path.join(__dirname, f)), path.basename(f)]);
    ok(!r.ok, f + ' → 読めなかった（' + (r.why || '') + '）');
  }
  const t0 = Date.now();
  const hang = await pg.evaluate(([b]) => window.__hang(b, 800), [b64(PAPERS[0].file)]);
  ok(!hang.ok && /時間切れ/.test(hang.why) && Date.now() - t0 < 5000, 'pdf.js が止まった → ' + (Date.now() - t0) + 'ms で「' + hang.why + '」');
  await br.close();

  /* ---------- サーバー：色と AI の突き合わせ ---------- */
  console.log('■ サーバー：色を正にして、帳票に効く食い違い・「?」・AI の不明だけ要確認');
  const { env } = require('./gasmock.js');
  const D = require('./data0929.js');
  const ctx = vm.createContext(env);
  vm.runInContext(fs.readFileSync(path.join(ROOT, 'Code.js'), 'utf8') + '\n' + fs.readFileSync(path.join(ROOT, 'ApaIndicator.js'), 'utf8')
    + '\n;globalThis.__s = { mergeAll_, crossCheck_, normOrder_, normDouble_, normDblColor_, ROOMS };', ctx);
  const S = ctx.__s;
  const rooms0 = [];
  Object.keys(D.IND).forEach(f => D.IND[f].forEach(c => { if (!c) return; const [room, code] = c.split(' ');
    rooms0.push({ room, code, reserved: code.indexOf('*') >= 0, hand: false, uncertain: [] }); }));
  const merge = (aiRooms, color) => {
    const parsed = { rooms: JSON.parse(JSON.stringify(rooms0)), counts: D.BOX };
    const ai = aiRooms ? S.normDouble_({ rooms: aiRooms, twins: [['1209', '1211']], connects: [['909', '910']], note: '水2本' }) : null;
    return S.mergeAll_(S.crossCheck_(parsed, JSON.parse(JSON.stringify(parsed))), S.normOrder_(JSON.parse(JSON.stringify(D.ORDER))), ai, color);
  };
  const by = res => { const o = {}; res.rooms.forEach(r => { o[r.room] = r; }); return o; };
  const dblAsk = r => r.uncertain.filter(u => /^ダブルメイク：/.test(u));   // 色と AI の突き合わせで付けたもの
  const askRooms = res => res.rooms.filter(r => dblAsk(r).length).map(r => r.room).sort();
  // 色の一覧は 11/8 の紙の正解（PDF が無くても回るように）
  const m8 = truthMap(PAPERS[3].truth), col8 = { ok: true, map: m8 };
  const aiSame = Object.keys(m8).filter(no => m8[no]).map(no => ({ room: no, kind: m8[no] }));

  let res = merge(aiSame, col8);
  ok(askRooms(res).length === 0, 'AI と色が全部同じ → 要確認 0室');
  ok(!res.verify.warn.some(w => /ダブルメイク(は色|指示書：マスの色)/.test(w)), 'AI と色が同じ → 色の警告なし');
  ok(by(res)['204'].dmake === '継続' && by(res)['301'].dmake === '解除' && !by(res)['1201'].dmake, 'dmake：204 継続・301 解除・1201 なし');
  ok(res.dbl.color.ok && res.dbl.twins.length === 1 && res.dbl.note === '水2本', 'ツイン・注意書きは AI の読みのまま');

  // 11/8 に起きたこと：204 を返さない。ほかに 207 を継続、301 をピンク、1101 を「不明」、909 を返さず、801 を新規、
  // 青の 215・305 を返さず、白の 1201 を青と読む（青と白のちがいは帳票に効かないので出さない）
  const aiBad = aiSame.filter(x => ['204', '909', '215', '305'].indexOf(x.room) < 0).map(x => {
    if (x.room === '207') return { room: '207', kind: '継続' };
    if (x.room === '301') return { room: '301', kind: '解除→ベッド下収納' };
    if (x.room === '1101') return { room: '1101', kind: '不明' };
    return x;
  }).concat([{ room: '801', kind: '新規' }, { room: '1201', kind: 'ベッド下収納' }]);
  res = merge(aiBad, col8);
  const B8 = by(res), ask8 = askRooms(res);
  ok(JSON.stringify(ask8) === JSON.stringify(['1101', '204', '207', '801', '909']), '要確認は 204・207・1101・909・801 だけ（301 の赤とピンク、215・305・1201 の青と白は出さない）：' + ask8.join('・'));
  ok(B8['204'].dmake === '継続' && /色は継続、AI は返さなかった/.test(dblAsk(B8['204'])[0]), '204：色の継続にして、要確認「' + dblAsk(B8['204'])[0] + '」');
  ok(B8['207'].dmake === '新規' && B8['207'].dmakeAi === '継続' && B8['207'].dmakeAsk, '207：色の新規にして、AI の読み（継続）を残す「' + dblAsk(B8['207'])[0] + '」');
  ok(B8['1101'].dmake === '常設' && B8['1101'].dmakeAi === '不明' && /AI は不明/.test(dblAsk(B8['1101'])[0]), '1101：AI が不明 → 色の常設で要確認、選択欄は「AI は読めなかった」');
  ok(B8['801'].dmake === '' && /色は白（区分なし）、AI は新規/.test(dblAsk(B8['801'])[0]), '801：色が白なのに AI が新規 → 区分なし（色）で要確認');
  ok(B8['215'].dmake === 'ベッド下収納' && B8['1201'].dmake === '' && !B8['215'].dmakeAsk && !B8['1201'].dmakeAsk, '215（青を返さず）・1201（白を青）：色のまま、要確認なし');
  ok(B8['301'].dmake === '解除' && dblAsk(B8['301']).length === 0, '301：赤とピンクの取り違えは要確認にしない');
  ok(B8['1101'].uncertain.indexOf('ダブルメイク指示書の色が読めなかった') < 0, '色を測れた日は、前の「色が読めなかった」は付けない');
  ok(res.verify.warn.some(w => /色が決まらない部屋 5室/.test(w) && /204（色は継続、AI は返さなかった）/.test(w)), '警告に5室の一覧');
  ok(res.verify.warn.some(w => /今日シングルに戻す部屋/.test(w) && /301/.test(w)), 'シングルに戻す部屋の一覧は色の区分で出る');

  // AI が「不明」で色が白 → 要確認（前の動きのまま）
  res = merge(aiSame.concat([{ room: '801', kind: '不明' }]), col8);
  ok(JSON.stringify(askRooms(res)) === '["801"]' && by(res)['801'].dmake === '' && /色は白（区分なし）、AI は不明/.test(dblAsk(by(res)['801'])[0]), '801：AI が不明・色が白 → 要確認');

  // 色が決まらないマス（305 を ? にする）→ 区分は AI のまま、要確認
  res = merge(aiSame, { ok: true, map: Object.assign({}, m8, { '305': '?' }) });
  ok(by(res)['305'].dmake === 'ベッド下収納' && /色が決められない（AI はベッド下収納）/.test(dblAsk(by(res)['305'])[0]) && askRooms(res).length === 1,
    '305 の色が決まらない → AI のベッド下収納のまま、要確認は 305 だけ');
  res = merge(aiSame.filter(x => x.room !== '1201'), { ok: true, map: Object.assign({}, m8, { '1201': '?' }) });
  ok(by(res)['1201'].dmake === '' && /色が決められない（AI は区分なし）/.test(dblAsk(by(res)['1201'])[0]), '1201 の色が決まらず AI も無し → 区分なしで要確認');

  // AI が読めなかった（3枚目は失敗）→ 色だけで決める。「?」のマスは要確認（黙って区分なしにしない）
  res = merge(null, { ok: true, map: Object.assign({}, m8, { '203': '?' }) });
  ok(res.dbl && by(res)['204'].dmake === '継続' && JSON.stringify(askRooms(res)) === '["203"]' && by(res)['203'].dmakeAi === '不明'
    && /色が決められない（AI は読めなかった）/.test(dblAsk(by(res)['203'])[0]) && res.verify.warn.some(w => /AI が読めなかったので、区分はマスの色だけ/.test(w)),
    'AI が読めなかった日：色だけで dmake、「?」の 203 だけ要確認、警告あり');
  res = merge(null, col8);
  ok(askRooms(res).length === 0, 'AI が読めなかった日で「?」なし → 要確認 0室');

  // 色を測れなかった（写真で外枠が取れない等）→ 今までどおり AI だけ。警告を出す
  res = merge(aiBad, { ok: false, why: '黒マスの位置が合わない（黒くない:1210）' });
  ok(by(res)['204'].dmake === '' && by(res)['207'].dmake === '継続' && askRooms(res).length === 0, '色なし：AI の読みのまま（204 は区分なし）');
  ok(by(res)['1101'].uncertain.indexOf('ダブルメイク指示書の色が読めなかった') >= 0, '色なし：AI が不明の部屋は前と同じ要確認');
  ok(res.verify.warn.some(w => /ダブルメイクは色で確かめられなかった（黒マスの位置が合わない/.test(w)), '色なし：「ダブルメイクは色で確かめられなかった（理由）」');
  res = merge(aiSame, null);
  ok(res.verify.warn.some(w => /^ダブルメイクは色で確かめられなかった。/.test(w)), '色の一覧が届かない（前の画面）→ 同じ警告');
  res = merge(null, null);
  ok(!res.dbl && !res.verify.warn.some(w => /ダブルメイク/.test(w)), 'ダブルメイク指示書が無い日 → 何も出さない');

  // 色の一覧が欠けている・変な値
  const part = Object.assign({}, m8); delete part['204'];
  ok(!S.normDblColor_({ ok: true, map: part }).ok, '部屋が1つ欠けた一覧は使わない');
  const odd = S.normDblColor_({ ok: true, map: Object.assign({}, m8, { '204': '紫', '1210': '新規' }) });
  ok(odd.ok && odd.map['204'] === '?' && !('1210' in odd.map), '知らない区分は「?」、部屋なしの番号は捨てる');
  ok(S.normDblColor_({ ok: true, map: truthMap(PAPERS[2].truth) }).map['201'] === '解除', 'ピンク（解除→ベッド下収納）は解除にそろえる');

  /* ---------- 参考：保存済みの dmake を AI の読みの代わりにしたときの要確認（SAVED_DIR があれば） ---------- */
  const savedDir = process.env.SAVED_DIR;
  if (savedDir) {
    console.log('■ 参考：保存済みの dmake を AI の読みの代わりにしたときの要確認');
    [['2026-11-05', '11/5'], ['2026-11-08', '11/8']].forEach(([d, n]) => {
      const f = path.join(savedDir, 'saved_' + d + '.json'), pp = PAPERS.find(p => p.name === n);
      if (!fs.existsSync(f)) return;
      const sv = JSON.parse(fs.readFileSync(f, 'utf8'));
      const rr = merge(sv.rooms.filter(r => r.dmake).map(r => ({ room: r.room, kind: r.dmake })), { ok: true, map: truthMap(pp.truth) });
      console.log('  -- ' + d + '：要確認 ' + rr.dbl.color.ask.length + '室　' + rr.dbl.color.ask.map(x => x.room + '（' + x.why + '）').join('、'));
    });
  }

  console.log(ng ? '\nNG ' + ng + '件' : '\nすべて OK');
  process.exit(ng ? 1 : 0);
})().catch(e => { console.log('NG', e); process.exit(1); });
