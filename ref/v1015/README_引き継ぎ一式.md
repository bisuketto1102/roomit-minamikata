# アパ南方 清掃アプリ 引き継ぎ一式（2026-10-26）

ルール・理由・データの持ち方は Claude Docs「アパ南方 清掃アプリ 引き継ぎ書（書き換える人向け）」にある。
食い違うときはその引き継ぎ書が正。

## 中身
- `src/` … GAS の5ファイル（10/15 版）。セットで差し替える
- `test/` … GAS の代わりの仕掛け（Node）と 9/29 の正解データ
  - `gasmock.js` … SpreadsheetApp / CacheService / PropertiesService などの真似。`STRICT=1` で行・列のはみ出しをエラーにする
  - `data0929.js` … 9/29 のインジケーター（12F→02F、列1〜17）・清掃指示書・ダブルメイク指示書の書き起こし
  - `run0929.js` … 9/29 を取り込み→全室完了→日報・フロアレポート・特別清掃シート。数字を表示する
  - `run_new.js` … 打刻・DDセット・回収・追加指示・部屋を直す・取り込み直し・保管の動き（OK/NG で表示）
  - `run_ocr.js` … 切り出し読み取り（Gemini の代わりに書き起こしを返す）と検算
  - `ui.js` / `ui_admin.js` … Chromium で清掃員画面・管理画面を開き、google.script.run を仕掛けにつないで操作
  - `crop.js` … インジケーター PDF の切り出しを試す（`node crop.js pdf0929/indicator_0929.pdf 0.70,0.60`）
  - `pdf0929/` … 9/29 の実物の PDF 3枚

## 使い方
```
cd test
npm i
npm test      # 数字の確認
npx playwright install chromium   # 初回だけ
npm run ui    # 画面の確認
```

## 正解（9/29）
検算OK／OUT 110・STAY 61・FULL 8／未清掃3・実質176・除菌176・ロイヤル48・ツイン2・やり残しなし
（404・505・614 を DD（備品要）にした試験条件）

本物の Gemini での読み取りと、GAS 上での PDF 作成はこの仕掛けでは確かめられない。
