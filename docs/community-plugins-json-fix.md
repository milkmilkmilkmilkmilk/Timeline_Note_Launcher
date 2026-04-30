# Obsidian監査エラー台帳

このドキュメントは、Obsidianコミュニティプラグイン提出時の監査エラーを一元管理する台帳です。
旧 `community-plugins.json` 構文エラー用メモを拡張し、`Required` / `Errors` を主対象に記録します。

## 0. 目的とスコープ

- 対象: `obsidianmd/obsidian-releases` の提出PRに対する bot 指摘
  - `ObsidianReviewBot`（コード監査）
  - `github-actions[bot]`（`community-plugins.json` 検証）
- 主対象: `Required` と `Errors`
- 補助対象: `Optional`（定型運用メッセージ）
- 初回バックフィル範囲: PR #9899 の bot コメント全件（確認済み9件）

## 1. 記録ルール

### 1.1 記録タイミング

- 新しい bot 指摘が出たら **24時間以内** に本台帳へ追記する。
- 同種エラーは「代表事例 + 発生履歴」に正規化して更新する。

### 1.2 1エントリの必須フィールド

- 発生日(UTC/JST)
- ソース（`ObsidianReviewBot` / `github-actions[bot]`）
- 種別（`Required` / `Errors` / `Optional`）
- 原文（短い抜粋）
- 影響範囲（ファイル・行・PR）
- 原因（技術的根因）
- 対応（修正コミット/PR）
- 再発防止策（予防チェック、運用ルール）
- 検証（再スキャン結果）

### 1.3 取得・照合コマンド

```bash
# PRコメント取得（ネットワーク利用可能時）
gh api repos/obsidianmd/obsidian-releases/issues/9899/comments

# JSON構文位置の特定
node scripts/find-json-error.mjs community-plugins.json <position>

# JSONの最終パース検証
node -e "JSON.parse(require('node:fs').readFileSync('community-plugins.json','utf8')); console.log('OK')"
```

## 2. エントリテンプレート（コピペ用）

```md
### E-XXX: <エラー名>

- 発生日(UTC/JST):
- ソース:
- 種別:
- 原文:
- 影響範囲:
- 原因:
- 対応:
- 再発防止策:
- 検証:
- 発生履歴:
  - YYYY-MM-DDThh:mm:ssZ (JST): <要約>
```

## 3. 監査エラー一覧（インデックス）

| ID | 分類 | 概要 | 初回検知 | 最終検知 | 状態 |
|---|---|---|---|---|---|
| E-001 | Required | Use sentence case for UI text | 2026-02-10 | 2026-03-05 | 対応済み（再スキャン待ち） |
| E-002 | Errors | `community-plugins.json` invalid JSON at position 645692 | 2026-03-05 | 2026-03-05 | 解消済み |
| E-003 | Errors | Newly added entry is not at the end | 2026-03-05 | 2026-03-05 | 解消済み |
| E-004 | Required | Disallowed eslint-disable directives | 2026-01-30 | 2026-02-10 | 解消済み |
| E-005 | Required | Async method has no `await` expression | 2026-01-30 | 2026-02-16 | 解消済み |
| E-006 | Required | Unused eslint-disable directive | 2026-01-30 | 2026-02-08 | 解消済み |

## 4. 詳細ログ（時系列）

### E-001: Use sentence case for UI text

- 発生日(UTC/JST): 2026-02-10T00:08:56Z (2026-02-10 09:08 JST) 初回
- ソース: `ObsidianReviewBot`
- 種別: `Required`
- 原文: `Use sentence case for UI text.`
- 影響範囲:
  - `src/settings.ts#L143`（過去）
  - `src/settingSections.ts#L78`（過去）
  - `src/settingSections.ts#L339-L340`（直近）
- 原因:
  - UI文言に大文字略語（`SRS`）をそのまま使用し、sentence case ルールに抵触。
- 対応:
  - `5319f4e`: sentence case違反を含む Required 指摘へ対応
  - `404394b`: settings/timeline 側の review bot 指摘を修正
  - `87f0dab`: `Show SRS in actions` → `Show spaced repetition in actions` へ修正
- 再発防止策:
  - UI文字列（`setName`, `setDesc`, command 名）で全大文字略語を直接使わない。
  - 例外が必要なら略語を展開（例: `spaced repetition`）して sentence case を優先。
  - 提出前チェックに「UI文言の sentence case 目視点検」を固定化。
- 検証:
  - `87f0dab` push 済み。bot 再スキャン結果を確認して本項目を更新する。
- 発生履歴:
  - 2026-02-10T00:08:56Z (JST 09:08): `src/settings.ts` で検知
  - 2026-02-16T19:02:17Z (JST 02/17 04:02): `src/settingSections.ts` で再検知
  - 2026-03-05T05:36:57Z (JST 14:36): `src/settingSections.ts#L339-L340` で再検知

### E-002: `community-plugins.json` invalid JSON

- 発生日(UTC/JST): 2026-03-05T04:07:46Z (2026-03-05 13:07 JST)
- ソース: `github-actions[bot]`
- 種別: `Errors`
- 原文: `Could not parse community-plugins.json, invalid JSON. Expected ',' or '}' after property value in JSON at position 645692`
- 影響範囲: `obsidian-releases/community-plugins.json`（PR #9899）
- 原因:
  - 新規エントリ追加時にオブジェクト区切り（`,` / `}`）が欠落し、JSON が壊れた。
- 対応:
  - `8e2a0bff` (`obsidian-releases` 側): JSONオブジェクト終端を修正
  - `5d303532` (`obsidian-releases` 側): エントリ位置を末尾へ移動
  - `ca58b75b` (`obsidian-releases` 側): 空コミットで再検証を発火
- 再発防止策:
  - 編集後に必ず `JSON.parse` で構文検証する。
  - position 指定エラーは `scripts/find-json-error.mjs` で即座に局所確認する。
  - 大きなJSONは「追記後に末尾近傍のみ」ではなく全体パースを必須化。
- 検証:
  - `plugin-validation` が `completed/success`（run: `22704199099`）
- 発生履歴:
  - 2026-03-05T04:07:46Z (JST 13:07): 初回検知

### E-003: Newly added entry is not at the end

- 発生日(UTC/JST): 2026-03-05T05:18:28Z (2026-03-05 14:18 JST)
- ソース: `github-actions[bot]`
- 種別: `Errors`
- 原文: `The newly added entry is not at the end...`
- 影響範囲: `obsidian-releases/community-plugins.json`（PR #9899）
- 原因:
  - `community-plugins.json` で新規エントリの挿入位置が末尾ルールに一致していなかった。
- 対応:
  - `5d303532` (`obsidian-releases` 側): `timeline-note-launcher` エントリを配列末尾へ移動
- 再発防止策:
  - PR作成/更新前に「自分のエントリが末尾か」を必ず確認する。
  - `master` 取り込み後は末尾位置がズレるため、再度末尾配置を確認する。
- 検証:
  - E-002 と同じ再検証で `plugin-validation` 成功。
- 発生履歴:
  - 2026-03-05T05:18:28Z (JST 14:18): 初回検知

### E-004: Disallowed eslint-disable directives

- 発生日(UTC/JST): 2026-01-30T07:27:01Z (2026-01-30 16:27 JST) 初回
- ソース: `ObsidianReviewBot`
- 種別: `Required`
- 原文（代表）:
  - `Disabling 'obsidianmd/ui/sentence-case' is not allowed.`
  - `Disabling '@typescript-eslint/no-explicit-any' is not allowed.`
  - `Disabling 'obsidianmd/settings-tab/no-problematic-settings-headings' is not allowed.`
- 影響範囲: `src/settings.ts`, `src/dataLayer.ts`, `src/timelineView.ts` など（過去）
- 原因:
  - lint違反を suppress で回避する実装方針が、監査ルールに抵触。
- 対応:
  - `5319f4e`, `404394b` などで suppress 除去 + 本体修正へ切り替え。
- 再発防止策:
  - 監査対象ルールの `eslint-disable` を禁止（コード規約化）。
  - suppress ではなく型/文言/実装の修正を優先する。
- 検証:
  - 以降の bot コメントで同種の指摘が消失。
- 発生履歴:
  - 2026-01-30T07:27:01Z
  - 2026-02-08T04:02:07Z
  - 2026-02-08T10:00:17Z
  - 2026-02-10T00:08:56Z

### E-005: Async method has no `await` expression

- 発生日(UTC/JST): 2026-01-30T07:27:01Z (2026-01-30 16:27 JST) 初回
- ソース: `ObsidianReviewBot`
- 種別: `Required`
- 原文: `Async method '<name>' has no 'await' expression.`
- 影響範囲: `src/timelineView.ts`, `src/cardRenderer.ts`（過去）
- 原因:
  - 非同期化の名残で `async` が残り、`await` を使わない関数が混在。
- 対応:
  - `5319f4e`: `createGridCardElement` から `async` を除去
  - `404394b`: `render` / `renderCardList` で実際に `await Promise.all(...)` を導入
- 再発防止策:
  - `async` 追加時に「`await` の有無」をレビュー項目に固定する。
  - 返り値が同期で十分な関数は `async` を付けない。
- 検証:
  - 以降の bot コメントで同種指摘が解消。
- 発生履歴:
  - 2026-01-30T07:27:01Z
  - 2026-02-08T04:02:07Z
  - 2026-02-08T10:00:17Z
  - 2026-02-10T00:08:56Z
  - 2026-02-16T19:02:17Z

### E-006: Unused eslint-disable directive

- 発生日(UTC/JST): 2026-01-30T07:27:01Z (2026-01-30 16:27 JST) 初回
- ソース: `ObsidianReviewBot`
- 種別: `Required`
- 原文: `Unused eslint-disable directive ...`
- 影響範囲: `src/dataLayer.ts`, `src/timelineView.ts`（過去）
- 原因:
  - ルール違反が解消した後も suppress コメントが残存。
- 対応:
  - `5319f4e` を含む lint cleanup で未使用 suppress を削除。
- 再発防止策:
  - suppress 追加を原則禁止し、必要時も期限付き・理由付きに限定。
  - 変更後に suppress が残っていないかを確認する。
- 検証:
  - 2026-02-10 以降、同種の再指摘なし。
- 発生履歴:
  - 2026-01-30T07:27:01Z
  - 2026-02-08T04:02:07Z
  - 2026-02-08T10:00:17Z

### バックフィル済み bot コメント一覧（PR #9899）

| No. | 投稿日時(UTC) | JST | ソース | 要約 |
|---|---|---|---|---|
| 1 | 2026-01-30T07:27:01Z | 2026-01-30 16:27 | ObsidianReviewBot | Required 多数（suppress禁止、async/no-await、sentence case等） |
| 2 | 2026-02-08T04:02:07Z | 2026-02-08 13:02 | ObsidianReviewBot | Required 再指摘（suppress禁止、async/no-await 等） |
| 3 | 2026-02-08T10:00:17Z | 2026-02-08 19:00 | ObsidianReviewBot | Required 再指摘（同系統） |
| 4 | 2026-02-10T00:08:56Z | 2026-02-10 09:08 | ObsidianReviewBot | sentence case / disable禁止 / async指摘 |
| 5 | 2026-02-16T19:02:17Z | 2026-02-17 04:02 | ObsidianReviewBot | sentence case / async指摘 |
| 6 | 2026-03-01T16:40:43Z | 2026-03-02 01:40 | ObsidianReviewBot | bot修正完了、human review待ち通知 |
| 7 | 2026-03-05T04:07:46Z | 2026-03-05 13:07 | github-actions[bot] | `community-plugins.json` parse error |
| 8 | 2026-03-05T05:18:28Z | 2026-03-05 14:18 | github-actions[bot] | 新規エントリ末尾ルール違反 |
| 9 | 2026-03-05T05:36:57Z | 2026-03-05 14:36 | ObsidianReviewBot | sentence case 再指摘（`src/settingSections.ts#L339-L340`） |

## 5. 再発防止チェックリスト

### 5.1 `obsidian-releases` 提出前

- `community-plugins.json` を全体パースで検証する。
- 新規エントリが配列末尾にあることを確認する。
- `id` / `name` / `description` / `repo` が `manifest.json` と整合することを確認する。

### 5.2 プラグイン側提出前

- UI文言（`setName` / `setDesc` / command 名）を sentence case で点検する。
- 全大文字略語（例: `SRS`）はそのまま使わず、必要に応じて展開表現にする。
- `eslint-disable` を追加しない。
- `async` 関数は `await` を持つか、不要なら `async` を外す。

### 5.3 修正後運用

- 新しいPRは作成しない（既存PRへ push して再検証を発火）。
- rebase はしない（reviewer 側運用に従う）。
- bot 指摘の修正完了後、台帳の `対応` と `検証` を更新する。

## 6. 付録（Optionalメッセージと運用メモ）

### 6.1 Optional 定型文（要約）

- 新しいPRを作らない。
- 変更を push すると bot が再スキャンする（目安: 数分〜6時間）。
- 判定に異議がある場合は `/skip` と理由をコメントする。
- rebase はしない。

### 6.2 運用メモ

- bot コメントの原文取得が困難な場合は、GitHub PR画面の最新コメントを優先し、取得後に本台帳を補完する。
- 再発が起きたエラーは新規IDを作らず、既存IDの `発生履歴` に追記する。
