/*************************************************
 * アパホテル〈新大阪 南方駅前〉
 * 2枚読み取り版
 *
 *  1枚目 ルームインジケーター … 部屋番号・状態コード（印刷）
 *  2枚目 清掃指示書           … フル清掃・ノーメイク・アーリーIN など（印刷）
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
  I: 'NONE', C: 'NONE', P: 'NONE', X: 'NONE', A: 'NONE'
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
function readIndicator(base64, mimeType) {
  const key = apiKey_();
  const a = callGemini_(key, base64, mimeType, indicatorPrompt_('color'), indicatorSchema_());
  const b = callGemini_(key, base64, mimeType, indicatorPrompt_('text'),  indicatorSchema_());
  return crossCheck_(a, b);
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
function readOrder(base64, mimeType) {
  const parsed = callGemini_(apiKey_(), base64, mimeType, orderPrompt_(), orderSchema_());
  return normOrder_(parsed);
}

function orderPrompt_() {
  return [
    'これはホテルの「清掃指示書」です。フロントが作成し、その日の清掃の指示をまとめた紙です。',
    '印刷された内容と、ペンでの手書きの追記が混在しています。両方を読み取ってください。',
    '手書きで書かれた部屋番号は handwritten の配列にも入れてください（後で人が確認するため）。',
    '',
    '■ 読み取る欄',
    '1) 右上「清掃指示日」の日付 → date（yyyy-MM-dd）。作成者名 → maker',
    '2) 上段の数値欄 → 「清掃指示数」の数字を orderCount に入れる',
    '3)「本日の清掃予定客室数」… 2F〜12Fの階ごとの室数と合計。',
    '   planned に [{floor:"2F", rooms:12}, ...]、合計を plannedTotal に。',
    '4)「フル清掃（リネン強制交換）」… 丸で囲まれた部屋番号を fullClean に列挙。',
    '   手書きで書き足された番号も必ず含める。',
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
const DMAKE_KINDS = ['新規', '継続', '解除', '常設', '増設予定', '増設解除して増設予定'];

/** 日報の「ロイヤル（増設含む）」に数える色 */
const ROYAL_KINDS = ['新規', '継続', '常設'];

function readDouble(base64, mimeType) {
  const parsed = callGemini_(apiKey_(), base64, mimeType, doublePrompt_(), doubleSchema_());
  return normDouble_(parsed);
}

function doublePrompt_() {
  return [
    'これはホテルの「ダブルメイク指示書」です。',
    'ダブルメイクとは、ベッドが1台の部屋に2人が泊まるときに寝具を2人分用意する作業のことです。',
    '',
    '■ 表の形',
    '- 部屋番号が書かれたマスが格子状に並んでいます。上の行が高い階、下の行が低い階です。',
    '- 1つのマスに部屋番号が1つ。マスの塗りつぶしの色が、その部屋の区分を表します。',
    '- 真っ黒に塗りつぶされたマスは「部屋が存在しない」印です。出力しないでください。',
    '',
    '■ 色と区分 ※凡例が紙の下に印刷されています',
    '- 緑　　　　→ 新規',
    '- 黄色　　　→ 継続',
    '- 赤　　　　→ 解除',
    '- 茶色・オレンジ → 常設',
    '- 青　　　　→ 増設予定',
    '- 薄い赤・サーモンピンク → 増設解除して増設予定',
    '- 白・無色　→ 区分なし。kind を空文字にする',
    '色の見分けがつかないときは kind を空文字にして、uncertain に "kind" を入れてください。',
    '赤と茶色、緑と青は取り違えやすいので落ち着いて見てください。',
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
      rooms: { type: 'ARRAY', items: {
        type: 'OBJECT',
        properties: {
          room: { type: 'STRING' },
          kind: { type: 'STRING' },
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

function normDouble_(p) {
  const pairs = a => (Array.isArray(a) ? a : [])
    .map(x => (Array.isArray(x) ? x : []).map(y => String(y).replace(/[^0-9]/g, '')).filter(Boolean))
    .filter(x => x.length >= 2);

  const rooms = (Array.isArray(p.rooms) ? p.rooms : []).map(r => {
    const kind = String(r.kind || '').trim();
    return {
      room: String(r.room || '').replace(/[^0-9]/g, ''),
      kind: DMAKE_KINDS.indexOf(kind) >= 0 ? kind : ''
    };
  }).filter(r => r.room && r.kind);

  return {
    date: String(p.date || '').trim(),
    rooms: rooms,
    connects: pairs(p.connects),
    twins: pairs(p.twins),
    note: String(p.note || '').trim()
  };
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

function mergeSheets(rooms, order, dbl) {
  const ruled = applyOrderRules_(rooms, order);

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
    dbl.twins.forEach(pair => pair.forEach(no => { if (by[no]) by[no].twin = true; }));
    dbl.connects.forEach(pair => pair.forEach(no => { if (by[no]) by[no].connect = pair.join('・'); }));
  }

  return { rooms: rooms, order: order, ruled: ruled, dbl: dbl || null,
           verify: verify_(rooms, order, orphan, ruled) };
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
  if (cr.onlyA && cr.onlyA.length) warn.push('1回目だけに出た部屋：' + cr.onlyA.join('、'));
  if (cr.onlyB && cr.onlyB.length) warn.push('2回目だけに出た部屋：' + cr.onlyB.join('、'));

  if (orphan.length) warn.push('指示書にあってインジケーターにない部屋：' + orphan.join('、'));
  if (order.uncertain.length) warn.push('指示書で読み取りに自信がない欄：' + order.uncertain.join('、'));
  if (order.handwritten.length) warn.push('指示書の手書き：' + order.handwritten.join('、'));
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
    warn: warn
  };
}

/** 集計ボックスを検算に渡すための入口 */
function mergeAll(indicator, order, dbl) {
  const o = order;
  o.__box   = indicator.counts;
  o.__cross = indicator.cross || {};
  return mergeSheets(indicator.rooms, o, dbl || null);
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

function callGemini_(key, base64, mimeType, prompt, schema) {
  const payload = {
    contents: [{ parts: [
      { text: prompt },
      { inline_data: { mime_type: mimeType || 'image/jpeg', data: base64 } }
    ]}],
    generationConfig: {
      temperature: 0,
      responseMimeType: 'application/json',
      responseSchema: schema
    }
  };

  const url = 'https://generativelanguage.googleapis.com/v1beta/models/' + GEMINI_MODEL
            + ':generateContent?key=' + encodeURIComponent(key);
  const send = () => UrlFetchApp.fetch(url, {
    method: 'post', contentType: 'application/json',
    payload: JSON.stringify(payload), muteHttpExceptions: true
  });

  let res, code = 0;
  for (let i = 0; i < 4; i++) {
    if (i > 0) Utilities.sleep(3000 * i);
    res = send();
    code = res.getResponseCode();
    if (code === 200) break;
    if ([429, 500, 502, 503].indexOf(code) < 0) break;
  }
  if (code !== 200) {
    const hint = (code === 503 || code === 429)
      ? 'Gemini側が混み合っています。少し待ってもう一度お試しください。'
      : res.getContentText().slice(0, 300);
    throw new Error('読み取り失敗 (' + code + '): ' + hint);
  }

  const body  = JSON.parse(res.getContentText());
  const parts = (((body.candidates || [])[0] || {}).content || {}).parts || [];
  return JSON.parse(parts.map(p => p.text || '').join('').replace(/```json|```/g, '').trim());
}