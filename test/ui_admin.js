const fs = require('fs'), vm = require('vm');
const { chromium } = require('playwright');
const { env } = require('./gasmock.js');
const D = require('./data0929.js');
const ctx = vm.createContext(env);
env.PropertiesService.getScriptProperties().setProperty('GEMINI_API_KEY', 'x');
env.PropertiesService.getScriptProperties().setProperty('ADMIN_PIN', '1234');
const seen = [];
env.UrlFetchApp.fetchAll = reqs => reqs.map(q => {
  const body = JSON.parse(q.payload); const pr = body.contents[0].parts[0].text;
  const mime = body.contents[0].parts[1].inline_data.mime_type;
  let data;
  if (/清掃指示書」です/.test(pr)) { data = D.ORDER; seen.push('order ' + mime); }
  else if (/ダブルメイク指示書」です/.test(pr)) { data = D.DOUBLE; seen.push('double ' + mime); }
  else if (/12F〜07F|06F〜02F/.test(pr)) {
    const top = /12F〜07F/.test(pr), floors = top ? ['12F','11F','10F','09F','08F','07F'] : ['06F','05F','04F','03F','02F'];
    data = { rows: floors.map(f => ({ floor: f, cells: D.IND[f].filter(Boolean).join(', ') })), counts: top ? D.BOX : {} };
    seen.push('crop ' + (top ? 'top' : 'bottom') + ' ' + mime + ' ' + body.contents[0].parts[1].inline_data.data.length);
  } else { seen.push('other'); data = {}; }
  const txt = JSON.stringify(data);
  return { getResponseCode: () => 200, getContentText: () => JSON.stringify({ candidates: [{ content: { parts: [{ text: txt }] } }], usageMetadata: { promptTokenCount: 1500, candidatesTokenCount: 300 } }) };
});
vm.runInContext(fs.readFileSync('' + require('path').join(__dirname, '../') + 'Code.js','utf8') + '\n' + fs.readFileSync('' + require('path').join(__dirname, '../') + 'ApaIndicator.js','utf8') + '\n' + fs.readFileSync('' + require('path').join(__dirname, '../') + 'Shift.js','utf8'), ctx);
const call = (n, a) => vm.runInContext(n, ctx)(...a);
call('initSpreadsheet', []);
call('ss_', []).getSheetByName('スタッフ').getRange(2,1,2,2).setValues([['上井 勇輔','在籍'],['川原 なつみ','在籍']]);
const { page } = require('./pagegen.js');
(async () => {
  const br = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium-1194/chrome-linux/chrome' });
  const pg = await br.newPage({ viewport: { width: 430, height: 900 } });
  pg.on('pageerror', e => console.log('pageerror:', e.message));
  pg.on('dialog', d => d.accept());
  await pg.route('https://cdnjs.cloudflare.com/**', r => r.fulfill({ contentType: 'application/javascript',
    body: fs.readFileSync('node_modules/pdfjs-dist/build/' + r.request().url().split('/').pop()) }));
  await pg.route('http://app.test/**', r => r.fulfill({ contentType: 'text/html; charset=utf-8', body: page('Admin') }));
  await pg.exposeFunction('__gas', (n, a) => { try { const v = call(n, JSON.parse(a)); return JSON.stringify({ v: v === undefined ? null : JSON.parse(JSON.stringify(v)) }); }
                                               catch (e) { return JSON.stringify({ err: e.message }); } });
  await pg.goto('http://app.test/admin');
  await pg.fill('#pin', '1234'); await pg.click('text=開く'); await pg.waitForTimeout(500);
  await pg.fill('#date', call('today_', [])); 
  await pg.setInputFiles('#f1', __dirname + '/pdf0929/indicator_0929.pdf');
  await pg.waitForFunction(() => !document.getElementById('cropMsg') && document.querySelectorAll('#p1 img').length === 2, null, { timeout: 30000 });
  await pg.setInputFiles('#f2', __dirname + '/pdf0929/order_0929.pdf'); await pg.setInputFiles('#f3', __dirname + '/pdf0929/double_0929.pdf');
  await pg.waitForTimeout(500);
  console.log('go disabled:', await pg.isDisabled('#go'));
  await pg.click('#go');
  await pg.waitForFunction(() => /室を読み取り/.test(document.getElementById('ocrMsg').textContent), null, { timeout: 30000 });
  console.log('ocrMsg:', await pg.textContent('#ocrMsg'));
  console.log('bars:', (await pg.textContent('#bars')).slice(0, 300));
  console.log('seen:', seen.join(' | '));
  await pg.screenshot({ path: 'adm1.png' });
  await pg.click('.btn.save'); await pg.waitForTimeout(800);
  console.log('save:', await pg.textContent('#saveMsg'));
  // 追加指示
  await pg.fill('#odRooms', '405、1201'); await pg.fill('#odText', 'タオル2枚追加'); await pg.click('button:has-text("指示を入れる")'); await pg.waitForTimeout(400);
  console.log('od:', await pg.textContent('#odMsg'), '|', await pg.textContent('#odList'));
  // 部屋を直す
  await pg.fill('#edRoom', '405'); await pg.click('button:has-text("呼び出す")'); await pg.waitForTimeout(400);
  console.log('ed:', await pg.textContent('#edMsg'));
  await pg.fill('#edLate', '19:30'); await pg.check('#edTw'); await pg.selectOption('#edW', '新規');
  await pg.click('button:has-text("この部屋を保存")'); await pg.waitForTimeout(500);
  console.log('ed save:', await pg.textContent('#edMsg'));
  // 打刻して人ごとの表
  call('clockStart', ['301', '上井 勇輔', 'clean']); call('clockFinish', ['301', '上井 勇輔', 'clean']);
  call('clockStart', ['301', '川原 なつみ', 'check']); call('clockFinish', ['301', '川原 なつみ', 'check']);
  await pg.evaluate(() => refresh()); await pg.waitForTimeout(600);
  console.log('staff:', await pg.textContent('#sumStaff'), '| check:', await pg.textContent('#sumCheck'));
  await pg.click('button:has-text("フロアレポートを作る")'); await pg.waitForTimeout(1500);
  console.log('floor:', (await pg.textContent('#frMsg')).slice(0, 120));
  await pg.screenshot({ path: 'adm2.png', fullPage: true });
  await br.close();
})();
