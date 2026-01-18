# 要件定義書（v0.2）

**プロダクト名（仮）：** Timeline Note Launcher

## 0. 目的・非目的・対象環境

* 目的
  ユーザーがTwitterの代替として、Obsidian内の“ランダム復習用タイムライン”を無意識に開く習慣を作る。ノートカードを縦並びで提示し、タップ一発で全文へ遷移させる。
* 非目的
  公式UIや商標の模倣。初期版での高度SRS実装。ソーシャル機能の実装。
* 対象環境
  Obsidian Desktop + Mobile。モバイル最優先。Desktopは快適性の追加。

## 1. 開発・配布の基盤方針（公式準拠）

### 1.1 何を

公式の**obsidian-sample-plugin**テンプレートから開始し、標準ビルド構成・ファイル構成（`manifest.json` / `main.js` / `styles.css`）で進める。
**なぜ**：Obsidian公式リポジトリは最短経路での環境構築と配布手順を提供しており、API変更への追従も容易。
**順序**

1. GitHubでテンプレートを「Use this template」。
2. Node.js導入 → `npm i` → `npm run dev`。
3. 生成物（`main.js`, `manifest.json`, `styles.css`）をVaultの`Vault/.obsidian/plugins/<id>/`へ配置。
4. Obsidianをリロードし、プラグインを有効化。
   **どのように**：テンプレREADMEに従い、開発中は`npm run dev`のwatchで自動ビルド。配布はGitHub Releaseへ3点（`manifest.json`, `main.js`, `styles.css`）を添付。([GitHub][1])

### 1.2 設定保存の基本原則

**何を**：ユーザー設定・内部データは`loadData()`/`saveData()`で`data.json`に保存。
**なぜ**：Obsidian APIの標準I/Oで互換性・将来性が高い。
**どのように**：設定画面は`PluginSettingTab`で提供。モバイルでも同一設定を共有。([GitHub][2])

### 1.3 独自ビューの提供

**何を**：タイムライン専用の**カスタムView**を登録。
**なぜ**：エディタと独立した“ランチャー”体験を作り、将来のSRS導入時もUI分離で影響を最小化。
**順序**

1. `this.registerView(type, factory)`でViewを登録。
2. リボンやコマンドからViewを開くフローを実装。
   **どのように**：ObsidianのView/BasesView系APIに従い、View生成は**ファクトリ関数**で行い、手動で参照を保持しない。([Developer Documentation][3])

### 1.4 モバイル前提の実装

**何を**：モバイルUI最適化と機能差の考慮。
**なぜ**：`addStatusBarItem()`等はモバイル未対応。プラグインは**isDesktopOnlyをfalse**で公開し、両OSで同等動作。
**どのように**：実行時は`Platform.isMobile`で分岐し、タップ領域やアニメーション量を調整。([GitHub][2])

### 1.5 パフォーマンス原則

**何を**：`onload()`では登録処理に限定し、重い処理を遅延。ビルドは最小化。
**なぜ**：起動時間とUXの劣化を防ぐ。
**どのように**：公式ガイドの推奨に従い、初期化と描画負荷を分離する。([Developer Documentation][4])

## 2. ユースケース

1. ユーザーがスマホでプラグインViewを開く。
2. 縦一列のカード群に「未読・久しぶり・ピン留め」等が混在表示。
3. カード全体タップでノートへ。戻るでViewに復帰。
4. 閲覧ログ（時刻・回数）を自動記録し、将来のSRSに転用。

## 3. スコープ

### v1（骨組み）

* タイムラインView（1カラム、無限スクロールは任意）
* 対象ノートの定義：フォルダ／タグ／検索（Obsidian検索構文をそのまま受ける）
* 選択モード：
  A. 単純ランダム
  B. 古さ優先ランダム（`lastReviewedAt`が古いほど重み↑、`pinned`に加点）
* ログ：`lastReviewedAt`, `reviewCount`
* PCは任意でSplit View（タイムライン + 本文）
* **SRSは未実装**。SRSは選択エンジンとして後付け可能な形だけ確保。

### v2+（拡張）

* 選択エンジンにSRS導入（`nextReviewAt`, `difficulty`などを考慮）
* 難易度ボタン等の評価入力
* 他プラグインのYAMLキー読取による連携（存在しなくても動作）

## 4. アーキテクチャ（3層）

1. **データ層**

   * 対象ノートの列挙・フィルタ（フォルダ、タグ、検索式）
   * **保存方針**：

     * 内部コア（`lastReviewedAt`, `reviewCount`）→ `data.json`（`loadData/saveData`）
     * ユーザーが他プラグインと共有したい属性（例：`pinned`, 将来の`difficulty`）→ 各ノートのYAML
   * YAML編集は**`processFrontMatter()`**で行い、原子的に更新。コメント消失等の既知仕様に注意（必要な場合はJSON側に寄せる）。([Developer Documentation][5])

2. **選択ロジック層（選択エンジン）**

   * 入力：候補ノート＋メタデータ＋ユーザー設定
   * 出力：並べる`noteId[]`
   * モード：Aランダム / B古さ優先 / 将来C=SRS
   * `engineVersion`を持ち、将来のアルゴリズム変更に備える。

3. **表示・インタラクション層（タイムラインView）**

   * 構成：タイトル、先頭数行プレビュー、メタ小アイコン、全体タップで本文
   * 既読ショートカット（ワンタップで`lastReviewedAt`更新）
   * モバイルは1画面で遷移。PCは設定でSplit Viewを許可。
   * Viewは**`registerView( type, factory )`**で管理（ファクトリ外参照を持たない）。([Developer Documentation][3])

## 5. 既存プラグインへの依存ポリシー

* コアは**Obsidian APIのみで完結**。
* 他プラグインに依存する場合も**YAML等の“ノート上の文字列”**を読むだけに限定。内部実装やイベントへは依存しない。
* 目的：将来の互換性維持と破綻リスクの局所化。

## 6. 設定項目（初期）

* 対象ノート：対象フォルダ[], 対象タグ[], 検索クエリ
* 選択モード：ランダム / 古さ優先（SRSは将来）
* 表示：プレビュー行数、メタ表示ON/OFF、DesktopのSplit View可否
* 動作：タイムライン更新（手動 / n分ごと）、ログ保持期間（例：90日）
* 実装：`PluginSettingTab`で提供し、値は`loadData/saveData`で保持。([Developer Documentation][6])

## 7. モバイル要件の具体化

* **必須**：1カラム、タップ領域は指操作前提、余白・行高を増やして誤タップ防止。
* **分岐**：`Platform.isMobile`で重UI（アニメ）と軽UIを出し分け。ステータスバー項目は利用しない（モバイル非対応）。([GitHub][2])
* **導線**：カード→本文→戻るで即復帰。スクロール位置を維持。
* **パフォーマンス**：画像サムネ等は遅延生成。`onload()`は登録処理に限定。([Developer Documentation][4])

## 8. リスクと対処

* **API変更・非互換**

  * 対処：公式テンプレートを継続利用。API型定義（`obsidian.d.ts`）をアップデート。必要に応じ`minAppVersion`を上げる。([GitHub][7])
* **Frontmatter操作の副作用**

  * 対処：重要データは`data.json`側を主とし、YAMLは最小限。`processFrontMatter()`の再整形仕様を把握。([Developer Documentation][5])
* **モバイルUI破綻**

  * 対処：`Platform`判定で機能出し分け。ステータスバー機能を使用しない。([GitHub][2])
* **起動遅延**

  * 対処：`onload()`の最小化、ビルドの縮小化、重処理の遅延実行。([Developer Documentation][4])

## 9. 受け入れ条件（v1）

* Vault内の指定集合から**100件程度**のカードを即時生成し、縦スクロールで快適に閲覧できる。
* カードタップで本文へ遷移し、戻るでスクロール位置が保たれる。
* `lastReviewedAt`と`reviewCount`が**閲覧操作に応じて確実に更新**される。
* 設定画面から対象フォルダ/タグ/検索を切り替えられ、**再読み込みのみで反映**される。

---

### 参考（公式ソース）

* 公式テンプレート（ビルド・配置・Release手順）([GitHub][1])
* API型定義（設定保存`loadData/saveData`、GUI差、各UI APIの可用性注記）([GitHub][2])
* View/BasesViewと`registerView()`の設計指針([Developer Documentation][3])
* 設定タブ（`PluginSettingTab`）([Developer Documentation][6])
* 起動時間最適化（`onload`の最小化とビルド縮小）([Developer Documentation][4])

不明点や追加要件があれば指示を出せ。

[1]: https://github.com/obsidianmd/obsidian-sample-plugin "GitHub - obsidianmd/obsidian-sample-plugin: Template for Obsidian community plugins with build configuration and development best practices."
[2]: https://raw.githubusercontent.com/obsidianmd/obsidian-api/refs/heads/master/obsidian.d.ts?utm_source=chatgpt.com "https://raw.githubusercontent.com/obsidianmd/obsid..."
[3]: https://docs.obsidian.md/Reference/TypeScript%2BAPI/BasesView?utm_source=chatgpt.com "BasesView - Developer Documentation"
[4]: https://docs.obsidian.md/plugins/guides/load-time?utm_source=chatgpt.com "Optimize plugin load time - Developer Documentation"
[5]: https://docs.obsidian.md/Reference/TypeScript%2BAPI/FileManager/processFrontMatter?utm_source=chatgpt.com "processFrontMatter - Developer Documentation"
[6]: https://docs.obsidian.md/Reference/TypeScript%2BAPI/PluginSettingTab?utm_source=chatgpt.com "PluginSettingTab - Developer Documentation"
[7]: https://github.com/obsidianmd/obsidian-api?utm_source=chatgpt.com "Type definitions for the latest Obsidian API."
