# Roomit 南方 — アパホテル〈新大阪 南方駅前〉客室清掃アプリ（GAS）

ルール・数え方・理由は `docs/引き継ぎ書_2026-10-26.pdf` が正。変えるときは理由の欄を読んでから。**効率より確実性が先**（紙のフロアレポートの置き換え）。
サウス（`bisuketto1102/hotel-cleaning-app`）で良くした仕組みを、南方のルールを崩さずに入れていく。サウスのコードをそのまま持ってこない（部屋・紙・工程・帳票が違う）。

## 話し方
- 日本語、敬語なし、シンプルに。気遣いや将来を匂わせる言い回しは要らない。「お前」は使わない。

## ファイル（GASに上がるのはルートの7ファイルだけ。`.claspignore`）
| ファイル | 役割 |
|---|---|
| `Code.js`（GAS上は Code） | 打刻・保存・集計・日報・責任者業務日報・フロアレポート・特別清掃・保存期間 |
| `ApaIndicator.js` | 3枚の紙の読み取り（Gemini）・突き合わせ・検算・区分のルール |
| `Shift.js` | 会社のシフト表 → 名簿（スタッフシート）の自動反映（サウスと同じ仕組み） |
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
NODE_PATH=/opt/node-tools/node_modules node run_outbox.js && NODE_PATH=/opt/node-tools/node_modules node ui_offline.js   # 送り直し
NODE_PATH=/opt/node-tools/node_modules node run_avg.js   # 清掃員のアベレージ
NODE_PATH=/opt/node-tools/node_modules node run_shift.js   # シフト表 → 名簿
```
9/29 の正解：検算OK／OUT 110・STAY 61・FULL 8／未清掃3・実質176・除菌176・ロイヤル48・ツイン2・やり残しなし。

## デプロイ（clasp）
```
node tools/check.cjs          # OK になるまで push しない
clasp push
clasp deploy -i AKfycbxvbj5iniJPsZxyG5W6aUfxPwSFe3ohYtYrfzv8GMsszdxUCkavv0AvFpJ_DzoiKhfu -d "変更内容"
```
- `tools/check.cjs` が見ているもの：.js と HTML内 `<script>` の構文／onclick などから呼んでる関数が画面にあるか／`google.script.run`・`adminRun()` で呼んでる関数がサーバーにあるか／画面から `_` 付きを呼んでいないか／清掃員画面から暗証番号つきの関数を呼んでいないか／管理画面が暗証番号なしで管理用の関数を呼んでいないか／同じ名前の関数・定数が2つないか／scriptlet 以外の `<?`。
- スクリプトID `1-TnpUIqQk9L8p0iTQbT4GqN1odA304JhqzGgTVWSKrHoPwEuRNF7xAV2`
- 現場の `/exec`：`clasp deploy -i AKfycbxvbj5iniJPsZxyG5W6aUfxPwSFe3ohYtYrfzv8GMsszdxUCkavv0AvFpJ_DzoiKhfu -d "変更内容"`（`-i` を付けないと新しいURLになる）
- 2026-10-26 時点で現場は @28（45列の古い版）。10/15 版（46列）はまだ入っていない。入れるときは業務後に `initSpreadsheet()` を1回。
- 反映は業務が終わってから。

## 進め方
- 大きな変更は：作業者が直してテスト → チェック担当（`.claude/agents/checker.md`、名前は `checker`）がもう一度確かめる → 結果をユーザーに伝える → 業務後に反映。
- 文言の直し・小さな見た目の調整など、小さい変更は checker を通さなくていい。checker はファイルを直さない。

## 管理用の関数と暗証番号
- `/exec` は誰でも開けて、`google.script.run` で名前の最後に `_` が無い関数を直接呼べる。画面のロックだけでは守れない。
- 管理画面から呼ぶ関数は `name(pin, ...)` で `needAdmin_(pin)` を通してから中身の `name_` を動かす。管理画面は `adminRun()` で暗証番号を最初に付けて送る。
- 中だけで使う関数は名前の最後に `_`。テストは `this[n] = this[n + '_']` で中身を直接呼ぶ。
- メールアドレスを見る `Session` は使わない。

## 電波が切れたときの送り直し
- 清掃員画面の押す操作（入室・退出・DDセット/確認済・取り消し・DD/清掃不要/回収などのフラグ・アウト済・締切・回収の確認）は、送れなければ端末（localStorage `outbox`）に貯め、つながったら押した順に送る（15秒ごと・online・読み直しのあと）。14秒返事が無ければ通信失敗とみなす。
- 送り直しは押した時刻（`getBoard` の `now` で端末の時計のずれを直した `at`）で記録する（`when_`）。36時間より古いものは断る、5分より先の時刻は今にする。
- サーバーは `at` 付き＝送り直しのとき、同じ人の同じ操作がもう入っていれば成功扱い（二重記録しない）。回収・回収の確認は最初の人と時刻のまま。
- 送り直しの退出・取り消し・作業中に戻す・DDセット済は、その作業をしている人が送った人と同じときだけ効く（`samePerson_`）。押した時刻のあとに別の入室/退出が入っていても断る（別の人の作業に付けない・消さない）。
- 画面は、入室などが断られたら同じ部屋・同じ作業のあとの操作も送らず赤い「!」にする。
- 送り直しの回収を外すは自分が付けた回収だけ。送り直しの「アウト前に戻す」は清掃に入った部屋には効かせない。
- 断られた操作は赤い「! n」で残し、押すと中身を見せて消える。未送信があるときは名前の下に黄色の「未送信 n 件」。

## 見た目（Roomit）
- 画面のタイトルは「Roomit 南方」「Roomit 管理 南方」。ロゴは紺 #14213D の文字・「oo」が2つ連なった鍵の輪で右が金 #C9962B（サウスと同じ）。清掃員画面の一番下と、管理画面の見出し・ロック画面に出す。ホテルに出す帳票（日報・フロアレポートなど）の名前はそのまま。
- 色・タイルはインジケーターの紙に合わせた南方のまま。
- 名前欄は丸い頭文字＋名前のカプセル（`paintWho`）。未選択は赤く脈打つ。`<option>` には value を付ける（空白が2つ続く名前がずれないように）。
- ホーム画面のアイコン：GASエディタで `setupAppIcon` を1回実行（ドライブ直下に置いてリンク公開、IDを `APP_ICON_<版>` に保存）。`doGet` が `setFaviconUrl` で付ける。`addMetaTag` は足さない。

## 清掃員のアベレージ（管理画面）
- `getStaffAverages(pin, from, to)`。期間はその日（上の日付）／今月／先月／30日／3か月。見るだけ。打刻ログより前の期間は保管シートも読む。
- 清掃とチェックを、アウト・ステイ・フルメイクで分けて1室あたりの平均。DDの部屋（DDセット・DD確認）は部屋数だけ。区分がそれ以外の部屋も部屋数と出勤日だけ。
- 75分（`AVG_LIMIT_MIN`）を超える記録は平均から外して「押し忘れ?」に出す。部屋数・1日あたりには入れる。
- 1日あたり＝その人が打刻した日で割る。全体の1人1日あたりは、その作業をした人の出勤日だけで割る。全体との差：時間は短いと緑、部屋数は多いと緑。3室未満は「参考」。
- 空白の違いだけの名前は1人にまとめる。

## 名前の重なりに注意
- 管理用の入口 `name(pin)` と中身 `name_` のほかに、二重実行防止の入口が要るときは `nameGuarded_` にする（`buildDailyReportGuarded_`・`buildFloorReportGuarded_`）。同じ名前の関数が2つあると、あとのほうが勝って黙って防止が外れる（10/26 に一度起きた）。

## 名簿（シフト表から自動）
- シフト表「清掃員シフト ○年」をドライブで名前検索し（見つけたIDは `SHIFT_SS_<年>`）、当月タブ「○年○月」のB列が「南方」の人（または日の欄に「南方」がある人）を在籍、いなくなった人を退職にする。名簿で「応援」と書いた人は触らない（シフトに出てきたら在籍に戻す）。
- 毎朝4時台に自動（`syncStaffFromShift`）。読めた人が5人未満なら何もしない。退職が在籍の3割（最低3人）を超えるときは自動では止め、管理画面「名簿とシフト表」で確かめて反映する。結果は `SHIFT_LAST`。
- 名前欄の「（チェック可）」「\n社員 ベトナム」「平日週4」などは `cleanShiftName_` で落とす。比較は `nameKey_`（空白・長音・中点・全角半角を無視）。
- トリガーは `setupTrigger` を1回実行すると、毎朝5時台の整理と4時台の名簿の両方が入る。管理画面で反映したときも4時台のほうが入る。

## 古い打刻の保管（毎朝5時台）
- `archiveOldLogs`：KEEP_MONTHS（2か月）より古い行を「打刻ログ_保管」に書き、書けたのを読み返して確かめてから、打刻ログの先頭の古い行だけ消す（前は全部消して書き直していた）。並びが崩れていたら並べ替えてやり直し、それでもだめなら何も書かず・消さずに止める。
