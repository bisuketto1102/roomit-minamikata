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
  resetSS: () => { SS_CACHE_ = null; }, archiveOldLogs, KEEP_MONTHS };`, ctx);
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
console.log('■ 列の補修'); ok(L.maxCols >= 46 && L.getRange(1,46).getValue() === '追加指示', '46列目「追加指示」' + L.maxCols);

console.log('■ 打刻');
const b = A.getBoard(T);
const d1 = b.rooms.find(r => r.code === 'D' && r.kbn === 'OUT').room;
let r = A.clockStart(d1, '上井 勇輔', 'clean');
ok(r.clean.state === 'doing' && r.code === 'O' && r.__rev > 0, d1 + ' 入室でD→O、rev ' + r.__rev);
r = A.clockFinish(d1, '上井 勇輔', 'clean'); ok(r.clean.state === 'done' && r.clean.minutes >= 1, '退出 ' + r.clean.minutes + '分');
r = A.clockStart(d1, '川原 なつみ', 'check'); r = A.clockFinish(d1, '川原 なつみ', 'check'); ok(r.check.state === 'done', 'チェック完了');
try { A.clockUndo(d1, 'clean'); ok(false, '取り消しを止めるべき'); } catch (e) { ok(/チェック/.test(e.message), '清掃取消はチェック後に止まる'); }
console.log('■ 時刻の列が文字のまま'); 
const eIn = b.rooms.find(x => x.dueIn); r = A.clockStart(eIn.room, '上井 勇輔', 'clean'); ok(r.dueIn === eIn.dueIn, eIn.room + ' 締切 ' + r.dueIn);

console.log('■ 取り込み直しでアウト済を戻さない');
A.saveImport(T, JSON.parse(JSON.stringify(res.rooms)));
const after = A.getBoard(T).rooms; ok(after.find(x => x.room === d1).code === 'O', d1 + ' はO のまま');
ok(after.find(x => x.room === eIn.room).code === (eIn.code === 'D' ? 'O' : eIn.code), eIn.room + ' 清掃入室済 → ' + after.find(x => x.room === eIn.room).code);
ok(after.find(x => x.room === d1).clean.state === 'done', '打刻は残る');

console.log('■ DDセット1回押し');
const s1 = b.rooms.find(x => x.kbn === 'STAY' && !x.fullClean).room;
r = A.setRoomFlag1(s1, { skip: true, dd: true, supply: '要' }); ok(r.dd && r.skip && r.supply === '要', s1 + ' 清掃不要→DD');
try { A.clockOnce(s1, '川原 なつみ', 'check'); ok(false,'セット前の確認は止める'); } catch(e){ ok(true, 'セット前の確認は止まる'); }
r = A.clockOnce(s1, '上井 勇輔', 'clean'); ok(r.clean.state === 'done' && r.clean.minutes === 0 && r.code !== 'O', 'セット済 code=' + r.code);
r = A.clockOnce(s1, '川原 なつみ', 'check'); ok(r.check.state === 'done', '確認済');
try { A.clockOnce(s1, '上井 勇輔', 'clean'); ok(false,'二重'); } catch(e){ ok(/セット済/.test(e.message), e.message); }

console.log('■ 回収');
r = A.setRoomFlag1(d1, { pickup: true, __by: '上井 勇輔' }); ok(r.pickup && /^上井 勇輔 \d\d:\d\d$/.test(r.pickupBy), 'ゴミ回収 ' + r.pickupBy);
r = A.setCollectCheck(d1, '川原 なつみ', true); ok(/^川原/.test(r.collectOk), '確認 ' + r.collectOk);
r = A.setRoomFlag1(d1, { pickup: false }); ok(!r.pickup && !r.pickupBy && !r.collectOk, '外すと記録も確認も消える');
r = A.setRoomFlag1(d1, { spAircon: true }); ok(r.spAircon, '特別清掃');
r = A.setRoomFlag1(d1, { memo: '1/2' }); ok(r.memo === '1/2', 'メモ ' + r.memo);

console.log('■ 追加指示');
let o = A.addOrder('405、1201 9999', 'タオル追加'); ok(o.added.length === 2 && o.missing[0] === '9999', JSON.stringify(o.added) + ' 無し' + o.missing);
o = A.addOrder(['405'], '枕2つ'); ok(o.orders.find(x => x.room === '405').order === 'タオル追加 / 枕2つ', '追記');
o = A.setOrder('1201', ''); ok(!o.orders.find(x => x.room === '1201'), '消す');
ok(A.getBoard(T).rooms.find(x => x.room === '405').order === 'タオル追加 / 枕2つ', '清掃員画面に載る');

console.log('■ 部屋を直す');
const a = A.getRoomAdmin('405'); ok(a.room === '405' && a.dmakeKinds.length > 0, '読み出し ' + a.code + '/' + a.kbn);
r = A.setRoomAdmin('405', { lateOut: '19:30' }); ok(r.kbn === 'NONE' && r.lateOut === '19:30', '19時半レイト→対象外');
r = A.setRoomAdmin('405', { lateOut: '' }); ok(r.kbn === 'OUT', '外すとアウトに戻る ' + r.kbn);
const st = b.rooms.find(x => x.kbn === 'STAY' && x.room !== s1 && !x.dd).room;
r = A.setRoomAdmin(st, { fullClean: true }); ok(r.kbn === 'FULL', st + ' フル→FULL');
r = A.setRoomAdmin(st, { code: 'V' }); ok(r.kbn === 'V', 'コードV→空室');
r = A.setRoomAdmin(st, { code: 'SD', fullClean: false, skip: true, dmake: '新規', twin: true, eco: true, order: 'x', note: 'n', memo: 'm' });
ok(r.kbn === 'STAY' && r.skip && r.dd && r.dmake === '新規' && r.twin && r.eco && r.order === 'x', 'まとめて');
try { A.setRoomAdmin(st, { code: 'ZZ' }); ok(false, ''); } catch(e){ ok(true, '不明コードは止める'); }

console.log('■ 人ごとの数');
const sm = A.getSummary(T); console.log('  ', JSON.stringify(sm.people));
console.log('■ 作成（二重実行防止の下で動く）');
const fr = A.buildFloorReport(T); ok(fr.floors.length === 11, 'フロアレポート');
const f4 = A.ss_().getSheetByName('フロアレポート 4F'); const vals = f4.getDataRange().getValues().flat().filter(v => /指示：/.test(String(v)));
ok(vals.length === 1, '備考 ' + vals[0]);
const dr = A.buildDailyReport(T); ok(!!dr, '日報');

console.log('■ 保管（1000行を超える移動）');
const LG = A.ss_().getSheetByName('打刻ログ'); const old = [];
for (let i = 0; i < 1300; i++) { const r = new Array(A.NCOL).fill(''); r[0] = '2026-01-' + String(1 + i % 28).padStart(2,'0'); r[1] = String(201 + i); old.push(r); }
LG.getRange(LG.getLastRow() + 1, 1, 0 || 1, 1); LG.maxRows += 1400;
LG.getRange(LG.getLastRow() + 1, 1, old.length, A.NCOL).setValues(old);
const ar = A.archiveOldLogs(); ok(ar.moved === 1300, '保管へ ' + ar.moved + '行 / 残り ' + ar.kept);
{ const left = LG.getRange(2, 1, LG.getLastRow() - 1, 2).getValues();
  ok(left.length === 179 && left.every(r => String(r[0]).indexOf('2026-01') < 0), '打刻ログには今日の179室だけ残る（後ろに付いた古い行も並べ替えて移す）');
  const AR = A.ss_().getSheetByName('打刻ログ_保管'); const av = AR.getRange(2, 1, AR.getLastRow() - 1, 2).getValues();
  ok(av.length === 1300 && av.every(r => String(r[0]).indexOf('2026-01') === 0), '保管に1300行');
  const bb = A.getBoard(T); ok(bb.rooms.length === 179, '移したあとも盤面は179室');
  const free = bb.rooms.find(x => x.kbn === 'STAY' && x.clean.state === 'todo' && !x.dd).room;
  const rr = A.clockStart(free, '上井 勇輔', 'clean'); ok(rr.room === free && rr.clean.state === 'doing', '移したあとも打刻できる ' + free);
  ok(A.archiveOldLogs().moved === 0, '2回目は何もしない'); }
{ // 保管に書いたあと、消す前に止まっていた場合：同じ行を保管に2回書かない
  const LG2 = A.ss_().getSheetByName('打刻ログ'), AR = A.ss_().getSheetByName('打刻ログ_保管');
  const before = AR.getLastRow();
  const o2 = []; for (let i = 0; i < 5; i++) { const r = new Array(A.NCOL).fill(''); r[0] = '2026-02-0' + (i + 1); r[1] = '2' + String(i + 1).padStart(2, '0'); o2.push(r); }
  AR.maxRows += 10; AR.getRange(AR.getLastRow() + 1, 1, 5, A.NCOL).setValues(o2);          // 保管には書けていた
  LG2.maxRows += 10; LG2.getRange(LG2.getLastRow() + 1, 1, 5, A.NCOL).setValues(o2);       // 打刻ログからは消せていなかった
  const a2 = A.archiveOldLogs();
  ok(a2.moved === 5 && AR.getLastRow() === before + 5 && LG2.getLastRow() - 1 === 179, '止まったあとの2回目：保管は5行のまま・打刻ログから5行消える'); }
