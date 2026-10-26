const fs = require('fs'), vm = require('vm');
const { env, BOOKS, props } = require('./gasmock.js');
const D = require('./data0929.js');
const ctx = vm.createContext(env);
const code = fs.readFileSync('' + require('path').join(__dirname, '../') + 'Code.js','utf8') + '\n' +
             fs.readFileSync('' + require('path').join(__dirname, '../') + 'ApaIndicator.js','utf8');
vm.runInContext(code + "\n;/* テスト：管理用の関数は暗証番号なしで中身を直接呼ぶ */ ['mergeAll','getSaved','saveDayNote','getDayNote','saveImport','addOrder','setOrder','getOrders','getRoomAdmin','setRoomAdmin','getReport','getSummary','getSpecial','getStale','setSpecialNames','buildSpecialSheet','buildDailyReport','buildFloorReport','buildManagerReport','getDeclarationText','readIndicator','readIndicatorCrops','readOrder','readDouble','mergeSheets','resortLog'].forEach(n => { this[n] = this[n + '_']; });\n" + `
;globalThis.__api = { initSpreadsheet, normRoom_, crossCheck_, normOrder_, normDouble_, mergeAll, saveImport,
  saveDayNote, buildDailyReport, buildManagerReport, buildFloorReport, buildSpecialSheet, getBoard, setSpecialNames,
  getReport, SHEET, NCOL, TASK_COL, FLAG_COL, findLogRow_, ss_ };`, ctx);
const A = ctx.__api;
const DATE = '2026-09-29';

// ① 準備：スプレッドシートと名簿、9月の特別清掃の枠
A.initSpreadsheet();
const ss = A.ss_();
const STAFF = ['川原 なつみ','正田 久之','内田 真里','上井 勇輔','靏 和香葉','山本 理穂','越智 仁美',
               'シュレスタ ビマラ','カフレ レヌカ','ネパール プレム','スリング キカ'];
const st = ss.getSheetByName('スタッフ');
st.getRange(2,1,STAFF.length,2).setValues(STAFF.map(n=>[n,'在籍']));
A.setSpecialNames('2026-09', ['エアコン掃除機','排水溝','ブック・テレビ裏']);

// ② 読み取り結果（Geminiの代わりに書き起こしを入れる。2回とも同じ読みとする）
const rooms = [];
Object.keys(D.IND).forEach(f => D.IND[f].forEach(c => {
  if (!c) return; const [room, code] = c.split(' ');
  rooms.push({ room, code, reserved: code.indexOf('*')>=0, hand: false, uncertain: [] });
}));
const parsed = { rooms, counts: D.BOX };
const ind = A.crossCheck_(parsed, JSON.parse(JSON.stringify(parsed)));
const ord = A.normOrder_(D.ORDER);
const dbl = A.normDouble_(D.DOUBLE);
const res = A.mergeAll(ind, ord, dbl);

console.log('■ 読み取りの検算');
console.log('  ' + (res.verify.ok ? '検算OK' : '検算NG') + '：' + res.verify.message);
res.verify.warn.forEach(w => console.log('  注意：' + w));
const kb = {}; res.rooms.forEach(r => { kb[r.kbn] = (kb[r.kbn]||0)+1; });
console.log('  区分', JSON.stringify(kb), '／ 清掃対象', res.verify.cleanTarget, '室（指示書の清掃指示数 179）');

// ③ 保存
A.saveImport(DATE, res.rooms);
A.saveDayNote(DATE, ord, dbl);

// ④ 1日終わった状態にする：DD以外は清掃・チェック完了、ノーメイク（DD・備品要）はDDセット・DDチェック完了
const log = ss.getSheetByName('打刻ログ');
const board = A.getBoard(DATE);
const cleaners = STAFF.slice(1, 9), checkers = [STAFF[0], STAFF[5]];
const t = (h, m) => new Date(2026, 8, 29, h, m);
let k = 0;
board.rooms.forEach(r => {
  const row = A.findLogRow_(log, DATE, r.room);
  const target = ['OUT','STAY','FULL'].indexOf(r.kbn) >= 0;
  const isDD = ['404','505','614'].indexOf(r.room) >= 0;
  if (isDD) { log.getRange(row, 18).setValue(true); log.getRange(row, 36).setValue('要'); }
  if (!target && !isDD) return;
  const who = cleaners[k % cleaners.length], chk = checkers[k % 2];
  const s0 = 10*60 + (k*3) % 270, dur = isDD ? 5 : (r.kbn==='OUT' ? 28 : 18);
  const s1 = s0 + dur, c0 = s1 + 5, c1 = c0 + 6;
  log.getRange(row, 10, 1, 4).setValues([[who, t(0,s0), t(0,s1), dur]]);
  log.getRange(row, 14, 1, 4).setValues([[chk, t(0,c0), t(0,c1), 6]]);
  k++;
});

// ⑤ 日報（客室清掃日報＋責任者業務日報）、フロアレポート、特別清掃シート
const day = A.buildDailyReport(DATE);
const fr = A.buildFloorReport(DATE);
const sp = A.buildSpecialSheet('2026-09');
console.log('\n■ やり残し', JSON.stringify(day.pending));
console.log('■ フロアレポート', fr.floors.length + '階', fr.pdfError ? '（PDF：' + fr.pdfError + '）' : '');
fs.writeFileSync('book.json', JSON.stringify(ss.sheets.map(s => ({ name: s.name, hidden: s.hidden,
  cells: s.cells, fmt: s.fmt, merges: s.merges, rowH: s.rowH, colW: s.colW, hiddenRows: [...s.hiddenRows],
  maxCols: s.maxCols }))));
const dl = ss.getSheetByName('日報ログ');
const H = dl.getRange(1,1,1,19).getValues()[0], V = dl.getRange(dl.getLastRow(),1,1,19).getValues()[0];
console.log('■ 日報ログ'); H.forEach((h,i)=>console.log('  '+h+'：'+(V[i] instanceof Date ? 'date' : V[i])));
