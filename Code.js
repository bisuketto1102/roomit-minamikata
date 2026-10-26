/*************************************************
 * アパホテル〈新大阪 南方駅前〉 客室清掃 打刻アプリ
 * Code.gs — 打刻・保存・集計
 *
 * OCR は ApaIndicator.gs にある。こちらは触らない。
 *
 * 【版を差し替えたら】initSpreadsheet() を1回実行する。
 *   見出しを最新にそろえ、足りない列を後ろに足すだけ。シートの削除は要らない（記録は消えない）。
 *************************************************/

const SHEET = { LOG: '打刻ログ', STAFF: 'スタッフ', ARCHIVE: '打刻ログ_保管',
                DAY: '日次メモ', DLOG: '日報ログ' };

/** 打刻ログを何か月ぶん手元に置くか。過ぎたぶんは保管シートへ移す（消さない） */
const KEEP_MONTHS = 2;

/** 日報ログの見出し。ホテルへ出した数字をそのまま1日1行で残す */
const DLOG_HEAD = [
  '日付','清掃終了時間','メイク人数',
  '清掃指示数','アパエコ清掃数','アウト清掃数','強制交換','交換依頼',
  '使用済みバッグ回収数','未清掃数(DD)','実質稼働室数','除菌数','水設置','ゴミ箱回収数',
  'ロイヤル(増設含む)','新規増設Dメイク','増設Dメイク解除','ツイン数',
  '作成時刻'
];

/**
 * 日次メモ。部屋に紐づかない、その日ぜんぶに関わる情報を1日1行で残す。
 * 全室共通の注意は毎日ほぼ同じだが、その日だけの追記が入ることがあるので保存する。
 */
const DAY_HEAD = [
  '日付','清掃指示書の日付','作成者','清掃指示数',
  'コネクト開閉','全室共通の注意','Wメイクの注意書き',
  'ツイン','コネクト（Wメイク）','取込時刻'
];

/**
 * 打刻ログの列
 *   1 日付 / 2 部屋番号 / 3 階 / 4 コード / 5 区分 / 6 予約
 *   7 締切 / 8 IN時刻 / 9 レイトアウト
 *  10 清掃担当 / 11 清掃入室 / 12 清掃退出 / 13 清掃分
 *  14 チェッカー / 15 チェック入室 / 16 チェック退出 / 17 チェック分
 *  18 DD / 19 清掃不要 / 20 ノーメイク / 21 フル清掃 / 22 リネン交換依頼
 *  23 延泊 / 24 POP回収 / 25 水本数 / 26 冷蔵庫 / 27 リネン・ゴミ回収
 *  28 現場メモ / 29 指示書特記 / 30 取込時刻
 *  31-33 特別清掃 / 34 要確認メモ / 36 備品 / 37 バッグ回収 / 38 冷蔵庫(チェック)
 *  39 Dメイク / 40 ツイン / 41 コネクト / 42 エコ清掃
 *  43-45 回収の記録 / 46 追加指示
 */
const LOG_HEAD = [
  '日付','部屋番号','階','コード','区分','予約',
  '締切','IN時刻','レイトアウト',
  '清掃担当','清掃入室','清掃退出','清掃分',
  'チェッカー','チェック入室','チェック退出','チェック分',
  'DD','清掃不要','ノーメイク','フル清掃','リネン交換依頼',
  '延泊','POP回収','水本数','冷蔵庫','リネン・ゴミ回収',
  '現場メモ','指示書特記','取込時刻',
  '特掃エアコン','特掃排水溝','特掃TV裏',
  '要確認メモ',
  '(未使用)','備品','バッグ回収','冷蔵庫(チェック)',
  'Dメイク','ツイン','コネクト','エコ清掃',
  'ゴミ回収記録','バッグ回収記録','回収確認',
  '追加指示'
];
const NCOL = LOG_HEAD.length;

/** 工程の開始列。担当 / 入室 / 退出 / 分 の4列が並ぶ */
const TASK_COL = { clean: 10, check: 14 };
function taskName_(t) { return t === 'clean' ? '清掃' : 'チェック'; }

/** 指示書・インジケーター由来の列。取込のたびに上書きする */
const IMPORT_COLS = [3,4,5,6,7,8,9,20,21,22,23,24,29,34,39,40,41,42];

/** 現場でしか変わらない列。取込では触らない */
const FLAG_COL = {
  dd: 18, skip: 19, water: 25, fridge: 26, pickup: 27, memo: 28,
  spAircon: 31, spDrain: 32, spTv: 33,
  supply: 36, bag: 37, fridgeCheck: 38
};

/** 回収を押した人と時刻を残す列。「上井 10:32」の形 */
const COLLECT_COL = { pickup: 43, bag: 44, check: 45 };
const BOOL_FLAGS = ['dd','skip','pickup','spAircon','spDrain','spTv','bag'];

/** 業務中の追加指示（フロントなどから途中で来た指示）。取り込みでは触らない */
const ORDER_COL = 46;

/**
 * 特別清掃。月内に全室を1周するローテーション。
 * フロアレポートの「特別清掃」シートに対応する。
 *   キー / 表示名 / 打刻ログの列
 */
const SPECIAL = [
  ['spAircon', 31],
  ['spDrain',  32],
  ['spTv',     33]
];

/**
 * 1枠目・2枠目で選べる項目。ホテルの指定に合わせて毎月選び直す。
 * 3枠目は自由入力なのでここには入れない。
 */
const SPECIAL_CHOICES = [
  'エアコン掃除機',
  'エアコン水洗い',
  '排水溝',
  '換気扇',
  'ベッド下冷蔵庫裏埃除去',
  'ツインルーム空気清浄機 掃除機',
  'ツインルーム空気清浄機 水洗い',
  '換気口'
];

/** 設定がまだ無い月に使う名前 */
const SPECIAL_DEFAULT = ['エアコン掃除機', '排水溝', ''];

/** 全客室数。残数の計算に使う。部屋が増減したらここを直す */
const SPECIAL_TOTAL = 179;

/** 区分の表示名。集計の並び順もこの通り */
const KBN_LIST = [
  ['OUT',  'アウト'],
  ['STAY', 'ステイ'],
  ['FULL', 'フルメイク'],
  ['V',    '空室'],
  ['NONE', '対象外']
];
function kbnName_(k) {
  const f = KBN_LIST.filter(x => x[0] === k)[0];
  return f ? f[1] : '—';
}


/*************************************************
 * 基本
 *************************************************/
function props_() { return PropertiesService.getScriptProperties(); }

let SS_CACHE_ = null;
function ss_() {
  if (!SS_CACHE_) {
    SS_CACHE_ = SpreadsheetApp.openById(props_().getProperty('SS_ID'));
    ensureCols_(SS_CACHE_);
  }
  return SS_CACHE_;
}

/**
 * 列を後ろに足した版に差し替えたとき、initSpreadsheet() を忘れても止まらないようにする。
 * 打刻ログの列が足りなければ足して見出しをそろえる。確かめた結果は6時間覚えておく。
 */
function ensureCols_(ss) {
  const c = CacheService.getScriptCache(), key = 'NCOL_OK:' + NCOL;
  if (c.get(key)) return;
  const log = ss.getSheetByName(SHEET.LOG);
  if (log) {
    if (log.getMaxColumns() < NCOL) log.insertColumnsAfter(log.getMaxColumns(), NCOL - log.getMaxColumns());
    const h = log.getRange(1, 1, 1, NCOL).getValues()[0];
    if (h.some((x, i) => String(x) !== LOG_HEAD[i])) {
      log.getRange(1, 1, 1, NCOL).setValues([LOG_HEAD]).setFontWeight('bold');
      // 足した列（追加指示）と回収記録・メモは文字のまま残す
      const rows = Math.max(log.getMaxRows() - 1, 1);
      [28, 43, 44, 45, ORDER_COL].forEach(c => log.getRange(2, c, rows).setNumberFormat('@'));
    }
  }
  c.put(key, '1', 21600);
}

function today_() { return Utilities.formatDate(new Date(), 'Asia/Tokyo', 'yyyy-MM-dd'); }
function hm_(d)   { return d ? Utilities.formatDate(new Date(d), 'Asia/Tokyo', 'HH:mm') : ''; }

function normDate_(v) {
  if (v instanceof Date) return Utilities.formatDate(v, 'Asia/Tokyo', 'yyyy-MM-dd');
  return String(v).trim().replace(/\//g, '-');
}

function bool_(v) { return v === true || String(v).toUpperCase() === 'TRUE'; }

function cmpRoom_(a, b) {
  const na = parseInt(String(a).replace(/\D/g, ''), 10);
  const nb = parseInt(String(b).replace(/\D/g, ''), 10);
  if (!isNaN(na) && !isNaN(nb) && na !== nb) return na - nb;
  return a < b ? -1 : a > b ? 1 : 0;
}

function withLock_(fn) {
  const lock = LockService.getScriptLock();
  lock.waitLock(20000);
  try { return fn(); } finally { lock.releaseLock(); }
}
/** 時間のかかる作成を同時に2つ走らせない。打刻のロックとは別にする（打刻を待たせないため） */
function busyGuard_(key, fn) {
  const c = CacheService.getScriptCache();
  if (c.get(key)) throw new Error('作成中です。終わるまで1〜2分お待ちください');
  c.put(key, '1', 300);
  try { return fn(); } finally { c.remove(key); }
}


/*************************************************
 * ルーティング
 *************************************************/
/** HTMLファイルを差し込む。Index.html から Lang.html を読むのに使う */
function include(name) {
  return HtmlService.createHtmlOutputFromFile(name).getContent();
}

function doGet(e) {
  const page = (e && e.parameter && e.parameter.p) || 'staff';
  const file = page === 'admin' ? 'Admin' : page === 'test' ? 'Test' : 'Index';
  return HtmlService.createTemplateFromFile(file)
    .evaluate()
    .setTitle('客室清掃')
    .addMetaTag('viewport', 'width=device-width, initial-scale=1, maximum-scale=1, viewport-fit=cover')
    .setXFrameOptionsMode(HtmlService.XFrameOptionsMode.ALLOWALL);
}


/*************************************************
 * 初回セットアップ
 *************************************************/
function initSpreadsheet() {
  let ss;
  const existing = props_().getProperty('SS_ID');
  if (existing) ss = SpreadsheetApp.openById(existing);
  else {
    ss = SpreadsheetApp.create('アパ南方 客室清掃 打刻データ');
    props_().setProperty('SS_ID', ss.getId());
  }

  let log = ss.getSheetByName(SHEET.LOG);
  if (!log) log = ss.insertSheet(SHEET.LOG);
  // 見出しは毎回最新にそろえる（列を後ろに足しただけなら、シートを消さずにこれで済む）
  if (log.getMaxColumns() < NCOL) log.insertColumnsAfter(log.getMaxColumns(), NCOL - log.getMaxColumns());
  log.getRange(1, 1, 1, NCOL).setValues([LOG_HEAD]).setFontWeight('bold');
  log.setFrozenRows(1);

  const rows = Math.max(log.getMaxRows() - 1, 1);
  [11, 12, 15, 16].forEach(c => log.getRange(2, c, rows).setNumberFormat('HH:mm'));
  // 部屋番号・時刻・メモ・回収記録・追加指示は文字列固定
  [2, 7, 8, 9, 28, 43, 44, 45, ORDER_COL].forEach(c => log.getRange(2, c, rows).setNumberFormat('@'));

  let day = ss.getSheetByName(SHEET.DAY);
  if (!day) day = ss.insertSheet(SHEET.DAY);
  if (day.getLastRow() === 0) {
    day.getRange(1, 1, 1, DAY_HEAD.length).setValues([DAY_HEAD]).setFontWeight('bold');
    day.setFrozenRows(1);
    day.setColumnWidth(6, 420); day.setColumnWidth(5, 160);
  }

  let dlog = ss.getSheetByName(SHEET.DLOG);
  if (!dlog) dlog = ss.insertSheet(SHEET.DLOG);
  if (dlog.getLastRow() === 0) {
    dlog.getRange(1, 1, 1, DLOG_HEAD.length).setValues([DLOG_HEAD]).setFontWeight('bold');
    dlog.setFrozenRows(1);
  }

  let staff = ss.getSheetByName(SHEET.STAFF);
  if (!staff) {
    staff = ss.insertSheet(SHEET.STAFF);
    staff.getRange(1, 1, 1, 2).setValues([['氏名', '在籍']]).setFontWeight('bold');
    staff.setFrozenRows(1);
    staff.getRange(2, 1, 1, 2).setValues([['（ここに清掃員名）', '在籍']]);
  }

  Logger.log('スプレッドシート: ' + ss.getUrl());
  return ss.getUrl();
}


/*************************************************
 * 取り込んだ内容を保存する
 *  mergeAll_() の戻り値をそのまま渡す
 *  打刻と現場フラグには一切触れない
 *************************************************/
/**
 * その日ぜんぶに関わる情報を保存する。同じ日付の行があれば書き換える。
 * order は清掃指示書、dbl はダブルメイク指示書の読み取り結果。
 */
function saveDayNote_(date, order, dbl) {
  return withLock_(() => {
    const d = date || today_();
    const sh = ss_().getSheetByName(SHEET.DAY);
    const o = order || {};
    const b = dbl || {};

    const row = [
      d,
      String(o.date || ''),
      String(o.maker || ''),
      o.orderCount == null ? '' : o.orderCount,
      (o.connect || []).map(x => x.floor + x.state).join('、'),
      (o.allNotes || []).join('\n'),
      String(b.note || ''),
      (b.twins || []).map(p => p.join('・')).join('、'),
      (b.connects || []).map(p => p.join('・')).join('、'),
      new Date()
    ];

    let at = 0;
    if (sh.getLastRow() >= 2) {
      const v = sh.getRange(2, 1, sh.getLastRow() - 1, 1).getValues();
      for (let i = 0; i < v.length; i++) if (normDate_(v[i][0]) === d) { at = i + 2; break; }
    }
    if (!at) at = appendAt_(sh, 1);

    sh.getRange(at, 1, 1, DAY_HEAD.length).setValues([row]);
    sh.getRange(at, 6).setWrap(true);
    return { date: d };
  });
}

/** 指定日の日次メモを読み出す */
function getDayNote_(dateStr) {
  const d = dateStr || today_();
  const sh = ss_().getSheetByName(SHEET.DAY);
  if (!sh || sh.getLastRow() < 2) return null;
  const v = sh.getRange(2, 1, sh.getLastRow() - 1, DAY_HEAD.length).getValues();
  for (let i = 0; i < v.length; i++) {
    if (normDate_(v[i][0]) !== d) continue;
    return {
      date: d, orderDate: String(v[i][1] || ''), maker: String(v[i][2] || ''),
      orderCount: v[i][3], connect: String(v[i][4] || ''),
      allNotes: String(v[i][5] || ''), dblNote: String(v[i][6] || ''),
      twins: String(v[i][7] || ''), connects: String(v[i][8] || '')
    };
  }
  return null;
}


function saveImport_(date, rooms) {
  return withLock_(() => {
    const d = date || today_();
    const sh = ss_().getSheetByName(SHEET.LOG);
    const stamp = new Date();

    // その日の行をまとめて読み、手元で直して、まとめて書き戻す（1セルずつ書くと遅いため）
    const last = sh.getLastRow();
    const all = last >= 2 ? sh.getRange(2, 1, last - 1, NCOL).getValues() : [];
    const have = {};
    all.forEach((r, i) => { if (normDate_(r[0]) === d) have[String(r[1]).trim()] = i; });

    let lo = Infinity, hi = -1;
    const add = [];
    rooms.forEach(r => {
      const vals = importVals_(r);
      const i = have[String(r.room)];
      if (i != null) {
        const v = all[i];
        const prevCode = String(v[3] || '').toUpperCase();
        const started = !!v[TASK_COL.clean];
        IMPORT_COLS.forEach((c, k) => { v[c - 1] = vals[k]; });
        // 現場でアウト済にした・清掃に入った部屋は、取り込み直しても D（アウト前）に戻さない
        if (r.kbn === 'OUT' && String(v[3]).toUpperCase() === 'D' && (prevCode === 'O' || started)) v[3] = 'O';
        v[29] = stamp;
        lo = Math.min(lo, i); hi = Math.max(hi, i);
      } else {
        const line = new Array(NCOL).fill('');
        line[0] = d; line[1] = String(r.room);
        IMPORT_COLS.forEach((c, k) => { line[c - 1] = vals[k]; });
        line[29] = stamp;
        add.push(line);
      }
    });

    // 文字のままにしたい列（部屋番号・時刻・メモ・回収記録・追加指示）は先に書式を決めてから書く
    const textCols = (r0, n) => {
      const r1 = r0 + n - 1;
      sh.getRangeList(['B' + r0 + ':B' + r1, 'G' + r0 + ':I' + r1, 'AB' + r0 + ':AB' + r1,
                       'AQ' + r0 + ':AT' + r1]).setNumberFormat('@');
    };
    if (hi >= 0) {
      textCols(lo + 2, hi - lo + 1);
      sh.getRange(lo + 2, 1, hi - lo + 1, NCOL).setValues(all.slice(lo, hi + 1));
    }
    if (add.length) {
      const at = appendAt_(sh, add.length);
      textCols(at, add.length);
      sh.getRange(at, 1, add.length, NCOL).setValues(add);
    }

    sortLog_();
    CacheService.getScriptCache().removeAll(rooms.map(r => 'L:' + d + ':' + r.room));
    bumpRev_(d);
    return { saved: rooms.length, added: add.length, date: d };
  });
}

/** IMPORT_COLS と同じ並びで値を返す */
function importVals_(r) {
  return [
    r.floor || '',                    //  3 階
    r.code || '',                     //  4 コード
    r.kbn || '',                      //  5 区分
    r.reserved ? true : '',           //  6 予約
    r.dueIn || '',                    //  7 締切
    r.checkIn || '',                  //  8 IN時刻
    r.lateOut || '',                  //  9 レイトアウト
    r.noMake ? true : '',             // 20 ノーメイク
    r.fullClean ? true : '',          // 21 フル清掃
    r.linen ? true : '',              // 22 リネン交換依頼
    r.extend ? true : '',             // 23 延泊
    r.pop ? true : '',                // 24 POP回収
    String(r.note || '').slice(0, 300), // 29 指示書特記
    flagNote_(r),                       // 34 要確認メモ
    r.dmake || '',                      // 39 Dメイク
    r.twin ? true : '',                 // 40 ツイン
    r.connect || '',                    // 41 コネクト
    r.eco ? true : ''                   // 42 エコ清掃
  ];
}

/**
 * 読み取りのときに何が引っかかったかを1行で残す。
 * 保存したあとに読み込み直しても、どの部屋を確かめたのかが分かる。
 */
function flagNote_(r) {
  // 責任者が写真と見比べて「確認済み」を押した部屋は、その印を残す
  if (r.confirmed) return ('確認済み：' + (r.confirmedWhat || '')).slice(0, 200);
  const a = [];
  if (r.ruled) a.push(r.ruled + 'で確定');
  if (r.hand) a.push('手書きあり');
  if (r.alt)  a.push('読み取りが割れた(' + (r.code || '空') + '/' + r.alt + ')');
  (r.uncertain || []).forEach(u => {
    if (u !== 'code' && u !== '手書きあり') a.push(u);
  });
  return a.join(' / ').slice(0, 200);
}


/*************************************************
 * 読み取り
 *************************************************/
function getStaffList() {
  const sh = ss_().getSheetByName(SHEET.STAFF);
  if (sh.getLastRow() < 2) return [];
  return sh.getRange(2, 1, sh.getLastRow() - 1, 2).getValues()
    .filter(r => r[0] && String(r[1]).trim() !== '退職')
    .map(r => String(r[0]).trim());
}

function rowToRoom_(r) {
  return {
    room: String(r[1]).trim(), floor: String(r[2] || ''),
    code: String(r[3] || ''), kbn: String(r[4] || 'NONE'), reserved: bool_(r[5]),
    dueIn: String(r[6] || ''), checkIn: String(r[7] || ''), lateOut: String(r[8] || ''),
    clean: task_(r[9],  r[10], r[11], r[12]),
    check: task_(r[13], r[14], r[15], r[16]),
    dd: bool_(r[17]), skip: bool_(r[18]),
    noMake: bool_(r[19]), fullClean: bool_(r[20]), linen: bool_(r[21]),
    extend: bool_(r[22]), pop: bool_(r[23]),
    water: r[24] === '' || r[24] == null ? '' : Number(r[24]),
    fridge: String(r[25] || ''), pickup: bool_(r[26]),
    memo: String(r[27] || '').trim(), note: String(r[28] || '').trim(),
    spAircon: bool_(r[30]), spDrain: bool_(r[31]), spTv: bool_(r[32]),
    flagNote: String(r[33] || '').trim(),
    supply: String(r[35] || ''), bag: bool_(r[36]),
    fridgeCheck: String(r[37] || ''),
    dmake: String(r[38] || ''), twin: bool_(r[39]), connect: String(r[40] || ''),
    eco: bool_(r[41]),
    pickupBy: String(r[42] || ''), bagBy: String(r[43] || ''), collectOk: String(r[44] || ''),
    order: String(r[ORDER_COL - 1] || '').trim()
  };
}

function task_(staff, start, finish, min) {
  return {
    staff: String(staff || ''), start: hm_(start), finish: hm_(finish),
    minutes: (min === '' || min == null) ? null : Number(min),
    state: finish ? 'done' : (start ? 'doing' : 'todo')
  };
}

/**
 * 保存済みの指示を確認画面の形で読み出す。
 * 取り込み直さずに区分や付帯作業を直したいときに使う。
 * 打刻や現場フラグは返さない（保存時にも触らないため）。
 */
function getSaved_(dateStr) {
  const date = dateStr || today_();
  const rooms = dayBlock_(ss_().getSheetByName(SHEET.LOG), date, NCOL)
    .filter(r => String(r[1]).trim())
    .map(r => ({
      room:      String(r[1]).trim(),
      floor:     String(r[2] || ''),
      code:      String(r[3] || ''),
      kbn:       String(r[4] || 'NONE'),
      reserved:  bool_(r[5]),
      dueIn:     String(r[6] || ''),
      checkIn:   String(r[7] || ''),
      lateOut:   String(r[8] || ''),
      noMake:    bool_(r[19]),
      fullClean: bool_(r[20]),
      linen:     bool_(r[21]),
      extend:    bool_(r[22]),
      pop:       bool_(r[23]),
      note:      String(r[28] || '').trim(),
      dmake:     String(r[38] || ''),
      twin:      bool_(r[39]),
      connect:   String(r[40] || ''),
      eco:       bool_(r[41]),
      flagNote:  String(r[33] || '').trim(),
      alt: '', hand: false,
      confirmed: /^確認済み/.test(String(r[33] || '')),
      uncertain: (String(r[33] || '').trim() && !/^確認済み/.test(String(r[33] || '')))
        ? ['前回の要確認'] : []
    }))
    .sort((a, b) => cmpRoom_(a.room, b.room));

  return { date: date, rooms: rooms };
}

/*************************************************
 * 特別清掃の残り
 *  その月にまだ日にちが入っていない項目を部屋ごとに出す。
 *  毎回その月の記録を全部読むと重いので、月ごとにまとめて覚えておき、
 *  特別清掃が押されたとき（アプリ・特別清掃シート）だけ読み直す。
 *************************************************/
function spCacheKey_(month) { return 'SPDONE:' + month; }
function spDoneClear_(month) { CacheService.getScriptCache().remove(spCacheKey_(month)); }

/** 部屋 → [[実施日の一覧],[…],[…]]（3枠ぶん）。その月だけ */
function spDoneMap_(month) {
  const cache = CacheService.getScriptCache();
  const hit = cache.get(spCacheKey_(month));
  if (hit) { try { return JSON.parse(hit); } catch (e) {} }

  const sh = ss_().getSheetByName(SHEET.LOG);
  const map = {};
  const last = sh.getLastRow();
  if (last >= 2) {
    // 打刻ログは日付順に並んでいるので、その月の行のかたまりだけ読む
    const d = sh.getRange(2, 1, last - 1, 1).getValues();
    let s0 = -1, e0 = -1;
    for (let i = 0; i < d.length; i++) {
      if (normDate_(d[i][0]).indexOf(month) === 0) { if (s0 < 0) s0 = i; e0 = i; }
    }
    if (s0 >= 0) {
      const cols = SPECIAL.reduce((m, x) => Math.max(m, x[1]), 0);
      sh.getRange(s0 + 2, 1, e0 - s0 + 1, cols).getValues().forEach(r => {
        const dd = normDate_(r[0]);
        if (dd.indexOf(month) !== 0) return;
        const no = String(r[1]).trim();
        if (!no) return;
        SPECIAL.forEach(([k, col], i) => {
          if (!bool_(r[col - 1])) return;
          if (!map[no]) map[no] = [[], [], []];
          map[no][i].push(Number(dd.slice(8, 10)));
        });
      });
    }
  }
  try { cache.put(spCacheKey_(month), JSON.stringify(map), 21600); } catch (e) {}
  return map;
}

/**
 * その部屋の特別清掃のうち、今月まだ済んでいない枠。
 * 今日の分は画面のトグルで分かるので除いて判定する（今日ONを外したら残りに戻るように）。
 */
function spTodo_(room, names, map, today) {
  const days = map[room] || [[], [], []];
  return [0, 1, 2].map(i => !!names[i] && !days[i].some(d => d !== today));
}

function getBoard(dateStr) {
  const date = dateStr || today_();
  const sh = ss_().getSheetByName(SHEET.LOG);
  const list = dayBlock_(sh, date, NCOL)
    .filter(r => String(r[1]).trim())
    .map(rowToRoom_)
    .sort((a, b) => cmpRoom_(a.room, b.room));

  const month = date.slice(0, 7);
  const names = getSpecialNames(month).names;
  const map = spDoneMap_(month);
  const todayNo = Number(date.slice(8, 10));
  list.forEach(r => { r.spTodo = spTodo_(r.room, names, map, todayNo); });

  return {
    date: date, rooms: list, staffList: getStaffList(),
    rev: getRev(date), counts: countOf_(list)
  };
}

function countOf_(list) {
  const target = list.filter(r => !r.skip && ['OUT','STAY','FULL'].indexOf(r.kbn) >= 0);
  return {
    total:   target.length,
    done:    target.filter(r => r.clean.state === 'done').length,
    checked: target.filter(r => r.check.state === 'done').length,
    dd:      list.filter(r => r.dd).length,
    skip:    list.filter(r => r.skip).length
  };
}

/** その日の行だけ読む。データが増えても読み込み量が変わらない */
function dayBlock_(sh, date, cols) {
  const last = sh.getLastRow();
  if (last < 2) return [];
  const d = sh.getRange(2, 1, last - 1, 1).getValues();
  let s = -1, e = -1;
  for (let i = 0; i < d.length; i++) {
    if (normDate_(d[i][0]) === date) { if (s < 0) s = i; e = i; }
  }
  if (s < 0) return [];
  return sh.getRange(s + 2, 1, e - s + 1, cols).getValues()
           .filter(r => normDate_(r[0]) === date);
}

function oneRoom_(date, room) {
  const sh = ss_().getSheetByName(SHEET.LOG);
  const row = findLogRow_(sh, date, room);
  if (!row) return null;
  return rowToRoom_(sh.getRange(row, 1, 1, NCOL).getValues()[0]);
}

/** 行番号をキャッシュ。使う前に中身を照合するので並べ替え後も自己修復する */
function findLogRow_(sh, date, room) {
  const key = 'L:' + date + ':' + room;
  const cache = CacheService.getScriptCache();
  const hit = cache.get(key);
  const last = sh.getLastRow();

  if (hit) {
    const row = Number(hit);
    if (row >= 2 && row <= last) {
      const v = sh.getRange(row, 1, 1, 2).getValues()[0];
      if (normDate_(v[0]) === date && String(v[1]).trim() === String(room).trim()) return row;
    }
  }
  if (last < 2) return 0;

  const v = sh.getRange(2, 1, last - 1, 2).getValues();
  for (let i = 0; i < v.length; i++) {
    if (normDate_(v[i][0]) === date && String(v[i][1]).trim() === String(room).trim()) {
      cache.put(key, String(i + 2), 21600);
      return i + 2;
    }
  }
  return 0;
}

function sortLog_() {
  const sh = ss_().getSheetByName(SHEET.LOG);
  const n = sh.getLastRow() - 1;
  if (n < 2) return;
  const rng = sh.getRange(2, 1, n, NCOL);
  const v = rng.getValues();
  v.sort((a, b) => {
    const da = normDate_(a[0]), db = normDate_(b[0]);
    if (da !== db) return da < db ? -1 : 1;
    return cmpRoom_(String(a[1]), String(b[1]));
  });
  rng.setValues(v);
}

function resortLog_() { return withLock_(() => { sortLog_(); return { ok: true }; }); }


/**
 * 1部屋の行を読む。行番号はキャッシュを使い、読んだ中身で本当にその部屋か確かめる。
 * 通常はスプレッドシートを1回読むだけで済む。
 */
function readRoomRow_(sh, date, room) {
  const key = 'L:' + date + ':' + room;
  const hit = Number(CacheService.getScriptCache().get(key) || 0);
  if (hit >= 2 && hit <= sh.getLastRow()) {
    const v = sh.getRange(hit, 1, 1, NCOL).getValues()[0];
    if (normDate_(v[0]) === date && String(v[1]).trim() === String(room).trim()) return { row: hit, v: v };
  }
  const row = findLogRow_(sh, date, room);
  if (!row) return null;
  return { row: row, v: sh.getRange(row, 1, 1, NCOL).getValues()[0] };
}

/** 書き換えた行を1回で書き戻し、画面に返す形にする */
function writeRoomRow_(sh, date, x) {
  sh.getRange(x.row, 1, 1, NCOL).setValues([x.v]);
  const out = rowToRoom_(x.v);
  out.__rev = bumpRev_(date);
  return out;
}

/**
 * 下に n 行書き足すときの書き始めの行。シートの行が足りなければ先に足す
 * （スプレッドシートは最初1000行しかなく、打刻ログは1日179行ずつ増えるため）。
 */
function appendAt_(sh, n) {
  const at = sh.getLastRow() + 1;
  const need = at + n - 1 - sh.getMaxRows();
  if (need > 0) sh.insertRowsAfter(sh.getMaxRows(), need + 200);
  return at;
}


/*************************************************
 * 打刻（task = 'clean' | 'check'）
 *  入室 → 退出 の2打刻。清掃が終わるまでチェックには入れない
 *  どれも「行を1回読む → 手元で直す → 1回で書く」
 *************************************************/
function clockStart(room, staff, task) {
  return withLock_(() => {
    const date = today_(), sh = ss_().getSheetByName(SHEET.LOG);
    const c = TASK_COL[task];
    if (!c) throw new Error('不明な作業です');

    const x = readRoomRow_(sh, date, room);
    if (!x) throw new Error(room + ' は本日の指示に入っていません');
    const v = x.v;

    if (task === 'check' && !v[TASK_COL.clean + 1]) throw new Error(room + ' はまだ清掃が終わっていません');
    if (v[c + 1]) throw new Error(room + ' の' + taskName_(task) + 'は ' + v[c - 1] + ' さんが完了済みです');
    if (v[c])     throw new Error(room + ' の' + taskName_(task) + 'は ' + v[c - 1] + ' さんが作業中です');

    v[c - 1] = staff;
    v[c] = new Date();
    // 清掃に入れたということはお客様はもう出ている。アウト前(D)ならアウト済(O)にする
    if (task === 'clean' && String(v[3] || '').toUpperCase() === 'D') v[3] = 'O';
    return writeRoomRow_(sh, date, x);
  });
}

function clockFinish(room, staff, task) {
  return withLock_(() => {
    const date = today_(), sh = ss_().getSheetByName(SHEET.LOG);
    const c = TASK_COL[task];
    if (!c) throw new Error('不明な作業です');

    const x = readRoomRow_(sh, date, room);
    if (!x) throw new Error(room + ' はまだ開始されていません');
    const v = x.v;

    if (v[c + 1]) throw new Error(room + ' の' + taskName_(task) + 'はすでに完了しています');
    if (!v[c])    throw new Error(room + ' の' + taskName_(task) + 'はまだ開始されていません');

    const end = new Date();
    v[c + 1] = end;
    v[c + 2] = Math.max(1, Math.round((end - new Date(v[c])) / 60000));
    return writeRoomRow_(sh, date, x);
  });
}

/** 完了を取り消して作業中に戻す。入室時刻は残す */
function clockReopen(room, task) {
  return withLock_(() => {
    const date = today_(), sh = ss_().getSheetByName(SHEET.LOG);
    const c = TASK_COL[task];
    const x = readRoomRow_(sh, date, room);
    if (!x) throw new Error(room + ' の記録がありません');
    const v = x.v;

    if (task === 'clean' && v[TASK_COL.check]) {
      throw new Error(room + ' はチェックが始まっています。先にチェックを取り消してください');
    }
    if (!v[c + 1]) throw new Error(room + ' の' + taskName_(task) + 'はまだ完了していません');
    v[c + 1] = ''; v[c + 2] = '';
    return writeRoomRow_(sh, date, x);
  });
}

/** 入室前に戻す。担当者と時刻をすべて消す */
function clockUndo(room, task) {
  return withLock_(() => {
    const date = today_(), sh = ss_().getSheetByName(SHEET.LOG);
    const c = TASK_COL[task];
    const x = readRoomRow_(sh, date, room);
    if (!x) throw new Error(room + ' の記録がありません');
    const v = x.v;

    if (task === 'clean' && v[TASK_COL.check]) {
      throw new Error(room + ' はチェックが始まっています。先にチェックを取り消してください');
    }
    v[c - 1] = ''; v[c] = ''; v[c + 1] = ''; v[c + 2] = '';
    return writeRoomRow_(sh, date, x);
  });
}

/**
 * DDセット用。入室と退出を1回で記録する（清掃員は「セット済」、チェッカーは「確認済」）。
 * 入室だけ押してあった部屋（前のやり方）は、その入室時刻のまま退出を入れる。
 * DD の部屋はお客様が滞在中なので、コード（D/O）は変えない。
 */
function clockOnce(room, staff, task) {
  return withLock_(() => {
    const date = today_(), sh = ss_().getSheetByName(SHEET.LOG);
    const c = TASK_COL[task];
    if (!c) throw new Error('不明な作業です');

    const x = readRoomRow_(sh, date, room);
    if (!x) throw new Error(room + ' は本日の指示に入っていません');
    const v = x.v;
    const word = task === 'clean' ? 'セット済' : '確認済';

    if (task === 'check' && !v[TASK_COL.clean + 1]) throw new Error(room + ' はまだDDセットが済んでいません');
    if (v[c + 1]) throw new Error(room + ' は ' + v[c - 1] + ' さんが' + word + 'です');

    const now = new Date();
    const fresh = !v[c];
    if (fresh) { v[c - 1] = staff; v[c] = now; }
    v[c + 1] = now;
    v[c + 2] = fresh ? 0 : Math.max(1, Math.round((now - new Date(v[c])) / 60000));
    return writeRoomRow_(sh, date, x);
  });
}


/*************************************************
 * 現場で変わるもの
 *************************************************/

/**
 * コードを書き換える（D → O のアウト済み反映が主用途）
 * 区分も一緒に作り直す。フル清掃ならステイは FULL に昇格する
 */
function setRoomCode(rooms, code) {
  return withLock_(() => {
    const date = today_(), sh = ss_().getSheetByName(SHEET.LOG);
    const list = (Array.isArray(rooms) ? rooms : [rooms]).map(String);
    const c = String(code || '').toUpperCase();
    if (IND_CODES.indexOf(c) < 0) throw new Error('不明なコードです: ' + code);

    list.forEach(room => {
      const row = findLogRow_(sh, date, room);
      if (!row) return;
      const full = bool_(sh.getRange(row, 21).getValue());
      sh.getRange(row, 4, 1, 2).setValues([[c, kbnOf_(c, full)]]);
    });

    bumpRev_(date);
    return getBoard(date);
  });
}

/** 締切・IN時刻をまとめて入れる */
function setRoomTime(rooms, field, value) {
  return withLock_(() => {
    const date = today_(), sh = ss_().getSheetByName(SHEET.LOG);
    const col = { dueIn: 7, checkIn: 8, lateOut: 9 }[field];
    if (!col) throw new Error('不明な項目です');
    const v = hhmm_(value);

    (Array.isArray(rooms) ? rooms : [rooms]).map(String).forEach(room => {
      const row = findLogRow_(sh, date, room);
      if (!row) return;
      const cell = sh.getRange(row, col);
      cell.setNumberFormat('@');
      cell.setValue(v);
    });

    bumpRev_(date);
    return getBoard(date);
  });
}

/** フラグを手元の行（配列）に書く */
function putFlag_(v, k, val) {
  const i = FLAG_COL[k] - 1;
  if (BOOL_FLAGS.indexOf(k) >= 0) { v[i] = val ? true : ''; return; }
  if (k === 'water') { v[i] = (val === '' || val == null) ? '' : Number(val); return; }
  v[i] = String(val == null ? '' : val).trim().slice(0, 200);
}

/**
 * パッチを行に当てる。
 * 回収（ゴミ・バッグ）は押した人と時刻を残す。外したら記録も確認も消す。
 */
function applyPatch_(v, patch) {
  const by = String(patch.__by || '').trim();
  ['pickup', 'bag'].forEach(k => {
    if (!(k in patch)) return;
    v[COLLECT_COL[k] - 1] = patch[k] ? (by + ' ' + hm_(new Date())).trim() : '';
    if (!patch[k]) v[COLLECT_COL.check - 1] = '';
  });
  Object.keys(FLAG_COL).forEach(k => { if (k in patch) putFlag_(v, k, patch[k]); });
}

/**
 * 1部屋・1回ぶんのフラグ保存（DD・清掃不要・ゴミ回収など1タップごとに呼ぶ操作）。
 * 行を1回読んで1回書くだけなので軽い。
 */
function setRoomFlag1(room, patch) {
  return withLock_(() => {
    const date = today_(), sh = ss_().getSheetByName(SHEET.LOG);
    const x = readRoomRow_(sh, date, String(room));
    if (!x) return null;
    // 特別清掃を押したら、月の残りを読み直す
    if (SPECIAL.some(s => s[0] in patch)) spDoneClear_(date.slice(0, 7));
    applyPatch_(x.v, patch);
    return writeRoomRow_(sh, date, x);
  });
}

/**
 * チェッカーが回収を確認する。確認した人と時刻を残す。
 * ok が false なら確認を取り消す。
 */
function setCollectCheck(room, staff, ok) {
  return withLock_(() => {
    const date = today_(), sh = ss_().getSheetByName(SHEET.LOG);
    const x = readRoomRow_(sh, date, String(room));
    if (!x) throw new Error(room + ' の記録がありません');
    x.v[COLLECT_COL.check - 1] = ok ? (String(staff || '').trim() + ' ' + hm_(new Date())).trim() : '';
    return writeRoomRow_(sh, date, x);
  });
}

function setRoomFlags(rooms, patch) {
  return withLock_(() => {
    const date = today_(), sh = ss_().getSheetByName(SHEET.LOG);
    if (SPECIAL.some(s => s[0] in patch)) spDoneClear_(date.slice(0, 7));
    (Array.isArray(rooms) ? rooms : [rooms]).map(String).forEach(room => {
      const x = readRoomRow_(sh, date, room);
      if (!x) return;
      applyPatch_(x.v, patch);
      sh.getRange(x.row, 1, 1, NCOL).setValues([x.v]);
    });
    bumpRev_(date);
    return getBoard(date);
  });
}


/*************************************************
 * 業務中の追加指示
 *  フロントなどから途中で来た指示を部屋に入れる。
 *  清掃員画面で部屋を押すと、詳細の一番上に赤い枠で出る。フロアレポートの備考にも載る。
 *  date を渡さなければ今日。
 *************************************************/
function roomNo_(v) {
  const d = String(v || '').replace(/[^0-9]/g, '');
  return d ? String(parseInt(d, 10)) : '';
}

/** rooms は「305 306」「305,306」のような文字でも配列でもよい。すでに指示がある部屋は後ろに足す */
function addOrder_(rooms, text, dateStr) {
  return withLock_(() => {
    const t = String(text || '').replace(/\s+/g, ' ').trim();
    if (!t) throw new Error('指示の内容を入れてください');
    const list = (Array.isArray(rooms) ? rooms : String(rooms || '').split(/[\s,、，・]+/))
      .map(roomNo_).filter(Boolean);
    if (!list.length) throw new Error('部屋番号を入れてください');

    const date = dateStr || today_(), sh = ss_().getSheetByName(SHEET.LOG);
    const added = [], missing = [];
    [...new Set(list)].forEach(room => {
      const x = readRoomRow_(sh, date, room);
      if (!x) { missing.push(room); return; }
      const prev = String(x.v[ORDER_COL - 1] || '').trim();
      x.v[ORDER_COL - 1] = ((prev ? prev + ' / ' : '') + t).slice(0, 300);
      sh.getRange(x.row, 1, 1, NCOL).setValues([x.v]);
      added.push(room);
    });
    if (added.length) bumpRev_(date);
    return { added: added, missing: missing, orders: getOrders_(date).orders };
  });
}

/** 1部屋の指示を書き換える（空にすると消える） */
function setOrder_(room, text, dateStr) {
  return withLock_(() => {
    const date = dateStr || today_(), sh = ss_().getSheetByName(SHEET.LOG);
    const x = readRoomRow_(sh, date, roomNo_(room));
    if (!x) throw new Error(room + ' はその日の指示に入っていません');
    x.v[ORDER_COL - 1] = String(text || '').trim().slice(0, 300);
    sh.getRange(x.row, 1, 1, NCOL).setValues([x.v]);
    bumpRev_(date);
    return getOrders_(date);
  });
}

/** 指示が入っている部屋の一覧 */
function getOrders_(dateStr) {
  const date = dateStr || today_();
  const orders = dayBlock_(ss_().getSheetByName(SHEET.LOG), date, NCOL)
    .filter(r => String(r[1]).trim()).map(rowToRoom_)
    .filter(r => r.order)
    .sort((a, b) => cmpRoom_(a.room, b.room))
    .map(r => ({ room: r.room, order: r.order, kbn: kbnName_(r.kbn),
                 state: r.check.state === 'done' ? 'チェック済' : r.clean.state === 'done' ? '清掃済'
                      : r.clean.state === 'doing' ? '清掃中' : '未着手' }));
  return { date: date, orders: orders };
}


/*************************************************
 * 管理画面から1部屋を直す
 *  コード（区分も作り直す）・フル清掃・ノーメイク・延泊・DD・備品・清掃不要・アパエコ・
 *  Wメイク・ツイン・締切・IN時刻・レイトアウト・特記・現場メモ・追加指示。
 *  打刻（入室・退出）と回収の記録には触らない。
 *  取り込みの列（コード・フル・ノーメイク・Wメイク・時刻・特記など）は、
 *  あとで取り込み直すと読み取りの値に戻る。
 *************************************************/
function getRoomAdmin_(room, dateStr) {
  const date = dateStr || today_(), sh = ss_().getSheetByName(SHEET.LOG);
  const x = readRoomRow_(sh, date, roomNo_(room));
  if (!x) throw new Error(room + ' はその日の指示に入っていません');
  const out = rowToRoom_(x.v);
  out.dmakeKinds = DMAKE_KINDS;
  out.codes = IND_CODES;
  return out;
}

function setRoomAdmin_(room, d, dateStr) {
  return withLock_(() => {
    const date = dateStr || today_(), sh = ss_().getSheetByName(SHEET.LOG);
    const x = readRoomRow_(sh, date, roomNo_(room));
    if (!x) throw new Error(room + ' はその日の指示に入っていません');
    const v = x.v;
    const wasNext = String(v[8] || '') >= '19:00';
    const was = { code: String(v[3]), full: bool_(v[20]) };

    if ('fullClean' in d) v[20] = d.fullClean ? true : '';
    if ('noMake' in d)    v[19] = d.noMake ? true : '';
    if ('extend' in d)    v[22] = d.extend ? true : '';
    if ('code' in d) {
      const c = String(d.code || '').toUpperCase();
      if (IND_CODES.indexOf(c) < 0) throw new Error('不明なコードです: ' + d.code);
      v[3] = c;
    }
    if ('dueIn' in d)   v[6] = hhmm_(d.dueIn);
    if ('checkIn' in d) v[7] = hhmm_(d.checkIn);
    if ('lateOut' in d) v[8] = hhmm_(d.lateOut);
    const isNext = String(v[8] || '') >= '19:00';

    // 19時以降のレイトアウトは翌日回し（清掃対象外）。
    // それ以外は、コードかフルが変わったとき・翌日回しを外したときだけ区分を作り直す
    if (isNext) v[4] = 'NONE';
    else if (wasNext || String(v[3]) !== was.code || bool_(v[20]) !== was.full) v[4] = kbnOf_(v[3], bool_(v[20]));

    if ('dmake' in d) v[38] = DMAKE_KINDS.indexOf(d.dmake) >= 0 ? d.dmake : '';
    if ('twin' in d)  v[39] = d.twin ? true : '';
    if ('eco' in d)   v[41] = d.eco ? true : '';
    if ('note' in d)  v[28] = String(d.note || '').trim().slice(0, 300);
    if ('order' in d) v[ORDER_COL - 1] = String(d.order || '').trim().slice(0, 300);

    const patch = {};
    ['dd', 'skip', 'supply', 'memo'].forEach(k => { if (k in d) patch[k] = d[k]; });
    if (patch.skip === true) patch.dd = true;      // 清掃不要は DD も立てる（清掃員画面と同じ）
    applyPatch_(v, patch);

    return writeRoomRow_(sh, date, x);
  });
}


/*************************************************
 * 人ごとの数（退出まで押した部屋だけ）
 *  清掃員：清掃・ツイン・DDセット・清掃の平均分
 *  チェッカー：チェック・DDチェック・チェックの平均分
 *************************************************/
function people_(list) {
  const ppl = {};
  const P = n => ppl[n] || (ppl[n] = { name: n, clean: 0, tw: 0, dd: 0, minutes: 0, check: 0, ddCheck: 0, checkMin: 0 });
  list.forEach(r => {
    if (r.clean.state === 'done') {
      const p = P(r.clean.staff || '不明');
      if (r.dd) p.dd++;
      else if (['OUT','STAY','FULL'].indexOf(r.kbn) >= 0) {
        p.clean++; p.minutes += r.clean.minutes || 0;
        if (r.twin) p.tw++;
      }
    }
    if (r.check.state === 'done') {
      const p = P(r.check.staff || '不明');
      if (r.dd) p.ddCheck++;
      else { p.check++; p.checkMin += r.check.minutes || 0; }
    }
  });
  return Object.keys(ppl).map(k => ppl[k]).sort((a, b) => a.name < b.name ? -1 : 1);
}


/*************************************************
 * 反映の合図
 *************************************************/
function bumpRev_(date) {
  const c = CacheService.getScriptCache(), k = 'rev:' + date;
  const n = Number(c.get(k) || 0) + 1;
  c.put(k, String(n), 21600);
  return n;
}

function getRev(dateStr) {
  return Number(CacheService.getScriptCache().get('rev:' + (dateStr || today_())) || 0);
}


/*************************************************
 * 集計（フロアレポートの報告欄に対応）
 *  アウト / ステイ / フルメイク / トータル / DD / 水
 *************************************************/
function getReport_(dateStr) {
  const date = dateStr || today_();
  const list = dayBlock_(ss_().getSheetByName(SHEET.LOG), date, NCOL)
    .filter(r => String(r[1]).trim()).map(rowToRoom_);

  const floors = {};
  const blank = () => ({ OUT: 0, STAY: 0, FULL: 0, total: 0, dd: [], water: 0, done: 0, checked: 0 });

  list.forEach(r => {
    const f = r.floor || 'その他';
    if (!floors[f]) floors[f] = blank();
    const o = floors[f];

    if (r.dd) o.dd.push(r.room);
    if (r.water) o.water += Number(r.water) || 0;

    if (r.skip || ['OUT','STAY','FULL'].indexOf(r.kbn) < 0) return;
    o[r.kbn]++; o.total++;
    if (r.clean.state === 'done') o.done++;
    if (r.check.state === 'done') o.checked++;
  });

  const all = blank();
  const rows = Object.keys(floors).sort((a, b) => parseInt(a, 10) - parseInt(b, 10)).map(f => {
    const o = floors[f];
    ['OUT','STAY','FULL','total','water','done','checked'].forEach(k => { all[k] += o[k]; });
    all.dd = all.dd.concat(o.dd);
    return {
      floor: f, out: o.OUT, stay: o.STAY, full: o.FULL, total: o.total,
      dd: o.dd.sort(cmpRoom_), water: o.water, done: o.done, checked: o.checked
    };
  });

  return {
    date: date, floors: rows,
    all: {
      out: all.OUT, stay: all.STAY, full: all.FULL, total: all.total,
      dd: all.dd.sort(cmpRoom_), water: all.water, done: all.done, checked: all.checked
    }
  };
}

/** 清掃員別・区分別の当日集計 */
function getSummary_(dateStr) {
  const date = dateStr || today_();
  const list = dayBlock_(ss_().getSheetByName(SHEET.LOG), date, NCOL)
    .filter(r => String(r[1]).trim()).map(rowToRoom_);

  const byStaff = {}, byKbn = {};
  const add = (o, key, min) => {
    if (!o[key]) o[key] = { key: key, rooms: 0, minutes: 0 };
    o[key].rooms++; o[key].minutes += min;
  };

  list.forEach(r => {
    // DDの部屋の作業はDDセット／DDチェックとして、清掃の平均に混ぜない
    const names = r.dd ? [['clean', 'DDセット'], ['check', 'DDチェック']]
                       : [['clean', '清掃'], ['check', 'チェック']];
    names.forEach(([k, name]) => {
      const t = r[k];
      if (t.state !== 'done') return;
      add(byStaff, (t.staff || '不明') + ' / ' + name, t.minutes || 0);
      if (k === 'clean') add(byKbn, r.dd ? 'DD' : kbnName_(r.kbn), t.minutes || 0);
    });
  });

  const shape = o => Object.keys(o).map(k => {
    const v = o[k];
    v.avg = v.rooms ? Math.round(v.minutes / v.rooms) : 0;
    return v;
  }).sort((a, b) => a.key < b.key ? -1 : 1);

  return { date: date, staff: shape(byStaff), kbn: shape(byKbn), people: people_(list) };
}

/** ホテルへ出す申告文 */
function getDeclarationText_(dateStr) {
  const date = dateStr || today_();
  const rep = getReport_(date);
  const md = date.replace(/^\d{4}-/, '').replace('-', '/');
  const a = rep.all;

  const out = [
    md + '　客室清掃 作業報告',
    '',
    'アウト　　 ' + a.out + '室',
    'ステイ　　 ' + a.stay + '室',
    'フルメイク ' + a.full + '室',
    'トータル　 ' + a.total + '室'
  ];
  if (a.dd.length) out.push('', 'DD設置 ' + a.dd.length + '室：' + a.dd.join('、'));
  if (a.water)     out.push('水 合計 ' + a.water + '本');

  const sp = daySpecial_(date);
  if (sp.length) out.push('', '［特別清掃］', sp.join('\n'));

  out.push('', '［階別］');
  rep.floors.forEach(f => {
    out.push(f.floor + '　アウト' + f.out + ' / ステイ' + f.stay + ' / フル' + f.full
           + ' / 計' + f.total + (f.water ? ' / 水' + f.water + '本' : ''));
  });

  return { date: date, text: out.join('\n') };
}

/*************************************************
 * 特別清掃の進み具合
 *  月内に全室を1周する。実施した日を部屋ごとに持ち、
 *  実施数と残数、まだ手を付けていない部屋を返す
 *************************************************/
/**
 * その月の特別清掃3枠の名前を読む。
 * ホテルの指定が毎月変わるので、月ごとにスクリプトプロパティへ持つ。
 * 1枠目・2枠目は SPECIAL_CHOICES から選び、3枠目は自由入力。
 */
function getSpecialNames(ym) {
  const month = ym || Utilities.formatDate(new Date(), 'Asia/Tokyo', 'yyyy-MM');
  const all = props_().getProperties();

  /*
   * その月の設定が無ければ、それより前でいちばん新しい月の設定を引き継ぐ。
   * 月が替わって設定し忘れても、清掃員の画面から項目が消えないようにするため。
   */
  let raw = all['SP_NAMES_' + month], from = month;
  if (!raw) {
    const prev = Object.keys(all)
      .filter(k => /^SP_NAMES_\d{4}-\d{2}$/.test(k) && k.slice(9) < month)
      .sort();
    if (prev.length) { raw = all[prev[prev.length - 1]]; from = prev[prev.length - 1].slice(9); }
  }

  let names;
  try { names = raw ? JSON.parse(raw) : null; } catch (e) { names = null; }
  if (!Array.isArray(names) || names.length !== 3) names = SPECIAL_DEFAULT.slice();
  return { month: month, names: names, choices: SPECIAL_CHOICES,
           inheritedFrom: from !== month ? from : '' };
}

/**
 * 3枠の名前を保存する。管理画面から呼ぶ。
 * 3枠目（ホテル指定で毎月変わる自由入力の枠）は、空欄なら今の項目をそのまま残す。
 * 責任者が書き換えたときだけ変わる。
 */
function setSpecialNames_(ym, names) {
  const month = ym || Utilities.formatDate(new Date(), 'Asia/Tokyo', 'yyyy-MM');
  const cur = getSpecialNames(month).names;
  const v = [0, 1, 2].map(i => {
    const x = String((Array.isArray(names) ? names[i] : '') || '').trim().slice(0, 40);
    if (i === 2 && !x) return cur[2] || '';
    return x;
  });
  props_().setProperty('SP_NAMES_' + month, JSON.stringify(v));
  return { month: month, names: v };
}

/**
 * その部屋の特別清掃を前回いつやったかを返す。
 *
 * 枠の中身はホテルの指定で毎月変わるので、列だけで遡ると
 * 9月の「ブック・テレビ裏」と10月の「換気扇」が混ざってしまう。
 * 各行の月の設定を見て、いまの枠名と一致する月の記録だけを拾う。
 */
function getRoomSpecial(room) {
  const no = String(room || '').trim();
  const now = Utilities.formatDate(new Date(), 'Asia/Tokyo', 'yyyy-MM');
  const cur = getSpecialNames(now).names;
  const out = SPECIAL.map(([key], i) => ({ key: key, name: cur[i] || '', last: '' }));
  if (!no) return out;

  const sh = ss_().getSheetByName(SHEET.LOG);
  if (sh.getLastRow() < 2) return out;

  const rows = sh.getRange(2, 1, sh.getLastRow() - 1, NCOL).getValues()
    .filter(r => String(r[1]).trim() === no);

  const nameCache = {};
  const namesOf = ym => {
    if (!nameCache[ym]) nameCache[ym] = getSpecialNames(ym).names;
    return nameCache[ym];
  };

  rows.forEach(r => {
    const d = normDate_(r[0]);
    const ns = namesOf(d.slice(0, 7));
    SPECIAL.forEach(([key, col], i) => {
      if (!bool_(r[col - 1])) return;
      if (!cur[i] || ns[i] !== cur[i]) return;      // 別の内容だった月は数えない
      if (!out[i].last || d > out[i].last) out[i].last = d;
    });
  });

  return out;
}

function getSpecial_(ym) {
  const month = ym || Utilities.formatDate(new Date(), 'Asia/Tokyo', 'yyyy-MM');
  const conf = getSpecialNames(month);
  const sh = ss_().getSheetByName(SHEET.LOG);
  if (sh.getLastRow() < 2) return emptySpecial_(month);

  const all = sh.getRange(2, 1, sh.getLastRow() - 1, NCOL).getValues()
    .filter(r => normDate_(r[0]).indexOf(month) === 0 && String(r[1]).trim());
  if (!all.length) return emptySpecial_(month);

  const seen = {};
  all.forEach(r => { seen[String(r[1]).trim()] = 1; });

  const items = SPECIAL.map(([key, col], i) => {
    const name = conf.names[i] || ('特別清掃' + (i + 1));
    const lastDay = {};
    all.forEach(r => {
      if (!bool_(r[col - 1])) return;
      const no = String(r[1]).trim();
      const day = Number(normDate_(r[0]).slice(8, 10));
      if (!lastDay[no] || day > lastDay[no]) lastDay[no] = day;
    });

    const rooms = Object.keys(lastDay);
    const byDay = {};
    rooms.forEach(no => { byDay[lastDay[no]] = (byDay[lastDay[no]] || 0) + 1; });

    const todo = Object.keys(seen).filter(no => !lastDay[no]).sort(cmpRoom_);

    return {
      key: key, name: name,
      done: rooms.length,
      remain: SPECIAL_TOTAL - rooms.length,
      byDay: byDay,
      todo: todo
    };
  });

  return { month: month, total: SPECIAL_TOTAL, items: items,
           names: conf.names, choices: SPECIAL_CHOICES, inheritedFrom: conf.inheritedFrom, inheritedFrom: conf.inheritedFrom };
}

function emptySpecial_(month) {
  const conf = getSpecialNames(month);
  return {
    month: month, total: SPECIAL_TOTAL,
    names: conf.names, choices: SPECIAL_CHOICES,
    items: SPECIAL.map(([key], i) =>
      ({ key: key, name: conf.names[i] || ('特別清掃' + (i + 1)),
         done: 0, remain: SPECIAL_TOTAL, byDay: {}, todo: [] }))
  };
}


/** その日に実施した特別清掃を項目ごとに並べる */
function daySpecial_(date) {
  const conf = getSpecialNames(String(date).slice(0, 7));
  const list = dayBlock_(ss_().getSheetByName(SHEET.LOG), date, NCOL)
    .filter(r => String(r[1]).trim());
  return SPECIAL.map(([key, col], i) => {
    const name = conf.names[i] || ('特別清掃' + (i + 1));
    const rooms = list.filter(r => bool_(r[col - 1])).map(r => String(r[1]).trim()).sort(cmpRoom_);
    return rooms.length ? name + ' ' + rooms.length + '室：' + rooms.join('、') : '';
  }).filter(Boolean);
}


/**
 * 入室したまま退出していない工程を返す。
 * 押し忘れは所要時間が丸ごと欠けるので当日中に拾いたい
 */
function getStale_(dateStr, minMinutes) {
  const date = dateStr || today_();
  const limit = minMinutes == null ? 60 : Number(minMinutes);
  const now = new Date();
  const out = [];

  dayBlock_(ss_().getSheetByName(SHEET.LOG), date, NCOL).forEach(r => {
    const no = String(r[1]).trim();
    if (!no) return;
    [['clean', '清掃'], ['check', 'チェック']].forEach(([k, name]) => {
      const c = TASK_COL[k];
      const start = r[c];                     // 0始まりなので 担当(c-1) の次が入室(c)
      if (!start || r[c + 1]) return;
      const mins = Math.round((now - new Date(start)) / 60000);
      if (mins < limit) return;
      out.push({ room: no, task: name, staff: String(r[c - 1] || ''), start: hm_(start), mins: mins });
    });
  });

  out.sort((a, b) => b.mins - a.mins);
  return { date: date, rows: out };
}

/*************************************************
 * 日報シート
 *  ホテルへ提出する「客室清掃日報」と同じ並びで書き出す。
 *
 *  ＜自動で埋まる欄＞ 打刻ログから計算する
 *  ＜手入力の欄＞     現場で意味を確かめてから自動化する。
 *                     いまは空欄にしておき、管理者が直接書き込む。
 *************************************************/
const DAILY_SHEET = '日報';

/** 手入力のまま残す欄。意味が固まったら自動に移す */
/** 手入力で残す欄。すべて自動化できたので今は空 */
const MANUAL_ROWS = [];

/** 日報の「ロイヤル（増設含む）」に数える区分 */
const ROYAL_SET = ['新規', '継続', '常設'];

/** 日報（＋責任者業務日報）を作る。重いので同時に2つは走らせない */
function buildDailyReport_(dateStr) {
  return busyGuard_('busy:daily', () => buildDailyReport_(dateStr));
}

function buildDailyReport_(dateStr) {
  const date = dateStr || today_();
  const ss = ss_();
  const list = dayBlock_(ss.getSheetByName(SHEET.LOG), date, NCOL)
    .filter(r => String(r[1]).trim()).map(rowToRoom_);

  const target = list.filter(r => ['OUT','STAY','FULL'].indexOf(r.kbn) >= 0);

  /*
   * 実績の欄はチェック完了を基準にする。
   * 清掃が済んだだけではまだ数えない。点検が終わって初めて1室とする。
   * 「清掃指示数」だけが指示ベースで、それ以外は実際に仕上がった部屋で数える。
   * 1日の終わりには全室チェックが済むので「清掃指示数 − 未清掃(DD)」に落ち着く。
   */
  const cleaned = r => r.check.state === 'done';

  const undone = list.filter(r => r.dd).sort((a, b) => cmpRoom_(a.room, b.room));
  const need   = undone.filter(r => r.supply !== '不要').map(r => r.room);
  const noNeed = undone.filter(r => r.supply === '不要').map(r => r.room);

  const who = {};
  list.forEach(r => {
    if (r.clean.staff) who[r.clean.staff] = 1;
    if (r.check.staff) who[r.check.staff] = 1;
  });

  let last = '';
  list.forEach(r => {
    [r.clean.finish, r.check.finish].forEach(t => { if (t && t > last) last = t; });
  });

  const dm    = list.filter(r => ['OUT','STAY','FULL'].indexOf(r.kbn) >= 0 && !r.dd && cleaned(r));
  const royal = dm.filter(x => ROYAL_SET.indexOf(x.dmake) >= 0);
  const twin  = dm.filter(x => x.twin);
  const nNew  = dm.filter(x => x.dmake === '新規').length;
  const nOff  = dm.filter(x => x.dmake === '解除').length;

  const byFloor = {};
  target.forEach(r => {
    const f = r.floor || 'その他';
    if (!byFloor[f]) byFloor[f] = { order: 0, real: 0, dbl: 0, twin: 0 };
    byFloor[f].order++;
    if (!r.dd && cleaned(r)) {
      byFloor[f].real++;
      if (ROYAL_SET.indexOf(r.dmake) >= 0) byFloor[f].dbl++;
      if (r.twin) byFloor[f].twin++;
    }
  });
  const floors = Object.keys(byFloor).sort((a, b) => parseInt(a, 10) - parseInt(b, 10));

  const note = getDayNote_(date);

  const n = {
    order:  target.length,
    eco:    list.filter(x => x.eco && cleaned(x)).length,
    out:    target.filter(x => x.kbn === 'OUT'  && cleaned(x)).length,
    full:   target.filter(x => x.kbn === 'FULL' && cleaned(x)).length,
    linen:  list.filter(x => x.linen && cleaned(x)).length,
    bag:    list.filter(x => x.bag).length,
    undone: undone.length,
    real:   target.filter(x => !x.dd && cleaned(x)).length,
    water:  list.reduce((a, x) => a + (Number(x.water) || 0), 0),
    trash:  list.filter(x => x.pickup).length
  };

  /*************** 描画 ***************
   * 列は A〜T の20列で組む。1列62px、A列だけ広い。
   * 罫線は外枠を太線、中を細線にして紙の見た目に寄せる。
   * 最後に A4横1枚へ収まるよう印刷設定を入れる。
   ************************************/
  let sh = ss.getSheetByName(DAILY_SHEET);

  // 作り直す前に、手で書いた欄（清掃責任者・ホテル・備考）を保存する
  const cap = sh ? captureManual_('DAY', sh) : null;
  const manual = (cap && cap.date === date) ? cap.data : loadManual_('DAY', date);

  if (!sh) sh = ss.insertSheet(DAILY_SHEET);
  sh.clear();
  sh.clearFormats();
  sh.getRangeList(['A1:Z200']).getRanges().forEach(x => x.breakApart());

  const INK = '#1A1A1A', HEAD = '#E8ECEF', RULE = '#555555';
  const SOLID = SpreadsheetApp.BorderStyle.SOLID;
  const THICK = SpreadsheetApp.BorderStyle.SOLID_THICK;

  const rg   = (r1, c1, nr, nc) => sh.getRange(r1, c1, nr || 1, nc || 1);
  const put  = (r1, c1, v) => rg(r1, c1).setValue(v);
  /** 外枠を太く、内側を細く */
  const frame = (r1, c1, r2, c2) => rg(r1, c1, r2 - r1 + 1, c2 - c1 + 1)
    .setBorder(true, true, true, true, null, null, RULE, THICK)
    .setBorder(null, null, null, null, true, true, '#BBBBBB', SOLID);

  sh.getRange(1, 1, 200, 20).setFontSize(10).setFontColor(INK)
    .setVerticalAlignment('middle');

  /* ── 表題 ───────────────────────── */
  rg(1, 1, 1, 12).merge().setValue('客室清掃日報　アパホテル〈新大阪 南方駅前〉')
    .setFontSize(16).setFontWeight('bold');
  sh.setRowHeight(1, 34);

  rg(1, 13, 1, 2).merge().setValue('清掃指示日').setBackground(HEAD)
    .setFontWeight('bold').setHorizontalAlignment('center');
  rg(1, 15, 1, 4).merge().setValue(date.replace(/-0?/g, '/'))   // 紙と同じ 2026/9/29
    .setHorizontalAlignment('center').setFontSize(12).setFontWeight('bold');
  rg(2, 13, 1, 2).merge().setValue('清掃責任者').setBackground(HEAD)
    .setFontWeight('bold').setHorizontalAlignment('center');
  rg(2, 15, 1, 2).merge().setHorizontalAlignment('center').setBackground('#FFFBEA')
    .setValue(manual && manual.leader ? manual.leader : '');
  rg(2, 17, 1, 1).setValue('ホテル').setBackground(HEAD)
    .setFontWeight('bold').setHorizontalAlignment('center');
  rg(2, 18, 1, 1).merge().setBackground('#FFFBEA')
    .setValue(manual && manual.hotel ? manual.hotel : '');
  frame(1, 13, 2, 18);
  sh.setRowHeights(1, 2, 28);

  rg(3, 1, 1, 2).merge().setValue('清掃終了時間').setBackground(HEAD)
    .setFontWeight('bold').setHorizontalAlignment('center');
  rg(3, 3, 1, 2).merge().setValue(last || '')
    .setHorizontalAlignment('center').setFontSize(12).setFontWeight('bold');
  rg(4, 1, 1, 2).merge().setValue('メイク人数').setBackground(HEAD)
    .setFontWeight('bold').setHorizontalAlignment('center');
  rg(4, 3, 1, 2).merge().setValue(Object.keys(who).length + ' 人')
    .setHorizontalAlignment('center').setFontSize(12).setFontWeight('bold');
  frame(3, 1, 4, 4);
  sh.setRowHeights(3, 2, 26);

  /* ── 数値ブロック（3列組・紙と同じ並び）───── */
  const grid = [
    ['清掃指示数',           n.order, '室', '未清掃数',     n.undone, '室', 'Ｄメイク(増設含む)', royal.length, '室'],
    ['アパエコ清掃数',       n.eco,   '室', 'アウト清掃数', n.out,    '室', '新規増設Ｄメイク',   nNew,         '室'],
    ['強制交換',             n.full,  '室', '除菌数',       n.real,   '室', '増設Ｄメイク解除',   nOff,         '室'],
    ['交換依頼',             n.linen, '室', '水設置',       n.water,  '本', 'ツイン数',           twin.length,  '室'],
    ['使用済みバッグ回収数', n.bag,   '室', 'ゴミ箱回収数', n.trash,  '室', '', '', '']
  ];
  const top = 6;
  grid.forEach((line, i) => {
    const y = top + i;
    for (let g = 0; g < 3; g++) {
      const c = 1 + g * 6;                         // A / G / M
      rg(y, c, 1, 3).merge().setValue(line[g * 3])
        .setBackground(HEAD).setFontWeight('bold')
        .setHorizontalAlignment('left').setWrap(false);
      rg(y, c + 3, 1, 2).merge().setValue(line[g * 3 + 1])
        .setHorizontalAlignment('right').setFontSize(13).setFontWeight('bold');
      rg(y, c + 5, 1, 1).setValue(line[g * 3 + 2])
        .setHorizontalAlignment('center').setFontSize(9).setFontColor('#777777');
    }
  });
  frame(top, 1, top + grid.length - 1, 18);
  sh.setRowHeights(top, grid.length, 26);

  /* ── 清掃内訳 ───────────────────── */
  let r = top + grid.length + 2;
  rg(r, 1, 1, 4).merge().setValue('★ 清掃内訳')
    .setFontSize(12).setFontWeight('bold');
  sh.setRowHeight(r, 26);
  r++;

  // 左の見出しは2列ぶん使う（紙と同じく「実質客室清掃数」が切れないように）
  const w = floors.length + 3;
  const table = [
    ['', '', ...floors, '合計'],
    ['ホテル指示数', '',   ...floors.map(f => byFloor[f].order),      n.order],
    ['実質客室清掃数', '', ...floors.map(f => byFloor[f].real),       n.real],
    ['ダブル設置数', '',   ...floors.map(f => byFloor[f].dbl || ''),  royal.length],
    ['ツイン数', '',       ...floors.map(f => byFloor[f].twin || ''), twin.length]
  ];
  sh.getRange(r, 1, 5, w).setValues(table);
  for (let i = 0; i < 5; i++) rg(r + i, 1, 1, 2).merge();
  rg(r, 1, 1, w).setBackground(HEAD).setFontWeight('bold').setHorizontalAlignment('center');
  rg(r, 1, 5, 2).setBackground(HEAD).setFontWeight('bold').setHorizontalAlignment('center').setFontSize(9);
  rg(r + 1, 3, 4, w - 2).setHorizontalAlignment('center').setFontSize(11);
  rg(r, w, 5, 1).setBackground('#FFF9E0').setFontWeight('bold');
  frame(r, 1, r + 4, w);
  sh.setRowHeights(r, 5, 25);
  r += 7;

  /* ── 未清掃内容報告 ──────────────── */
  const PER = 7;                                   // 1行に7組。紙と同じ
  const rowsNeed = Math.max(Math.ceil(need.length / PER), 5);
  const rowsNo   = Math.max(Math.ceil(noNeed.length / 2), 5);
  const RCOL = 16;                                 // 右ブロックは P 列から

  rg(r, 1, 1, PER * 2).merge()
    .setValue('未清掃内容報告（備品要）　　' + need.length + ' 室')
    .setFontWeight('bold').setBackground(HEAD).setHorizontalAlignment('center');
  rg(r, RCOL, 1, 4).merge()
    .setValue('未清掃（備品不要）　' + noNeed.length + ' 室')
    .setFontWeight('bold').setBackground(HEAD).setHorizontalAlignment('center');
  sh.setRowHeight(r, 24);
  r++;

  const mk = (arr, cols, rows) => {
    const out = [];
    for (let i = 0; i < rows; i++) {
      const line = [];
      for (let c = 0; c < cols; c++) {
        const idx = i * cols + c;
        line.push(idx < arr.length ? idx + 1 : '', arr[idx] || '');
      }
      out.push(line);
    }
    return out;
  };

  sh.getRange(r, 1, rowsNeed, PER * 2).setValues(mk(need, PER, rowsNeed))
    .setHorizontalAlignment('center').setFontSize(11);
  frame(r, 1, r + rowsNeed - 1, PER * 2);
  for (let c = 1; c <= PER * 2; c += 2) {
    rg(r, c, rowsNeed, 1).setBackground('#F4F6F7')
      .setFontColor('#A0A0A0').setFontSize(8);
  }

  sh.getRange(r, RCOL, rowsNo, 4).setValues(mk(noNeed, 2, rowsNo))
    .setHorizontalAlignment('center').setFontSize(11);
  frame(r, RCOL, r + rowsNo - 1, RCOL + 3);
  [RCOL, RCOL + 2].forEach(c => rg(r, c, rowsNo, 1)
    .setBackground('#F4F6F7').setFontColor('#A0A0A0').setFontSize(8));
  sh.setRowHeights(r, Math.max(rowsNeed, rowsNo), 22);
  r += Math.max(rowsNeed, rowsNo) + 1;

  /* ── 備考 ───────────────────────── */
  // 現場メモから作る行に、手で書き足した行を合わせる（同じ行は1つにする）
  const memos = uniq_(((manual && manual.memo) || []).concat(
    list.filter(x => x.memo)
      .sort((a, b) => cmpRoom_(a.room, b.room))
      .map(x => x.room + '　' + x.memo)));
  const memoRows = Math.max(memos.length + 1, 4);
  const memoTop = r;
  for (let i = 0; i < memoRows; i++) {
    rg(r + i, 1, 1, PER * 2).merge().setValue(memos[i] || '')
      .setHorizontalAlignment('left').setBackground('#FFFBEA');
  }
  frame(r, 1, r + memoRows - 1, PER * 2);
  sh.setRowHeights(r, memoRows, 22);

  /* ── レイトアウト（翌日清掃回し）────────── */
  // 翌日回しは19時以降のレイトアウトだけ。12時のレイトアウトは当日中に清掃する
  const lateRooms = list.filter(x => isNextDay_(x)).map(x => x.room).sort(cmpRoom_);
  rg(r, RCOL, 1, 4).merge().setValue('レイトアウト（翌日回し）')
    .setFontWeight('bold').setBackground(HEAD).setHorizontalAlignment('center');
  const lateRows = Math.max(Math.ceil(lateRooms.length / 4), 3);
  const lt = [];
  for (let i = 0; i < lateRows; i++) {
    const line = [];
    for (let c = 0; c < 4; c++) line.push(lateRooms[i * 4 + c] || '');
    lt.push(line);
  }
  sh.getRange(r + 1, RCOL, lateRows, 4).setValues(lt)
    .setHorizontalAlignment('center').setFontSize(11);
  frame(r, RCOL, r + lateRows, RCOL + 3);
  r += Math.max(memoRows, lateRows + 1) + 2;

  /* ── 指示書の記録（参考・紙にはない）────── */
  if (note) {
    rg(r, 1, 1, 4).merge().setValue('指示書の記録（参考）')
      .setFontWeight('bold').setFontColor('#6E7B87').setFontSize(11);
    r++;
    [['コネクト開閉', note.connect], ['ツイン', note.twins],
     ['コネクト（Ｗメイク）', note.connects], ['Ｗメイクの注意書き', note.dblNote]
    ].forEach(function (x) {
      if (!x[1]) return;
      rg(r, 1, 1, 3).merge().setValue(x[0]).setBackground('#F7F8F9').setFontSize(9);
      rg(r, 4, 1, 10).merge().setValue(x[1]).setFontSize(9);
      r++;
    });
    if (note.allNotes) {
      rg(r, 1, 1, 3).merge().setValue('全室共通の注意')
        .setBackground('#F7F8F9').setFontSize(9).setVerticalAlignment('top');
      rg(r, 4, 1, 10).merge().setValue(note.allNotes)
        .setWrap(true).setFontSize(9).setVerticalAlignment('top');
      sh.setRowHeight(r, 150);
    }
  }

  /* ── 体裁と印刷設定 ─────────────────── */
  sh.setColumnWidth(1, 54);
  for (let c = 2; c <= 20; c++) sh.setColumnWidth(c, 54);
  sh.setHiddenGridlines(true);
  sh.setFrozenRows(0);
  if (sh.getMaxColumns() > 20) sh.deleteColumns(21, sh.getMaxColumns() - 20);

  /*
   * 提出用の「日報」シートは毎回上書きするので、
   * 出した数字だけを「日報ログ」に1日1行で積んでおく。
   */
  appendDailyLog_([
    date, last || '', Object.keys(who).length,
    n.order, n.eco, n.out, n.full, n.linen, n.bag,
    n.undone, n.real, n.real, n.water, n.trash,
    royal.length, nNew, nOff, twin.length,
    new Date()
  ]);

  props_().setProperty('MAP_DAY', JSON.stringify({ date: date, memoTop: memoTop, memoRows: memoRows }));

  /*
   * やり残し。実績はチェック完了で数えるので、押し忘れがあると黙って数字が減る。
   * 日報を作ったときに、終わっていない部屋を並べて知らせる。
   */
  const pending = {
    noCheck: target.filter(x => !x.dd && !x.skip && x.check.state !== 'done')
                   .map(x => x.room).sort(cmpRoom_),
    inRoom:  list.filter(x => x.clean.state === 'doing' || x.check.state === 'doing')
                 .map(x => x.room + (x.clean.state === 'doing' ? '（清掃）' : '（チェック）'))
                 .sort(cmpRoom_),
    collect: list.filter(x => (x.pickup || x.bag) && !x.collectOk)
                 .map(x => x.room).sort(cmpRoom_),
    ddTodo:  list.filter(x => x.dd && x.supply !== '不要' && x.check.state !== 'done')
                 .map(x => x.room + (x.clean.state !== 'done' ? '（セット）' : '（チェック）'))
                 .sort(cmpRoom_)
  };

  // 責任者業務日報も同じ日付で作る
  let mgr = null;
  try { mgr = buildManagerReport_(date); } catch (e) { mgr = { error: e.message }; }

  return { date: date, url: ss.getUrl() + '#gid=' + sh.getSheetId(),
           undone: undone.length, people: Object.keys(who).length, last: last,
           pending: pending, mgr: mgr };
}


/*************************************************
 * 特別清掃シート
 *  フロアレポートの「特別清掃」と同じ形で出す。
 *  3項目それぞれについて、部屋ごとのマスに実施した日にちを書く。
 *  下に日別の実施数、実施数の合計、残数（実施数 − 全客室数）。
 *
 *  枠の中身はホテルの指定で毎月変わるので、その月の名前で見出しを付ける。
 *************************************************/
const SPECIAL_SHEET = '特別清掃';

/*************************************************
 * 手で書いた欄を残す
 *  日報・責任者業務日報は作り直すとシートを書き直すので、
 *  そのままだと手で書いた欄（氏名・クレーム・申し送りなど）が消える。
 *  作り直す前にシートから読み取って日付ごとに保存し、作り直したあと書き戻す。
 *************************************************/
function manualKey_(kind, date) { return 'MANUAL_' + kind + '_' + date; }

function saveManual_(kind, date, data) {
  if (!date || !data) return;
  props_().setProperty(manualKey_(kind, date), JSON.stringify(data).slice(0, 8500));
}

function loadManual_(kind, date) {
  try { return JSON.parse(props_().getProperty(manualKey_(kind, date)) || 'null'); }
  catch (e) { return null; }
}

/**
 * シートに今書かれている手書き欄を読み、そのシートの日付で保存する。
 * 読んだ内容と日付を返す。配置は作ったときに記録したものを使う。
 */
function captureManual_(kind, sh) {
  const map = JSON.parse(props_().getProperty('MAP_' + kind) || 'null');
  if (!sh || !map || !map.date) return null;
  const g = (r, c) => String(sh.getRange(r, c).getDisplayValue() || '').trim();
  const block = (top, rows, cols, step) => {
    if (!top) return [];
    const v = sh.getRange(top, 1, rows, cols).getDisplayValues();
    const out = [];
    v.forEach(line => { for (let c = 0; c < cols; c += step) out.push(String(line[c] || '').trim()); });
    return out;
  };
  let data;
  if (kind === 'MGR') {
    data = {
      name:   g(4, 9),
      pub:    (map.pubCells || []).map(([r, c]) => g(r, c)),
      att:    block(map.attTop, map.attRows, 12, 3).filter(Boolean),
      claim:  map.claim  ? g(map.claim, 1)  : '',
      report: map.report ? g(map.report, 1) : ''
    };
  } else {
    data = {
      leader: g(2, 15),
      hotel:  g(2, 18),
      memo:   map.memoTop ? sh.getRange(map.memoTop, 1, map.memoRows, 1).getDisplayValues()
                              .map(x => String(x[0] || '').trim()).filter(Boolean) : []
    };
  }
  saveManual_(kind, map.date, data);
  return { date: map.date, data: data };
}

/** 重複を取り除いて順番どおりに並べる */
function uniq_(a) {
  const seen = {};
  return a.filter(x => x && !seen[x] && (seen[x] = 1));
}

/** 古い手書き欄の保存を片づける（打刻ログの保存期間より古いもの） */
function cleanupManual_() {
  const limit = keepFrom_();
  const all = props_().getProperties();
  Object.keys(all).forEach(k => {
    const m = k.match(/^MANUAL_[A-Z]+_(\d{4}-\d{2}-\d{2})$/);
    if (m && m[1] < limit) props_().deleteProperty(k);
  });
}


/** 翌日回しの部屋。19時以降にお客様が出る部屋は当日中に清掃できない */
function isNextDay_(r) {
  return !!r.lateOut && String(r.lateOut) >= '19:00';
}


/*************************************************
 * フロアレポート
 *  ホテルに出している紙のフロアレポート（Excel）と同じ形で、階ごとに1枚ずつ出す。
 *  列幅・行の高さ・結合・罫線は紙に合わせてある。
 *
 *  1階ずつ全部のマスを組み立てるとGASの時間制限にかかるので、
 *  雛形のシートを1回だけ作って隠しておき、各階はそれを複製して値だけ流し込む。
 *************************************************/
const FR_PREFIX   = 'フロアレポート ';
const FR_TEMPLATE = '_フロアレポート雛形';
const FR_VERSION  = 'fr-v1';
const FR_SLOTS    = 17;      // 1フロアの部屋数の上限（紙と同じ）
const FR_TOP      = 6;       // 最初の部屋の行
const FR_COLS     = 27;      // A〜AA
const FR_FOOT     = FR_TOP + FR_SLOTS * 2;   // 清掃合計の行

/** 紙の列幅（Excelの幅を画面の px に直したもの） */
const FR_WIDTH = [41, 37, 45, 64, 64, 64, 64, 64, 54, 46, 80, 64, 96,
                  120, 41, 137, 64, 15, 54, 76, 64, 64, 50, 67, 64, 64, 27];

const DD_SET_TEXT = '・バスタオル　・フェイスタオル　・浴衣　・紙コップ（ブラック/オレンジ）\n'
                  + '・ボディタオル　・歯磨き粉　・綿棒　・コットン　・お茶　・コーヒーセット';

/** 雛形を作る。罫線・結合・固定の文字だけ入れて、値は入れない */
function buildFloorTemplate_(ss) {
  let sh = ss.getSheetByName(FR_TEMPLATE);
  if (sh && sh.getRange('AB1').getValue() === FR_VERSION) return sh;
  if (sh) ss.deleteSheet(sh);
  sh = ss.insertSheet(FR_TEMPLATE);

  const need = FR_FOOT + 12;
  if (sh.getMaxRows() < need) sh.insertRowsAfter(sh.getMaxRows(), need - sh.getMaxRows());
  if (sh.getMaxColumns() < 28) sh.insertColumnsAfter(sh.getMaxColumns(), 28 - sh.getMaxColumns());

  const MED = SpreadsheetApp.BorderStyle.SOLID_MEDIUM;
  const THIN = SpreadsheetApp.BorderStyle.SOLID;
  const rg = (a) => sh.getRange(a);
  const box = (a, style) => rg(a).setBorder(true, true, true, true, null, null, '#000000', style || MED);

  FR_WIDTH.forEach((w, i) => sh.setColumnWidth(i + 1, w));
  sh.getRange(1, 1, need, FR_COLS).setFontSize(11).setVerticalAlignment('middle')
    .setHorizontalAlignment('center').setFontWeight('bold');

  /* ── 見出し ── */
  sh.setRowHeight(1, 11); sh.setRowHeight(2, 44); sh.setRowHeight(3, 36);
  sh.setRowHeight(4, 25); sh.setRowHeight(5, 25);
  rg('A2:I2').merge().setFontSize(24).setVerticalAlignment('top');
  rg('S2:W2').merge().setFontSize(14).setFontWeight('normal');
  rg('X2:AA2').merge().setFontSize(14).setFontWeight('normal');
  rg('S3:W3').merge().setFontSize(14).setFontWeight('normal');
  rg('C3:H3').merge().setFontSize(16).setHorizontalAlignment('left').setVerticalAlignment('bottom');
  rg('K3').setValue('担当者：').setFontSize(16).setVerticalAlignment('bottom');
  rg('L3:Q3').merge().setFontSize(13).setHorizontalAlignment('left').setVerticalAlignment('bottom');

  const head = [
    ['A4:B5', 'ROOM', 12], ['C4:C5', 'リネン\n回収', 9], ['D4:D5', 'ゴミ\n回収', 9],
    ['E4:E5', 'OUT', 12], ['F4:H4', 'STAY', 12], ['F5', 'STAY', 10], ['G5', 'FULL', 10], ['H5', 'DD', 10],
    ['I4:I5', '冷蔵庫', 11], ['J4:J5', '水', 12], ['K4:M4', '清掃スタッフ', 12],
    ['K5', '入室時間', 10], ['L5', '退出時間', 10], ['M5', '担当者', 10],
    ['N4:S5', '忘れ物・お客様から言われたこと・シーツ類の交換をしたなど', 11],
    ['T4:T5', '', 9], ['U4:U5', '', 9], ['V4:V5', '', 9],
    ['W4:W5', '冷蔵庫', 10], ['X4:Z4', 'チェッカー', 12],
    ['X5', '入室時間', 10], ['Y5', '退出時間', 10], ['Z5', '担当者', 10], ['AA4:AA5', '号\n室', 10]
  ];
  head.forEach(([a, v, sz]) => {
    const r = rg(a);
    if (a.indexOf(':') > 0) r.merge();
    r.setValue(v).setFontSize(sz).setWrap(true);
  });
  sh.getRange('A4:AA5').setBorder(true, true, true, true, true, true, '#000000', MED);

  /* ── 部屋の行（1部屋2行） ── */
  sh.setRowHeights(FR_TOP, FR_SLOTS * 2, 22);
  for (let i = 0; i < FR_SLOTS; i++) {
    const r = FR_TOP + i * 2;
    sh.getRange(r, 1, 2, 8).mergeVertically();      // A〜H
    sh.getRange(r, 10, 2, 4).mergeVertically();     // J〜M
    sh.getRange(r, 14, 2, 6).merge();               // N〜S（メモ）
    sh.getRange(r, 20, 2, 3).mergeVertically();     // T〜V（特別清掃）
    sh.getRange(r, 24, 2, 4).mergeVertically();     // X〜AA
    sh.getRange(r, 1, 2, FR_COLS)
      .setBorder(true, true, true, true, true, null, '#000000', THIN);
    sh.getRange(r, 1, 1, FR_COLS)
      .setBorder(true, null, null, null, null, null, '#000000', MED);
  }
  // 縦の太線（紙と同じ区切り）
  [[1, 2], [3, 3], [4, 4], [5, 8], [9, 9], [10, 10], [11, 13], [14, 19],
   [20, 22], [23, 23], [24, 26], [27, 27]].forEach(([c1, c2]) =>
    sh.getRange(FR_TOP, c1, FR_SLOTS * 2, c2 - c1 + 1)
      .setBorder(true, true, true, true, null, null, '#000000', MED));

  sh.getRange(FR_TOP, 14, FR_SLOTS * 2, 6).setHorizontalAlignment('left')
    .setWrap(true).setFontWeight('normal').setFontSize(10);
  sh.getRange(FR_TOP, 2, FR_SLOTS * 2, 1).setFontSize(20).setFontWeight('normal');
  sh.getRange(FR_TOP, 11, FR_SLOTS * 2, 2).setNumberFormat('@').setFontSize(12);
  sh.getRange(FR_TOP, 24, FR_SLOTS * 2, 2).setNumberFormat('@').setFontSize(12);
  sh.getRange(FR_TOP, 13, FR_SLOTS * 2, 1).setFontSize(9).setWrap(true);
  sh.getRange(FR_TOP, 26, FR_SLOTS * 2, 1).setFontSize(9).setWrap(true);

  /* ── 下の集計 ── */
  const F = FR_FOOT;
  sh.setRowHeights(F, 2, 20); sh.setRowHeight(F + 2, 10);
  sh.setRowHeight(F + 3, 18); sh.setRowHeight(F + 4, 10);
  sh.setRowHeights(F + 5, 2, 44); sh.setRowHeight(F + 7, 24);
  sh.setRowHeight(F + 8, 43); sh.setRowHeight(F + 9, 50);

  sh.getRange(F, 1, 3, 2).merge().setValue('清掃合計');
  for (let c = 3; c <= 8; c++) sh.getRange(F, c, 3, 1).merge().setHorizontalAlignment('right');
  sh.getRange(F, 9, 3, 1).merge().setValue('水\n合計').setWrap(true);
  sh.getRange(F, 10, 3, 1).merge().setHorizontalAlignment('right');
  sh.getRange(F, 11, 3, 4).merge().setValue('ドア前（DD）\nセット内容').setWrap(true).setFontSize(10);
  sh.getRange(F, 15, 3, 13).merge().setValue(DD_SET_TEXT).setWrap(true)
    .setFontSize(10).setFontWeight('normal');
  sh.getRange(F, 1, 3, FR_COLS).setBorder(true, true, true, true, true, null, '#000000', MED);

  sh.getRange(F + 3, 1, 2, 10).merge().setValue('DD（ドア前セット）設置した号室')
    .setFontSize(13).setHorizontalAlignment('left');

  // DDの号室欄。番号の右に「号室」
  FR_DD_CELLS.forEach(([num, lab], i) => {
    const row = F + 5 + (i < 9 ? 0 : 1);
    sh.getRange(row, num).setFontSize(13);
    sh.getRange(row, lab).setValue('号室').setFontSize(9)
      .setBorder(null, true, null, null, null, null, '#000000', MED);
  });
  sh.getRange(F + 6, 25, 1, 2).merge().setHorizontalAlignment('right');
  sh.getRange(F + 5, 1, 2, 26).setBorder(true, true, true, true, null, true, '#000000', MED);

  sh.getRange(F + 7, 18, 1, 9).merge().setValue('本日の清掃合計件数').setFontSize(13);
  [['S', 'T', 'アウト'], ['U', 'V', 'ステイ\n（清掃札あり）'], ['W', 'X', 'フルメイク'],
   ['Y', 'Z', 'トータル室数']].forEach(([a, b, v]) => {
    rg(a + (F + 8) + ':' + b + (F + 8)).merge().setValue(v).setWrap(true).setFontSize(11);
    rg(a + (F + 9) + ':' + b + (F + 9)).merge().setHorizontalAlignment('right').setFontSize(16);
  });
  box('S' + (F + 8) + ':Z' + (F + 9));
  sh.getRange('S' + (F + 8) + ':Z' + (F + 9))
    .setBorder(null, null, null, null, true, true, '#000000', MED);

  sh.setHiddenGridlines(true);
  sh.getRange('AB1').setValue(FR_VERSION).setFontColor('#FFFFFF');
  sh.hideSheet();
  return sh;
}

/** DD号室欄の位置 [番号の列, 「号室」の列]。1段目9つ、2段目8つ＋合計 */
const FR_DD_CELLS = [
  [4, 5], [9, 10], [11, 12], [13, 14], [15, 16], [17, 18], [19, 20], [23, 24], [25, 26],
  [4, 5], [9, 10], [11, 12], [13, 14], [15, 16], [17, 18], [19, 20], [23, 24]
];

/** 半角数字を全角に（紙の表題が「２F」なので） */
function zen_(s) {
  return String(s).replace(/[0-9]/g, d => String.fromCharCode(d.charCodeAt(0) + 0xFEE0));
}

/** フロアレポート（全階＋PDF）を作る。重いので同時に2つは走らせない */
function buildFloorReport_(dateStr) {
  return busyGuard_('busy:floor', () => buildFloorReport_(dateStr));
}

function buildFloorReport_(dateStr) {
  const date = dateStr || today_();
  const ss = ss_();
  const log = ss.getSheetByName(SHEET.LOG);
  const list = dayBlock_(log, date, NCOL)
    .filter(r => String(r[1]).trim()).map(rowToRoom_);
  if (!list.length) throw new Error(date + ' の記録がありません。先に指示を取り込んで保存してください');

  // 特別清掃：その月の、その日までに最後にやった日にち
  const month = date.slice(0, 7);
  const names = getSpecialNames(month).names;
  const mrows = log.getLastRow() < 2 ? []
    : log.getRange(2, 1, log.getLastRow() - 1, NCOL).getValues()
        .filter(r => { const d = normDate_(r[0]); return d.indexOf(month) === 0 && d <= date; });
  const spDay = {};                                  // 部屋 → [日,日,日]
  mrows.forEach(r => {
    const no = String(r[1]).trim(), d = Number(normDate_(r[0]).slice(8, 10));
    SPECIAL.forEach(([key, col], i) => {
      if (!bool_(r[col - 1])) return;
      if (!spDay[no]) spDay[no] = ['', '', ''];
      if (!spDay[no][i] || d > spDay[no][i]) spDay[no][i] = d;
    });
  });

  const tpl = buildFloorTemplate_(ss);
  const byFloor = {};
  list.forEach(r => { (byFloor[r.floor] = byFloor[r.floor] || []).push(r); });
  const floors = Object.keys(byFloor).sort((a, b) => parseInt(a, 10) - parseInt(b, 10));

  const GREY = '#AAAAAA', INK = '#000000', MARK = '#FFF2A8', WHITE = '#FFFFFF';
  const made = [];

  floors.forEach(f => {
    const rooms = byFloor[f].sort((a, b) => cmpRoom_(a.room, b.room)).slice(0, FR_SLOTS);
    const name = FR_PREFIX + f;
    const old = ss.getSheetByName(name);
    if (old) ss.deleteSheet(old);
    const sh = tpl.copyTo(ss).setName(name);
    sh.showSheet();
    sh.getRange('AB1').clearContent();

    /* 見出し */
    sh.getRange('A2').setValue('フロアレポート　' + zen_(f));
    sh.getRange('C3').setValue(date.replace(/-/g, '/'));
    const who = {};
    rooms.forEach(r => { if (r.clean.staff) who[r.clean.staff] = 1; });
    sh.getRange('L3').setValue(Object.keys(who).join('・'));
    sh.getRange('S2').setValue(names[0] || '');
    sh.getRange('S3').setValue(names[1] || '');
    sh.getRange('X2').setValue(names[2] || '');
    sh.getRange('T4').setValue(names[0] || '');
    sh.getRange('U4').setValue(names[1] || '');
    sh.getRange('V4').setValue(names[2] || '');

    /* 部屋の行をまとめて作る（値・文字色・背景を1回ずつ書く） */
    const N = FR_SLOTS * 2;
    const val = [], col = [], bg = [];
    for (let i = 0; i < N; i++) {
      val.push(new Array(FR_COLS).fill(''));
      col.push(new Array(FR_COLS).fill(INK));
      bg.push(new Array(FR_COLS).fill(WHITE));
    }
    rooms.forEach((r, i) => {
      const t = i * 2, b = t + 1;
      const suf = String(parseInt(r.room.slice(-2), 10)) + (r.twin ? 'TW' : '');
      const V = val[t], C = col[t], B = bg[t];

      V[0] = suf;
      V[1] = (r.kbn === 'OUT' && r.code === 'O') ? '☑' : '□';
      V[2] = r.bag ? '○' : '';
      V[3] = r.pickup ? '○' : '';

      // O / S / F / DD：該当するものだけ黒の太字＋黄色。ほかは紙と同じグレー
      [['O', 4, r.kbn === 'OUT'], ['S', 5, r.kbn === 'STAY'],
       ['F', 6, r.kbn === 'FULL'], ['DD', 7, !!r.dd]].forEach(([s, c, on]) => {
        V[c] = s; C[c] = on ? INK : GREY; B[c] = on ? MARK : WHITE;
      });

      // 冷蔵庫（清掃時 I列 / チェック時 W列）：上がON、下がOFF
      [[8, r.fridge], [22, r.fridgeCheck]].forEach(([c, v]) => {
        val[t][c] = 'ON'; val[b][c] = 'OFF';
        col[t][c] = v === 'ON'  ? INK : GREY; bg[t][c] = v === 'ON'  ? MARK : WHITE;
        col[b][c] = v === 'OFF' ? INK : GREY; bg[b][c] = v === 'OFF' ? MARK : WHITE;
      });

      V[9]  = (r.water !== '' && r.water != null) ? r.water + ' 本' : '本';
      V[10] = r.clean.start  || '：';
      V[11] = r.clean.finish || '：';
      V[12] = r.clean.staff  || '';
      // 備考：業務中の追加指示と現場メモ
      V[13] = [r.order ? '指示：' + r.order : '', r.memo || ''].filter(Boolean).join(' / ');
      const sd = spDay[r.room] || ['', '', ''];
      V[19] = sd[0]; V[20] = sd[1]; V[21] = sd[2];
      V[23] = r.check.start  || '：';
      V[24] = r.check.finish || '：';
      V[25] = r.check.staff  || '';
      V[26] = suf;
    });
    const block = sh.getRange(FR_TOP, 1, N, FR_COLS);
    block.setValues(val);
    block.setFontColors(col);
    block.setBackgrounds(bg);

    // 部屋の無い枠は隠す
    if (rooms.length < FR_SLOTS) {
      sh.hideRows(FR_TOP + rooms.length * 2, (FR_SLOTS - rooms.length) * 2);
    }

    /* 下の集計 */
    const F = FR_FOOT;
    const cnt = fn => rooms.filter(fn).length;
    const water = rooms.reduce((a, r) => a + (Number(r.water) || 0), 0);
    sh.getRange(F, 3).setValue(cnt(r => r.bag) + ' 室');
    sh.getRange(F, 4).setValue(cnt(r => r.pickup) + ' 室');
    sh.getRange(F, 5).setValue(cnt(r => r.kbn === 'OUT') + ' 室');
    sh.getRange(F, 6).setValue(cnt(r => r.kbn === 'STAY') + ' 室');
    sh.getRange(F, 7).setValue(cnt(r => r.kbn === 'FULL') + ' 室');
    sh.getRange(F, 8).setValue(cnt(r => r.dd) + ' 室');
    sh.getRange(F, 10).setValue(water + ' 本');

    const dd = rooms.filter(r => r.dd).map(r => r.room);
    FR_DD_CELLS.forEach(([num], i) => {
      const row = F + 5 + (i < 9 ? 0 : 1);
      sh.getRange(row, num).setValue(dd[i] || '');
    });
    sh.getRange(F + 6, 25).setValue('合計　' + dd.length + ' 室');

    // 本日の清掃合計件数：DD以外で、チェックまで終わった部屋
    const done = r => !r.dd && r.check.state === 'done';
    const o = cnt(r => r.kbn === 'OUT'  && done(r));
    const s = cnt(r => r.kbn === 'STAY' && done(r));
    const u = cnt(r => r.kbn === 'FULL' && done(r));
    sh.getRange('S' + (F + 9)).setValue(o + ' 室');
    sh.getRange('U' + (F + 9)).setValue(s + ' 室');
    sh.getRange('W' + (F + 9)).setValue(u + ' 室');
    sh.getRange('Y' + (F + 9)).setValue((o + s + u) + ' 室');

    made.push(f);
  });

  // 前回つくったが今回は無い階のシートは消す
  ss.getSheets().forEach(sh => {
    const n = sh.getName();
    if (n.indexOf(FR_PREFIX) === 0 && made.indexOf(n.slice(FR_PREFIX.length)) < 0) ss.deleteSheet(sh);
  });

  const first = ss.getSheetByName(FR_PREFIX + made[0]);

  // 全階をまとめたPDFも作る。失敗してもシートはできているので止めない
  let pdf = '', pdfError = '';
  try { pdf = exportFloorPdf_(date, made); } catch (e) { pdfError = e.message; }

  return { date: date, floors: made, url: ss.getUrl() + '#gid=' + first.getSheetId(),
           pdf: pdf, pdfError: pdfError };
}

/**
 * フロアレポート全階を1つのPDFにして、スプレッドシートと同じフォルダの
 * 「フロアレポートPDF」フォルダに保存する。同じ日付のPDFは作り直す。
 *
 * 一部のシートだけをPDFにする方法が無いので、各階を一時的なスプレッドシートに写して
 * 丸ごとPDFにし、写したものは捨てる。A4横・幅に合わせる・グリッド線なし。
 */
function exportFloorPdf_(date, floors) {
  const ss = ss_();
  const tmp = SpreadsheetApp.create('tmp_フロアレポート_' + date);
  try {
    floors.forEach(f => {
      const src = ss.getSheetByName(FR_PREFIX + f);
      if (src) src.copyTo(tmp).setName(f);
    });
    tmp.getSheets().forEach(sh => { if (floors.indexOf(sh.getName()) < 0) tmp.deleteSheet(sh); });
    SpreadsheetApp.flush();

    const url = 'https://docs.google.com/spreadsheets/d/' + tmp.getId() + '/export?format=pdf'
      + '&size=A4&portrait=false&fitw=true&gridlines=false&printtitle=false&sheetnames=false'
      + '&pagenum=UNDEFINED&horizontal_alignment=CENTER'
      + '&top_margin=0.3&bottom_margin=0.3&left_margin=0.3&right_margin=0.3';
    const res = UrlFetchApp.fetch(url, {
      headers: { Authorization: 'Bearer ' + ScriptApp.getOAuthToken() },
      muteHttpExceptions: true
    });
    if (res.getResponseCode() !== 200) throw new Error('PDFを作れませんでした（' + res.getResponseCode() + '）');

    const name = 'フロアレポート_' + date + '.pdf';
    const folder = pdfFolder_();
    const old = folder.getFilesByName(name);
    while (old.hasNext()) old.next().setTrashed(true);
    return folder.createFile(res.getBlob().setName(name)).getUrl();
  } finally {
    DriveApp.getFileById(tmp.getId()).setTrashed(true);
  }
}

function pdfFolder_() {
  const parents = DriveApp.getFileById(ss_().getId()).getParents();
  const base = parents.hasNext() ? parents.next() : DriveApp.getRootFolder();
  const it = base.getFoldersByName('フロアレポートPDF');
  return it.hasNext() ? it.next() : base.createFolder('フロアレポートPDF');
}


const MANAGER_SHEET = '責任者業務日報';
const FACILITY_NAME = 'アパホテル新大阪南方駅前';

/**
 * 紙の特別清掃欄。左7行と、右下の換気口2行。
 * 今月の3枠の名前を、どの行に入れるかを当てはめる関数で決める。
 * どの行にも当たらない枠（ホテル指定の3枠目など）は、右の空いている行に名前ごと出す。
 */
const MANAGER_SP_LEFT = [
  ['エアコンフィルター ／ 掃除機',                       n => /エアコン/.test(n) && /掃除機/.test(n)],
  ['エアコンフィルター ／ 水洗い清掃',                   n => /エアコン/.test(n) && /水洗い/.test(n)],
  ['バスルーム ／ 排水溝',                               n => /排水/.test(n)],
  ['バスルーム ／ 換気扇',                               n => /換気扇/.test(n)],
  ['ベッド下冷蔵庫裏埃除塵＆マットレス回転',             n => /ベッド下|冷蔵庫裏|マットレス/.test(n)],
  ['ツインルーム空気清浄機フィルター/掃除機清掃',        n => /空気清浄機/.test(n) && /掃除機/.test(n)],
  ['ツインルーム空気清浄機フィルター/水洗い清掃',        n => /空気清浄機/.test(n) && /水洗い/.test(n)]
];

/** パブリック特別清掃。紙と同じく左3行・右1行（右の残り2行は空欄） */
const PUBLIC_LEFT  = ['客室窓ガラス（外面）', '1階エントランス自動ドア（2枚）', '1階ロビー鏡面清掃'];
const PUBLIC_RIGHT = ['1階テナントガラス面清掃', '', ''];
const PUBLIC_ROWS  = PUBLIC_LEFT.concat(PUBLIC_RIGHT);   // 手書き欄の保存で使う並び

function buildManagerReport_(dateStr) {
  const date = dateStr || today_();
  const ss = ss_();
  const list = dayBlock_(ss.getSheetByName(SHEET.LOG), date, NCOL)
    .filter(r => String(r[1]).trim()).map(rowToRoom_);

  const checked = r => r.check.state === 'done';
  const target  = list.filter(r => ['OUT','STAY','FULL'].indexOf(r.kbn) >= 0);

  const n = {
    clean:   target.filter(r => !r.dd && checked(r)).length,   // DD除く
    ddNeed:  list.filter(r => r.dd && r.supply !== '不要').length,
    ddNo:    list.filter(r => r.dd && r.supply === '不要').length,
    nextDay: list.filter(r => isNextDay_(r)).length
  };

  // ダブル・ツインは日報と同じ数え方（DD対応の部屋は除く）
  const dm    = target.filter(r => !r.dd && checked(r));
  const royal = dm.filter(x => ROYAL_SET.indexOf(x.dmake) >= 0).length;
  const twin  = dm.filter(x => x.twin).length;
  const nNew  = dm.filter(x => x.dmake === '新規').length;
  const nOff  = dm.filter(x => x.dmake === '解除').length;

  // 特別清掃：今月の3枠を紙の行に当てはめる
  const names = getSpecialNames(date.slice(0, 7)).names;
  const leftCnt = MANAGER_SP_LEFT.map(() => 0);
  const vent = [];                                     // 換気口の行（右下2行）
  const other = [];                                    // どこにも当たらない枠
  SPECIAL.forEach(([key], i) => {
    const nm = names[i];
    if (!nm) return;
    const cnt = list.filter(r => r[key]).length;
    if (/換気口/.test(nm)) { vent.push(cnt); return; }
    const at = MANAGER_SP_LEFT.findIndex(x => x[1](nm));
    if (at >= 0) leftCnt[at] += cnt;
    else other.push([nm, cnt]);
  });

  // 出勤者：清掃かチェックで入室した人。名簿の並び順
  const staff = getStaffList();
  const came = {};
  list.forEach(r => {
    if (r.clean.staff) came[r.clean.staff] = 1;
    if (r.check.staff) came[r.check.staff] = 1;
  });
  let attend = staff.filter(x => came[x])
    .concat(Object.keys(came).filter(x => staff.indexOf(x) < 0));

  /*************** 描画 ***************/
  let sh = ss.getSheetByName(MANAGER_SHEET);

  // 作り直す前に手書き欄を保存。同じ日付ならそれを、別の日付なら保存してあったその日の分を使う
  const cap = sh ? captureManual_('MGR', sh) : null;
  const manual = (cap && cap.date === date) ? cap.data : loadManual_('MGR', date);
  if (manual && manual.att) attend = uniq_(manual.att.concat(attend));

  if (!sh) sh = ss.insertSheet(MANAGER_SHEET);
  sh.clear();
  sh.clearFormats();
  sh.getRange(1, 1, 200, 12).clearDataValidations();
  sh.getRange(1, 1, 200, 12).breakApart();

  const INK = '#1A1A1A', INPUT = '#FFFBEA', LINE = '#333333';
  const SOLID  = SpreadsheetApp.BorderStyle.SOLID;
  const MED    = SpreadsheetApp.BorderStyle.SOLID_MEDIUM;
  const DOTTED = SpreadsheetApp.BorderStyle.DOTTED;
  const rg = (r1, c1, nr, nc) => sh.getRange(r1, c1, nr || 1, nc || 1);
  /** 紙と同じ下線 */
  const under = (r1, c1, nc) => rg(r1, c1, 1, nc)
    .setBorder(null, null, true, null, null, null, LINE, MED);
  /** 表の枠。外も中も細線 */
  const table = (r1, c1, nr, nc) => rg(r1, c1, nr, nc)
    .setBorder(true, true, true, true, null, true, LINE, SOLID);

  sh.getRange(1, 1, 200, 12).setFontSize(11).setFontColor(INK).setVerticalAlignment('middle');

  const staffRule = staff.length
    ? SpreadsheetApp.newDataValidation().requireValueInList(staff, true).setAllowInvalid(false).build()
    : null;

  /* ── 表題・日付・所属先・氏名 ── */
  rg(1, 1, 1, 12).merge().setValue('【責任者業務日報 】')
    .setFontSize(18).setHorizontalAlignment('center');
  sh.setRowHeight(1, 40);
  sh.setRowHeight(2, 10);

  rg(3, 8).setValue('日付：');
  rg(3, 9, 1, 4).merge().setValue(date.replace(/-/g, '/')).setFontSize(14);
  under(3, 8, 5);
  rg(4, 1).setValue('所属先：');
  rg(4, 2, 1, 5).merge().setValue(FACILITY_NAME).setFontSize(13).setHorizontalAlignment('center');
  under(4, 1, 6);
  rg(4, 8).setValue('氏名：');
  rg(4, 9, 1, 4).merge().setFontSize(14).setBackground(INPUT);
  if (staffRule) rg(4, 9).setDataValidation(staffRule);
  under(4, 8, 5);
  sh.setRowHeights(3, 2, 30);
  sh.setRowHeight(5, 10);

  /* ── 本日の清掃実績 ── */
  rg(6, 1, 3, 3).merge().setValue('本日の清掃実績');
  const L = (row, label, val) => {                    // 中央の列：清掃数・翌日回し
    rg(row, 4, 1, 2).merge().setValue(label);
    rg(row, 6).setValue(val).setHorizontalAlignment('right').setFontSize(13);
    rg(row, 7).setValue('室').setHorizontalAlignment('center');
    under(row, 4, 4);
  };
  const R = (row, label, val) => {                    // 右の列：DD・合計
    rg(row, 8, 1, 3).merge().setValue(label);
    const c = rg(row, 11).setHorizontalAlignment('right').setFontSize(13);
    if (val !== null) c.setValue(val);
    rg(row, 12).setValue('室').setHorizontalAlignment('center');
    under(row, 8, 5);
  };
  L(6, '清掃数',   n.clean);
  L(8, '翌日回し', n.nextDay);
  R(6, 'D/D（ドア前あり）', n.ddNeed);
  R(7, 'D/D（ドア前なし）', n.ddNo || '');
  R(8, '合計室数', null);
  rg(8, 11).setFormula('=F6+K6+N(K7)');               // 清掃数＋DDあり＋DDなし
  sh.setRowHeights(6, 3, 30);
  sh.setRowHeight(9, 14);

  /* ── 特別清掃実績 ── */
  rg(10, 1, 1, 6).merge().setValue('◇特別清掃実績').setFontSize(12);
  sh.setRowHeight(10, 30);
  const spTop = 11;
  const right = [['ダブルメイク', royal], ['ツインメイク', twin],
                 other[0] ? [other[0][0], other[0][1]] : null,
                 ['ダブル増設', nNew], ['ダブル解除', nOff],
                 ['換気口', vent[0] || 0], ['換気口', vent[1] || 0]];
  MANAGER_SP_LEFT.forEach((x, i) => {
    const row = spTop + i;
    rg(row, 1, 1, 6).merge().setValue(x[0]).setFontSize(10.5);
    rg(row, 7).setValue(leftCnt[i]).setHorizontalAlignment('right').setFontSize(12);
    rg(row, 8).setValue('室').setHorizontalAlignment('center');
    const rr = right[i];
    rg(row, 9, 1, 2).merge().setValue(rr ? rr[0] : '').setFontSize(rr && rr[0].length > 7 ? 9 : 11);
    rg(row, 11).setValue(rr ? rr[1] : '').setHorizontalAlignment('right').setFontSize(12);
    rg(row, 12).setValue(rr ? '室' : '').setHorizontalAlignment('center');
  });
  const spN = MANAGER_SP_LEFT.length;
  table(spTop, 1, spN, 12);
  rg(spTop, 7, spN, 1).setBorder(null, true, null, null, null, null, LINE, DOTTED);
  rg(spTop, 9, spN, 1).setBorder(null, true, null, null, null, null, LINE, SOLID);
  rg(spTop, 11, spN, 1).setBorder(null, true, null, null, null, null, LINE, DOTTED);
  sh.setRowHeights(spTop, spN, 30);
  // 紙の行に無い枠がもう1つあれば、その下に足す
  let r = spTop + spN;
  other.slice(1).forEach(([nm, cnt]) => {
    rg(r, 1, 1, 6).merge().setValue(nm).setFontSize(10.5);
    rg(r, 7).setValue(cnt).setHorizontalAlignment('right').setFontSize(12);
    rg(r, 8).setValue('室').setHorizontalAlignment('center');
    table(r, 1, 1, 8);
    sh.setRowHeight(r, 30);
    r++;
  });
  sh.setRowHeight(r, 14);
  r++;

  /* ── パブリック特別清掃実績（手入力） ── */
  rg(r, 1, 1, 6).merge().setValue('◇パブリック特別清掃実績').setFontSize(12);
  sh.setRowHeight(r, 30);
  r++;
  const pTop = r;
  const pubCells = [];
  for (let i = 0; i < 3; i++) {
    const row = pTop + i;
    rg(row, 1, 1, 4).merge().setValue(PUBLIC_LEFT[i]).setFontSize(10.5);
    rg(row, 5).setBackground(INPUT).setHorizontalAlignment('right').setFontSize(12);
    rg(row, 6).setValue('回').setHorizontalAlignment('center');
    pubCells.push([row, 5]);
    rg(row, 7, 1, 4).merge().setValue(PUBLIC_RIGHT[i]).setFontSize(10.5);
    rg(row, 11).setBackground(INPUT).setHorizontalAlignment('right').setFontSize(12);
    rg(row, 12).setValue(PUBLIC_RIGHT[i] ? '回' : '室').setHorizontalAlignment('center');
  }
  for (let i = 0; i < 3; i++) pubCells.push([pTop + i, 11]);
  table(pTop, 1, 3, 12);
  rg(pTop, 5, 3, 1).setBorder(null, true, null, null, null, null, LINE, DOTTED);
  rg(pTop, 7, 3, 1).setBorder(null, true, null, null, null, null, LINE, SOLID);
  rg(pTop, 11, 3, 1).setBorder(null, true, null, null, null, null, LINE, DOTTED);
  sh.setRowHeights(pTop, 3, 30);
  r = pTop + 3;
  sh.setRowHeight(r, 14);
  r++;

  /* ── 出勤者（名簿のプルダウン） ── */
  const COLS = 4, NROW = Math.max(5, Math.ceil(attend.length / COLS));
  const aTop = r;
  for (let i = 0; i < NROW; i++) {
    for (let c = 0; c < COLS; c++) {
      const cell = rg(aTop + i, 1 + c * 3, 1, 3).merge()
        .setHorizontalAlignment('center').setFontSize(10.5).setBackground(INPUT);
      if (staffRule) rg(aTop + i, 1 + c * 3).setDataValidation(staffRule);
      const nm = attend[i * COLS + c];
      if (nm) cell.setValue(nm);
    }
  }
  rg(aTop, 1, NROW, 12).setBorder(true, true, true, true, true, true, LINE, SOLID);
  rg(aTop, 1, NROW, 12).setBorder(true, true, true, true, null, null, LINE, MED);
  sh.setRowHeights(aTop, NROW, 30);
  r = aTop + NROW;

  rg(r, 9, 1, 2).merge().setValue('合計');
  rg(r, 11).setFormula('=COUNTA(' + rg(aTop, 1, NROW, 12).getA1Notation() + ')')
    .setHorizontalAlignment('right').setFontSize(13);
  rg(r, 12).setValue('人').setHorizontalAlignment('center');
  under(r, 9, 4);
  sh.setRowHeight(r, 30);
  r += 2;

  /* ── 自由記入欄 ── */
  const freeRows = [];
  [['◇フロントから報告があったクレーム内容・要望など', 6],
   ['◇明日の責任者への報告事項', 5]].forEach(([ttl, h]) => {
    rg(r, 1, 1, 12).merge().setValue(ttl).setFontSize(12);
    sh.setRowHeight(r, 30);
    r++;
    rg(r, 1, h, 12).merge().setBackground(INPUT).setVerticalAlignment('top').setWrap(true);
    rg(r, 1, h, 12).setBorder(true, true, true, true, null, null, LINE, MED);
    sh.setRowHeights(r, h, 24);
    freeRows.push(r);
    r += h + 1;
  });

  /* ── 手で書いた欄を書き戻す ── */
  if (manual) {
    if (manual.name) rg(4, 9).setValue(manual.name);
    (manual.pub || []).forEach((v, i) => { if (v !== '' && pubCells[i]) rg(pubCells[i][0], pubCells[i][1]).setValue(v); });
    if (manual.claim)  rg(freeRows[0], 1).setValue(manual.claim);
    if (manual.report) rg(freeRows[1], 1).setValue(manual.report);
  }
  props_().setProperty('MAP_MGR', JSON.stringify({
    date: date, pubCells: pubCells, attTop: aTop, attRows: NROW,
    claim: freeRows[0], report: freeRows[1]
  }));

  for (let c = 1; c <= 12; c++) sh.setColumnWidth(c, 56);
  sh.setHiddenGridlines(true);
  if (sh.getMaxColumns() > 12) sh.deleteColumns(13, sh.getMaxColumns() - 12);

  return { date: date, url: ss.getUrl() + '#gid=' + sh.getSheetId(),
           clean: n.clean, people: attend.length };
}

function buildSpecialSheet_(ym) {
  const month = ym || Utilities.formatDate(new Date(), 'Asia/Tokyo', 'yyyy-MM');
  const ss = ss_();
  const conf = getSpecialNames(month);

  const log = ss.getSheetByName(SHEET.LOG);
  const rows = log.getLastRow() < 2 ? []
    : log.getRange(2, 1, log.getLastRow() - 1, NCOL).getValues()
        .filter(r => normDate_(r[0]).indexOf(month) === 0 && String(r[1]).trim());

  // その月に出てきた部屋を階ごとに集める
  const byFloor = {};
  rows.forEach(r => {
    const no = String(r[1]).trim();
    const f = String(r[2] || floorOf_(no));
    if (!byFloor[f]) byFloor[f] = {};
    byFloor[f][no] = 1;
  });
  const floors = Object.keys(byFloor).sort((a, b) => parseInt(a, 10) - parseInt(b, 10));
  const cols   = floors.map(f => Object.keys(byFloor[f]).sort(cmpRoom_));
  const maxRow = cols.reduce((a, c) => Math.max(a, c.length), 0);
  const W = Math.max(floors.length, 11);           // 日別は1行11日ぶん。紙と同じ

  /*************** 描画 ***************
   * 日報シートと同じ体裁でそろえる。
   *   外枠は太線、内側は細線。見出しは薄いグレー。
   *   列幅はすべて54pxで、日報と並べても違和感が出ないようにする。
   ************************************/
  let sh = ss.getSheetByName(SPECIAL_SHEET);
  if (!sh) sh = ss.insertSheet(SPECIAL_SHEET);
  sh.clear();
  sh.clearFormats();

  const INK = '#1A1A1A', HEAD = '#E8ECEF', RULE = '#555555';
  const SOLID = SpreadsheetApp.BorderStyle.SOLID;
  const THICK = SpreadsheetApp.BorderStyle.SOLID_THICK;

  const rg = (r1, c1, nr, nc) => sh.getRange(r1, c1, nr || 1, nc || 1);
  const frame = (r1, c1, r2, c2) => rg(r1, c1, r2 - r1 + 1, c2 - c1 + 1)
    .setBorder(true, true, true, true, null, null, RULE, THICK)
    .setBorder(null, null, null, null, true, true, '#BBBBBB', SOLID);

  sh.getRange(1, 1, 220, 14).setFontSize(10).setFontColor(INK)
    .setVerticalAlignment('middle');

  rg(1, 1, 1, 6).merge()
    .setValue('特別清掃　' + month.replace('-', '年') + '月')
    .setFontSize(16).setFontWeight('bold');
  sh.setRowHeight(1, 34);

  let r = 3;
  const totals = [];
  const layout = [];                                 // 取り込みのときに使う配置

  SPECIAL.forEach(([key, col], idx) => {
    const name = conf.names[idx] || ('特別清掃' + (idx + 1));

    // 部屋ごとに、その月で最後にやった日にち
    const day = {};
    rows.forEach(x => {
      if (!bool_(x[col - 1])) return;
      const no = String(x[1]).trim();
      const d = Number(normDate_(x[0]).slice(8, 10));
      if (!day[no] || d > day[no]) day[no] = d;
    });
    const done = Object.keys(day).length;

    /* 見出し */
    rg(r, 1, 1, 4).merge().setValue('★ ' + name)
      .setFontSize(12).setFontWeight('bold');
    sh.setRowHeight(r, 26);
    r++;

    /* 階の見出し */
    rg(r, 1, 1, floors.length).setValues([floors])
      .setFontWeight('bold').setBackground(HEAD).setHorizontalAlignment('center');
    sh.setRowHeight(r, 25);
    const gridTop = r;
    r++;

    layout.push({ top: gridTop + 1 });               // 部屋番号の行の先頭

    /* 1部屋を2行で書く。上が部屋番号、下がやった日にち */
    for (let i = 0; i < maxRow; i++) {
      const line1 = [], line2 = [];
      cols.forEach(list => {
        const no = list[i] || '';
        line1.push(no);
        line2.push(no && day[no] ? day[no] : '');
      });
      rg(r, 1, 1, floors.length).setValues([line1])
        .setHorizontalAlignment('center').setFontSize(8)
        .setFontColor('#A0A0A0').setBackground('#F4F6F7');
      rg(r + 1, 1, 1, floors.length).setValues([line2])
        .setHorizontalAlignment('center').setFontSize(11).setFontWeight('bold');
      r += 2;
    }
    if (maxRow) {
      frame(gridTop, 1, r - 1, floors.length);
      sh.setRowHeights(gridTop + 1, maxRow * 2, 21);
    }
    r++;

    /* 日別の実施数。紙と同じで1行11日ずつ3段 */
    const count = new Array(32).fill(0);
    Object.keys(day).forEach(no => { count[day[no]]++; });

    const bTop = r;
    for (let g = 0; g < 3; g++) {
      const labs = [], vals = [];
      for (let k = 0; k < 11; k++) {
        const d = g * 11 + k + 1;
        if (d <= 31) { labs.push(d + '日'); vals.push(count[d] || 0); }
        else if (d === 32) { labs.push('実施数'); vals.push(done + ' 部屋'); }
        else { labs.push(''); vals.push(''); }
      }
      rg(r, 1, 1, 11).setValues([labs])
        .setFontWeight('bold').setBackground(HEAD)
        .setHorizontalAlignment('center').setFontSize(9);
      rg(r + 1, 1, 1, 11).setValues([vals])
        .setHorizontalAlignment('center').setFontSize(10);
      r += 2;
    }
    // 3段目の右端（32番目の枠）に実施数が入る
    rg(bTop + 4, 10).setValue('実施数').setFontWeight('bold')
      .setBackground(HEAD).setHorizontalAlignment('center').setFontSize(9);
    rg(bTop + 5, 10).setValue(done + ' 部屋')
      .setFontWeight('bold').setHorizontalAlignment('center');
    rg(bTop + 4, 11).setValue('残数').setFontWeight('bold')
      .setBackground(HEAD).setHorizontalAlignment('center').setFontSize(9);
    rg(bTop + 5, 11).setValue((done - SPECIAL_TOTAL) + ' 部屋')
      .setFontWeight('bold').setHorizontalAlignment('center')
      .setFontColor(done - SPECIAL_TOTAL < 0 ? '#B5442F' : '#2E7D4F');

    frame(bTop, 1, r - 1, 11);
    sh.setRowHeights(bTop, 6, 22);

    totals.push({ name: name, done: done, remain: done - SPECIAL_TOTAL });
    r += 2;
  });

  /* まとめ */
  rg(r, 1, 1, 4).merge().setValue('★ まとめ').setFontSize(12).setFontWeight('bold');
  sh.setRowHeight(r, 26);
  r++;
  rg(r, 1, 1, 3).merge().setValue('清掃項目')
    .setFontWeight('bold').setBackground(HEAD).setHorizontalAlignment('center');
  rg(r, 4).setValue('実施数').setFontWeight('bold').setBackground(HEAD)
    .setHorizontalAlignment('center');
  rg(r, 5).setValue('残数').setFontWeight('bold').setBackground(HEAD)
    .setHorizontalAlignment('center');
  const sTop = r;
  r++;
  totals.forEach(t => {
    rg(r, 1, 1, 3).merge().setValue(t.name).setBackground(HEAD).setFontWeight('bold');
    rg(r, 4).setValue(t.done).setHorizontalAlignment('center').setFontWeight('bold');
    rg(r, 5).setValue(t.remain).setHorizontalAlignment('center').setFontWeight('bold')
      .setBackground('#FFF9E0')
      .setFontColor(t.remain < 0 ? '#B5442F' : '#2E7D4F');
    r++;
  });
  frame(sTop, 1, r - 1, 5);
  sh.setRowHeights(sTop, totals.length + 1, 25);

  /* 使い方のひとこと */
  r += 2;
  rg(r, 1, 1, 8).merge()
    .setValue('※ 日にちのマスは直接書き換えられます。'
            + '直したあと管理画面の「シートの入力を取り込む」を押すと打刻ログに反映されます。'
            + '（空欄にすればその月の実施を取り消せます）')
    .setFontSize(9).setFontColor('#6E7B87').setWrap(true);
  sh.setRowHeight(r, 32);

  for (let c = 1; c <= 14; c++) sh.setColumnWidth(c, 54);
  sh.setHiddenGridlines(true);
  if (sh.getMaxColumns() > 14) sh.deleteColumns(15, sh.getMaxColumns() - 14);

  // 取り込みのときに、どの行のどの列が何号室かを引けるよう配置を残す
  props_().setProperty('SP_MAP_' + month, JSON.stringify({
    month: month, maxRow: maxRow, cols: cols,
    tops: layout.map(x => x.top)
  }));

  return {
    month: month, url: ss.getUrl() + '#gid=' + sh.getSheetId(),
    items: totals
  };
}


/*************************************************
 * 特別清掃シートの手直しを、その場で打刻ログへ反映する
 *
 *  日にちのマスを直接書き換えると onEdit が拾って、その1マスだけ
 *  打刻ログへ書き戻す。空欄にすればその日の実施が取り消される。
 *  「作る → 直す → 取り込む」の3ステップを「作る → 直す」に減らすため。
 *************************************************/

/** 単純トリガー。GASプロジェクトのどのファイルでも1つだけ */
function onEdit(e) {
  try { handleSpecialEdit_(e); } catch (err) { /* 編集を邪魔しない */ }
}

function handleSpecialEdit_(e) {
  const sh = e.range.getSheet();
  if (sh.getName() !== SPECIAL_SHEET) return;

  const month = sh.getRange(1, 1).getValue().toString()
    .replace('特別清掃　', '').replace('年', '-').replace('月', '');
  const map = JSON.parse(props_().getProperty('SP_MAP_' + month) || 'null');
  if (!map) return;

  const row = e.range.getRow(), col = e.range.getColumn();
  if (col > map.cols.length) return;

  SPECIAL.forEach((sp, idx) => {
    const top = map.tops[idx];
    if (!top) return;
    const dayRow = top + 1;                              // 実施日の行は部屋番号の1つ下
    for (let i = 0; i < map.maxRow; i++) {
      if (dayRow + i * 2 !== row) continue;

      const no = String(sh.getRange(row - 1, col).getValue() || '').trim();
      if (!no) return;
      const raw = String(e.range.getValue() || '').trim();
      const d = Number(raw.replace(/[^0-9]/g, ''));
      applyOneSpecial_(no, month, sp[1], (d >= 1 && d <= 31) ? d : 0);
      return;
    }
  });
}

/**
 * 1部屋・1項目ぶんの実施日を打刻ログへ反映する。
 * day が 0 ならその月の記録を消す。
 */
function applyOneSpecial_(room, month, col, day) {
  spDoneClear_(month);
  return withLock_(() => {
    const sh = ss_().getSheetByName(SHEET.LOG);
    const last = sh.getLastRow();
    if (last < 2 && !day) return;

    const all = last < 2 ? [] : sh.getRange(2, 1, last - 1, NCOL).getValues();

    // その月・その部屋の印をいったん全部消す
    let touched = false;
    for (let i = 0; i < all.length; i++) {
      const d = normDate_(all[i][0]);
      if (d.indexOf(month) !== 0) continue;
      if (String(all[i][1]).trim() !== room) continue;
      if (bool_(all[i][col - 1])) {
        sh.getRange(i + 2, col).setValue('');
        touched = true;
      }
    }

    if (!day) { bumpRev_(today_()); return; }

    const target = month + '-' + ('0' + day).slice(-2);
    let at = -1;
    for (let i = 0; i < all.length; i++) {
      if (normDate_(all[i][0]) === target && String(all[i][1]).trim() === room) { at = i; break; }
    }

    if (at >= 0) {
      sh.getRange(at + 2, col).setValue(true);
    } else {
      const row = new Array(NCOL).fill('');
      row[0] = target; row[1] = room; row[2] = floorOf_(room); row[col - 1] = true;
      sh.getRange(appendAt_(sh, 1), 1, 1, NCOL).setValues([row]);
      sortLog_();
    }
    bumpRev_(today_());
  });
}


/*************************************************
 * テスト用：指定した日を「1日終わった状態」にする
 *  日報・業務日報・フロアレポートの出来を確かめるためのもの。本番の日には使わない。
 *  エディタで testFinishDay_('2026-09-29') のように日付を入れて実行する。
 *  清掃対象（DD以外）は清掃・チェック完了、DD（備品 要）はDDセット・DDチェック完了にする。
 *  すでに入っている打刻は触らない。担当者はスタッフ名簿から順番に入れる。
 *************************************************/
function testFinishDay_(dateStr) {
  const date = dateStr || today_();
  return withLock_(() => {
    const sh = ss_().getSheetByName(SHEET.LOG);
    const staff = getStaffList();
    if (staff.length < 2) throw new Error('スタッフ名簿に2人以上入れてください');
    const cleaners = staff.slice(1), checkers = staff.slice(0, Math.min(2, staff.length));
    const [y, m, d] = date.split('-').map(Number);
    const at = min => new Date(y, m - 1, d, 0, min);

    const rooms = dayBlock_(sh, date, NCOL).filter(r => String(r[1]).trim()).map(rowToRoom_);
    let k = 0, done = 0;
    rooms.forEach(r => {
      const target = ['OUT', 'STAY', 'FULL'].indexOf(r.kbn) >= 0;
      const ddWork = r.dd && r.supply !== '不要';
      if (!(target || ddWork) || (r.dd && r.supply === '不要')) return;
      const row = findLogRow_(sh, date, r.room);
      const dur = r.dd ? 5 : (r.kbn === 'OUT' ? 28 : 18);
      const s0 = 600 + (k * 3) % 270, s1 = s0 + dur, c0 = s1 + 5, c1 = c0 + 6;
      if (r.clean.state === 'todo')
        sh.getRange(row, TASK_COL.clean, 1, 4).setValues([[cleaners[k % cleaners.length], at(s0), at(s1), dur]]);
      if (r.check.state === 'todo')
        sh.getRange(row, TASK_COL.check, 1, 4).setValues([[checkers[k % checkers.length], at(c0), at(c1), 6]]);
      if (r.code === 'D' && r.kbn === 'OUT') sh.getRange(row, 4).setValue('O');
      k++; done++;
    });
    bumpRev_(date);
    Logger.log(date + ' の ' + done + ' 室を完了にしました');
    return done;
  });
}


/** 同じ日付の行があれば書き換える。なければ足す */
function appendDailyLog_(row) {
  const sh = ss_().getSheetByName(SHEET.DLOG);
  if (!sh) return;
  const d = normDate_(row[0]);

  let at = 0;
  if (sh.getLastRow() >= 2) {
    const v = sh.getRange(2, 1, sh.getLastRow() - 1, 1).getValues();
    for (let i = 0; i < v.length; i++) if (normDate_(v[i][0]) === d) { at = i + 2; break; }
  }
  if (!at) at = appendAt_(sh, 1);
  sh.getRange(at, 1, 1, DLOG_HEAD.length).setValues([row]);

  // 日付順に並べ直す
  const n = sh.getLastRow() - 1;
  if (n >= 2) {
    const rng = sh.getRange(2, 1, n, DLOG_HEAD.length);
    const v = rng.getValues();
    v.sort((a, b) => normDate_(a[0]) < normDate_(b[0]) ? -1 : 1);
    rng.setValues(v);
  }
}


/*************************************************
 * 保存期間の管理
 *  打刻ログは直近3か月ぶんを手元に置き、
 *  それより古い行は「打刻ログ_保管」へ移す。消さないので過去データは残る。
 *************************************************/

/** 直近3か月の開始日 */
function keepFrom_() {
  const now = new Date();
  const from = new Date(now.getFullYear(), now.getMonth() - (KEEP_MONTHS - 1), 1);
  return Utilities.formatDate(from, 'Asia/Tokyo', 'yyyy-MM-dd');
}

function archiveOldLogs() {
  return withLock_(() => {
    const ss = ss_();
    const sh = ss.getSheetByName(SHEET.LOG);
    const last = sh.getLastRow();
    if (last < 2) return { moved: 0 };

    const limit = keepFrom_();
    const all = sh.getRange(2, 1, last - 1, NCOL).getValues();
    const old = all.filter(r => normDate_(r[0]) < limit);
    if (!old.length) return { moved: 0, limit: limit };

    let ar = ss.getSheetByName(SHEET.ARCHIVE);
    if (!ar) {
      ar = ss.insertSheet(SHEET.ARCHIVE);
      ar.setFrozenRows(1);
    }
    // 新しいシートは26列しかない。列を後ろに足した版のときも同じ。足りない列を足して見出しをそろえる
    if (ar.getMaxColumns() < NCOL) ar.insertColumnsAfter(ar.getMaxColumns(), NCOL - ar.getMaxColumns());
    ar.getRange(1, 1, 1, NCOL).setValues([LOG_HEAD]).setFontWeight('bold');
    ar.getRange(appendAt_(ar, old.length), 1, old.length, NCOL).setValues(old);

    const keep = all.filter(r => normDate_(r[0]) >= limit);
    sh.getRange(2, 1, last - 1, NCOL).clearContent();
    if (keep.length) sh.getRange(2, 1, keep.length, NCOL).setValues(keep);

    CacheService.getScriptCache().removeAll(['dummy']);
    return { moved: old.length, kept: keep.length, limit: limit };
  });
}

/** 毎朝5時台に走らせる。古い打刻ログを保管へ移し、古いフロアレポートPDFをゴミ箱へ */
function dailyMaintenance() {
  archiveOldLogs();
  try { cleanupManual_(); } catch (e) {}
  try { cleanupFloorReports_(); } catch (e) {}
}

/**
 * フロアレポートPDFを何か月残すか。過ぎたぶんは毎朝ゴミ箱へ移す（ゴミ箱から30日は戻せる）。
 * フロアレポートは3か月保管が要るとのことなので 3。1か月にするならここを 1 にする。
 */
const PDF_KEEP_MONTHS = 3;

/**
 * 古いフロアレポートPDFをゴミ箱へ移す。
 * 「フロアレポートPDF」フォルダの「フロアレポート_YYYY-MM-DD.pdf」だけが対象。
 * 残したい分は別フォルダへ移しておけば消えない。
 */
function cleanupFloorReports_() {
  const now = new Date();
  const limit = Utilities.formatDate(new Date(now.getFullYear(), now.getMonth() - PDF_KEEP_MONTHS, now.getDate()),
                                     'Asia/Tokyo', 'yyyy-MM-dd');
  const it = pdfFolder_().getFiles();
  let n = 0;
  while (it.hasNext()) {
    const f = it.next();
    const m = f.getName().match(/^フロアレポート_(\d{4}-\d{2}-\d{2})\.pdf$/);
    if (m && m[1] < limit) { f.setTrashed(true); n++; }
  }
  Logger.log('古いフロアレポートPDFをゴミ箱へ: ' + n + '件（' + limit + ' より前）');
  return { trashed: n, limit: limit };
}

/** トリガーを置く。エディタから1回だけ実行すればよい */
function setupTrigger() {
  ScriptApp.getProjectTriggers().forEach(t => {
    if (t.getHandlerFunction() === 'dailyMaintenance') ScriptApp.deleteTrigger(t);
  });
  ScriptApp.newTrigger('dailyMaintenance')
    .timeBased().atHour(5).everyDays(1).inTimezone('Asia/Tokyo').create();
  Logger.log('毎朝5時台の整理を設置しました');
}

function removeTrigger_() {
  ScriptApp.getProjectTriggers().forEach(t => {
    if (t.getHandlerFunction() === 'dailyMaintenance') ScriptApp.deleteTrigger(t);
  });
  Logger.log('自動整理を解除しました');
}


function checkAdminPin(pin) {
  const set = props_().getProperty('ADMIN_PIN');
  if (!set) return false;
  // 総当たり対策：10分に8回まちがえたら、10分は正しい番号でも通さない（全員で共通）
  const c = CacheService.getScriptCache(), k = 'pinFail';
  if (Number(c.get(k) || 0) >= 8) return false;
  if (String(pin) === String(set)) return true;
  // まちがえたときだけ数え上げを1本ずつにする（打刻の script lock とは別の user lock）
  let lk = null;
  try { lk = LockService.getUserLock(); } catch (e) {}
  if (!lk) c.put(k, String(Number(c.get(k) || 0) + 1), 600);
  else if (lk.tryLock(5000)) {
    try { c.put(k, String(Number(c.get(k) || 0) + 1), 600); } finally { lk.releaseLock(); }
  } else c.put(k, '8', 600);
  Utilities.sleep(800);   // 総当たりを遅くする
  return false;
}

/*************************************************
 * 管理画面から呼ぶ関数の入口（暗証番号つき）
 *  /exec は誰でも開けて、google.script.run で名前の最後に _ が無い関数を直接呼べる。
 *  画面のロックだけでは守れないので、ここで暗証番号を確かめてから中身（_ 付き）を動かす。
 *  管理画面は adminRun() で、どの呼び出しにも暗証番号を最初に付けて送る。
 *************************************************/
function needAdmin_(pin) {
  if (!checkAdminPin(pin)) throw new Error('暗証番号が確かめられませんでした。管理画面を開き直してください');
}
function mergeAll(pin, ...a) { needAdmin_(pin); return mergeAll_(...a); }
function getSaved(pin, ...a) { needAdmin_(pin); return getSaved_(...a); }
function saveDayNote(pin, ...a) { needAdmin_(pin); return saveDayNote_(...a); }
function getDayNote(pin, ...a) { needAdmin_(pin); return getDayNote_(...a); }
function saveImport(pin, ...a) { needAdmin_(pin); return saveImport_(...a); }
function addOrder(pin, ...a) { needAdmin_(pin); return addOrder_(...a); }
function setOrder(pin, ...a) { needAdmin_(pin); return setOrder_(...a); }
function getOrders(pin, ...a) { needAdmin_(pin); return getOrders_(...a); }
function getRoomAdmin(pin, ...a) { needAdmin_(pin); return getRoomAdmin_(...a); }
function setRoomAdmin(pin, ...a) { needAdmin_(pin); return setRoomAdmin_(...a); }
function getReport(pin, ...a) { needAdmin_(pin); return getReport_(...a); }
function getSummary(pin, ...a) { needAdmin_(pin); return getSummary_(...a); }
function getSpecial(pin, ...a) { needAdmin_(pin); return getSpecial_(...a); }
function getStale(pin, ...a) { needAdmin_(pin); return getStale_(...a); }
function setSpecialNames(pin, ...a) { needAdmin_(pin); return setSpecialNames_(...a); }
function buildSpecialSheet(pin, ...a) { needAdmin_(pin); return buildSpecialSheet_(...a); }
function buildDailyReport(pin, ...a) { needAdmin_(pin); return buildDailyReport_(...a); }
function buildFloorReport(pin, ...a) { needAdmin_(pin); return buildFloorReport_(...a); }
function buildManagerReport(pin, ...a) { needAdmin_(pin); return buildManagerReport_(...a); }
function getDeclarationText(pin, ...a) { needAdmin_(pin); return getDeclarationText_(...a); }
function readIndicator(pin, ...a) { needAdmin_(pin); return readIndicator_(...a); }
function readIndicatorCrops(pin, ...a) { needAdmin_(pin); return readIndicatorCrops_(...a); }
function readOrder(pin, ...a) { needAdmin_(pin); return readOrder_(...a); }
function readDouble(pin, ...a) { needAdmin_(pin); return readDouble_(...a); }
function mergeSheets(pin, ...a) { needAdmin_(pin); return mergeSheets_(...a); }
function resortLog(pin, ...a) { needAdmin_(pin); return resortLog_(...a); }

