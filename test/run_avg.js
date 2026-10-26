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
  getStaffAverages_, resetSS: () => { SS_CACHE_ = null; }, archiveOldLogs, KEEP_MONTHS };`, ctx);
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


const NOW = Date.now(), MIN = 60000;
const B = A.getBoard(T);
const by = k => B.rooms.filter(r => r.kbn === k && !r.dd).map(r => r.room);
const OUT = by('OUT'), STAY = by('STAY'), FULL = by('FULL');
const job = (room, who, task, startAgo, mins) => {
  A.clockStart(room, who, task, NOW - startAgo * MIN);
  A.clockFinish(room, who, task, NOW - (startAgo - mins) * MIN);
};
// 上井：アウト 20分・30分、ステイ 10分、フル 40分、押し忘れのアウト 90分
job(OUT[0], '上井 勇輔', 'clean', 300, 20);
job(OUT[1], '上井　 勇輔', 'clean', 270, 30);   // 空白違いの同じ人
job(STAY[0], '上井 勇輔', 'clean', 230, 10);
job(FULL[0], '上井 勇輔', 'clean', 210, 40);
job(OUT[2], '上井 勇輔', 'clean', 160, 90);
// 川原：清掃 アウト 26分、チェック アウト 5分・7分
job(OUT[3], '川原 なつみ', 'clean', 300, 26);
job(OUT[0], '川原 なつみ', 'check', 100, 5);
job(OUT[1], '川原 なつみ', 'check', 90, 7);
// DD：清掃不要→セット済（0分）は平均に入れない
const st = B.rooms.find(x => x.kbn === 'STAY' && !x.fullClean && x.room !== STAY[0]).room;
A.setRoomFlag1(st, { skip: true, dd: true });
A.clockOnce(st, '上井 勇輔', 'clean');

const a = A.getStaffAverages_(T, T);
const u = a.staff.find(p => p.name === '上井 勇輔'), k = a.staff.find(p => p.name === '川原 なつみ');
console.log('■ アベレージ');
ok(a.staff.length === 2, '空白違いは1人にまとめる：' + a.staff.map(p => p.name).join('/'));
ok(u.clean.OUT.n === 2 && u.clean.OUT.avg === 25 && u.clean.OUT.ex === 1, '上井 アウト 2室 平均25分 押し忘れ1 ' + JSON.stringify(u.clean.OUT));
ok(u.clean.STAY.avg === 10 && u.clean.FULL.avg === 40, 'ステイ10 フル40');
ok(u.cleanDone === 5 && u.ddSet === 1 && u.cleanPerDay === 5, '清掃 5室（押し忘れも数える）・DDセット1・1日あたり5 ' + u.cleanDone + '/' + u.ddSet + '/' + u.cleanPerDay);
ok(u.ex === 1, '押し忘れ? 1');
ok(k.check.OUT.n === 2 && k.check.OUT.avg === 6 && k.checkDone === 2 && k.cleanDone === 1, '川原 チェック アウト 2室 6分・清掃1室');
ok(a.team.clean.OUT.n === 3 && Math.abs(a.team.clean.OUT.avg - 25.3) < 0.01, '全体 清掃アウト 3室 ' + a.team.clean.OUT.avg);
ok(a.perDay.clean === 3 && a.perDay.check === 2, '全体 1人1日あたり 清掃3・チェック2 ' + JSON.stringify(a.perDay));
const none = A.getStaffAverages_('2000-01-01', '2000-01-02'); ok(none.staff.length === 0, '期間外は空');

console.log('■ 朝の確認用の JSON（?p=instr）');
{
  let out = null;
  env.ContentService = { MimeType: { JSON: 'json' }, createTextOutput: t => ({ setMimeType: () => (out = JSON.parse(t)) }) };
  vm.runInContext('globalThis.__instr = instrJson_', ctx);
  const j = ctx.__instr(T);
  ok(j.rooms.length === 179 && j.date === T, '179室');
  ok(!JSON.stringify(j).includes('上井') && !JSON.stringify(j).includes('川原'), '名前は入らない');
  const o0 = j.rooms.find(x => x.room === OUT[0]); ok(o0.cleanStarted && o0.code === 'O', '入室した部屋は cleanStarted');
  ok(j.note && 'allNotes' in j.note || j.note === null, '日次メモ ' + (j.note ? 'あり' : 'なし'));
}

console.log('■ 紙の写真をドライブに残す');
{
  const made = [];
  const file = n => { const id = 'id' + made.length; const f = { n, getId: () => id, getName: () => f.n, setName: x => { f.n = x; },
    isTrashed: () => false, getDateCreated: () => new Date(), setTrashed(){} }; made.push(f); return f; };
  const folder = { getId: () => 'F', isTrashed: () => false, createFile: b => file(b.getName()), getFiles: () => ({ hasNext: () => false }) };
  env.DriveApp.getFoldersByName = () => ({ hasNext: () => false });
  env.DriveApp.createFolder = () => folder; env.DriveApp.getFolderById = () => folder;
  env.DriveApp.getFileById = id => made[Number(String(id).slice(2))];
  env.Utilities.base64Decode = env.Utilities.base64Decode || (b => Buffer.from(b, 'base64'));
  env.Utilities.newBlob = env.Utilities.newBlob || ((d, mt, n) => ({ getName: () => n }));
  vm.runInContext("savePhoto_('eA==', 'image/jpeg', '清掃指示書'); savePhoto_('eQ==', 'application/pdf', 'ダブルメイク'); renamePendingPhotos_('2026-10-27')", ctx);
  ok(made.length === 2 && /^指示書_2026-10-27_清掃指示書_\w{6}\.jpg$/.test(made[0].n) && /^指示書_2026-10-27_ダブルメイク_\w{6}\.pdf$/.test(made[1].n), '写真 ' + made.map(f => f.n).join(' / '));
}
