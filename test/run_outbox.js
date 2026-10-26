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

const hm = ms => { const d = new Date(ms), p = n => String(n).padStart(2,'0'); return p(d.getHours()) + ':' + p(d.getMinutes()); };
const NOW = Date.now(), MIN = 60000;
const B = A.getBoard(T);
console.log('■ 時計'); ok(typeof B.now === 'number' && Math.abs(B.now - NOW) < 5000, 'getBoard に now');
const outs = B.rooms.filter(r => r.code === 'D' && r.kbn === 'OUT').map(r => r.room);
const [o1, o2, o3, o4] = outs;

console.log('■ 押した時刻で記録');
let r = A.clockStart(o1, '上井 勇輔', 'clean', NOW - 30 * MIN);
ok(r.clean.start === hm(NOW - 30 * MIN) && r.code === 'O', o1 + ' 入室 ' + r.clean.start + '（30分前）');
const rev1 = r.__rev;
r = A.clockStart(o1, '上井 勇輔', 'clean', NOW - 30 * MIN);
ok(r.clean.start === hm(NOW - 30 * MIN) && r.__rev === rev1, '同じ入室が2回届いても1回（revも進まない）');
try { A.clockStart(o1, '川原 なつみ', 'clean', NOW - 29 * MIN); ok(false, '別の人の入室は断る'); } catch (e) { ok(/作業中/.test(e.message), '別の人の送り直し入室は断る：' + e.message); }
r = A.clockFinish(o1, '上井 勇輔', 'clean', NOW - 10 * MIN);
ok(r.clean.finish === hm(NOW - 10 * MIN) && r.clean.minutes === 20, '退出 ' + r.clean.finish + ' ' + r.clean.minutes + '分');
r = A.clockFinish(o1, '上井 勇輔', 'clean', NOW - 10 * MIN); ok(r.clean.minutes === 20, '退出の二重は成功扱い');
try { A.clockFinish(o1, '上井 勇輔', 'clean'); ok(false, '通常の二重退出は断る'); } catch (e) { ok(/完了/.test(e.message), '通常の二重退出は今まで通り断る'); }

console.log('■ 入室より前の退出（送り直し）は付けない');
A.clockStart(o2, '川原 なつみ', 'clean');
try { A.clockFinish(o2, '上井 勇輔', 'clean', NOW - 20 * MIN); ok(false, '断るべき'); } catch (e) { ok(/別の人が入室|さんの作業/.test(e.message), e.message); }
ok(A.getBoard(T).rooms.find(x => x.room === o2).clean.state === 'doing', o2 + ' は作業中のまま');

console.log('■ 取り消しの送り直し');
A.clockStart(o3, '上井 勇輔', 'clean', NOW - 15 * MIN);
r = A.clockUndo(o3, 'clean', NOW - 14 * MIN, '上井 勇輔'); ok(r.clean.state === 'todo', '入室→取り消し');
r = A.clockUndo(o3, 'clean', NOW - 14 * MIN, '上井 勇輔'); ok(r.clean.state === 'todo', '取り消しの二重は成功扱い');
A.clockStart(o3, '川原 なつみ', 'clean');
try { A.clockUndo(o3, 'clean', NOW - 14 * MIN, '上井 勇輔'); ok(false, '後から入った入室を消してはいけない'); } catch (e) { ok(/入室し直|さんの作業/.test(e.message), e.message); }
ok(A.getBoard(T).rooms.find(x => x.room === o3).clean.staff === '川原 なつみ', '川原さんの入室は残る');
A.clockFinish(o3, '川原 なつみ', 'clean');
try { A.clockReopen(o3, 'clean', NOW - 14 * MIN, '川原 なつみ'); ok(false, '後の退出は戻さない'); } catch (e) { ok(/退出し直/.test(e.message), e.message); }

console.log('■ 時間の上限');
try { A.clockStart(o4, '上井 勇輔', 'clean', NOW - 37 * 3600 * 1000); ok(false, '古すぎ'); } catch (e) { ok(/時間がたちすぎ/.test(e.message), '37時間前は断る'); }
r = A.clockStart(o4, '上井 勇輔', 'clean', NOW + 60 * MIN); ok(r.clean.start === hm(Date.now()), '先の時刻は今にする ' + r.clean.start);

console.log('■ DDセット・回収・確認');
const st = B.rooms.find(x => x.kbn === 'STAY' && !x.fullClean).room;
A.setRoomFlag1(st, { skip: true, dd: true }, NOW - 40 * MIN);
r = A.clockOnce(st, '上井 勇輔', 'clean', NOW - 40 * MIN); ok(r.clean.start === hm(NOW - 40 * MIN) && r.clean.state === 'done', 'セット済 ' + r.clean.start);
r = A.clockOnce(st, '上井 勇輔', 'clean', NOW - 40 * MIN); ok(r.clean.state === 'done', 'セット済の二重は成功扱い');
try { A.clockOnce(st, '川原 なつみ', 'clean', NOW - 39 * MIN); ok(false, '別の人'); } catch (e) { ok(/セット済/.test(e.message), '別の人の送り直しは断る'); }
r = A.setRoomFlag1(o1, { pickup: true, __by: '上井 勇輔' }, NOW - 9 * MIN);
ok(r.pickupBy === '上井 勇輔 ' + hm(NOW - 9 * MIN), '回収は押した時刻 ' + r.pickupBy);
r = A.setRoomFlag1(o1, { pickup: true, __by: '川原 なつみ' }, NOW - 5 * MIN); ok(r.pickupBy === '上井 勇輔 ' + hm(NOW - 9 * MIN), '回収の二重は最初のまま');
r = A.setCollectCheck(o1, '川原 なつみ', true, NOW - 8 * MIN); ok(r.collectOk === '川原 なつみ ' + hm(NOW - 8 * MIN), '確認 ' + r.collectOk);
r = A.setCollectCheck(o1, '上井 勇輔', true, NOW - 2 * MIN); ok(r.collectOk === '川原 なつみ ' + hm(NOW - 8 * MIN), '確認の二重は最初のまま');
r = A.setRoomFlag1(o1, { pickup: false }); ok(!r.pickupBy && !r.collectOk, '外すと消える');

console.log('■ まとめて操作');
let bd = A.setRoomFlags([o2, o3], { dd: true }, NOW - 3 * MIN); ok(bd.rooms.filter(x => (x.room === o2 || x.room === o3) && x.dd).length === 2, 'DD 2室');
bd = A.setRoomCode([outs[5]], 'O', NOW - 3 * MIN); ok(bd.rooms.find(x => x.room === outs[5]).code === 'O', 'アウト済');

console.log('■ 断られた入室のあとの送り直し（別の人の作業に付けない・消さない）');
const [p1, p2, p3, p4] = outs.slice(8);
A.clockStart(p1, '川原 なつみ', 'clean', NOW - 40 * MIN);
try { A.clockFinish(p1, '上井 勇輔', 'clean', NOW - 5 * MIN); ok(false, '付けてはいけない'); } catch (e) { ok(/さんの作業/.test(e.message), '退出は付けない：' + e.message); }
ok(A.getBoard(T).rooms.find(x => x.room === p1).clean.state === 'doing', p1 + ' は川原さんの作業中のまま');
A.clockStart(p2, '川原 なつみ', 'clean', NOW - 40 * MIN);
try { A.clockUndo(p2, 'clean', NOW - 5 * MIN, '上井 勇輔'); ok(false, '消してはいけない'); } catch (e) { ok(/さんの作業/.test(e.message), '取り消しは消さない'); }
ok(A.getBoard(T).rooms.find(x => x.room === p2).clean.staff === '川原 なつみ', p2 + ' 川原さんのまま');
A.clockFinish(p2, '川原 なつみ', 'clean');
try { A.clockFinish(p2, '上井 勇輔', 'clean', NOW - 1 * MIN); ok(false, '成功に見せない'); } catch (e) { ok(/さんの作業/.test(e.message), '完了済みでも別の人の退出は断る（赤い!が出る）'); }
try { A.clockReopen(p2, 'clean', NOW + 0, '上井 勇輔'); ok(false, '戻さない'); } catch (e) { ok(/さんの作業/.test(e.message), '作業中に戻すも本人だけ'); }
r = A.clockReopen(p2, 'clean', Date.now(), '川原 なつみ'); ok(r.clean.state === 'doing', '本人の作業中に戻すは通る');
const st2 = B.rooms.filter(x => x.kbn === 'STAY' && !x.fullClean && x.room !== st)[0].room;
A.setRoomFlag1(st2, { skip: true, dd: true });
A.clockStart(st2, '川原 なつみ', 'clean', NOW - 20 * MIN);
try { A.clockOnce(st2, '上井 勇輔', 'clean', NOW - 40 * MIN); ok(false, 'DDセット済を付けない'); } catch (e) { ok(/入室中/.test(e.message), 'DDセット済も別の人の入室には付けない'); }
r = A.clockOnce(st2, '川原 なつみ', 'clean', NOW - 10 * MIN); ok(r.clean.state === 'done' && r.clean.minutes === 10, '本人のセット済は付く ' + r.clean.minutes + '分');
console.log('■ 古い「外す」で新しい回収を消さない');
A.setRoomFlag1(p3, { pickup: true, __by: '川原 なつみ' });
r = A.setRoomFlag1(p3, { pickup: false, __by: '上井 勇輔' }, NOW - 3 * MIN); ok(r.pickup && /川原/.test(r.pickupBy), '川原さんの回収は残る ' + r.pickupBy);
r = A.setRoomFlag1(p3, { pickup: false, __by: '川原 なつみ' }, NOW - 1 * MIN); ok(!r.pickup && !r.pickupBy, '本人の外すは効く');
console.log('■ 遅れて届いた「アウト前に戻す」');
A.clockStart(p4, '上井 勇輔', 'clean');
bd = A.setRoomCode([p4, outs[20]], 'D', NOW - 5 * MIN);
ok(bd.rooms.find(x => x.room === p4).code === 'O', p4 + ' 清掃に入った部屋は O のまま');
