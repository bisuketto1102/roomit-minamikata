// 電波切れの送り直し：オフラインで押した操作が端末に貯まり、つながったら押した順・押した時刻で入るか
const { chromium } = require('playwright');
const { call, page, T } = require('./ui.js');
(async () => {
  const br = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium-1194/chrome-linux/chrome' });
  const pg = await br.newPage({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2 });
  const ok = (c, m) => console.log((c ? '  OK ' : '  NG ') + m);
  let OFF = false;
  pg.on('pageerror', e => console.log('pageerror:', e.message));
  await pg.exposeFunction('__gas', (n, a) => {
    if (OFF) return JSON.stringify({ err: 'NetworkError: Connection failure due to HTTP 0' });
    try { const v = call(n, JSON.parse(a)); return JSON.stringify({ v: v === undefined ? null : JSON.parse(JSON.stringify(v)) }); }
    catch (e) { return JSON.stringify({ err: e.message }); } });
  await pg.route('http://app.test/**', r => r.fulfill({ contentType: 'text/html; charset=utf-8', body: page('Index') }));
  await pg.goto('http://app.test/'); await pg.waitForTimeout(800);
  await pg.evaluate(() => { localStorage.setItem('lang', 'ja'); }); await pg.reload(); await pg.waitForTimeout(800);
  await pg.selectOption('#staff', '上井 勇輔');
  const srv = room => call('getBoard', [T]).rooms.find(r => r.room === room);
  const outs = call('getBoard', [T]).rooms.filter(r => r.code === 'D' && r.kbn === 'OUT').map(r => r.room);
  const [a, b2, c3, d4] = outs.slice(10);

  console.log('■ 電波なしで入室・退出');
  OFF = true;
  await pg.click('#c-' + a); await pg.waitForTimeout(200);
  const at0 = await pg.evaluate(() => Date.now());
  await pg.evaluate(() => act('start', 'clean')); await pg.waitForTimeout(300);
  await pg.evaluate(() => act('finish', 'clean')); await pg.waitForTimeout(300);
  ok(await pg.isVisible('#qPill') && /2/.test(await pg.textContent('#qPill')), '未送信の印 ' + await pg.textContent('#qPill'));
  ok(srv(a).clean.state === 'todo', 'サーバーにはまだ入っていない');
  ok(await pg.evaluate(r => BOARD.rooms.find(x => x.room === r).clean.state, a) === 'done', '画面は完了のまま');
  await pg.click('.sheet.on .btn.close').catch(() => {}); await pg.waitForTimeout(200);

  console.log('■ まとめてDD・回収も貯める');
  await pg.evaluate(rs => { togglePick(); rs.forEach(r => SEL.add(r)); bulkFlag({ dd: true }); }, [b2, c3]); await pg.waitForTimeout(300);
  await pg.evaluate(() => togglePick());
  ok(JSON.parse(await pg.evaluate(() => localStorage.getItem('outbox'))).length === 3, '端末に3件');

  console.log('■ 開き直しても残る（電波なし）');
  await pg.reload(); await pg.waitForTimeout(800);
  ok(JSON.parse(await pg.evaluate(() => localStorage.getItem('outbox'))).length === 3, '閉じても消えない');

  console.log('■ つながったら送る');
  OFF = false;
  await pg.evaluate(() => load(true)); await pg.waitForTimeout(2500);
  const s = srv(a);
  ok(s.clean.state === 'done' && s.clean.staff === '上井 勇輔', a + ' 完了 ' + s.clean.start + '〜' + s.clean.finish);
  const hm = ms => { const d = new Date(ms), p = n => String(n).padStart(2,'0'); return p(d.getHours()) + ':' + p(d.getMinutes()); };
  ok(s.clean.start === hm(at0) || s.clean.start === hm(at0 + 60000), '押した時刻で記録 ' + s.clean.start);
  ok(srv(b2).dd && srv(c3).dd, b2 + '・' + c3 + ' DD');
  ok(JSON.parse(await pg.evaluate(() => localStorage.getItem('outbox'))).length === 0 && await pg.isHidden('#qPill'), '未送信 0、印が消える');

  console.log('■ 断られたら赤い印');
  OFF = true;
  await pg.click('#c-' + d4); await pg.waitForTimeout(200);
  await pg.evaluate(() => act('start', 'clean')); await pg.waitForTimeout(300);
  await pg.evaluate(() => act('finish', 'clean')); await pg.waitForTimeout(300);
  await pg.click('.sheet.on .btn.close').catch(() => {});
  call('clockStart', [d4, '川原 なつみ', 'clean']);   // その間に別の人が入った
  OFF = false;
  await pg.evaluate(() => flush()); await pg.waitForTimeout(1500);
  ok(await pg.isVisible('#qDrop') && /2/.test(await pg.textContent('#qDrop')), '入室と、その後の退出も送らず赤い印 ' + await pg.textContent('#qDrop'));
  ok(srv(d4).clean.state === 'doing', '川原さんの作業は完了にならない');
  ok(srv(d4).clean.staff === '川原 なつみ', '川原さんの入室のまま');
  ok(await pg.evaluate(r => BOARD.rooms.find(x => x.room === r).clean.staff, d4) === '川原 なつみ', '画面も読み直して川原さん');
  await pg.screenshot({ path: 'ui_off.png' });
  let msg = ''; pg.once('dialog', dl => { msg = dl.message(); dl.accept(); });
  await pg.click('#qDrop'); await pg.waitForTimeout(300);
  ok(/作業中/.test(msg) && await pg.isHidden('#qDrop'), '中身を見せて消える：' + msg.split('\n').slice(2).join(' / '));
  console.log('errors:', await pg.evaluate(() => window.__errs));
  await br.close();
})();
