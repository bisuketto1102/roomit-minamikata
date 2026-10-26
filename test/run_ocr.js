const fs = require('fs'), vm = require('vm');
const { env } = require('./gasmock.js');
const D = require('./data0929.js');
const ctx = vm.createContext(env);
// Gemini の代わり：プロンプトを見て、写真どおりの答えを返す
let calls = [], mode = '';
env.PropertiesService.getScriptProperties().setProperty('GEMINI_API_KEY', 'x');
const rowsFor = (floors, order, drop) => {
  const fl = order === 'up' ? floors.slice().reverse() : floors;
  return fl.map(f => ({ floor: f, cells: D.IND[f].filter(Boolean).filter(c => !(drop && drop.includes(c.split(' ')[0]))).map(c => c).join(', ') }));
};
env.UrlFetchApp.fetchAll = reqs => reqs.map(q => {
  const body = JSON.parse(q.payload); const pr = body.contents[0].parts[0].text; const cfg = body.generationConfig;
  calls.push({ think: cfg.thinkingConfig && cfg.thinkingConfig.thinkingLevel, hi: cfg.mediaResolution });
  if (mode === 'nothink' && cfg.thinkingConfig) return { getResponseCode: () => 400, getContentText: () => 'thinking_level is not supported' };
  let data;
  const top = /12F〜07F/.test(pr), up = /→ 12F|02F →|→ 06F/.test(pr) && /07F → 08F|02F → 03F/.test(pr);
  if (/12F〜07F|06F〜02F/.test(pr)) {
    const floors = top ? ['12F','11F','10F','09F','08F','07F'] : ['06F','05F','04F','03F','02F'];
    // 下の画像には 07F が切れて写っている想定（混ざっても捨てられるか）
    const rows = rowsFor(floors, up ? 'up' : 'down', mode === 'drop' && !up ? ['1203'] : null);
    if (!top) rows.unshift({ floor: '07F', cells: '701 D, 702 SD' });
    data = { rows, counts: top ? D.BOX : {} };
    if (top) rows[0].cells += ', 1210 D';   // 無い番号を読んだ
  } else data = {};
  const txt = JSON.stringify(data);
  return { getResponseCode: () => 200, getContentText: () => JSON.stringify({ candidates: [{ content: { parts: [{ text: txt }] } }], usageMetadata: { promptTokenCount: 1000, candidatesTokenCount: 200 } }) };
});
vm.runInContext(fs.readFileSync('' + require('path').join(__dirname, '../src/') + 'Code.gs','utf8') + '\n' + fs.readFileSync('' + require('path').join(__dirname, '../src/') + 'ApaIndicator.gs','utf8')
  + ';globalThis.__a = { readIndicatorCrops, mergeAll, normOrder_, normDouble_, ROOMS, USAGE_ };', ctx);
const A = ctx.__a;
console.log('ROOMS', A.ROOMS.length);
let r = A.readIndicatorCrops('TOP', 'BOT');
console.log('部屋', r.rooms.length, 'counts', JSON.stringify(r.counts), 'usage', JSON.stringify(r.usage), 'calls', JSON.stringify(calls.slice(0,1)));
console.log('cross', JSON.stringify(r.cross));
let m = A.mergeAll(r, A.normOrder_(D.ORDER), A.normDouble_(D.DOUBLE));
console.log(m.verify.ok ? '検算OK' : '検算NG', m.verify.message); m.verify.warn.forEach(w => console.log('  ', w));
const kb = {}; m.rooms.forEach(x => kb[x.kbn] = (kb[x.kbn]||0)+1); console.log(JSON.stringify(kb));
// 1203 を1回目だけ読み落とす → 2回目だけに出た扱い
mode = 'drop'; calls = []; r = A.readIndicatorCrops('TOP', 'BOT');
console.log('drop: onlyB', r.cross.onlyB, 'missing', r.cross.missing);
// thinking 指定が使えないモデル → 指定を外して読み直す
mode = 'nothink'; calls = []; r = A.readIndicatorCrops('TOP', 'BOT');
console.log('nothink: 部屋', r.rooms.length, '呼び出し', calls.length, calls.map(c => c.think || '-').join(','));
