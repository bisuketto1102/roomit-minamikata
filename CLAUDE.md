# Roomit 南方 — アパホテル〈新大阪 南方駅前〉客室清掃アプリ（GAS）

ルール・数え方・理由は `docs/引き継ぎ書_2026-10-26.pdf` が正。変えるときは理由の欄を読んでから。**効率より確実性が先**（紙のフロアレポートの置き換え）。
サウス（`bisuketto1102/hotel-cleaning-app`）で良くした仕組みを、南方のルールを崩さずに入れていく。サウスのコードをそのまま持ってこない（部屋・紙・工程・帳票が違う）。

## 話し方
- 日本語、敬語なし、シンプルに。気遣いや将来を匂わせる言い回しは要らない。「お前」は使わない。

## ファイル（GASに上がるのはルートの6ファイルだけ。`.claspignore`）
| ファイル | 役割 |
|---|---|
| `Code.js`（GAS上は Code） | 打刻・保存・集計・日報・責任者業務日報・フロアレポート・特別清掃・保存期間 |
| `ApaIndicator.js` | 3枚の紙の読み取り（Gemini）・突き合わせ・検算・区分のルール |
| `Index.html` | 清掃員画面 |
| `Admin.html` | 管理画面（`?p=admin`、暗証番号） |
| `Lang.html` | 7言語（ja/en/vi/ne/my/id/zh） |
- `ref/v1015/` … 2026-10-15 版の元ファイル（引き継ぎ一式）。`test/` … GASの代わりの仕掛けと 9/29 の正解。

## 確かめ方（変えたら必ず）
```
cd test
NODE_PATH=/opt/node-tools/node_modules STRICT=1 node run0929.js   # 9/29 の数字
NODE_PATH=/opt/node-tools/node_modules STRICT=1 node run_new.js   # 打刻・DD・回収・追加指示など
NODE_PATH=/opt/node-tools/node_modules node run_ocr.js
NODE_PATH=/opt/node-tools/node_modules node ui.js && NODE_PATH=/opt/node-tools/node_modules node ui_admin.js
```
9/29 の正解：検算OK／OUT 110・STAY 61・FULL 8／未清掃3・実質176・除菌176・ロイヤル48・ツイン2・やり残しなし。

## デプロイ（clasp）
- スクリプトID `1-TnpUIqQk9L8p0iTQbT4GqN1odA304JhqzGgTVWSKrHoPwEuRNF7xAV2`
- 現場の `/exec`：`clasp deploy -i AKfycbxvbj5iniJPsZxyG5W6aUfxPwSFe3ohYtYrfzv8GMsszdxUCkavv0AvFpJ_DzoiKhfu -d "変更内容"`（`-i` を付けないと新しいURLになる）
- 2026-10-26 時点で現場は @28（45列の古い版）。10/15 版（46列）はまだ入っていない。入れるときは業務後に `initSpreadsheet()` を1回。
- 反映は業務が終わってから。

## 進め方
- 大きな変更は：作業者が直してテスト → チェック担当（checker）がもう一度確かめる → 結果をユーザーに伝える → 業務後に反映。
