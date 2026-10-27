// シフト表 → 名簿（南方）。シフト表はにせものを渡す
const fs = require('fs'), vm = require('vm'), path = require('path');
const { env } = require('./gasmock.js');
const ctx = vm.createContext(env);
vm.runInContext(['Code.js', 'ApaIndicator.js', 'Shift.js'].map(f => fs.readFileSync(path.join(__dirname, '..', f), 'utf8')).join('\n'), ctx);
const ok = (c, m) => console.log((c ? '  OK ' : '  NG ') + m);
const call = (n, a) => vm.runInContext(n, ctx)(...a);
call('initSpreadsheet', []);
const st = call('ss_', []).getSheetByName('スタッフ');
st.getRange(2, 1, 4, 2).setValues([['上井 勇輔', '在籍'], ['川原 なつみ', '在籍'], ['辞めた 人', '在籍'], ['戻る 人', '退職']]);
let GRID = [];
ctx.shiftFile_ = () => ({ getName: () => '清掃員シフト 2026年', getUrl: () => 'u',
  getSheetByName: () => ({ getLastRow: () => GRID.length, getLastColumn: () => 34,
    getRange: () => ({ getDisplayValues: () => GRID.map(r => r.concat(Array(34).fill('')).slice(0, 34)) }) }) });
const row = (n, f, days) => [n, f].concat(days || []);
GRID = [row('氏名', '施設'), row('上井　勇輔（チェック可）', '南方'), row('9-17', ''), row('川原 なつみ 社員', '南方'),
        row('戻る 人／ベッド', '南方'), row('新しい 人 平日週4', '南方'), row('サウスの 人', 'サウス'), row('手伝い 人', 'サウス', ['', '南方']),
        row('A', '南方'), row('B', '南方'), row('11.4-11', '南方')];
console.log('■ シフト表と照らし合わせ');
const p = call('planShiftSync_', []);
ok(p.add.join(',') === '新しい　人,手伝い　人,A,B', '追加 ' + p.add.join(','));
ok(p.retire.map(x => x.name).join(',') === '辞めた 人', '退職 ' + p.retire.map(x => x.name));
ok(p.back.map(x => x.name).join(',') === '戻る 人', '在籍に戻す ' + p.back.map(x => x.name));
const before0 = call('getStaffList', []).join('/');
call('syncStaffFromShift', []);
ok(call('getStaffList', []).join('/') === before0, '管理画面で一度反映するまでは、自動の反映は何もしない');
call('props_', []).setProperty('SHIFT_AUTO_ON', '1');
call('syncStaffFromShift', []);
const names = call('getStaffList', []);
ok(names.indexOf('辞めた 人') < 0 && names.indexOf('戻る 人') >= 0 && names.indexOf('新しい　人') >= 0 && names.indexOf('サウスの　人') < 0, '名簿 ' + names.join('/'));
ok(JSON.parse(call('props_', []).getProperty('SHIFT_LAST')).status === 'applied', '前回の結果を残す');
console.log('■ 読めないときは触らない');
GRID = [row('上井 勇輔', '南方')];
call('syncStaffFromShift', []);
ok(call('getStaffList', []).length === names.length && JSON.parse(call('props_', []).getProperty('SHIFT_LAST')).status === 'error', '5人未満は止める');

console.log('■ 応援の人');
{
  const r = call('addHelper', ['応援 一郎、応援　二郎\n上井勇輔、応援 一郎']);
  ok(r.names.join('/') === '応援 一郎/応援 二郎/上井 勇輔', '何人でも一度に・名簿の人は名簿の表記・だぶりは1回 ' + r.names.join('/'));
  const L = call('getStaffList', []);
  ok(L.indexOf('応援 一郎') >= 0 && L.indexOf('応援 二郎') >= 0 && L.filter(n => n === '上井 勇輔').length === 1, '今日の名簿に出る');
  const rows = st.getRange(2, 1, st.getLastRow() - 1, 3).getValues();
  const h = rows.filter(x => x[1] === '応援');
  ok(h.length === 2 && h.every(x => x[2] === call('today_', [])), '応援・今日の日付（文字）で2行');
  const i = rows.findIndex(x => x[0] === '応援 一郎'); st.getRange(i + 2, 3).setValue('2026-01-01');
  ok(call('getStaffList', []).indexOf('応援 一郎') < 0, '別の日の応援は出ない');
  call('addHelper', ['応援一郎']); ok(call('getStaffList', []).indexOf('応援 一郎') >= 0 && st.getRange(2, 1, st.getLastRow() - 1, 1).getValues().filter(x => x[0] === '応援 一郎').length === 1, 'また来た日は日付だけ今日に（行は増えない）');
  GRID = [row('上井 勇輔', '南方'), row('川原 なつみ', '南方'), row('戻る 人', '南方'), row('新しい 人', '南方'), row('A', '南方'), row('B', '南方')];
  const p2 = call('planShiftSync_', []);
  ok(!p2.retire.some(x => /応援/.test(x.name)), 'シフト連携で応援の人は退職にしない');
  try { call('addHelper', ['<b>']); ok(false, '<> は断る'); } catch (e) { ok(true, '< > は断る'); }
}

console.log('■ 退職の人が応援で来て、またシフトに出ても1行だけ在籍に戻す');
{
  const r0 = st.getLastRow() + 1;
  st.getRange(r0, 1, 1, 2).setValues([['山本　かおり', '退職']]);
  call('addHelper', ['山本 かおり']);
  GRID = [row('上井 勇輔', '南方'), row('川原 なつみ', '南方'), row('戻る 人', '南方'), row('新しい 人', '南方'), row('A', '南方'), row('B', '南方'), row('山本　かおり', '南方')];
  const p3 = call('planShiftSync_', []);
  ok(p3.back.length === 1, '戻すのは1行 ' + p3.back.map(x => x.name).join('/'));
  call('syncStaffFromShift', []);
  ok(call('getStaffList', []).filter(n => call('nameKey_', [n]) === call('nameKey_', ['山本かおり'])).length === 1, '名簿には1人だけ');
}
