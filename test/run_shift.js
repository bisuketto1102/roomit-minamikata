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
GRID = [row('氏名', '施設'), row('上井　勇輔（チェック可）', '南方'), row('9-17', ''), row('川原 なつみ\n社員 ベトナム', '南方'),
        row('戻る 人', '南方'), row('新しい 人 平日週4', '南方'), row('サウスの 人', 'サウス'), row('手伝い 人', 'サウス', ['', '南方']),
        row('A', '南方'), row('B', '南方')];
console.log('■ シフト表と照らし合わせ');
const p = call('planShiftSync_', []);
ok(p.add.join(',') === '新しい　人,手伝い　人,A,B', '追加 ' + p.add.join(','));
ok(p.retire.map(x => x.name).join(',') === '辞めた 人', '退職 ' + p.retire.map(x => x.name));
ok(p.back.map(x => x.name).join(',') === '戻る 人', '在籍に戻す ' + p.back.map(x => x.name));
call('syncStaffFromShift', []);
const names = call('getStaffList', []);
ok(names.indexOf('辞めた 人') < 0 && names.indexOf('戻る 人') >= 0 && names.indexOf('新しい　人') >= 0 && names.indexOf('サウスの　人') < 0, '名簿 ' + names.join('/'));
ok(JSON.parse(call('props_', []).getProperty('SHIFT_LAST')).status === 'applied', '前回の結果を残す');
console.log('■ 読めないときは触らない');
GRID = [row('上井 勇輔', '南方')];
call('syncStaffFromShift', []);
ok(call('getStaffList', []).length === names.length && JSON.parse(call('props_', []).getProperty('SHIFT_LAST')).status === 'error', '5人未満は止める');
