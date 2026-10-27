const fs = require('fs'), vm = require('vm');
const { env } = require('./gasmock.js');
const D = require('./data0929.js');
const ctx = vm.createContext(env);
const code = fs.readFileSync('' + require('path').join(__dirname, '../') + 'Code.js','utf8') + '\n' +
             fs.readFileSync('' + require('path').join(__dirname, '../') + 'ApaIndicator.js','utf8');
vm.runInContext(code + "\n;/* テスト：管理用の関数は暗証番号なしで中身を直接呼ぶ */ ['mergeAll','getSaved','saveDayNote','getDayNote','saveImport','addOrder','setOrder','getOrders','getRoomAdmin','setRoomAdmin','getReport','getSummary','getSpecial','getStale','setSpecialNames','buildSpecialSheet','buildDailyReport','buildFloorReport','buildManagerReport','getDeclarationText','readIndicator','readIndicatorCrops','readOrder','readDouble','mergeSheets','resortLog'].forEach(n => { this[n] = this[n + '_']; });\n" + `
;globalThis.__api = { initSpreadsheet, crossCheck_, normOrder_, normDouble_, mergeAll, saveImport, getBoard,
  clockStart, clockFinish, clockOnce, clockUndo, clockReopen, setRoomFlag1, setRoomFlags, setCollectCheck, addOrder, setOrder, getOrders,
  getRoomAdmin, setRoomAdmin, getSummary, today_, ss_, NCOL, LOG_HEAD, buildFloorReport, buildDailyReport, setRoomCode,
  getReport, resetSS: () => { SS_CACHE_ = null; }, archiveOldLogs, KEEP_MONTHS };`, ctx);
const A = ctx.__api, ok = (c, m) => console.log((c ? '  OK ' : '  NG ') + m);
const T = A.today_();

// 古い版（45列）のシートを再現 → 新しい版で開いたら列が足りるか
A.initSpreadsheet();
const ss = A.ss_();
const log = ss.getSheetByName('打刻ログ');
log.maxCols = 45; log.getRange(1,1,1,45).setValues([A.LOG_HEAD.slice(0,45)]); delete log.cells['1,46'];
ss.getSheetByName('スタッフ').getRange(2,1,2,2).setValues([['上井 勇輔','在籍'],['川原 なつみ','在籍']]);
env.CacheService.getScriptCache().removeAll && 0;
// キャッシュを空にしてから開き直す
const MC = require('./gasmock.js').cache; for (const k of Object.keys(MC)) delete MC[k];
A.resetSS();
const rooms = [];
Object.keys(D.IND).forEach(f => D.IND[f].forEach(c => { if (!c) return; const [room, code] = c.split(' ');
  rooms.push({ room, code, reserved: code.indexOf('*')>=0, hand: false, uncertain: [] }); }));
const parsed = { rooms, counts: D.BOX };
const res = A.mergeAll(A.crossCheck_(parsed, JSON.parse(JSON.stringify(parsed))), A.normOrder_(D.ORDER), A.normDouble_(D.DOUBLE));
A.ss_().getSheetByName('打刻ログ').maxRows = 100;
A.saveImport(T, JSON.parse(JSON.stringify(res.rooms)));
const L = A.ss_().getSheetByName('打刻ログ');


const B = A.getBoard(T);
const full = B.rooms.find(r => r.kbn === 'FULL').room;
const stay = B.rooms.filter(r => r.kbn === 'STAY' && !r.dd && !r.fullClean).map(r => r.room);
console.log('■ 帳票の数え方（見直し2）');
// フルの部屋が清掃不要→DD。DDセット・DD確認まで済んでも強制交換・実質に入れない
A.setRoomFlag1(full, { skip: true });
let r = A.getBoard(T).rooms.find(x => x.room === full); ok(r.dd && r.skip, full + ' 清掃不要でDDも立つ');
A.clockOnce(full, '上井 勇輔', 'clean'); A.clockOnce(full, '川原 なつみ', 'check');
// 清掃不要の部屋はDDを外せない
r = A.setRoomFlag1(stay[0], { skip: true }); r = A.setRoomFlag1(stay[0], { dd: false }); ok(r.dd && r.skip, stay[0] + ' 清掃不要の間はDDを外せない');
A.setRoomFlags([stay[1]], { skip: true }); A.setRoomFlags([stay[1]], { dd: false });
ok(A.getBoard(T).rooms.find(x => x.room === stay[1]).dd, 'まとめての DD解除でも外れない');
// メモ：消したら日報の備考からも消える
A.setRoomFlag1(stay[2], { memo: '忘れ物あり' });
let d = A.buildDailyReport(T);
const memoCells = () => { const sh = A.ss_().getSheetByName('日報'); return sh.getRange(1, 1, sh.getLastRow(), 1).getValues().map(x => String(x[0])); };
ok(memoCells().some(x => x.indexOf(stay[2] + '　忘れ物あり') === 0), '備考に現場メモ');
A.setRoomFlag1(stay[2], { memo: '' });
d = A.buildDailyReport(T);
ok(!memoCells().some(x => x.indexOf('忘れ物あり') >= 0), '現場メモを消したら備考からも消える');
const dsh = A.ss_().getSheetByName('日報'), all = dsh.getRange(1, 1, 20, 18).getValues();
const find = lab => { for (const row of all) for (let i = 0; i < row.length; i++) if (row[i] === lab) return row[i + 3]; return null; };
ok(find('強制交換') === 0, 'DDになったフルは強制交換に入らない（チェック済みは0室） ' + find('強制交換'));
const ddN = A.getBoard(T).rooms.filter(x => x.dd || x.skip).length; ok(find('未清掃数') === ddN && ddN >= 3, '未清掃 = DD・清掃不要の部屋 ' + ddN + ' = ' + find('未清掃数'));
// 記録の無い日は作らない
try { A.buildDailyReport('2000-01-01'); ok(false, '作ってはいけない'); } catch (e) { ok(/記録がありません/.test(e.message), '記録の無い日の日報は作らない'); }
// 申告文・集計表：清掃不要もトータルに入る
const rep = A.getReport(T); ok(rep.all.total === 179, '集計のトータルは清掃不要があっても179 ' + rep.all.total);
