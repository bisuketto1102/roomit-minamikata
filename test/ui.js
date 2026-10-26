// 画面をChromiumで開き、google.script.run を node 側のGASモックにつないで操作する
const fs = require('fs'), vm = require('vm');
const { chromium } = require('playwright');
const { env } = require('./gasmock.js');
const D = require('./data0929.js');
const ctx = vm.createContext(env);
vm.runInContext(fs.readFileSync('' + require('path').join(__dirname, '../') + 'Code.js','utf8') + '\n' +
                fs.readFileSync('' + require('path').join(__dirname, '../') + 'ApaIndicator.js','utf8') + '\n;/* テストの準備：管理用は中身を直接呼ぶ（清掃員画面からは呼ばない） */ globalThis.A_ = {}; [\'mergeAll\',\'getSaved\',\'saveDayNote\',\'getDayNote\',\'saveImport\',\'addOrder\',\'setOrder\',\'getOrders\',\'getRoomAdmin\',\'setRoomAdmin\',\'getReport\',\'getSummary\',\'getSpecial\',\'getStale\',\'setSpecialNames\',\'buildSpecialSheet\',\'buildDailyReport\',\'buildFloorReport\',\'buildManagerReport\',\'getDeclarationText\',\'readIndicator\',\'readIndicatorCrops\',\'readOrder\',\'readDouble\',\'mergeSheets\',\'resortLog\'].forEach(n => { globalThis[n] = globalThis[n + \'_\']; });' + '\n;globalThis.__call = (n, a) => globalThis[n](...a);', ctx);
// 関数宣言は globalThis に乗る
const call = (n, a) => vm.runInContext(n, ctx)(...a);
call('initSpreadsheet', []);
const ss = call('ss_', []);
ss.getSheetByName('スタッフ').getRange(2,1,3,2).setValues([['上井 勇輔','在籍'],['川原 なつみ','在籍'],['シュレスタ ビマラ','在籍']]);
call('setSpecialNames', ['2026-10', ['エアコン掃除機','排水溝','ブック・テレビ裏']]);
const rooms = [];
Object.keys(D.IND).forEach(f => D.IND[f].forEach(c => { if (!c) return; const [room, code] = c.split(' ');
  rooms.push({ room, code, reserved: code.indexOf('*')>=0, hand: false, uncertain: [] }); }));
const parsed = { rooms, counts: D.BOX };
const res = call('mergeAll', [call('crossCheck_', [parsed, JSON.parse(JSON.stringify(parsed))]), call('normOrder_', [D.ORDER]), call('normDouble_', [D.DOUBLE])]);
const T = call('today_', []);
call('saveImport', [T, res.rooms]);
call('saveDayNote', [T, call('normOrder_', [D.ORDER]), call('normDouble_', [D.DOUBLE])]);
call('addOrder', ['405 1201', 'タオル2枚追加']);

function page(file){
  let h = fs.readFileSync('' + require('path').join(__dirname, '../') + '' + file + '.html', 'utf8');
  h = h.replace("<?!= include('Lang') ?>", fs.readFileSync('' + require('path').join(__dirname, '../') + 'Lang.html', 'utf8'));
  const shim = `<script>
  window.google = { script: { run: (function mk(ok, ng){ return new Proxy({}, { get(_, k){
    if (k === 'withSuccessHandler') return f => mk(f, ng);
    if (k === 'withFailureHandler') return f => mk(ok, f);
    return (...a) => { window.__gas(k, JSON.stringify(a)).then(r => { const o = JSON.parse(r);
      setTimeout(() => o.err ? (ng && ng({message: o.err})) : (ok && ok(o.v)), 30); }); };
  }}); })(null, null) } };
  window.__errs = []; window.addEventListener('error', e => window.__errs.push(e.message));
  window.confirm = () => true; window.prompt = () => '';
  </script>`;
  return h.replace('<head>', '<head><meta name="viewport" content="width=device-width, initial-scale=1, maximum-scale=1">' + shim);
}
module.exports = { call, page, T, ss };
if (require.main === module) (async () => {
  const br = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium-1194/chrome-linux/chrome' });
  const pg = await br.newPage({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2 });
  pg.on('console', m => { if (m.type() === 'error') console.log('console:', m.text()); });
  pg.on('pageerror', e => console.log('pageerror:', e.message));
  await pg.exposeFunction('__gas', (n, a) => { try { const v = call(n, JSON.parse(a)); return JSON.stringify({ v: v === undefined ? null : JSON.parse(JSON.stringify(v)) }); }
                                                catch (e) { return JSON.stringify({ err: e.message }); } });
  await pg.route('http://app.test/**', r => r.fulfill({ contentType: 'text/html; charset=utf-8', body: page(r.request().url().indexOf('admin') >= 0 ? 'Admin' : 'Index') }));
  await pg.goto('http://app.test/');
  await pg.waitForTimeout(800);
  await pg.evaluate(() => { localStorage.setItem('lang', 'ja'); }); await pg.reload(); await pg.waitForTimeout(800);
  await pg.selectOption('#staff', '上井 勇輔');
  await pg.screenshot({ path: 'ui1.png' });
  // 405 を開く（追加指示）
  await pg.click('#c-405'); await pg.waitForTimeout(300);
  await pg.screenshot({ path: 'ui2.png' });
  await pg.click('#dSteps .btn'); await pg.waitForTimeout(400);
  await pg.screenshot({ path: 'ui3.png' });
  await pg.click('.btn.close'); await pg.waitForTimeout(300);
  console.log('mywork:', await pg.textContent('#myWork'));
  // DD：301 を清掃不要 → DDセット1回押し
  await pg.click('#c-301'); await pg.waitForTimeout(300);
  await pg.click('#tgSkip'); await pg.waitForTimeout(400);
  await pg.screenshot({ path: 'ui4.png' });
  await pg.click('#dSteps .btn.fin'); await pg.waitForTimeout(400);
  await pg.screenshot({ path: 'ui5.png' });
  // ゴミ回収
  await pg.click('#tgPick'); await pg.waitForTimeout(400);
  await pg.click('.sheet.on .btn.close'); await pg.waitForTimeout(300);
  console.log('回収バッジ:', await pg.textContent('#colN'), await pg.isHidden('#colN'));
  console.log('指示バッジ:', await pg.textContent('#ordN'));
  await pg.click('text=指示'); await pg.waitForTimeout(300);
  await pg.screenshot({ path: 'ui6.png', fullPage: false });
  const sv = call('getBoard', [T]).rooms.filter(r => ['301','405'].includes(r.room)).map(r => [r.room, r.code, r.clean, r.dd, r.skip, r.pickup, r.pickupBy]);
  console.log(JSON.stringify(sv));
  console.log('errors:', await pg.evaluate(() => window.__errs));
  await br.close();
})();
