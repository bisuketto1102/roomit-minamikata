/* 清掃指示書のフル清掃：黄色いマスを数える（Admin.html の findFullCells）を、実物の PDF で確かめる。
 *   node run_full.js [PDFのあるフォルダ]
 * PDF のフォルダは引数か環境変数 ORD_DIR。ord_1104.pdf・ord_1105.pdf・ord_1108.pdf を読む（実物の紙なのでリポジトリには入れていない）。
 * 9/29 の紙（pdf0929/order_0929.pdf）はリポジトリにあるので、いつも見る。
 * 正解は紙を目で見て数えた数（11/8 は保存済みの fullClean 9室と同じ）。
 * 写真（JPEG）にしても数えられるか、PDF を画像にしたもので同じ数になるかも見る。 */
const fs = require('fs'), path = require('path');
const { chromium } = require('playwright');
const DIR = process.argv[2] || process.env.ORD_DIR || '';
const WANT = {
  order_0929: { n: 8,  rooms: '516 703 708 908 912 / 913 1206 1217', dir: path.join(__dirname, 'pdf0929') },   // 手書きのチェック入り
  ord_1104: { n: 16, rooms: '705 707 708 709 710 / 903 914 915 917 1001 / 1002 1003 1005 1006 1008 / 1017' },
  ord_1105: { n: 5,  rooms: '401 806 815 1001 1004' },
  ord_1108: { n: 9,  rooms: '404 610 714 904 906 / 915 1001 1004 1116' }
};
const html = fs.readFileSync(path.join(__dirname, '../Admin.html'), 'utf8');
const a = html.indexOf('let PDFJS = null;'), b = html.indexOf('/** ファイルをそのまま base64 にする');
if (a < 0 || b < 0) { console.log('NG Admin.html から関数を切り出せない'); process.exit(1); }
const code = html.slice(a, b);
const PDFJS = path.join(__dirname, 'node_modules/pdfjs-dist/build/');

/* ---- サーバー：数えた数と、読めたフル清掃の部屋数の突き合わせ（Gemini の返事は作り物） ---- */
function server() {
  const vm = require('vm');
  const { env } = require('./gasmock.js');
  const D = require('./data0929.js');
  const ctx = vm.createContext(env);
  env.PropertiesService.getScriptProperties().setProperty('GEMINI_API_KEY', 'x');
  env.PropertiesService.getScriptProperties().setProperty('ADMIN_PIN', '1234');
  let drop = [], prompts = [], paper = null, hand = [];   // drop[i]：i 回目の読みで落とす部屋。paper：紙のフル清掃（null は 9/29）。hand：AI が手書きとした部屋
  env.UrlFetchApp.fetchAll = reqs => reqs.map((q, i) => {
    const pr = JSON.parse(q.payload).contents[0].parts[0].text;
    let data;
    if (/ダブルメイク指示書」です/.test(pr)) data = D.DOUBLE;
    else if (/12F〜07F|06F〜02F/.test(pr)) {   // 管理画面の流れ（インジケーターの切り出し2枚）。ui_admin.js と同じ
      const top = /12F〜07F/.test(pr), floors = top ? ['12F','11F','10F','09F','08F','07F'] : ['06F','05F','04F','03F','02F'];
      data = { rows: floors.map(f => ({ floor: f, cells: D.IND[f].filter(Boolean).join(', ') })), counts: top ? D.BOX : {} };
    } else {
      prompts.push(pr);
      data = JSON.parse(JSON.stringify(D.ORDER));
      data.fullClean = (paper || data.fullClean).filter(no => (drop[i] || []).indexOf(no) < 0);
      data.handwritten = hand;
    }
    const txt = JSON.stringify(data);
    return { getResponseCode: () => 200, getContentText: () => JSON.stringify({ candidates: [{ content: { parts: [{ text: txt }] } }], usageMetadata: { promptTokenCount: 1, candidatesTokenCount: 1 } }) };
  });
  vm.runInContext(fs.readFileSync(path.join(__dirname, '../Code.js'), 'utf8') + '\n' + fs.readFileSync(path.join(__dirname, '../ApaIndicator.js'), 'utf8')
    + '\n' + fs.readFileSync(path.join(__dirname, '../Shift.js'), 'utf8')
    + '\n;savePhoto_ = function () {};   /* 写真の保存はここでは見ない */\nglobalThis.__a = { readOrder, mergeAll: mergeAll_, crossCheck_, normDouble_, initSpreadsheet };', ctx);
  const A = ctx.__a;
  A.initSpreadsheet();
  const rooms = [];
  Object.keys(D.IND).forEach(f => D.IND[f].forEach(c => { if (!c) return; const [room, code] = c.split(' ');
    rooms.push({ room, code, reserved: code.indexOf('*') >= 0, hand: false, uncertain: [] }); }));
  const parsed = { rooms, counts: D.BOX };
  const ind = () => A.crossCheck_(JSON.parse(JSON.stringify(parsed)), JSON.parse(JSON.stringify(parsed)));
  let bad = 0;
  const ok = (c, m) => { if (!c) bad++; console.log((c ? 'OK ' : 'NG ') + m); };
  const FULL = /フル清掃の黄色いマス|フル清掃の数を確かめられなかった/;
  // 管理用の入口（暗証番号つき）で読み、そのまま突き合わせる（管理画面と同じ順）
  const go = (count, d) => {
    drop = d; prompts = [];
    const ord = A.readOrder('1234', 'QUJD', 'application/pdf', count);
    return { ord: ord, v: A.mergeAll(ind(), ord, A.normDouble_(D.DOUBLE)).verify };
  };
  const n = D.ORDER.fullClean.length;   // 9/29 の紙は 8室

  let r = go(n, []);
  ok(r.ord.fullCount === n && r.ord.fullClean.length === n, '入口が数を渡す：fullCount ' + r.ord.fullCount + '・読めた ' + r.ord.fullClean.length);
  ok(prompts.length === 2 && prompts.every(p => /黄色く塗られたマス/.test(p) && !/丸で囲まれた部屋番号を/.test(p)), 'プロンプトの 4) が黄色いマスになっている');
  ok(!r.v.fullGap && !r.v.warn.some(w => FULL.test(w)), '数が合えば何も出さない：' + JSON.stringify(r.v.warn.filter(w => FULL.test(w))));

  r = go(n, [['913'], ['913']]);   // 2回とも 913 を落とす（11/6 の 413 と同じ）
  ok(r.v.fullGap === 'フル清掃の黄色いマスは' + n + '室、読めたのは' + (n - 1) + '室。紙と見比べて足りない部屋を足してください（読めた部屋：'
    + D.ORDER.fullClean.filter(x => x !== '913').join('、') + '）', '1室落とすと赤：' + r.v.fullGap);
  ok(r.v.warn[0] === r.v.fullGap && r.v.warn.filter(w => FULL.test(w)).length === 1, 'warn のいちばん上に1行だけ');

  r = go(n, [['913'], []]);        // 片方だけ落とした → 和で足りる
  ok(!r.v.fullGap && !r.v.warn.some(w => FULL.test(w)), '片方の読みで読めていれば出さない（2回の読みの食い違いは今までどおり）');

  r = go(n - 1, []);               // 読めたほうが多い：正しい部屋を外させないよう「外して」とは言わない
  ok(/読めたのは8室。紙と見比べてください（手書きで足した部屋は黄色く塗られていないので数に入りません）/.test(r.v.fullGap) && !/外して/.test(r.v.fullGap),
    '多く読めたときも赤（外せとは言わない）：' + r.v.fullGap);

  // 手書きで白いマスに書き足した部屋（AI の handwritten）は黄色くないので除いて比べる
  paper = D.ORDER.fullClean.concat(['1101']); hand = ['1101'];
  r = go(n, []);
  ok(!r.v.fullGap && !r.v.warn.some(w => FULL.test(w)), '手書きで足した部屋は数に入れない：' + (r.v.fullGap || '出ない'));
  r = go(n, [['913'], ['913']]);
  ok(/読めたのは7室（手書きの 1101 は除いた）。紙と見比べて足りない部屋を足してください/.test(r.v.fullGap), '手書きを除いて1室足りない → 赤：' + r.v.fullGap);
  paper = null; hand = [];

  for (const c of [null, undefined, '', 'abc', -1, 2.5]) {
    r = go(c, [['913'], ['913']]);
    const fw = r.v.warn.filter(w => FULL.test(w));
    ok(r.ord.fullCount === null && !r.v.fullGap && fw.length === 1 && fw[0] === 'フル清掃の数を確かめられなかった（黄色いマスを数えられなかった）',
      '数えられなかった（' + JSON.stringify(c) + '）：1行だけ・赤にしない');
  }
  // 黄色が0：数えられなかったのと同じ扱い。フル清掃の無い日はふつうにあるので、AI も0なら何も出さない
  paper = [];
  r = go(0, []);
  ok(!r.v.fullGap && !r.v.warn.some(w => FULL.test(w)), '黄色0・読めたのも0：何も出さない');
  paper = null;
  r = go(0, []);
  let fw0 = r.v.warn.filter(w => FULL.test(w));
  ok(!r.v.fullGap && fw0.length === 1 && /確かめられなかった/.test(fw0[0]), '黄色0なのに読めた：黄色の1行だけ（赤にしない）：' + fw0.join(' / '));
  paper = ['1101']; hand = ['1101'];
  r = go(0, []);
  ok(!r.v.fullGap && !r.v.warn.some(w => FULL.test(w)), '黄色0・手書きだけ読めた：何も出さない');
  paper = null; hand = [];
  let threw = false; try { A.readOrder('0000', 'QUJD', 'application/pdf', n); } catch (e) { threw = true; }
  ok(threw, '暗証番号が違えば読まない');
  env.CacheService.getScriptCache().put('pinFail', '0', 600);   // まちがえた数を戻す（この仕掛けには user lock が無く、1回で止まる）
  // 実物の紙の日：管理画面で数えた数と、紙どおりに読めた部屋（と1室落とした場合）で突き合わせる
  const day = (count, rooms, d) => { paper = rooms; const r = go(count, d); paper = null; return r.v; };
  return { bad: bad, day: day, FULL: FULL, ctx: ctx, setDrop: d => { drop = d; } };
}

(async () => {
  const S = server();
  const bad0 = S.bad, counted = {};
  const br = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium-1194/chrome-linux/chrome' });
  const pg = await br.newPage();
  await pg.route('https://cdnjs.cloudflare.com/**', r =>
    r.fulfill({ contentType: 'application/javascript', body: fs.readFileSync(PDFJS + r.request().url().split('/').pop()) }));
  await pg.route('http://app.test/**', r => r.fulfill({ contentType: 'text/html', body: '<html><body></body></html>' }));
  await pg.goto('http://app.test/');
  pg.on('pageerror', e => console.log('pageerror', e.message));
  await pg.addScriptTag({ content: code + '\nwindow.findFullCells = findFullCells; window.pageCanvas = pageCanvas; window.countFullClean = countFullClean;' });
  let bad = bad0;
  const run = async (name, b64, type, how) => pg.evaluate(async ([b64, type, how]) => {
    const bin = atob(b64), u = new Uint8Array(bin.length); for (let i = 0; i < bin.length; i++) u[i] = bin.charCodeAt(i);
    let file = new File([u], type === 'application/pdf' ? 'a.pdf' : 'a.jpg', { type: type });
    if (how !== 'pdf') {   // PDF を写真（JPEG）にしてから数える。skew は少し傾けて・ずらして（スキャンのずれ）
      let c = await pageCanvas(file, 2600);
      if (how !== 'jpeg') {
        const [kind, a1, a2, a3] = how.split(':');
        const d = document.createElement('canvas'); d.width = c.width; d.height = c.height;
        const g = d.getContext('2d'); g.fillStyle = '#fff'; g.fillRect(0, 0, d.width, d.height);
        if (kind === 'skew') { g.translate(d.width / 2 + Number(a2), d.height / 2 + Number(a3)); g.rotate(Number(a1) * Math.PI / 180); g.drawImage(c, -c.width / 2, -c.height / 2); }
        else g.drawImage(c, 0, 0);
        g.setTransform(1, 0, 0, 1, 0, 0);
        if (kind === 'tint') {   // 暖色の照明・暗い写真（色をかける）
          g.globalCompositeOperation = 'multiply'; g.fillStyle = a1; g.fillRect(0, 0, d.width, d.height); g.globalCompositeOperation = 'source-over';
        }
        if (kind === 'shade') {  // 左上が暗い影
          const gr = g.createLinearGradient(0, 0, d.width, d.height);
          gr.addColorStop(0, 'rgba(0,0,0,' + a1 + ')'); gr.addColorStop(1, 'rgba(0,0,0,0)'); g.fillStyle = gr; g.fillRect(0, 0, d.width, d.height);
        }
        c = d;
      }
      const blob = await new Promise(res => c.toBlob(res, 'image/jpeg', 0.85));
      file = new File([blob], 'a.jpg', { type: 'image/jpeg' });
    }
    const t0 = performance.now();
    const r = findFullCells(await pageCanvas(file, 1600));
    return { r: r, ms: Math.round(performance.now() - t0), n: await countFullClean(file) };
  }, [b64, type, how]);
  const pdfOf = k => path.join(WANT[k].dir || DIR, k + '.pdf');
  const files = Object.keys(WANT).filter(k => fs.existsSync(pdfOf(k)));
  if (files.length < Object.keys(WANT).length) { console.log('NG PDF が無いので一部の紙を見ていない（node run_full.js <ord_1104.pdf などのあるフォルダ>）：'
    + Object.keys(WANT).filter(k => files.indexOf(k) < 0).join('・')); bad++; }
  for (const k of files) {
    const b64 = fs.readFileSync(pdfOf(k)).toString('base64');
    for (const how of ['pdf', 'jpeg', 'skew:0.4:30:-40', 'skew:-0.4:-25:35']) {
      const o = await run(k, b64, 'application/pdf', how);
      // 数が合うことに加えて、枠が「★フル清掃」の位置（左上・リネン交換依頼の上）にあること＝ほかの黄色い欄を数えていない
      const at = o.r && o.r.box[0] < 0.06 && o.r.box[2] > 0.38 && o.r.box[2] < 0.46 && o.r.box[1] > 0.16 && o.r.box[1] < 0.23 && o.r.box[3] < 0.37;
      const ok = o.r && at && o.r.count === WANT[k].n && o.n === WANT[k].n;
      if (how === 'pdf') counted[k] = o.n;
      if (!ok) bad++;
      console.log((ok ? 'OK ' : 'NG ') + k + ' ' + how + '：黄色 ' + (o.r ? o.r.count : 'null') + ' / 正解 ' + WANT[k].n
        + (o.r ? '　枠 ' + o.r.rows + '行×' + o.r.cols + '列 位置 ' + o.r.box.map(v => v.toFixed(3)).join(',')
          + '　マス ' + o.r.yellow.map(c => c.join('-')).join(' ') : '') + '　' + o.ms + 'ms');
      if (process.env.DBG && o.r) console.log('  横線 ' + o.r.ys.join(',') + '\n  左の線のまとまり\n    ' + o.r.groups.join('\n    '));
    }
    // 大きく傾いた・暖色の照明・影・暗い写真：数えられなくてもよい（null）。まちがった数を出さないこと（出すと赤い知らせで保存を止めてしまう）
    for (const how of ['skew:1:0:0', 'skew:-1.5:40:40', 'skew:3:0:0', 'tint:#fff0c0', 'tint:#ffe8a0', 'tint:#ffe090',
                       'tint:#d0d0d0', 'tint:#a0a0a0', 'tint:#808080', 'shade:0.25', 'shade:0.4', 'shade:0.6']) {
      const o = await run(k, b64, 'application/pdf', how);
      const ok = o.n === null || o.n === WANT[k].n;
      if (!ok) bad++;
      console.log((ok ? 'OK ' : 'NG ') + k + ' ' + how + '：' + (o.n === null ? '数えられない（null）' : '黄色 ' + o.n) + ' / 正解 ' + WANT[k].n);
    }
  }
  // ふつうの日（AI が紙どおりに読めた）は何も出さない。1室落とした日だけ赤
  for (const k of files) {
    const rooms = WANT[k].rooms.split(/[\s\/]+/).filter(Boolean);
    let v = S.day(counted[k], rooms, []);
    const fw = v.warn.filter(w => S.FULL.test(w));
    if (fw.length || v.fullGap) bad++;
    console.log((fw.length || v.fullGap ? 'NG ' : 'OK ') + k + ' 紙どおりに読めた日：知らせなし' + (fw.length ? ' → ' + fw.join(' / ') : ''));
    v = S.day(counted[k], rooms, [[rooms[rooms.length - 1]], [rooms[rooms.length - 1]]]);
    if (!v.fullGap) bad++;
    console.log((v.fullGap ? 'OK ' : 'NG ') + k + ' ' + rooms[rooms.length - 1] + ' を2回とも落とした日：' + v.fullGap);
  }
  // 11/5 の保存（saved_2026-11-05.json）はフル清掃が 806 だけ。紙は5室なので、この仕組みがあれば止まっていた
  if (counted.ord_1105 != null) {
    const v = S.day(counted.ord_1105, ['806'], []);
    if (!v.fullGap) bad++;
    console.log((v.fullGap ? 'OK ' : 'NG ') + '11/5 の保存どおり（806 だけ）：' + v.fullGap);
  }
  // 黄色の無い白紙・別の紙（枠が無い）は null（数えられなかった）になること
  const blank = await pg.evaluate(async () => {
    const c = document.createElement('canvas'); c.width = 1131; c.height = 1600;
    const g = c.getContext('2d'); g.fillStyle = '#fff'; g.fillRect(0, 0, c.width, c.height);
    g.fillStyle = '#ff0'; g.fillRect(100, 300, 200, 50);
    return findFullCells(c);
  });
  if (blank !== null) bad++;
  console.log((blank === null ? 'OK ' : 'NG ') + '枠の無い紙は null');

  /* ---- 管理画面の流れ：紙を選ぶ → 数える → 読み取りに数を付けて送る → 赤 → 保存の前に止まる ---- */
  const ok = (c, m) => { if (!c) bad++; console.log((c ? 'OK ' : 'NG ') + m); };
  const { page } = require('./pagegen.js');
  const ap = await br.newPage({ viewport: { width: 430, height: 900 } });
  const dialogs = []; let accept = true;
  ap.on('pageerror', e => { bad++; console.log('NG pageerror:', e.message); });
  ap.on('dialog', d => { dialogs.push(d.message()); accept ? d.accept() : d.dismiss(); });
  await ap.route('https://cdnjs.cloudflare.com/**', r =>
    r.fulfill({ contentType: 'application/javascript', body: fs.readFileSync(PDFJS + r.request().url().split('/').pop()) }));
  // pagegen は confirm を差し替えるので、本物の確認ダイアログが出るように戻す
  await ap.route('http://app.test/**', r => r.fulfill({ contentType: 'text/html; charset=utf-8',
    body: page('Admin').replace('window.confirm = () => true;', '') }));
  const sent = [];
  await ap.exposeFunction('__gas', (n, a) => {
    try {
      const args = JSON.parse(a);
      if (n === 'readOrder') sent.push(args.length + '引数 数=' + JSON.stringify(args[3]) + ' 切り出し=' + (typeof args[4] === 'string' && args[4].length > 100 ? 'あり' : 'なし'));
      const v = S.ctx[n](...args);
      return JSON.stringify({ v: v === undefined ? null : JSON.parse(JSON.stringify(v)) });
    } catch (e) { return JSON.stringify({ err: e.message }); }
  });
  await ap.goto('http://app.test/admin');
  await ap.fill('#pin', '1234'); await ap.click('text=開く'); await ap.waitForTimeout(500);
  await ap.fill('#date', '2026-09-29');
  await ap.setInputFiles('#f1', path.join(__dirname, 'pdf0929/indicator_0929.pdf'));
  await ap.waitForFunction(() => !document.getElementById('cropMsg') && document.querySelectorAll('#p1 img').length === 2, null, { timeout: 30000 });
  const pick = async (file) => {
    await ap.$eval('#p2', e => { e.innerHTML = ''; });   // 前の紙の「黄色いマス n室」を消してから選ぶ
    await ap.setInputFiles('#f2', file);
    await ap.waitForFunction(() => document.getElementById('fullMsg') && !/数え中/.test(document.getElementById('fullMsg').textContent), null, { timeout: 30000 });
    return ap.textContent('#fullMsg');
  };
  const readNow = async () => {
    await ap.$eval('#ocrMsg', e => { e.textContent = ''; });   // 前の読み取りの「室を読み取り」で先へ進まないように
    await ap.click('#go');
    await ap.waitForFunction(() => /室を読み取り/.test(document.getElementById('ocrMsg').textContent), null, { timeout: 30000 });
  };
  const fullBars = () => ap.$$eval('#bars .bar', bs => bs.filter(b => /フル清掃の(黄色いマス|数)/.test(b.textContent)).map(b => b.className + '｜' + b.textContent));
  const saved = () => ap.waitForFunction(() => /保存しました|やめました|できませんでした/.test(document.getElementById('saveMsg').textContent), null, { timeout: 30000 }).then(() => ap.textContent('#saveMsg'));

  // ① 2回とも 913 を落とした
  ok(await pick(path.join(__dirname, 'pdf0929/order_0929.pdf')) === 'フル清掃の黄色いマス 8室', '紙を選ぶと数を出す');
  S.setDrop([['913'], ['913']]); sent.length = 0;
  await readNow();
  ok(sent.join() === '5引数 数=8 切り出し=あり', '読み取りに数と欄の切り出しを付けて送る（暗証番号の次に 紙・種類・数・切り出し）：' + sent.join());
  let fb = await fullBars();
  ok(fb.length === 1 && /^bar ng｜フル清掃の黄色いマスは8室、読めたのは7室。紙と見比べて足りない部屋を足してください/.test(fb[0]), '赤で1行：' + fb.join(' / '));
  dialogs.length = 0; accept = false;
  await ap.$eval('#saveMsg', e => { e.textContent = ''; }); await ap.click('.btn.save');
  let sm = await saved();
  ok(dialogs.length === 1 && /フル清掃の黄色いマスは 8室ですが、一覧でフル清掃の部屋は 7室/.test(dialogs[0]) && /保存をやめました（フル清掃/.test(sm), '保存の前に止まる：' + sm);
  // 913 の「フル清掃」を押して足すと、聞かずに保存できる
  await ap.evaluate(() => flipEx(ROWS.findIndex(r => r.room === '913'), 'fullClean'));
  dialogs.length = 0; accept = true;
  await ap.$eval('#saveMsg', e => { e.textContent = ''; }); await ap.click('.btn.save');
  sm = await saved();
  ok(!dialogs.some(d => /フル清掃/.test(d)) && /保存しました/.test(sm), '足りない部屋を足せば聞かずに保存：' + sm);

  // ② 紙どおりに読めた（ふつうの日）：何も出さず、保存でも聞かない
  S.setDrop([]); sent.length = 0;
  await pick(path.join(__dirname, 'pdf0929/order_0929.pdf'));
  await readNow();
  fb = await fullBars();
  ok(fb.length === 0, 'ふつうの日は知らせなし：' + fb.join(' / '));
  dialogs.length = 0;
  await ap.$eval('#saveMsg', e => { e.textContent = ''; }); await ap.click('.btn.save');
  sm = await saved();
  ok(!dialogs.some(d => /フル清掃/.test(d)) && /保存しました/.test(sm), 'ふつうの日は保存で聞かない：' + sm);

  // ③ 数えられない写真（白い画像）：1行だけ・黄色（赤にしない）・保存は止めない
  const white = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8/x8AAwMCAO+ip1sAAAAASUVORK5CYII=', 'base64');
  S.setDrop([['913'], ['913']]); sent.length = 0;
  ok(await pick({ name: 'a.png', mimeType: 'image/png', buffer: white }) === '', '数えられない写真は数を出さない');
  await readNow();
  ok(sent.join() === '5引数 数=null 切り出し=なし', '数えられないときは null と切り出しなしを送る：' + sent.join());
  fb = await fullBars();
  ok(fb.length === 1 && /^bar wa｜フル清掃の数を確かめられなかった/.test(fb[0]), '1行だけ・赤にしない：' + fb.join(' / '));
  dialogs.length = 0;
  await ap.$eval('#saveMsg', e => { e.textContent = ''; }); await ap.click('.btn.save');
  sm = await saved();
  ok(!dialogs.some(d => /フル清掃/.test(d)) && /保存しました/.test(sm), '数えられないときは保存を止めない：' + sm + (dialogs.length ? '　確認：' + dialogs.join(' / ') : ''));

  // ④ 保存済みを読み込んで直すときは比べない
  await ap.evaluate(() => loadSaved()); await ap.waitForTimeout(800);
  await ap.evaluate(() => flipEx(ROWS.findIndex(r => r.room === '516'), 'fullClean'));
  dialogs.length = 0;
  await ap.$eval('#saveMsg', e => { e.textContent = ''; }); await ap.click('.btn.save');
  sm = await saved();
  ok(!dialogs.some(d => /フル清掃/.test(d)) && /保存しました/.test(sm), '保存済みを直すときは聞かない：' + sm);
  await br.close();
  console.log(bad ? 'NG ' + bad + '件' : 'ALL OK');
  process.exit(bad ? 1 : 0);
})();
