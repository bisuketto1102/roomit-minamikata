/*************************************************
 * シフト表 → 名簿（スタッフシート）。サウス（hotel-cleaning-app）と同じ仕組み
 *
 * 会社のシフト表「清掃員シフト 2026年」の当月タブ（2026年10月 など）から、
 * 南方の人を名簿に入れる。シフトから消えた人は「退職」にする。
 * 年が替わると新しいスプレッドシートになるので、ファイル名で探す。
 *
 * シフト表の形：A列に名前（1人2行。下の行は時間）、B列に施設（南方）、C列から日ごと。
 * 名前の欄には「（チェック可）」「(火、木、土、日)」「\n社員 ベトナム」などの書き込みが混ざる。
 *
 * 毎朝4時台に自動で反映する（syncStaffFromShift）。
 * 自動のときは、退職が多すぎたら（シフト表の形が変わった等）反映せず止める。
 * 管理画面からは中身を確かめてから反映できる。
 *************************************************/
const SHIFT_FACILITY  = '南方';
const SHIFT_ROLE_WORDS = ['社員', '正社員', 'パート', 'アルバイト', 'バイト', '派遣', 'リーダー', 'サブリーダー', '責任者', 'チェッカー', '研修', '研修中', '新人'];
const SHIFT_HELPER = '応援';   // 南方の名簿には今は無い。手で「応援」と書いた人は触らない
const SHIFT_MIN_NAMES = 5;      // これより少なければ読み取り失敗とみなして何もしない
const SHIFT_AUTO_MAX_RETIRE = 0.3;   // 自動のとき、在籍の3割を超える退職は止める（3人までは通す）
function shiftTitle_(y) { return '清掃員シフト ' + y + '年'; }

/** その年のシフト表を開く。見つけたIDは覚えておく */
function shiftFile_(year) {
  const p = props_(), key = 'SHIFT_SS_' + year;
  const id = p.getProperty(key);
  if (id) { try { return SpreadsheetApp.openById(id); } catch (e) {} }

  const title = shiftTitle_(year);
  const it = DriveApp.searchFiles('title = "' + title + '" and mimeType = "application/vnd.google-apps.spreadsheet" and trashed = false');
  let best = null;
  while (it.hasNext()) {
    const f = it.next();
    if (!best || f.getLastUpdated() > best.getLastUpdated()) best = f;
  }
  if (!best) throw new Error('シフト表「' + title + '」がドライブに見つかりません');
  p.setProperty(key, best.getId());
  return SpreadsheetApp.openById(best.getId());
}

/** シフト表の名前欄から名前だけ取り出す。空白は全角1つにそろえる */
function cleanShiftName_(raw) {
  let s = String(raw == null ? '' : raw).split(/\r?\n/)[0];
  s = s.replace(/[（(][^）)]*[）)]/g, ' ');   // （チェック可）(火、木) （G） など
  s = s.replace(/※.*$/, '');                 // ※10/2退職 など
  const t = s.split(/[\s　]+/).filter(Boolean);
  // 末尾の「平日週4」「11.4-11」など・同じ行に書き足した立場（「上井 勇輔 社員」など）
  while (t.length && (/[0-9０-９]/.test(t[t.length - 1]) || (t.length > 1 && SHIFT_ROLE_WORDS.indexOf(t[t.length - 1]) >= 0))) t.pop();
  return t.join('　');
}

/** 当月のシフト表から南方の人の名前を読む */
function readShiftNames_(when) {
  const d = when || new Date();
  const y = Number(Utilities.formatDate(d, 'Asia/Tokyo', 'yyyy'));
  const m = Number(Utilities.formatDate(d, 'Asia/Tokyo', 'M'));
  const ss = shiftFile_(y);
  const tab = y + '年' + m + '月';
  const sh = ss.getSheetByName(tab);
  if (!sh) throw new Error('シフト表「' + ss.getName() + '」に「' + tab + '」のタブがありません');

  const v = sh.getRange(1, 1, sh.getLastRow(), Math.min(sh.getLastColumn(), 40)).getDisplayValues();
  const seen = {}, names = [];
  v.forEach(r => {
    const raw = String(r[0] || '').trim();
    if (!raw) return;
    const own    = String(r[1] || '').trim() === SHIFT_FACILITY;               // 南方の欄の人
    const visits = r.slice(2, 34).some(c => String(c).indexOf(SHIFT_FACILITY) >= 0);   // 他の欄でも南方の日がある人
    if (!own && !visits) return;
    const n = cleanShiftName_(raw), k = nameKey_(n);
    if (!k || seen[k]) return;
    seen[k] = 1; names.push(n);
  });
  return { file: ss.getName(), url: ss.getUrl(), tab: tab, names: names };
}

/** 名簿とシフト表を比べて、何を変えるかだけ決める（書き込まない） */
function planShiftSync_(shift0) {
  const shift = shift0 || readShiftNames_();
  if (shift.names.length < SHIFT_MIN_NAMES) {
    throw new Error('「' + shift.tab + '」の南方の名前が ' + shift.names.length + ' 人しか読めませんでした。シフト表の形が変わっていないか確認してください');
  }
  const inShift = {};
  shift.names.forEach(n => inShift[nameKey_(n)] = n);

  const sh = ss_().getSheetByName(SHEET.STAFF);
  const last = sh.getLastRow();
  const rows = last < 2 ? [] : sh.getRange(2, 1, last - 1, 2).getValues();
  const known = {}, add = [], retire = [], back = [];
  let active = 0;
  rows.forEach((r, i) => {
    const n = String(r[0] || '').trim(), st = String(r[1] || '').trim(), k = nameKey_(n);
    if (!k) return;
    known[k] = 1;
    const on = !!inShift[k];
    if (st === '退職' || st === SHIFT_HELPER) { if (on) back.push({ row: i + 2, name: n }); return; }
    active++;
    if (!on) retire.push({ row: i + 2, name: n });
  });
  shift.names.forEach(n => { if (!known[nameKey_(n)]) add.push(n); });

  return { file: shift.file, url: shift.url, tab: shift.tab, shiftCount: shift.names.length,
           active: active, add: add, retire: retire, back: back };
}

/** 決めた内容を名簿に書く */
function writeShiftSync_(plan) {
  const sh = ss_().getSheetByName(SHEET.STAFF);
  const stamp = 'シフト ' + today_() + ' ';
  if (!sh.getRange(1, 4).getValue()) sh.getRange(1, 3, 1, 2).setValues([['（空き）', 'シフト連携']]).setFontWeight('bold');
  plan.retire.forEach(x => sh.getRange(x.row, 2, 1, 3).setValues([['退職', '', stamp + 'シフトに無いため退職']]));
  plan.back.forEach(x   => sh.getRange(x.row, 2, 1, 3).setValues([['在籍', '', stamp + 'シフトに戻ったため在籍']]));
  if (plan.add.length) {
    const r0 = sh.getLastRow() + 1;
    sh.getRange(r0, 3, plan.add.length, 1).setNumberFormat('@');
    sh.getRange(r0, 1, plan.add.length, 4).setValues(plan.add.map(n => [n, '在籍', '', stamp + '追加']));
  }
}

function shortPlan_(plan, status, msg) {
  return { at: Utilities.formatDate(new Date(), 'Asia/Tokyo', 'yyyy-MM-dd HH:mm'), status: status, msg: msg || '',
           file: plan ? plan.file : '', tab: plan ? plan.tab : '', url: plan ? plan.url : '',
           add: plan ? plan.add : [], retire: plan ? plan.retire.map(x => x.name) : [],
           back: plan ? plan.back.map(x => x.name) : [] };
}
function saveShiftLast_(o) {
  try { props_().setProperty('SHIFT_LAST', JSON.stringify(o).slice(0, 8000)); } catch (e) {}
}

/** 管理画面：反映する前に中身を見る */
function previewShiftSync(pin) {
  needAdmin_(pin);
  const p = planShiftSync_();
  return Object.assign(shortPlan_(p, 'preview'), { shiftCount: p.shiftCount, active: p.active, last: getShiftLast_() });
}

/** 管理画面：確かめたうえで反映する。毎朝の自動反映もここで有効にする */
function applyShiftSync(pin) {
  needAdmin_(pin);
  // シフト表（外のファイル）はロックの外で読む。業務中に押しても打刻を待たせない
  const shift = readShiftNames_();
  return withLock_(() => {
    const p = planShiftSync_(shift);
    writeShiftSync_(p);
    const o = shortPlan_(p, 'applied', '管理画面から反映');
    saveShiftLast_(o);
    setupShiftTrigger_();
    return o;
  });
}

/** 毎朝の自動反映（トリガーから呼ばれる） */
function syncStaffFromShift() {
  let p;
  try {
    p = planShiftSync_();
  } catch (e) {
    saveShiftLast_(shortPlan_(null, 'error', e.message));
    return;
  }
  const limit = Math.max(3, Math.floor(p.active * SHIFT_AUTO_MAX_RETIRE));
  if (p.retire.length > limit) {
    saveShiftLast_(shortPlan_(p, 'stopped',
      '退職になる人が ' + p.retire.length + ' 人と多いので自動では反映していません。管理画面で確かめてから反映してください'));
    return;
  }
  if (!p.add.length && !p.retire.length && !p.back.length) {
    saveShiftLast_(shortPlan_(p, 'nochange', '変更なし'));
    return;
  }
  withLock_(() => writeShiftSync_(p));
  saveShiftLast_(shortPlan_(p, 'applied', '自動で反映'));
}

/** 管理画面：前回の反映の結果 */
function getShiftLast(pin) { needAdmin_(pin); return getShiftLast_(); }
function getShiftLast_() {
  try { return JSON.parse(props_().getProperty('SHIFT_LAST') || 'null'); } catch (e) { return null; }
}

/** 毎朝4時台に自動で反映する */
function setupShiftTrigger_() {
  const has = ScriptApp.getProjectTriggers().some(t => t.getHandlerFunction() === 'syncStaffFromShift');
  if (has) return;
  ScriptApp.newTrigger('syncStaffFromShift').timeBased().atHour(4).everyDays(1).inTimezone('Asia/Tokyo').create();
}
// 外から呼ばれて自動処理が止まらないよう非公開。止めるときはGASの「トリガー」画面で消す
function removeShiftTrigger_() {
  ScriptApp.getProjectTriggers().forEach(t => {
    if (t.getHandlerFunction() === 'syncStaffFromShift') ScriptApp.deleteTrigger(t);
  });
}

/** 名前の比較用。空白・長音・中点・全角半角・英字の大文字小文字の違いは同じ人とみなす */
function nameKey_(s) {
  return String(s == null ? '' : s).normalize('NFKC').toLowerCase().replace(/[\s　ー－\-・･.]+/g, '');
}
