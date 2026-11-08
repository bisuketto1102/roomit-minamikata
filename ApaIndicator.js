/*************************************************
 * アパホテル〈新大阪 南方駅前〉
 * 3枚読み取り版（3枚は同時に読む）
 *
 *  1枚目 ルームインジケーター … 部屋番号・状態コード（印刷）。12F〜02F・列1〜17、上に集計ボックス
 *         PDF なら管理画面で表を高解像度の画像2枚（12F〜07F／06F〜02F）に切り出して読む
 *  2枚目 清掃指示書           … フル清掃・ノーメイク・アーリーIN・レイトアウト・延泊 など（1枚）
 *  3枚目 ダブルメイク指示書   … 色マス（新規・継続・解除・常設・ベッド下収納常設・増設セット解除）、欄外にコネクト・ツイン
 *
 * インジケーターの手書きは、清掃指示書の内容を現場で転記したもの。
 * 手書きは読まず、活字の清掃指示書から取る。精度が段違いに高い。
 *
 * 2枚を部屋番号で合流させたあと、紙同士で検算する。
 *  ・清掃指示書の「清掃指示数」＝ インジケーターの アウト＋ステイ
 *  ・階別の清掃予定室数 ＝ 階ごとの アウト＋ステイ
 * 別々に作られた紙なので、ここが合えば読み取りはほぼ信用できる。
 *************************************************/

const GEMINI_MODEL = 'gemini-3.8-flash';

/** インジケーターの状態コード */
const IND_CODES = ['V', 'S', 'SD', 'I', 'D', 'O', 'C', 'P', 'X', 'A'];

/**
 * 状態コード → 清掃区分
 *  OUT  … アウト清掃（O は入室可、D はまだ入れない）
 *  STAY … ステイ清掃
 *  FULL … リネン強制交換。ステイとは料金が違うので分ける
 *  V    … 空室。トータル室数にもアウトにも含めない
 *  NONE … 清掃しない
 */
const IND_KBN = {
  O: 'OUT', D: 'OUT',
  S: 'STAY', SD: 'STAY',
  V: 'V',
  // C（清掃）は清掃しない部屋なので空室と同じ V にする（検算は紙の文字 C のまま数える）
  C: 'V',
  I: 'NONE', P: 'NONE', X: 'NONE', A: 'NONE'
};
function kbnOf_(code, full) {
  const k = IND_KBN[String(code || '').toUpperCase()] || 'NONE';
  return (k === 'STAY' && full) ? 'FULL' : k;
}

/** 集計ボックスのキー → コード */
const BOX_KEYS = {
  vacant: 'V', stay: 'S', checkin: 'I', depart: 'D',
  departed: 'O', cleaning: 'C', inspect: 'P', broken: 'X', block: 'A'
};

/**
 * 検算に使わない項目。
 * 「アサインブロック(A)」は紙の横に「プリアサインのある部屋」と書かれている通り、
 * 予約が割り当て済みの部屋数であって、マスに A と書かれるものではない。
 * 他のコードと重なるので室数の突き合わせには使えない。
 */
const SKIP_BOX = ['block'];

/** アーリーチェックインは「30分前には仕上げる」 */
const EARLY_MARGIN_MIN = 30;

/**
 * 全客室（179室）。インジケーターの列番号＝部屋番号の下2桁。
 *   12F … 01〜17 のうち 10・12 が無い
 *   11F〜04F … 01〜17
 *   03F … 01〜16（17 が無い）
 *   02F … 01〜17 のうち 05・06・13・14・17 が無い
 * 部屋が増減したらここと Code.gs の SPECIAL_TOTAL を直す。
 */
const NO_ROOM = ['1210', '1212', '317', '205', '206', '213', '214', '217'];
function roomList_() {
  const list = [];
  for (let f = 12; f >= 2; f--) {
    for (let n = 1; n <= 17; n++) {
      const no = String(f * 100 + n);
      if (NO_ROOM.indexOf(no) < 0) list.push(no);
    }
  }
  return list;
}
const ROOMS = roomList_();

/** 常にツインの部屋（ダブルメイク指示書の欄外の「1209・1211ツイン」が無い日や読み落とした日でも TW にする） */
const TWIN_FIXED = ['1209', '1211'];
const ROOM_SET = {};
ROOMS.forEach(r => { ROOM_SET[r] = 1; });

/** インジケーターの切り出し。上の画像に 12F〜07F、下の画像に 06F〜02F */
const IND_TOP = ['12F', '11F', '10F', '09F', '08F', '07F'];
const IND_BOTTOM = ['06F', '05F', '04F', '03F', '02F'];


/*************************************************
 * 1枚目 ルームインジケーター
 *************************************************/
/**
 * 同じ写真を2通りの読み方で読み、突き合わせる。
 *
 *  1回目「色から」… マスの背景色を手がかりにコードを決める
 *  2回目「文字から」… 印刷された文字そのものを読む
 *
 * どちらも単独では1室ほど外すことがあり、しかも本人は自信ありと申告してくる。
 * 読み方を変えれば外す場所がずれるので、食い違った部屋だけ人が見れば済む。
 * 一致した部屋は確認しなくてよい、と言い切れるのがこの方式の利点。
 */
function readIndicator_(base64, mimeType) {
  const key = apiKey_();
  // 2通りの読みは関係がないので同時に投げる（待ち時間は遅いほう1回ぶん）
  const out = callGeminiMany_(key, [
    { base64: base64, mimeType: mimeType, prompt: indicatorPrompt_('color'), schema: indicatorSchema_() },
    { base64: base64, mimeType: mimeType, prompt: indicatorPrompt_('text'),  schema: indicatorSchema_() }
  ]);
  return Object.assign(crossCheck_(out[0], out[1]), { usage: USAGE_ });
}


/*************************************************
 * インジケーター（PDF）を画像で読む ― 速くて正確な方法
 *
 * PDF をそのまま Gemini に渡すと、ページ全体が小さく縮められてから読まれ、
 * 「SD」と「D」の小さい文字がつぶれやすい（御堂筋で確認）。
 * そこで管理画面（ブラウザ）で PDF を高解像度の画像にし、表の部分だけを
 * 上（集計ボックス＋12F〜07F）と下（06F〜02F）の2枚に切り出して送る。
 *
 * 書き出しも短くする。階ごとに「1201 SD, 1202 D, 1203 *D」の1行だけ書かせる。
 * 読み方は2通り（上の行から／下の行から）。外す場所がずれるので、食い違いだけ人が見ればよい。
 * PDF は印刷の画面で手書きが無いので、考える量は最小・解像度は高にする。
 *************************************************/
function readIndicatorCrops_(top, bottom) {
  const key = apiKey_();
  const job = (img, part, order) => ({ base64: img, mimeType: 'image/jpeg', hi: true, think: 'minimal',
    prompt: indicatorCropPrompt_(part, order), schema: indicatorRowSchema_() });
  const out = callGeminiMany_(key, [
    job(top, 'top', 'down'), job(bottom, 'bottom', 'down'),
    job(top, 'top', 'up'),   job(bottom, 'bottom', 'up')
  ]);
  const join = (x, y) => ({
    rooms: rowsToRooms_(x, IND_TOP).concat(rowsToRooms_(y, IND_BOTTOM)),
    counts: (x && x.counts) || {}
  });
  const res = crossCheck_(join(out[0], out[1]), join(out[2], out[3]));

  // 無いはずの番号は落とし、2回とも出てこなかった部屋は空欄で足して人に埋めてもらう
  const notExist = res.rooms.filter(r => !ROOM_SET[r.room]).map(r => r.room);
  res.rooms = res.rooms.filter(r => ROOM_SET[r.room]);
  const have = {};
  res.rooms.forEach(r => { have[r.room] = 1; });
  const missing = ROOMS.filter(no => !have[no]);
  missing.forEach(no => {
    const r = normRoom_({ room: no, code: '' });
    r.uncertain.push('room');
    res.rooms.push(r);
  });
  res.rooms.sort((x, y) => cmpRoomNo_(x.room, y.room));
  res.cross.missing = missing;
  res.cross.notExist = notExist;
  return Object.assign(res, { usage: USAGE_, crops: true });
}

function indicatorCropPrompt_(part, order) {
  const floors = part === 'top' ? IND_TOP : IND_BOTTOM;
  const rows = order === 'up' ? floors.slice().reverse() : floors;
  const want = ROOMS.filter(no => floors.indexOf(('0' + parseInt(floorOf_(no), 10)).slice(-2) + 'F') >= 0);
  return [
    'これはアパホテル〈新大阪 南方駅前〉の PMS 画面「ルームインジケーター」をスキャンした画像の一部です（表の'
      + (part === 'top' ? '上側。上に集計ボックスがある' : '下側') + '）。',
    '',
    '■ 読むのは ' + floors[0] + '〜' + floors[floors.length - 1] + ' の行だけ（' + floors.length + '階ぶん）。',
    part === 'top'
      ? '画像の一番下に 06F の行が切れて写っていることがある。06F は出力しない。07F は必ず出力する。'
      : '画像の一番上に 07F の行が切れて写っていることがある。07F は出力しない。06F は必ず出力する（上から2行目のことがある）。',
    '行を ' + rows.join(' → ') + ' の順に、左から右へ読む。',
    '- 列の見出しは 1〜17。1つのマスは2段で、上段が部屋番号（例 1201）、下段が状態コード。',
    '- 部屋が無い位置（空白のマス）は飛ばす。12F は 1209 の次が 1211（1210・1212 は無い）。',
    '',
    '■ 状態コードは印刷された文字を一字ずつ読む ※最重要',
    '- V / SD / S / D / O / I / C / P / X / A のどれか。',
    '- 「SD」は2文字。「D」1文字と取り違えないこと。迷ったら文字の幅を見る（SD は横に長い）。',
    '- 「D」（出発予定）と「O」（出済）を取り違えないこと。D は右側が丸く閉じた形、O は左右対称の輪。',
    '- 参考：背景色は SD＝薄い黄色、D＝薄いピンク、O＝濃い赤・オレンジ、V＝緑、X＝赤。文字と色が食い違うときは文字を優先。',
    '- 頭に「*」が付いていたら残す（例 *D）。',
    '- どうしても読めないマスは「1203 ?」と書く。推測しない。',
    '',
    '■ 出力の形',
    'rows に1階1つ。cells は「部屋番号 コード」をカンマで並べた1行の文字。',
    '例　{"floor":"12F","cells":"1201 SD, 1202 D, 1203 *D, 1204 O"}',
    '対象の部屋は次の ' + want.length + ' 室。これ以外の番号は出力しない。',
    want.join(', '),
    '',
    part === 'top'
      ? '■ counts：表の上の集計ボックスの印刷の数字をそのまま入れる。vacant←空室(V)　stay←滞在(S)　checkin←仮チェックイン(I)　depart←出発予定(D)　departed←出済(O)　cleaning←清掃(C)　inspect←点検(P)　broken←故障(X)　block←アサインブロック(A)。'
      : 'counts は空にする。'
  ].join('\n');
}

function indicatorRowSchema_() {
  const n = { type: 'INTEGER' };
  return {
    type: 'OBJECT',
    properties: {
      rows: { type: 'ARRAY', items: {
        type: 'OBJECT',
        properties: { floor: { type: 'STRING' }, cells: { type: 'STRING' } },
        required: ['floor', 'cells']
      }},
      counts: { type: 'OBJECT', properties: {
        vacant: n, stay: n, checkin: n, depart: n, departed: n,
        cleaning: n, inspect: n, broken: n, block: n } }
    },
    required: ['rows']
  };
}

/**
 * 「1201 *D, 1202 SD, 1203 ?」→ 部屋の配列。カンマが抜けていても読める。
 * その画像で読むはずの階（floors）以外の行は捨てる（切れて写った隣の階を拾わないため）。
 */
function rowsToRooms_(x, floors) {
  const out = [];
  ((x && x.rows) || []).forEach(row => {
    const re = /(\d{3,4})\s*[:=：]?\s*(\*?\s*[A-Za-z]{1,2}|\?)?/g;
    let m;
    while ((m = re.exec(String(row.cells || '')))) {
      const f = ('0' + parseInt(floorOf_(m[1]), 10)).slice(-2) + 'F';
      if (floors && floors.indexOf(f) < 0) continue;
      const raw = String(m[2] || '').replace(/\s/g, '').toUpperCase();
      const code = raw === '?' ? '' : raw;
      out.push({ room: m[1], code: code, hand: false, uncertain: code ? [] : ['code'] });
    }
  });
  return out;
}

/** S と SD は同じ「滞在」。比較するときはそろえる */
function sameCode_(x, y) {
  const n = c => (c === 'SD' ? 'S' : c);
  return n(x) === n(y);
}

function crossCheck_(a, b) {
  const ra = (a.rooms || []).map(normRoom_).filter(r => r.room);
  const rb = (b.rooms || []).map(normRoom_).filter(r => r.room);

  const mapB = {};
  rb.forEach(r => { mapB[r.room] = r; });
  const mapA = {};
  ra.forEach(r => { mapA[r.room] = r; });

  const diff = [], onlyA = [], onlyB = [];
  const out = [];

  const hand = [];

  ra.forEach(r => {
    const o = mapB[r.room];
    if (!o) {
      r.uncertain.push('room');
      onlyA.push(r.room);
    } else if (!sameCode_(r.code, o.code)) {
      r.alt = o.code;
      if (r.uncertain.indexOf('code') < 0) r.uncertain.push('code');
      diff.push({ room: r.room, a: r.code, b: o.code });
    }

    /*
     * 手書きがコードに重なったマスだけが読み違いの原因になっている。
     * 2回とも同じ間違いをすると食い違いにも出てこないので、
     * 手書きがあると分かった時点で、読めていても人の目に回す。
     * どちらか一方でも手書きありと言えば拾う。
     */
    if (r.hand || (o && o.hand)) {
      r.hand = true;
      if (r.uncertain.indexOf('手書きあり') < 0) r.uncertain.push('手書きあり');
      hand.push(r.room);
    }
    out.push(r);
  });

  // 2回目にしか出てこなかった部屋も拾う。落とすより出したほうが安全
  rb.forEach(r => {
    if (mapA[r.room]) return;
    r.uncertain.push('room');
    onlyB.push(r.room);
    out.push(r);
  });

  out.sort((x, y) => cmpRoomNo_(x.room, y.room));

  return {
    rooms:  out,
    counts: cleanCounts_(a.counts || {}),
    cross:  { diff: diff, onlyA: onlyA, onlyB: onlyB, hand: hand,
              countsB: cleanCounts_(b.counts || {}) }
  };
}

function cmpRoomNo_(x, y) { return (parseInt(x, 10) || 0) - (parseInt(y, 10) || 0); }

function indicatorPrompt_(mode) {
  const color = mode !== 'text';
  return [
    'これはホテルの「ルームインジケーター」の印刷物です。客室の現在の状態を一覧にした表です。',
    'この表の読み間違いは「まだお客様がいる部屋に清掃員が入る」事故につながります。',
    '',
    '■ 読み取るのは印刷された内容だけ',
    'この紙にはペンでの書き込み（時刻・丸・斜線）がありますが、その内容は読まなくて構いません。',
    '別の紙から取ります。ここでは印刷の「部屋番号」と「状態コード」だけを読んでください。',
    '',
    '■ ただし「手書きがあるかどうか」は必ず申告する ※最重要',
    'マスの上にペンでの書き込みが少しでもあれば hand を true にしてください。',
    '時刻・丸・斜線・×・チェック・色ペンの線、どれでも構いません。',
    '印刷は黒の細い活字です。それ以外の、太い線・かすれた線・傾いた文字・',
    '赤や緑のペンの跡は、すべて手書きです。',
    'マスの一部にかかっているだけ、枠をまたいでいる、薄くて何か分からない場合も true。',
    '後で人が必ず目で確かめるので、迷ったら true にしてください。',
    'true が多すぎて困ることはありません。見落とすほうが困ります。',
    '',
    '■ 表の形',
    color
      ? '- 上の 12F の行から順に、左から右へ読んでください。'
      : '- 下の 02F の行から順に、左から右へ読んでください。',
    '- 列の見出しは 1〜17 の数字。行の見出しは 12F・11F・10F・09F・08F・07F・06F・05F・04F・03F・02F。',
    '- 1つのマスに2行ある。上段が部屋番号（1201 など3〜4桁）、下段が状態コード。',
    '- 部屋が存在しない位置はマスが空白。空白のマスは出力しないこと。',
    '- 列番号と部屋番号の下2桁は一致しないことがある（例：12F は 1209 の次が 1211）。',
    '  必ず印刷されている部屋番号をそのまま読むこと。列番号から計算して補わない。',
    '',
    '■ 状態コード',
    '- V（空室） / S または SD（滞在） / I（仮チェックイン） / D（出発予定）',
    '- O（出済） / C（清掃） / P（点検） / X（故障） / A（アサインブロック）',
    '- コードの前に「*」が付くことがある。本日その部屋に予約が入っている印。',
    '  「*」は code に含めず、reserved を true にする。',
    '',
    color
      ? '■ コードの判定は「マスの背景色」を最優先にする ※最重要'
      : '■ コードの判定は「印刷された文字」を最優先にする ※最重要',
    color
      ? 'この表は色で状態が分かるように作られています。文字はかすれたり手書きで隠れたりしますが、\n色は塗りつぶしなので消えません。文字と色が食い違ったら、色を信じてください。'
      : 'マスに印刷されている文字そのものを一字ずつ読んでください。\n背景色は参考程度にとどめ、文字が読めるならその文字を採用します。',
    '- 緑　　　　　　　→ V（空室）',
    '- 黄色　　　　　　→ S / SD（滞在）',
    '- 薄いピンク　　　→ D（出発予定）',
    '- 濃い赤・オレンジ→ O（出済）または X（故障）。色が同じなので文字で見分ける',
    '- 青系　　　　　　→ A（アサインブロック）/ C（清掃）/ P（点検）',
    color
      ? '手書きがコードに重なって文字が読めないときも、背景色から判断してください。\n色でも決められないときだけ code を空文字にして uncertain に "code" を入れる。'
      : '文字が手書きで隠れて読めないときだけ、背景色から判断してください。\nどちらでも決められないときは code を空文字にして uncertain に "code" を入れる。',
    'コードの上に手書きで大きな × が書かれている部屋は故障です。code を "X" にする。',
    color ? '' : '※ D と O は形が似ています。D は右側が丸く閉じ、O は左右対称の輪です。\n  拡大して形をよく見てから決めてください。',
    '',
    '■ counts（表の上にある集計ボックス）※9項目すべて必ず返す',
    '表の上に「空室(V) 4」「滞在(S) 60」のように室数が印刷されています。',
    'これは検算に使う重要な数字です。必ず9項目すべてを探して数字を入れてください。',
    '0 と書かれていれば 0。どうしても見つからない項目だけ -1 を入れる。',
    '  vacant ← 空室(V)　　　stay ← 滞在(S)　　　checkin ← 仮チェックイン(I)',
    '  depart ← 出発予定(D)　departed ← 出済(O)　cleaning ← 清掃(C)',
    '  inspect ← 点検(P)　　 broken ← 故障(X)　　block ← アサインブロック(A)',
    '表のマスを数えて埋めるのではなく、集計ボックスに印刷されている数字そのものを読むこと。',
    '',
    '■ uncertain（自信のない項目）',
    '- 使える項目名: room / code',
    '- 文字と背景色が食い違う、D と O の判別に迷った、かすれ・影・折り目で読みにくい、',
    '  部屋番号の桁が読み切れない場合に入れる。迷わず読めた項目には入れない。',
    '',
    '■ 注意',
    '- 推測で部屋を足さない。表にないものは返さない。同じ部屋番号を2回返さない。',
    '- 紙が折れて歪んでいても、行と列の対応を崩さないこと。',
    '- 表の外（右側の余白）の担当者名やメモは読み取らない。'
  ].join('\n');
}

function indicatorSchema_() {
  const n = { type: 'INTEGER' };
  return {
    type: 'OBJECT',
    properties: {
      rooms: { type: 'ARRAY', items: {
        type: 'OBJECT',
        properties: {
          room:      { type: 'STRING' },
          code:      { type: 'STRING' },
          reserved:  { type: 'BOOLEAN' },
          hand:      { type: 'BOOLEAN' },
          uncertain: { type: 'ARRAY', items: { type: 'STRING' } }
        },
        required: ['room', 'code', 'hand']
      }},
      counts: { type: 'OBJECT',
        properties: {
          vacant: n, stay: n, checkin: n, depart: n,
          departed: n, cleaning: n, inspect: n, broken: n, block: n
        },
        required: ['vacant','stay','checkin','depart','departed','cleaning','inspect','broken','block']
      }
    },
    required: ['rooms', 'counts']
  };
}


/*************************************************
 * 2枚目 清掃指示書
 *************************************************/
/**
 * 清掃指示書も、インジケーターと同じく読み方を変えて2回読み、突き合わせる（同時に投げるので待ち時間は1回ぶん）。
 * 1回だけだと、フル清掃の欄の部屋を読み落とすことがあった（11/03。2回目に読み直すと読めた）。
 * 部屋の一覧（フル清掃・ノーメイク・リネン交換依頼・アーリーイン・レイトアウト・延泊など）は2回の和をとり、
 * 片方だけに出た部屋は要確認に回す（落とすより出して人が見るほうが安全）。
 *
 * それでもフル清掃の部屋を2回とも落とすことがある（11/06 の 413）。紙に合計の数は無いので、
 * 管理画面がフル清掃の欄の黄色く塗られたマスを数えて fullCount で渡す（数えられなかったときは null）。
 * 読めた部屋数と比べるのは verify_。
 */
function readOrder_(base64, mimeType, fullCount) {
  const key = apiKey_();
  const out = callGeminiMany_(key, [
    { base64: base64, mimeType: mimeType, prompt: orderPrompt_('down'), schema: orderSchema_() },
    { base64: base64, mimeType: mimeType, prompt: orderPrompt_('up'),   schema: orderSchema_() }
  ]);
  const n = Number(fullCount);
  return Object.assign(mergeOrders_(normOrder_(out[0]), normOrder_(out[1])), {
    fullCount: (fullCount != null && fullCount !== '' && n >= 0 && n === Math.floor(n)) ? n : null,
    usage: USAGE_ });
}

/** 2回の読みを1つにする。部屋の一覧は和をとり、片方だけの部屋を split に残す */
function mergeOrders_(a, b) {
  const split = [];                                   // [{ field: 'フル清掃', room: '1103' }]
  const uni = (x, y, label) => {
    const out = x.slice();
    y.forEach(no => { if (out.indexOf(no) < 0) out.push(no); });
    out.forEach(no => { if ((x.indexOf(no) < 0) !== (y.indexOf(no) < 0)) split.push({ field: label, room: no }); });
    return out;
  };
  // 時刻ごとの部屋（アーリーイン・レイトアウト）：時刻と部屋の組で和をとる
  const slots = (x, y, label) => {
    const key = s => s.rooms.map(no => s.time + '|' + no);
    const kx = [].concat.apply([], x.map(key)), ky = [].concat.apply([], y.map(key));
    const all = kx.slice(); ky.forEach(k => { if (all.indexOf(k) < 0) all.push(k); });
    all.forEach(k => { if ((kx.indexOf(k) < 0) !== (ky.indexOf(k) < 0)) split.push({ field: label + ' ' + k.split('|')[0], room: k.split('|')[1] }); });
    const by = {};
    all.forEach(k => { const [t, no] = k.split('|'); (by[t] = by[t] || []).push(no); });
    return Object.keys(by).sort().map(t => ({ time: t, rooms: by[t] }));
  };
  const o = Object.assign({}, a);
  o.fullClean    = uni(a.fullClean, b.fullClean, 'フル清掃');
  o.linenRequest = uni(a.linenRequest, b.linenRequest, 'リネン交換依頼');
  o.popCollect   = uni(a.popCollect, b.popCollect, 'POP回収');
  o.extend       = uni(a.extend, b.extend, '延泊');
  o.handwritten  = uni(a.handwritten, b.handwritten, '手書き');
  o.struck       = uni(a.struck, b.struck, '取り消し線');
  o.earlyIn      = slots(a.earlyIn, b.earlyIn, 'アーリーイン');
  o.lateOut      = slots(a.lateOut, b.lateOut, 'レイトアウト');
  // ノーメイク：部屋で和をとる（要・不要は読めたほうを使う）
  const nm = a.noMake.slice();
  b.noMake.forEach(x => { const h = nm.filter(y => y.room === x.room)[0]; if (!h) nm.push(x); else if (!h.need && x.need) h.need = x.need; });
  nm.forEach(x => { if (!a.noMake.some(y => y.room === x.room) || !b.noMake.some(y => y.room === x.room)) split.push({ field: 'ノーメイク', room: x.room }); });
  o.noMake = nm;
  // ルームチェンジ・特記：同じものは1つに
  o.roomChange = a.roomChange.concat(b.roomChange.filter(x => !a.roomChange.some(y => y.from === x.from && y.to === x.to)));
  o.notes = a.notes.concat(b.notes.filter(x => !a.notes.some(y => y.room === x.room && y.text === x.text)));
  o.allNotes = a.allNotes.length >= b.allNotes.length ? a.allNotes : b.allNotes;
  // 数字の欄：1回目が読めなければ2回目。2回で違えば要確認の欄に入れる
  ['date', 'maker', 'orderCount', 'plannedTotal'].forEach(k => {
    if (o[k] == null || o[k] === '') o[k] = b[k];
    else if (b[k] != null && b[k] !== '' && String(b[k]) !== String(o[k]) && o.uncertain.indexOf(k) < 0) o.uncertain = o.uncertain.concat([k]);
  });
  if (!o.planned.length) o.planned = b.planned;
  else b.planned.forEach(x => { const h = o.planned.filter(y => y.floor === x.floor)[0];
    if (h && x.rooms != null && h.rooms !== x.rooms && o.uncertain.indexOf('planned') < 0) o.uncertain = o.uncertain.concat(['planned']); });
  b.uncertain.forEach(u => { if (o.uncertain.indexOf(u) < 0) o.uncertain = o.uncertain.concat([u]); });
  o.split = split;
  return o;
}

function orderPrompt_(order) {
  return [
    order === 'up'
      ? '※ 今回は各欄を下の行から順に読み、最後に欄の部屋番号を数え直して、1つも落としていないか確かめてください。'
      : '※ 各欄を上の行から順に読み、部屋番号を1つも落とさないこと。欄の中の部屋番号はすべて拾う。',
    'これはホテルの「清掃指示書」です。フロントが作成し、その日の清掃の指示をまとめた紙です。',
    '印刷された内容と、ペンでの手書きの追記が混在しています。両方を読み取ってください。',
    '手書きで書かれた部屋番号は handwritten の配列にも入れてください（後で人が確認するため）。',
    '',
    '■ 読み取る欄',
    '1) 右上「清掃指示日」の日付 → date（yyyy-MM-dd）。作成者名 → maker',
    '2) 上段の数値欄 → 「清掃指示数」の数字を orderCount に入れる',
    '3)「本日の清掃予定客室数」… 2F〜12Fの階ごとの室数と合計。',
    '   planned に [{floor:"2F", rooms:12}, ...]、合計を plannedTotal に。',
    '4)「★フル清掃（リネン強制交換）」の枠（左側、「★リネン交換依頼部屋」の上）… 黄色く塗られたマス',
    '   （丸で囲まれていることもある）の部屋番号を全部 fullClean に列挙。',
    '   マスを1つずつ数え、黄色いマスの数と fullClean の部屋番号の数が合うか確かめる。',
    '   手書きで書き足された番号も必ず含める。ほかの欄（レイトアウト・アーリーインなど）の黄色いマスは入れない。',
    '5)「本日ノーメイク部屋」… 部屋番号と、その下の「要」「不要」を noMake に。',
    '   [{room:"706", need:"要"}] の形。「要」はドア前に備品セットを置く意味。',
    '6)「リネン交換依頼部屋」… 部屋番号を linenRequest に列挙',
    '7)「本日アーリーチェックイン」… 左端が時刻（11時・13時・14時など）、右に部屋番号が並ぶ。',
    '   earlyIn に [{time:"11:00", rooms:["1106"]}, {time:"14:00", rooms:["403","404"]}] の形。',
    '   時刻は "HH:mm" にそろえる。空欄の行は返さない。',
    '8)「本日レイトアウト」… 同じ形で lateOut に。',
    '9)「本日のルームチェンジ」… roomChange に [{from:"元部屋", to:"新部屋"}]',
    '10)「モニターPOP回収」… popCollect に部屋番号を列挙',
    '11)「コネクト開閉指示」… connect に [{floor:"9F", state:"閉"}] の形',
    '12)「延泊」、または「インジケーターD表示で、延泊予定の客室番号」の欄 … extend に部屋番号を列挙',
    '13)「清掃指示及び特記事項」… 左の部屋番号と右の内容を notes に。',
    '    [{room:"913", text:"14時から清掃お願いします。"}] の形。',
    '    部屋番号が「1105/1106/1107」のように複数並んでいる行は、部屋ごとに分けて',
    '    同じ内容で1件ずつ入れる。',
    '    部屋番号が「全室」の行は allNotes に本文だけを配列で入れる。',
    '    行全体に取り消し線が引かれている特記は、取り消されたものなので notes に入れず、',
    '    その部屋番号を struck に入れる（後で人が確認する）。',
    '',
    '■ 書き方の注意',
    '- 部屋番号は数字だけにする（丸囲みや下線は無視して番号だけ）。',
    '- 部屋番号の横に手書きのチェック（✓ レ点）が付いていることがある。',
    '  これは責任者が確認した印なので無視する。手書きの追記として扱わず、handwritten にも入れない。',
    '  handwritten に入れるのは、印刷に無い部屋番号や数字をペンで書き足したものだけ。',
    '- 空欄の枠は返さない。空の配列でよい。',
    '- 読めない数字は推測せず、その項目を uncertain に入れる。',
    '- uncertain に使える項目名: date / orderCount / planned / fullClean / noMake /',
    '  linenRequest / earlyIn / lateOut / roomChange / popCollect / connect / extend / notes',
    '- 手書きで追記された部屋番号は、該当する欄に入れたうえで handwritten にも入れる。'
  ].join('\n');
}

function orderSchema_() {
  const strArr = { type: 'ARRAY', items: { type: 'STRING' } };
  return {
    type: 'OBJECT',
    properties: {
      date:         { type: 'STRING' },
      maker:        { type: 'STRING' },
      orderCount:   { type: 'INTEGER' },
      plannedTotal: { type: 'INTEGER' },
      planned: { type: 'ARRAY', items: { type: 'OBJECT', properties: {
        floor: { type: 'STRING' }, rooms: { type: 'INTEGER' } }, required: ['floor','rooms'] }},
      fullClean:    strArr,
      noMake: { type: 'ARRAY', items: { type: 'OBJECT', properties: {
        room: { type: 'STRING' }, need: { type: 'STRING' } }, required: ['room'] }},
      linenRequest: strArr,
      earlyIn: { type: 'ARRAY', items: { type: 'OBJECT', properties: {
        time: { type: 'STRING' }, rooms: strArr }, required: ['time','rooms'] }},
      lateOut: { type: 'ARRAY', items: { type: 'OBJECT', properties: {
        time: { type: 'STRING' }, rooms: strArr }, required: ['time','rooms'] }},
      roomChange: { type: 'ARRAY', items: { type: 'OBJECT', properties: {
        from: { type: 'STRING' }, to: { type: 'STRING' } }, required: ['from','to'] }},
      popCollect:   strArr,
      connect: { type: 'ARRAY', items: { type: 'OBJECT', properties: {
        floor: { type: 'STRING' }, state: { type: 'STRING' } }, required: ['floor','state'] }},
      extend:       strArr,
      notes: { type: 'ARRAY', items: { type: 'OBJECT', properties: {
        room: { type: 'STRING' }, text: { type: 'STRING' } }, required: ['room','text'] }},
      allNotes:     strArr,
      handwritten:  strArr,
      struck:       strArr,
      uncertain:    strArr
    },
    required: ['orderCount', 'fullClean', 'noMake', 'earlyIn']
  };
}

function normOrder_(p) {
  const nums = a => (Array.isArray(a) ? a : [])
    .map(x => String(x).replace(/[^0-9]/g, '')).filter(Boolean);

  const slot = a => (Array.isArray(a) ? a : []).map(x => ({
    time: hhmm_(x.time), rooms: nums(x.rooms)
  })).filter(x => x.time && x.rooms.length);

  return {
    date:         String(p.date || '').trim(),
    maker:        String(p.maker || '').trim(),
    orderCount:   num_(p.orderCount),
    plannedTotal: num_(p.plannedTotal),
    planned: (Array.isArray(p.planned) ? p.planned : []).map(x => ({
      floor: normFloor_(x.floor), rooms: num_(x.rooms)
    })).filter(x => x.floor),
    fullClean:    nums(p.fullClean),
    noMake: (Array.isArray(p.noMake) ? p.noMake : []).map(x => ({
      room: String(x.room || '').replace(/[^0-9]/g, ''),
      need: String(x.need || '').trim()
    })).filter(x => x.room),
    linenRequest: nums(p.linenRequest),
    earlyIn:      slot(p.earlyIn),
    lateOut:      slot(p.lateOut),
    roomChange: (Array.isArray(p.roomChange) ? p.roomChange : []).map(x => ({
      from: String(x.from || '').replace(/[^0-9]/g, ''),
      to:   String(x.to   || '').replace(/[^0-9]/g, '')
    })).filter(x => x.from && x.to),
    popCollect:   nums(p.popCollect),
    connect: (Array.isArray(p.connect) ? p.connect : []).map(x => ({
      floor: normFloor_(x.floor), state: String(x.state || '').trim()
    })).filter(x => x.floor),
    extend:       nums(p.extend),
    // 「1105/1106/1107」のようにまとめて書かれた行は部屋ごとに分ける
    notes: (Array.isArray(p.notes) ? p.notes : []).reduce((acc, x) => {
      const text = String(x.text || '').trim();
      String(x.room || '').split(/[\/／,、・\s]+/)
        .map(no => no.replace(/[^0-9]/g, ''))
        .filter(no => no.length >= 3 && no.length <= 4)
        .forEach(no => { if (text) acc.push({ room: no, text: text }); });
      return acc;
    }, []),
    allNotes:    (Array.isArray(p.allNotes)    ? p.allNotes    : []).map(s => String(s).trim()).filter(Boolean),
    handwritten: nums(p.handwritten),
    struck:      nums(p.struck),
    uncertain:   (Array.isArray(p.uncertain)   ? p.uncertain   : []).map(s => String(s).trim()).filter(Boolean)
  };
}


/*************************************************
 * 3枚目 ダブルメイク指示書
 *  部屋番号のマス目に色が塗ってある。色が作業の区分を表す。
 *  欄外にコネクト・ツインの組が書かれている。
 *************************************************/
/**
 * ダブルメイク指示書の区分。11/03 の紙の凡例で確かめた：
 *   緑＝ダブルメイク新規　黄＝ダブルメイク継続　赤＝解除　オレンジ（茶）＝ダブルメイク常設
 *   青＝ベッド下収納常設部屋（ふつうの1名の部屋）
 *   ピンク＝増設セット解除→ベッド下収納常設部屋に変更（＝今日シングルに戻す。解除として扱う）
 * 前は青を「増設予定」、ピンクを「増設解除して増設予定」と思い込んでいて、ピンクの部屋が解除にならなかった（11/03 の3F）。
 * 古い保存の値（増設予定・増設解除して増設予定）も読めるよう残す。
 */
const DMAKE_KINDS = ['新規', '継続', '解除', '常設', 'ベッド下収納', '増設予定', '増設解除して増設予定'];
/**
 * Gemini に返させる区分。ピンクは「解除→ベッド下収納」で返させ、取り込みでは解除にする。
 * 決められないときは「不明」。※ Gemini の enum に空文字は入れられない（入れると 400 で断られる。11/03 に起きた）
 */
const DMAKE_READ = ['新規', '継続', '解除', '常設', 'ベッド下収納', '解除→ベッド下収納', '不明'];

/** 日報の「ロイヤル（増設含む）」に数える色 */
const ROYAL_KINDS = ['新規', '継続', '常設'];

function readDouble_(base64, mimeType) {
  const parsed = callGemini_(apiKey_(), base64, mimeType, doublePrompt_(), doubleSchema_());
  return Object.assign(normDouble_(parsed), { usage: USAGE_ });
}

function doublePrompt_() {
  return [
    'これはアパホテル〈新大阪 南方駅前〉の「ダブルメイク指示書」です。',
    'ダブルメイクとは、ベッドが1台の部屋に2人が泊まるときに寝具を2人分用意する作業のことです。',
    '',
    '■ 表の形',
    '- 部屋番号が書かれたマスが格子状に並んでいます。上の行が高い階（12F）、下の行が低い階（2F）です。',
    '- 1つのマスに部屋番号が1つ。マスの塗りつぶしの色が、その部屋の区分を表します。',
    '- 真っ黒に塗りつぶされたマスは「部屋が存在しない」印です。出力しないでください。',
    '- 白（塗りなし）のマスは区分なし。出力しなくてよい。',
    '',
    '■ 色と区分 ※最重要。紙の左下の凡例（色の四角と「→〇〇」の説明）を必ず先に読み、それに合わせる',
    'ふだんの凡例は次のとおり。kind にはこの右側の言葉をそのまま入れる。',
    '- 緑　　　　　　　　　　「→ダブルメイク 新規」　　　　　　　　　　　→ 新規',
    '- 黄色　　　　　　　　　「→ダブルメイク継続」　　　　　　　　　　　→ 継続',
    '- 赤（濃い・あざやか）　「→解除」　　　　　　　　　　　　　　　　　→ 解除',
    '- オレンジ・茶色　　　　「→ダブルメイク常設」　　　　　　　　　　　→ 常設',
    '- 青　　　　　　　　　　「→ベッド下収納常設部屋」　　　　　　　　　→ ベッド下収納',
    '- ピンク（薄い赤）　　　「→増設セット解除→ベッド下収納常設部屋に変更」→ 解除→ベッド下収納',
    '凡例の説明がこれと違う日は、凡例の説明に近い言葉を選ぶ（「解除」を含む説明の色は 解除 か 解除→ベッド下収納）。',
    '見分け方：オレンジ（常設）は黄みが強い。ピンク（解除→ベッド下収納）は白っぽい桃色。赤（解除）は濃い。',
    '迷ったら凡例の四角の色とマスの色を並べて比べる。それでも決められないときは kind を「不明」にする。',
    '',
    '■ legend：凡例の色と説明を、上から順に [{color:"緑", text:"ダブルメイク 新規"}, …] で入れる（確認用）',
    '',
    '■ 欄外の書き込み',
    '- 「909・910コネクト」のように書かれた組 → connects に [["909","910"], ...] の形で入れる',
    '- 「1209・1211ツイン」のように書かれた組 → twins に [["1209","1211"], ...] の形で入れる',
    '- 「水2本設置お忘れなく」のような注意書き → note に文字のまま入れる',
    '',
    '■ その他',
    '- 右上の日付を date に入れる（yyyy-MM-dd）',
    '- 部屋番号は数字だけにする',
    '- 表にない部屋を推測で足さない。同じ部屋番号を2回返さない'
  ].join('\n');
}

function doubleSchema_() {
  const pair = { type: 'ARRAY', items: { type: 'ARRAY', items: { type: 'STRING' } } };
  return {
    type: 'OBJECT',
    properties: {
      date: { type: 'STRING' },
      legend: { type: 'ARRAY', items: { type: 'OBJECT', properties: {
        color: { type: 'STRING' }, text: { type: 'STRING' } }, required: ['color', 'text'] } },
      rooms: { type: 'ARRAY', items: {
        type: 'OBJECT',
        properties: {
          room: { type: 'STRING' },
          kind: { type: 'STRING', enum: DMAKE_READ },
          uncertain: { type: 'ARRAY', items: { type: 'STRING' } }
        },
        required: ['room', 'kind']
      }},
      connects: pair,
      twins:    pair,
      note:     { type: 'STRING' }
    },
    required: ['rooms']
  };
}

/** ピンク（増設セット解除→ベッド下収納常設部屋に変更）は今日シングルに戻すので解除にする。AI の読みも色の測定も同じにそろえる */
const DMAKE_ALIAS = { '解除→ベッド下収納': '解除', '増設解除して増設予定': '解除', 'ベッド下収納常設': 'ベッド下収納' };

function normDouble_(p) {
  const pairs = a => (Array.isArray(a) ? a : [])
    .map(x => (Array.isArray(x) ? x : []).map(y => String(y).replace(/[^0-9]/g, '')).filter(Boolean))
    .filter(x => x.length >= 2);

  const unsure = [];
  const rooms = (Array.isArray(p.rooms) ? p.rooms : []).map(r => {
    const raw = String(r.kind || '').trim(), kind = raw === '不明' ? '' : (DMAKE_ALIAS[raw] || raw);
    const room = String(r.room || '').replace(/[^0-9]/g, '');
    if (room && (!kind || (Array.isArray(r.uncertain) && r.uncertain.indexOf('kind') >= 0))) unsure.push(room);
    return { room: room, kind: DMAKE_KINDS.indexOf(kind) >= 0 ? kind : '', from: raw };
  }).filter(r => r.room && r.kind);

  return {
    date: String(p.date || '').trim(),
    legend: (Array.isArray(p.legend) ? p.legend : []).map(x => String(x.color || '').trim() + '→' + String(x.text || '').trim()).filter(x => x.length > 1),
    unsure: unsure,
    rooms: rooms,
    connects: pairs(p.connects),
    twins: pairs(p.twins),
    note: String(p.note || '').trim()
  };
}

/*
 * ダブルメイク指示書の色を、画像の色で決めたもの（管理画面の dblGridColors が作る）。
 * AI は塗られたマスを返し忘れることがある（11/7・11/8 に 204 の黄＝継続が黙って落ちた）。
 * 紙の形は決まっている（11行×17列・黒マス＝部屋なし）ので、画面で各マスの色を測って送ってくる。
 *   { ok:true, map:{ 部屋: 区分 } } … 区分は DMAKE_READ の言葉、''＝白（区分なし）、'?'＝色を決められないマス
 *   { ok:false, why } …………………… 外枠が見つからない・黒マスの位置が部屋なしと合わない など
 * 部屋が1つでも欠けていたら使わない（全部の部屋を測れていないと「AI が返さなかった」を見分けられない）。
 */
function normDblColor_(c) {
  if (!c || typeof c !== 'object') return null;
  if (!c.ok) return { ok: false, why: String(c.why || '').slice(0, 200) };
  const src = (c.map && typeof c.map === 'object') ? c.map : {};
  const map = {};
  let n = 0;
  ROOMS.forEach(no => {
    if (!Object.prototype.hasOwnProperty.call(src, no)) return;
    let k = String(src[no] == null ? '' : src[no]).trim();
    k = DMAKE_ALIAS[k] || k;
    if (k !== '' && k !== '?' && DMAKE_KINDS.indexOf(k) < 0) k = '?';
    map[no] = k; n++;
  });
  if (n < ROOMS.length) return { ok: false, why: '色の一覧に足りない部屋がある（' + n + '／' + ROOMS.length + '室）' };
  return { ok: true, map: map };
}

/**
 * 色を正にしてダブルメイクの区分を決める。ai は readDouble_ の結果（読めなかったら null）。
 * 人の確認（ask）に回すのは次の3つだけ。色と AI が同じ部屋・どちらも白の部屋は何も出さない。
 *   ・色と AI の区分が違う（赤とピンクはどちらも「解除」にそろえてから比べるので、その取り違えは出ない）
 *   ・色では区分ありなのに AI が返さなかった（AI が「不明」と返したものも含む）
 *   ・色を決められなかったマス（区分は AI の読みのまま）
 * AI が読めなかった日は比べようがないので、色だけで決めて何も出さない。
 * ツイン・コネクト・注意書き・凡例は AI の読みのまま。
 */
function dblByColor_(ai, col) {
  const aiKind = {}, aiUnsure = {};
  if (ai) {
    (ai.rooms || []).forEach(x => { aiKind[x.room] = x.kind; });
    (ai.unsure || []).forEach(no => { aiUnsure[no] = 1; });
  }
  const rooms = [], ask = [];
  ROOMS.forEach(no => {
    const c = col.map[no], a = aiKind[no] || '';
    const kind = c === '?' ? a : c;
    if (kind) rooms.push({ room: no, kind: kind, from: c === '?' ? 'AI' : '色' });
    if (!ai) return;
    let why = '';
    if (c === '?') why = '色が決められない（AI は' + (a || (aiUnsure[no] ? '不明' : '区分なし')) + '）';
    else if (c && !a) why = '色は' + c + '、AI は' + (aiUnsure[no] ? '不明' : '返さなかった');
    else if (c !== a) why = '色は' + (c || '白（区分なし）') + '、AI は' + a;
    if (why) ask.push({ room: no, why: why, color: c, ai: a });
  });
  return Object.assign({ date: '', legend: [], connects: [], twins: [], note: '' }, ai || {},
    { rooms: rooms, unsure: [], color: { ok: true, ask: ask, aiRead: !!ai } });
}


/*************************************************
 * 合流
 *  部屋番号をキーに、清掃指示書の内容をインジケーターの部屋へ載せる
 *************************************************/
/**
 * 清掃指示書に印刷されている内容から、区分を確定させる。
 *
 * インジケーターは手書きが重なると D と SD を取り違える。
 * 一方、清掃指示書は活字で、載っている部屋の区分は論理的に決まる。
 *   ・フル清掃 / ノーメイク → 必ずステイ（お客様が連泊している部屋の作業）
 *   ・レイトアウト          → 必ずアウト（今日お客様が出る部屋）
 * 読み取り結果と食い違ったら、指示書を正として上書きし、理由を残す。
 */
function applyOrderRules_(rooms, order) {
  const byRoom = {};
  rooms.forEach(r => { byRoom[r.room] = r; });
  const fixed = [];

  // 先にフル清掃の印を付ける。区分を決めるときに
  // ステイ→フルメイクの昇格を同時に済ませるため。
  order.fullClean.forEach(no => { if (byRoom[no]) byRoom[no].fullClean = true; });

  /*
   * code に合わせる。ok に並べたコードのどれかなら、すでに合っているとみなして触らない。
   * レイトアウトは「アウトであること」だけ決まっていて、D（アウト前）か O（アウト済）かは
   * 写真のとおりに残す。O と読めた部屋を D に戻さないため。
   */
  const force = (no, code, why, ok) => {
    const r = byRoom[no];
    if (!r) return;
    const fine = (ok || [code]).some(c => sameCode_(r.code, c));
    if (!fine) {
      fixed.push({ room: no, from: r.code, to: code, why: why });
      r.code = code;
      r.ruled = why;
      // 指示書で確定したので、読み取りの割れは解消したものとして扱う
      r.alt = '';
      const i = r.uncertain.indexOf('code');
      if (i >= 0) r.uncertain.splice(i, 1);
    }
    r.kbn = kbnOf_(r.code, r.fullClean);   // 直さなかった部屋も昇格をやり直す
  };

  order.fullClean.forEach(no => force(no, 'SD', '指示書のフル清掃'));
  order.noMake.forEach(x   => force(x.room, 'SD', '指示書のノーメイク'));
  order.lateOut.forEach(sl => sl.rooms.forEach(no =>
    force(no, 'D', '指示書のレイトアウト', ['D', 'O'])));

  /*
   * 延泊予定。インジケーターは D（出発予定）でも、お客様はそのまま残る。
   * 基本はステイにして、荷物の有無などで変わることがあるので責任者の確認に回す。
   * 集計ボックスとの検算は写真の文字で行うので、元のコードを boxCode に残す。
   */
  (order.extend || []).forEach(no => {
    const r = byRoom[no];
    if (!r) return;
    if (r.code === 'D' || r.code === 'O') {
      r.boxCode = r.code;
      r.code = 'SD';
      r.kbn = kbnOf_(r.code, r.fullClean);
    }
    r.extendStay = true;
    if (r.uncertain.indexOf('延泊予定（ステイにした）') < 0) r.uncertain.push('延泊予定（ステイにした）');
  });

  return fixed;
}

function mergeSheets_(rooms, order, dbl, color) {
  const ruled = applyOrderRules_(rooms, order);

  // ダブルメイク指示書は、画面で色を測れていれば色を正にする（AI が読めなかった日も色だけで決める）
  const col = normDblColor_(color);
  if (col && col.ok) dbl = dblByColor_(dbl || null, col);
  else if (dbl) dbl = Object.assign({}, dbl, { color: { ok: false, why: col ? col.why : '' } });

  const byRoom = {};
  rooms.forEach(r => { byRoom[r.room] = r; });

  const orphan = [];                              // 指示書にあってインジケーターにない部屋
  const touch = (no, fn) => {
    const r = byRoom[no];
    if (!r) { if (orphan.indexOf(no) < 0) orphan.push(no); return; }
    fn(r);
  };

  order.fullClean.forEach(no => touch(no, r => {
    r.fullClean = true;
    r.kbn = kbnOf_(r.code, true);
  }));

  order.noMake.forEach(x => touch(x.room, r => {
    r.noMake = true;
    r.noMakeNeed = x.need || '';
  }));

  order.linenRequest.forEach(no => touch(no, r => { r.linen = true; }));
  order.popCollect.forEach(no  => touch(no, r => { r.pop   = true; }));
  order.extend.forEach(no      => touch(no, r => { r.extend = true; }));

  // アーリーチェックイン → 仕上げの締切（イン時刻の30分前）
  order.earlyIn.forEach(s => s.rooms.forEach(no => touch(no, r => {
    r.checkIn = s.time;
    r.dueIn   = minusMin_(s.time, EARLY_MARGIN_MIN);
  })));

  order.lateOut.forEach(s => s.rooms.forEach(no => touch(no, r => { r.lateOut = s.time; })));

  /*
   * 19時以降のレイトアウトは翌日回し。清掃指示書にも
   * 「19時アウトなど翌日清掃まわし分は含めない」とあるので、清掃の対象から外す。
   * 写真の文字（D）は検算に使うのでそのまま残し、区分だけ対象外にする。
   */
  rooms.forEach(r => {
    if (r.lateOut && String(r.lateOut) >= '19:00') {
      r.nextDay = true;
      r.kbn = 'NONE';
    }
  });

  order.roomChange.forEach(x => {
    touch(x.from, r => { r.changeTo   = x.to;   });
    touch(x.to,   r => { r.changeFrom = x.from; });
  });

  order.notes.forEach(x => touch(x.room, r => {
    r.note = r.note ? (r.note + ' / ' + x.text) : x.text;
  }));

  // 取り消し線が引かれた特記の部屋は、載せずに人の確認へ回す
  (order.struck || []).forEach(no => touch(no, r => {
    if (r.uncertain.indexOf('特記に取り消し線') < 0) r.uncertain.push('特記に取り消し線');
  }));

  // 手書きで書かれた部屋は人の確認へ回す
  // 清掃指示書の2回の読みで、片方だけに出た部屋は人が紙と見比べる
  (order.split || []).forEach(x => touch(x.room, r => {
    const why = '清掃指示書の2回の読みで食い違い（' + x.field + '）';
    if (r.uncertain.indexOf(why) < 0) r.uncertain.push(why);
  }));

  order.handwritten.forEach(no => touch(no, r => {
    r.handwritten = true;
    if (r.uncertain.indexOf('指示書の手書き') < 0) r.uncertain.push('指示書の手書き');
  }));

  // 指示書で区分が決まった部屋は、手書きがあっても確認不要にする
  rooms.forEach(r => {
    if (!r.ruled) return;
    r.hand = false;
    const i = r.uncertain.indexOf('手書きあり');
    if (i >= 0) r.uncertain.splice(i, 1);
  });

  // ダブルメイク指示書を載せる
  if (dbl) {
    const by = {};
    rooms.forEach(r => { by[r.room] = r; });
    dbl.rooms.forEach(x => { if (by[x.room]) by[x.room].dmake = x.kind; });
    // 色と AI が食い違った部屋などは要確認に回し、AI の読みも残す（管理画面で選び直せるように）
    if (dbl.color.ok) dbl.color.ask.forEach(x => {
      const r = by[x.room];
      if (!r) return;
      const why = 'ダブルメイク：' + x.why;
      if (r.uncertain.indexOf(why) < 0) r.uncertain.push(why);
      r.dmakeAsk = true; r.dmakeAi = x.ai;
    });
    // 色を測れなかった日は、AI が色を決められなかった部屋だけ要確認に回す（赤とピンクはどちらも解除なので、取り違えても結果は同じ）
    (dbl.unsure || []).forEach(no => {
      const r = by[no];
      if (r && r.uncertain.indexOf('ダブルメイク指示書の色が読めなかった') < 0) r.uncertain.push('ダブルメイク指示書の色が読めなかった');
    });
    dbl.twins.forEach(pair => pair.forEach(no => { if (by[no]) by[no].twin = true; }));
    dbl.connects.forEach(pair => pair.forEach(no => { if (by[no]) by[no].connect = pair.join('・'); }));
  }
  // 1209・1211 は常にツイン（指示書の欄外に無い日・ダブルメイク指示書が無い日でも）
  rooms.forEach(r => { if (TWIN_FIXED.indexOf(r.room) >= 0) r.twin = true; });

  const v = verify_(rooms, order, orphan, ruled);
  // ダブルメイク指示書は、読んだ凡例と、今日シングルに戻す部屋を並べて、紙と見比べられるようにする
  if (dbl) {
    if ((dbl.legend || []).length) v.warn.push('ダブルメイク指示書の凡例（読んだもの）：' + dbl.legend.join('、'));
    const rel = rooms.filter(r => r.dmake === '解除').map(r => r.room).sort(cmpRoomNo_);
    if (rel.length) v.warn.push('今日シングルに戻す部屋（赤の解除・ピンクの増設セット解除）' + rel.length + '室：' + rel.join('、'));
    if ((dbl.unsure || []).length) v.warn.push('ダブルメイク指示書で色が読めなかった部屋：' + dbl.unsure.join('、'));
    const c = dbl.color;
    if (!c.ok) {
      v.warn.push('ダブルメイクは色で確かめられなかった' + (c.why ? '（' + c.why + '）' : '')
        + '。AI の読みだけなので、塗られたマスを AI が返し忘れても分かりません。紙と見比べてください');
    } else if (!c.aiRead) {
      v.warn.push('ダブルメイク指示書は AI が読めなかったので、区分はマスの色だけで決めました（ツイン・コネクト・注意書きは読めていません）');
    } else if (c.ask.length) {
      v.warn.push('ダブルメイク指示書：マスの色と AI の読みが違う部屋 ' + c.ask.length + '室（色のほうにしています。紙と見比べてください）：'
        + c.ask.map(x => x.room + '（' + x.why + '）').join('、'));
    }
  }
  return { rooms: rooms, order: order, ruled: ruled, dbl: dbl || null,
           verify: v };
}


/*************************************************
 * 検算
 *  ① インジケーター単体：集計ボックス vs 読み取った件数
 *  ② 2枚の突き合わせ：清掃指示数 vs アウト＋ステイ、階別の室数
 *************************************************/
function verify_(rooms, order, orphan, ruled) {
  const msgs = [], warn = [];

  // ① 集計ボックス
  // 延泊予定などで区分を変えた部屋は、写真で読んだ元の文字で数える
  const got = {};
  rooms.forEach(r => {
    const raw = r.boxCode || r.code;
    const c = raw === 'SD' ? 'S' : raw;
    if (c) got[c] = (got[c] || 0) + 1;
  });

  const box = order.__box || {};                  // mergeSheets からは渡らないので下で補う
  const gaps = [];
  let boxTotal = 0, boxRead = 0;
  Object.keys(BOX_KEYS).forEach(k => {
    if (SKIP_BOX.indexOf(k) >= 0) return;          // 検算に使えない項目は飛ばす
    const code = BOX_KEYS[k];
    const want = box[k];
    if (want == null || want < 0) return;
    boxTotal += want; boxRead++;
    const have = got[code] || 0;
    if (have !== want) gaps.push(code + ' 紙' + want + '室 / 読み' + have + '室');
  });
  if (gaps.length) msgs.push('インジケーター: ' + gaps.join('　'));
  if (boxRead === Object.keys(BOX_KEYS).length - SKIP_BOX.length && boxTotal !== rooms.length) {
    msgs.push('合計が合わない：紙' + boxTotal + '室 / 読み' + rooms.length + '室');
  }

  // ② 清掃指示数 = アウト + ステイ（V と X は含めない）
  const target = rooms.filter(r => r.kbn === 'OUT' || r.kbn === 'STAY' || r.kbn === 'FULL');
  if (order.orderCount > 0 && order.orderCount !== target.length) {
    msgs.push('清掃指示数が合わない：指示書' + order.orderCount + '室 / インジケーター' + target.length + '室');
  }

  // ③ 階別
  const byFloor = {};
  target.forEach(r => { byFloor[r.floor] = (byFloor[r.floor] || 0) + 1; });
  const fgaps = [];
  order.planned.forEach(p => {
    const have = byFloor[p.floor] || 0;
    if (p.rooms > 0 && p.rooms !== have) fgaps.push(p.floor + ' 指示書' + p.rooms + ' / 実際' + have);
  });
  if (fgaps.length) msgs.push('階別のズレ：' + fgaps.join('　'));

  if (ruled && ruled.length) {
    warn.push('指示書に合わせて直した部屋 ' + ruled.length + '室：'
      + ruled.map(x => x.room + '（' + (x.from || '空') + '→' + x.to + '／' + x.why + '）').join('、'));
  }

  const cr = order.__cross || {};
  // 指示書で確定した部屋は人が見なくてよいので、手書きの一覧から外す
  const ruledSet = {};
  (ruled || []).forEach(x => { ruledSet[x.room] = 1; });
  const hand = (cr.hand || []).filter(no => {
    const r = rooms.filter(x => x.room === no)[0];
    return !(r && r.ruled);
  });
  if (hand.length) {
    warn.push('手書きがあって指示書でも決まらない ' + hand.length + '室（写真と見比べてください）：'
      + hand.join('、'));
  }
  if (cr.diff && cr.diff.length) {
    warn.push('2回の読み取りで食い違った部屋（要確認）：'
      + cr.diff.map(d => d.room + '（' + (d.a || '空') + ' か ' + (d.b || '空') + '）').join('、'));
  }
  if (cr.missing && cr.missing.length)
    warn.push('2回とも読めなかった部屋（空欄にしています。写真を見て埋めてください）：' + cr.missing.join('、'));
  if (cr.notExist && cr.notExist.length) warn.push('無いはずの部屋番号を読んだので外しました：' + cr.notExist.join('、'));
  if (cr.onlyA && cr.onlyA.length) warn.push('1回目だけに出た部屋：' + cr.onlyA.join('、'));
  if (cr.onlyB && cr.onlyB.length) warn.push('2回目だけに出た部屋：' + cr.onlyB.join('、'));

  if (orphan.length) warn.push('指示書にあってインジケーターにない部屋：' + orphan.join('、'));
  if (order.uncertain.length) warn.push('指示書で読み取りに自信がない欄：' + order.uncertain.join('、'));
  if ((order.split || []).length) warn.push('清掃指示書の2回の読みで食い違った部屋（片方だけで読めた。紙と見比べてください）：'
    + order.split.map(x => x.room + '（' + x.field + '）').join('、'));
  if (order.handwritten.length) warn.push('指示書の手書き：' + order.handwritten.join('、'));

  // フル清掃：管理画面で数えた黄色いマスの数（fullCount）と、2回の読みで読めた部屋数を比べる。
  // 合っていれば何も出さない。合わないときだけ赤（fullGap。管理画面は保存の前にも確かめる）。
  // 手書きで白いマスに書き足した部屋は黄色くないので、AI が手書きとした部屋は除いて比べる。
  // 数えられなかったとき（写真の傾き・枠が見つからない）は1行だけ（赤にしない・保存は止めない）。
  // 黄色が0のときも数えられなかったのと同じ（フル清掃の無い日はふつうにある）。AI が1室以上読んでいたときだけ1行出す。
  let fullGap = '';
  const hw = order.handwritten || [];
  const fullAll = order.fullClean || [];
  const printed = fullAll.filter(no => hw.indexOf(no) < 0), handFull = fullAll.filter(no => hw.indexOf(no) >= 0);
  const UNSURE_FULL = 'フル清掃の数を確かめられなかった（黄色いマスを数えられなかった）';
  if (order.fullCount == null) warn.push(UNSURE_FULL);
  else if (order.fullCount === 0) { if (printed.length) warn.push(UNSURE_FULL); }
  else if (order.fullCount !== printed.length) {
    fullGap = 'フル清掃の黄色いマスは' + order.fullCount + '室、読めたのは' + printed.length + '室'
      + (handFull.length ? '（手書きの ' + handFull.join('、') + ' は除いた）' : '') + '。'
      + (order.fullCount > printed.length ? '紙と見比べて足りない部屋を足してください'
        : '紙と見比べてください（手書きで足した部屋は黄色く塗られていないので数に入りません）')
      + (printed.length ? '（読めた部屋：' + printed.join('、') + '）' : '');
    warn.unshift(fullGap);
  }
  if ((order.struck || []).length)
    warn.push('取り消し線が引かれた特記（載せていません）：' + order.struck.join('、'));
  const nd = rooms.filter(r => r.nextDay).map(r => r.room);
  if (nd.length) warn.push('19時以降のレイトアウトなので翌日回し（清掃の対象から外した）：' + nd.join('、'));
  const ext = rooms.filter(r => r.extendStay).map(r => r.room);
  if (ext.length)
    warn.push('延泊予定なのでステイにした部屋（状況で直してください）：' + ext.join('、'));

  return {
    ok: msgs.length === 0,
    total: rooms.length,
    cleanTarget: target.length,
    byCode: got,
    byFloor: byFloor,
    message: msgs.length ? msgs.join(' ／ ') : '2枚の数字がすべて一致',
    warn: warn,
    fullGap: fullGap
  };
}

/** 集計ボックスを検算に渡すための入口 */
function mergeAll_(indicator, order, dbl, color) {
  const o = order;
  o.__box   = indicator.counts;
  o.__cross = indicator.cross || {};
  return mergeSheets_(indicator.rooms, o, dbl || null, color || null);
}


/*************************************************
 * 整形
 *************************************************/
function normRoom_(r) {
  let code = String(r.code || '').toUpperCase().replace(/[^A-Z*]/g, '');
  const star = code.indexOf('*') >= 0;
  code = code.replace(/\*/g, '');
  if (IND_CODES.indexOf(code) < 0) code = '';

  const room = String(r.room || '').replace(/[^0-9]/g, '');
  const un = (Array.isArray(r.uncertain) ? r.uncertain : [])
    .map(x => String(x).trim()).filter(x => ['room','code'].indexOf(x) >= 0);
  if (!code && un.indexOf('code') < 0) un.push('code');

  return {
    room: room, floor: floorOf_(room), code: code, kbn: kbnOf_(code, false),
    alt: '', hand: !!r.hand, ruled: '', boxCode: '', extendStay: false, nextDay: false,
    dmake: '', twin: false, connect: '',
    reserved: !!r.reserved || star,
    fullClean: false, noMake: false, noMakeNeed: '',
    linen: false, pop: false, extend: false, handwritten: false,
    checkIn: '', dueIn: '', lateOut: '', changeTo: '', changeFrom: '', note: '',
    uncertain: un
  };
}

function cleanCounts_(c) {
  const out = {};
  Object.keys(BOX_KEYS).forEach(k => {
    const v = num_(c[k]);
    out[k] = (v == null || v < 0) ? null : v;
  });
  return out;
}

function num_(v) {
  const n = Number(String(v == null ? '' : v).replace(/[^0-9-]/g, ''));
  return isNaN(n) ? null : n;
}

function floorOf_(room) {
  const d = String(room).replace(/\D/g, '');
  if (d.length >= 4) return d.slice(0, 2) + 'F';
  if (d.length === 3) return d.slice(0, 1) + 'F';
  return 'その他';
}

/** "09F" も "9F" も "9" も 9F にそろえる */
function normFloor_(v) {
  const m = String(v == null ? '' : v).match(/(\d{1,2})/);
  return m ? String(Number(m[1])) + 'F' : '';
}

function hhmm_(v) {
  const s = String(v == null ? '' : v).trim();
  let m = s.match(/(\d{1,2})[:：](\d{2})/);
  if (m) return ('0' + m[1]).slice(-2) + ':' + m[2];
  m = s.match(/(\d{1,2})\s*時/);                  // 「14時」の形
  return m ? ('0' + m[1]).slice(-2) + ':00' : '';
}

function minusMin_(hm, min) {
  const m = String(hm).match(/^(\d{2}):(\d{2})$/);
  if (!m) return '';
  let t = Number(m[1]) * 60 + Number(m[2]) - min;
  if (t < 0) t += 1440;
  return ('0' + Math.floor(t / 60)).slice(-2) + ':' + ('0' + (t % 60)).slice(-2);
}


/*************************************************
 * Gemini 呼び出し
 *************************************************/
function apiKey_() {
  const k = PropertiesService.getScriptProperties().getProperty('GEMINI_API_KEY');
  if (!k) throw new Error('スクリプトプロパティ GEMINI_API_KEY が未設定です');
  return k;
}

/**
 * Gemini への1回ぶんのリクエストを作る。
 *  think … 考える量（'minimal' など）。渡さなければモデルの標準のまま（清掃指示書・ダブルメイクは標準）
 *  hi    … 画像を高解像度で読ませる（インジケーターの切り出し画像）
 */
function geminiReq_(key, base64, mimeType, prompt, schema, think, hi) {
  const cfg = {
    temperature: 0,
    maxOutputTokens: 65536,
    responseMimeType: 'application/json',
    responseSchema: schema
  };
  if (think) cfg.thinkingConfig = { thinkingLevel: think };
  if (hi) cfg.mediaResolution = 'MEDIA_RESOLUTION_HIGH';
  return {
    url: 'https://generativelanguage.googleapis.com/v1beta/models/' + GEMINI_MODEL
       + ':generateContent?key=' + encodeURIComponent(key),
    method: 'post', contentType: 'application/json', muteHttpExceptions: true,
    payload: JSON.stringify({
      contents: [{ parts: [
        { text: prompt },
        { inline_data: { mime_type: mimeType || 'image/jpeg', data: base64 } }
      ]}],
      generationConfig: cfg
    })
  };
}

/** この実行で使ったトークン数（読み取りのたびに画面に出す。やり直したぶんも入る） */
const USAGE_ = { input: 0, output: 0 };

/** 返事を読む。だめなら理由を文字で返す */
function geminiParse_(res) {
  const code = res.getResponseCode();
  if (code === 400 && /thinking|media_?resolution/i.test(res.getContentText())) {
    return { err: '考える量・解像度の指定が使えない', retry: true, plain: true };
  }
  if (code !== 200) {
    return { err: (code === 503 || code === 429)
      ? 'Gemini側が混み合っています。少し待ってもう一度お試しください。'
      : '(' + code + ') ' + res.getContentText().slice(0, 300), retry: [429, 500, 502, 503].indexOf(code) >= 0 };
  }
  let body;
  try { body = JSON.parse(res.getContentText()); } catch (e) { return { err: '返事が読めません', retry: true }; }
  const cand = (body.candidates || [])[0] || {};
  const parts = ((cand.content || {}).parts || []).filter(p => p.text && !p.thought);
  const text = parts.map(p => p.text).join('').replace(/```json|```/g, '').trim();
  if (!text) {
    const why = cand.finishReason || (body.promptFeedback && body.promptFeedback.blockReason) || '空の返事';
    return { err: 'Gemini が何も返しませんでした（' + why + '）', retry: true };
  }
  const u = body.usageMetadata || {};
  USAGE_.input  += u.promptTokenCount || 0;
  USAGE_.output += (u.candidatesTokenCount || 0) + (u.thoughtsTokenCount || 0);
  try { return { data: JSON.parse(text) }; }
  catch (e) {
    return { err: cand.finishReason === 'MAX_TOKENS'
      ? '返事が途中で切れました（出力が長すぎる）' : '返事の形がおかしい（' + (cand.finishReason || '') + '）', retry: true };
  }
}

/**
 * 複数のリクエストを同時に投げる。失敗したものだけ3回までやり直す。
 * 考える量・解像度の指定が使えないモデルだったら、指定を外して投げ直す。
 */
function callGeminiMany_(key, jobs) {
  const reqs = jobs.map(j => geminiReq_(key, j.base64, j.mimeType, j.prompt, j.schema, j.think, j.hi));
  let res = UrlFetchApp.fetchAll(reqs).map(geminiParse_);
  for (let t = 1; t <= 3; t++) {
    const again = res.map((r, i) => (r.err && r.retry) ? i : -1).filter(i => i >= 0);
    if (!again.length) break;
    again.forEach(i => { if (res[i].plain) { const j = jobs[i];
      reqs[i] = geminiReq_(key, j.base64, j.mimeType, j.prompt, j.schema, null, false); } });
    if (!again.every(i => res[i].plain)) Utilities.sleep(3000 * t);
    const re = UrlFetchApp.fetchAll(again.map(i => reqs[i])).map(geminiParse_);
    again.forEach((i, k) => { res[i] = re[k]; });
  }
  const bad = res.map((r, i) => r.err ? (jobs.length > 1 ? (i + 1) + '本目：' : '') + r.err : '').filter(Boolean);
  if (bad.length) throw new Error('読み取り失敗　' + bad.join(' ／ '));
  return res.map(r => r.data);
}

function callGemini_(key, base64, mimeType, prompt, schema) {
  return callGeminiMany_(key, [{ base64: base64, mimeType: mimeType, prompt: prompt, schema: schema }])[0];
}
