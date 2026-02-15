# Obsidian プラグイン開発ガイド

本ドキュメントは Obsidian コミュニティプラグインを開発・公開するにあたって必要な要件、デファクトスタンダード、および開発上の知見をまとめたものである。[Timeline Note Launcher](https://github.com/usumi/Timeline_Note_Launcher) の開発経験を踏まえ、実践的な情報を中心に記載する。

---

## 目次

1. [プロジェクト構成](#1-プロジェクト構成)
2. [manifest.json の仕様](#2-manifestjson-の仕様)
3. [ビルド構成](#3-ビルド構成)
4. [TypeScript 設定](#4-typescript-設定)
5. [ESLint 設定](#5-eslint-設定)
6. [プラグインライフサイクル](#6-プラグインライフサイクル)
7. [View の登録と管理](#7-view-の登録と管理)
8. [データの永続化](#8-データの永続化)
9. [Frontmatter 操作](#9-frontmatter-操作)
10. [コマンドとホットキー](#10-コマンドとホットキー)
11. [設定画面 (PluginSettingTab)](#11-設定画面-pluginsettingtab)
12. [CSS スタイリング](#12-css-スタイリング)
13. [パフォーマンス最適化](#13-パフォーマンス最適化)
14. [モバイル対応](#14-モバイル対応)
15. [セキュリティとプライバシー](#15-セキュリティとプライバシー)
16. [バージョニングとリリース](#16-バージョニングとリリース)
17. [コミュニティプラグインへの提出](#17-コミュニティプラグインへの提出)
18. [CI/CD](#18-cicd)
19. [開発上の知見・Tips](#19-開発上の知見tips)
20. [参考リンク](#20-参考リンク)

---

## 1. プロジェクト構成

### 必須ファイル

| ファイル | 説明 |
|---|---|
| `manifest.json` | プラグインメタデータ（ID、バージョン、最小Obsidianバージョン等） |
| `main.js` | esbuild 等でバンドルされたエントリーポイント（ビルド生成物） |
| `styles.css` | プラグインのスタイル定義（任意だが推奨） |
| `package.json` | npm 依存管理 |
| `README.md` | プラグインの説明と使い方（提出時に必須） |
| `LICENSE` | ライセンスファイル（提出時に必須） |

### 推奨ディレクトリ構造

```
project-root/
├── src/
│   ├── main.ts            # プラグインエントリーポイント（ライフサイクルのみ）
│   ├── types.ts           # インターフェース、型定義、デフォルト値
│   ├── settings.ts        # PluginSettingTab 実装
│   ├── *View.ts           # ItemView サブクラス
│   ├── *Modal.ts          # Modal サブクラス
│   └── dataLayer.ts       # データアクセス層
├── styles.css
├── manifest.json
├── versions.json
├── package.json
├── tsconfig.json
├── esbuild.config.mjs
├── eslint.config.mts
├── .editorconfig
├── .gitignore
├── README.md
└── LICENSE
```

### 公式テンプレートからの出発

[obsidian-sample-plugin](https://github.com/obsidianmd/obsidian-sample-plugin) を「Use this template」でクローンするのが最短経路。ビルド構成、ESLint設定、GitHub Actions が事前に構成されている。

### コード分割の方針

- **`main.ts` は最小限に**：`Plugin` のライフサイクル（`onload`/`onunload`）、コマンド登録、View 登録のみ
- 1ファイル200〜300行を超えたら分割を検討
- 各ファイルは単一責務を持つ
- ビルド後は全てが `main.js` にバンドルされるため、ランタイムの依存関係は不要

---

## 2. manifest.json の仕様

### 必須フィールド

```json
{
  "id": "your-plugin-id",
  "name": "Your Plugin Name",
  "version": "1.0.0",
  "minAppVersion": "1.0.0",
  "description": "A description of what this plugin does.",
  "author": "Your Name",
  "isDesktopOnly": false
}
```

### フィールドごとのルール

| フィールド | ルール |
|---|---|
| `id` | 一度公開したら変更不可。`"obsidian"` を含めない。プラグインフォルダ名と一致させる。`onExternalSettingsChange` 等のAPI動作に影響 |
| `name` | 末尾に `"Plugin"` を付けない |
| `version` | SemVer (`x.y.z`) のみ。`v` プレフィックス不可 |
| `minAppVersion` | 使用するAPIに応じて正確に設定。新しいAPIを使う場合は要更新 |
| `description` | `"Obsidian"` や `"This plugin"` で始めない。末尾は `.`、`?`、`!`、`)` で終わる |
| `isDesktopOnly` | Node.js / Electron APIを使う場合のみ `true` |
| `authorUrl` | （任意）作者のウェブサイト |
| `fundingUrl` | （任意）寄付リンク。文字列またはオブジェクト形式 |

### versions.json

旧バージョンのObsidianとの互換性マッピング。各プラグインバージョンに対して必要な最小Obsidianバージョンを記録する。

```json
{
  "1.0.0": "1.0.0",
  "1.1.0": "1.2.0"
}
```

ユーザーのObsidianバージョンが `manifest.json` の `minAppVersion` より古い場合、互換性のある最新バージョンが `versions.json` から参照される。

---

## 3. ビルド構成

### esbuild（デファクトスタンダード）

```javascript
// esbuild.config.mjs
import esbuild from "esbuild";
import { builtinModules } from "node:module";

const prod = process.argv[2] === "production";

const context = await esbuild.context({
  entryPoints: ["src/main.ts"],
  bundle: true,
  external: [
    "obsidian",
    "electron",
    "@codemirror/autocomplete",
    "@codemirror/collab",
    "@codemirror/commands",
    "@codemirror/language",
    "@codemirror/lint",
    "@codemirror/search",
    "@codemirror/state",
    "@codemirror/view",
    "@lezer/common",
    "@lezer/highlight",
    "@lezer/lr",
    ...builtinModules,
  ],
  format: "cjs",
  target: "es2018",
  outfile: "main.js",
  sourcemap: prod ? false : "inline",
  treeShaking: true,
  minify: prod,
});
```

### external の意味

`obsidian`、`electron`、CodeMirror 関連パッケージは Obsidian ランタイムが提供する。バンドルに含めてはならない。`builtinModules`（Node.js 組み込み）も同様。

### npm scripts

```json
{
  "scripts": {
    "dev": "node esbuild.config.mjs",
    "build": "tsc -noEmit -skipLibCheck && node esbuild.config.mjs production",
    "version": "node version-bump.mjs && git add manifest.json versions.json",
    "lint": "eslint ."
  }
}
```

- `dev`：ファイル変更を監視して自動リビルド
- `build`：TypeScript の型チェック → esbuild でプロダクションビルド
- `version`：`npm version` コマンドと連動してバージョンバンプ
- `lint`：ESLint 実行

---

## 4. TypeScript 設定

### 推奨 tsconfig.json

```json
{
  "compilerOptions": {
    "baseUrl": "src",
    "module": "ESNext",
    "target": "ES6",
    "moduleResolution": "node",
    "noImplicitAny": true,
    "noImplicitThis": true,
    "noImplicitReturns": true,
    "strictNullChecks": true,
    "strictBindCallApply": true,
    "noUncheckedIndexedAccess": true,
    "isolatedModules": true,
    "useUnknownInCatchVariables": true,
    "importHelpers": true,
    "allowSyntheticDefaultImports": true,
    "inlineSourceMap": true,
    "inlineSources": true,
    "lib": ["DOM", "ES5", "ES6", "ES7"]
  },
  "include": ["src/**/*.ts"]
}
```

### 重要な型安全設定

- **`noImplicitAny`**：暗黙の `any` を禁止
- **`strictNullChecks`**：`null` / `undefined` を明示的に扱う
- **`noUncheckedIndexedAccess`**：インデックスアクセスの結果に `undefined` を含める
- **`useUnknownInCatchVariables`**：`catch(e)` の `e` を `unknown` 型にする
- **`isolatedModules`**：esbuild と互換性のあるトランスパイルを保証

---

## 5. ESLint 設定

### eslint-plugin-obsidianmd

Obsidian 公式の ESLint プラグイン。プラグイン開発に特化したルールを提供する。

```typescript
// eslint.config.mts
import tseslint from "typescript-eslint";
import obsidianmd from "eslint-plugin-obsidianmd";
import comments from "@eslint-community/eslint-plugin-eslint-comments/configs";

export default tseslint.config(
  ...obsidianmd.configs.recommended,
  comments.recommended,
  {
    plugins: { obsidianmd },
    rules: {
      // eslint-disable コメントに理由の記載を強制
      "@eslint-community/eslint-comments/require-description": "error",
      "@eslint-community/eslint-comments/no-unlimited-disable": "error",
      "@eslint-community/eslint-comments/no-unused-disable": "error",
      // UI テキストは sentence case を強制
      "obsidianmd/ui/sentence-case": ["error", { ignoreWords: ["SRS"] }],
    },
  }
);
```

### 主要なルール

| ルール | 内容 |
|---|---|
| `obsidianmd/ui/sentence-case` | UI 文字列が sentence case であることを強制 |
| `obsidianmd/settings/use-heading` | 設定見出しに `setHeading()` を使うことを推奨（`<h2>` 等の直接生成を禁止） |
| `obsidianmd/no-command-in-id` | コマンドIDに `"command"` を含めない |
| `obsidianmd/no-command-in-name` | コマンド名に `"command"` を含めない |
| `obsidianmd/no-default-hotkeys` | デフォルトホットキーを設定しない |
| `obsidianmd/no-static-styles` | `style` プロパティへの直接代入を禁止 |

### eslint-disable のルール

```typescript
// eslint-disable-next-line rule-name -- 理由をここに記載
```

`@eslint-community/eslint-comments/require-description` を有効にすると、全ての `eslint-disable` コメントに `-- 理由` の記載が必須になる。

---

## 6. プラグインライフサイクル

### 基本構造

```typescript
import { Plugin } from "obsidian";

export default class MyPlugin extends Plugin {
  async onload(): Promise<void> {
    // 登録処理のみ（重い処理は置かない）
    this.registerView(...);
    this.addCommand(...);
    this.addSettingTab(...);
    this.addRibbonIcon(...);

    // 重い初期化は layoutReady 後に遅延
    this.app.workspace.onLayoutReady(() => {
      // データのクリーンアップ等
    });
  }

  onunload(): void {
    // 明示的なクリーンアップが必要な場合のみ
    // register* 系はフレームワークが自動解除する
  }
}
```

### register* メソッドによる自動クリーンアップ

| メソッド | 用途 |
|---|---|
| `this.registerEvent(...)` | `app.vault.on()`、`app.workspace.on()` 等のイベント |
| `this.registerDomEvent(...)` | DOM イベント（`window`、`document` 等） |
| `this.registerInterval(...)` | `window.setInterval` の戻り値を登録 |
| `this.registerView(...)` | カスタム View の登録 |
| `this.addChild(...)` | 子コンポーネントの登録（再帰的にアンロード） |

**重要**：全ての登録は `register*` メソッドで行う。手動で `addEventListener` 等を使うと、プラグイン無効化時にリークする。

### layoutReady による遅延初期化

```typescript
this.app.workspace.onLayoutReady(() => {
  // Vault のファイルが利用可能になってから実行される
  // 重い処理（ログのクリーンアップ、データ移行等）はここで
});
```

---

## 7. View の登録と管理

### registerView パターン

```typescript
// View タイプ定数
export const MY_VIEW_TYPE = "my-plugin-view";

// 登録（onload 内）
this.registerView(
  MY_VIEW_TYPE,
  (leaf) => new MyView(leaf, this)
);
```

### View のアクティブ化

```typescript
async activateView(): Promise<void> {
  const { workspace } = this.app;

  let leaf = workspace.getLeavesOfType(MY_VIEW_TYPE)[0];
  if (!leaf) {
    const newLeaf = workspace.getLeaf("tab");
    if (newLeaf) {
      await newLeaf.setViewState({
        type: MY_VIEW_TYPE,
        active: true,
      });
      leaf = newLeaf;
    }
  }
  if (leaf) {
    void workspace.revealLeaf(leaf);
  }
}
```

### 重要な注意点

- **View の参照をプラグインに保持しない**：ファクトリ関数で生成し、必要時に `getLeavesOfType()` で取得する
- View の `onOpen()` / `onClose()` でリソースの初期化・解放を行う
- `instanceof` でView型を検査してから操作する

---

## 8. データの永続化

### loadData / saveData

```typescript
// 読み込み
const loaded = await this.loadData() as Partial<PluginData> | null;
this.data = Object.assign({}, DEFAULT_DATA, loaded);

// 新しい設定キーの安全なマージ
this.data.settings = Object.assign(
  {},
  DEFAULT_SETTINGS,
  loaded?.settings
);

// 保存
await this.saveData(this.data);
```

### データ移行パターン

スキーマが変更された場合に `engineVersion` で段階的に移行する。

```typescript
private async migrateData(fromVersion: number): Promise<void> {
  const currentVersion = DEFAULT_DATA.engineVersion;
  if (fromVersion >= currentVersion) return;

  if (fromVersion < 2) {
    // v1 → v2 の移行ロジック
  }
  // if (fromVersion < 3) { ... }

  this.data.engineVersion = currentVersion;
  await this.saveData(this.data);
}
```

### 同期セーフな保存

モバイル同期（iCloud、Obsidian Sync 等）環境では、ディスクのデータが外部から変更される可能性がある。保存前にディスクから再読み込みしてマージすることで競合を防止する。

```typescript
// 保存キューで直列化
private saveQueue: Promise<void> = Promise.resolve();

async syncAndSave(): Promise<void> {
  this.saveQueue = this.saveQueue.then(async () => {
    const diskRaw = await this.loadData();
    const remote = reconstructFullData(diskRaw);
    this.data = mergePluginData(this.data, remote);
    await this.saveData(this.data);
  });
  await this.saveQueue;
}
```

### visibilitychange による再読み込み

アプリ復帰時（モバイルでバックグラウンドから復帰等）にリモート変更を取り込む。

```typescript
this.registerDomEvent(document, "visibilitychange", () => {
  if (document.visibilityState === "visible") {
    void this.reloadFromDisk();
  }
});
```

---

## 9. Frontmatter 操作

### processFrontMatter

```typescript
await this.app.fileManager.processFrontMatter(file, (frontmatter) => {
  // frontmatter オブジェクトを直接変更する（コピーしない）
  frontmatter.reviewed = true;
  frontmatter.lastReviewedAt = Date.now();
});
```

### 注意点

- `processFrontMatter` はコールバック内で**同期的に**オブジェクトを変更する
- オブジェクトをコピーしてから変更してはならない（参照の変更が検知されない）
- YAML のコメントは消失する可能性がある
- 重要なデータは `data.json`（`loadData`/`saveData`）を主とし、YAML は最小限にする
- 頻繁なフロントマター変更はキャッシュ更新のオーバーヘッドがある

### MetadataCache の活用

```typescript
// ファイルのキャッシュ済みメタデータを取得
const cache = this.app.metadataCache.getFileCache(file);
const tags = cache?.tags?.map(t => t.tag) ?? [];
const frontmatter = cache?.frontmatter;

// メタデータ変更の監視
this.registerEvent(
  this.app.metadataCache.on("changed", (file, data, cache) => {
    // file のメタデータが更新された
  })
);
```

**注意**：`rename` イベントは `MetadataCache` の `changed` では発火しない。ファイル名変更は `app.vault.on("rename", ...)` で監視する。

---

## 10. コマンドとホットキー

### コマンド登録

```typescript
this.addCommand({
  id: "open-timeline",      // 安定したID（リリース後変更不可）
  name: "Open timeline",    // Sentence case
  callback: () => {
    void this.activateView();
  },
});
```

### ルール

- **コマンドIDは安定させる**：一度リリースしたら変更しない（ユーザーのホットキー設定が壊れる）
- **コマンドIDに `"command"` を含めない**
- **コマンド名に `"command"` を含めない**
- **デフォルトホットキーを設定しない**：ユーザーが自分で設定する
- **sentence case を使う**：「Open timeline」であって「Open Timeline」ではない

---

## 11. 設定画面 (PluginSettingTab)

### 基本パターン

```typescript
export class MySettingTab extends PluginSettingTab {
  plugin: MyPlugin;

  constructor(app: App, plugin: MyPlugin) {
    super(app, plugin);
    this.plugin = plugin;
  }

  display(): void {
    const { containerEl } = this;
    containerEl.empty();

    // セクション見出し（setHeading を使う）
    new Setting(containerEl)
      .setName("General settings")
      .setHeading();

    // 設定項目
    new Setting(containerEl)
      .setName("Target folders")
      .setDesc("Folders to include in the timeline.")
      .addText(text => text
        .setValue(this.plugin.data.settings.targetFolders.join(", "))
        .onChange(async (value) => {
          this.plugin.data.settings.targetFolders = value
            .split(",")
            .map(s => s.trim())
            .filter(Boolean);
          await this.plugin.syncAndSave();
        }));
  }
}
```

### ルール

- **見出しは `setHeading()` を使う**：`containerEl.createEl("h2", ...)` ではなく `new Setting(containerEl).setName("...").setHeading()`
- **Sentence case**：見出し、ボタン、タイトル全て
- 設定値変更時はデバウンスを検討（テキスト入力の `onChange` は毎キーストロークで発火する）
- デフォルト値とバリデーションを必ず提供する

---

## 12. CSS スタイリング

### 基本原則

1. **`styles.css` を使う**：Obsidian がプラグインの `styles.css` を自動読み込みする。`<style>` 要素の手動追加は不可
2. **CSS 変数を使う**：ハードコード値ではなく Obsidian のCSS変数を使い、テーマ互換性を確保
3. **プラグイン固有のクラス名にスコープする**：他のプラグインやテーマとの衝突を防ぐ
4. **インラインスタイルを避ける**：`element.style.color = "red"` ではなくCSSクラスを使う（`obsidianmd/no-static-styles` ルール）
5. **4px グリッドを使う**：Obsidian は 4px グリッドを使用している。`--size-4-*` 変数を活用する
6. **低い詳細度のセレクタを使う**：複雑なセレクタよりCSS変数に頼る
7. **ライトモード・ダークモード両方でテストする**：CSS変数は自動的に切り替わるが、カスタムスタイルには注意

### 修飾子クラスによるテーマ切り替え

```css
/* 基本スタイル */
.my-plugin-container { }

/* テーマ修飾子 */
.my-plugin-container.my-plugin-theme-blue { }
.my-plugin-container.my-plugin-theme-dark { }

/* モバイル修飾子 */
.my-plugin-container.my-plugin-mobile { }

/* サイズ修飾子 */
.my-plugin-container.my-plugin-size-large { }
```

### CSS 変数の例

```css
.my-plugin-card {
  background-color: var(--background-primary);
  color: var(--text-normal);
  border: 1px solid var(--background-modifier-border);
  border-radius: var(--radius-s);
  padding: var(--size-4-3);           /* 12px */
  margin-bottom: var(--size-4-2);     /* 8px */
  font-size: var(--font-ui-small);
}
```

---

## 13. パフォーマンス最適化

### onload の最小化

`onload()` では登録処理のみ行い、重い処理は `onLayoutReady` または遅延実行にする。プラグインの起動時間は Obsidian の起動時間に直接影響する。

### 2フェーズパイプライン

大量のファイルを処理する場合、軽量な候補生成（同期・ファイルI/Oなし）とフルカード生成（非同期・ファイルI/Oあり）を分離する。

```
TFile[] → CandidateCard[]（同期・軽量）→ 選択 → TimelineCard[]（非同期・重い）
```

### チャンクレンダリング

```typescript
// 5件ずつ DOM に追加
const CHUNK_SIZE = 5;
for (let i = 0; i < cards.length; i += CHUNK_SIZE) {
  const chunk = cards.slice(i, i + CHUNK_SIZE);
  const fragment = document.createDocumentFragment();
  for (const card of chunk) {
    fragment.appendChild(createCardElement(card));
  }
  container.appendChild(fragment);
}
```

### キャッシュ戦略

```typescript
// TTLキャッシュの例
private cache: { data: T; timestamp: number } | null = null;
private static readonly CACHE_TTL = 10_000; // 10秒

private getCachedData(): T {
  const now = Date.now();
  if (this.cache && now - this.cache.timestamp < CACHE_TTL) {
    return this.cache.data;
  }
  const data = computeExpensiveData();
  this.cache = { data, timestamp: now };
  return data;
}
```

### その他の最適化

- **差分レンダリング**：カードのパスが変わっていなければ DOM 再構築をスキップ
- **DocumentFragment**：DOM 操作をバッチ化
- **`Promise.all()`**：並列処理可能なファイルI/Oをまとめて実行
- **デバウンス/スロットル**：ファイルシステムイベントへの応答を抑制

---

## 14. モバイル対応

### Platform 判定

```typescript
import { Platform } from "obsidian";

if (Platform.isMobile) {
  // モバイル固有の処理
}
```

### モバイル要件

- **タップ領域を十分に確保**：指操作を前提に余白・行高を調整
- **ステータスバーを使わない**：`addStatusBarItem()` はモバイル未対応
- **重い処理を避ける**：メモリ制約が厳しい
- **1カラムレイアウト**：モバイルは1カラムが基本
- **スクロール位置の維持**：ノートから戻った時にスクロール位置を復元

### isDesktopOnly

`manifest.json` の `isDesktopOnly` を `false` に設定する場合、以下を確認：

- Node.js API（`fs`、`path` 等）を使っていない
- Electron API を使っていない
- デスクトップ専用のObsidian APIを使っていない

### テスト用のモバイルレイアウト

デスクトップでモバイルレイアウトをテストする設定を提供すると開発効率が上がる。

```typescript
// 設定項目: mobileViewOnDesktop
if (Platform.isMobile || this.plugin.data.settings.mobileViewOnDesktop) {
  container.addClass("my-plugin-mobile");
}
```

---

## 15. セキュリティとプライバシー

### Developer Policies の要点

| 項目 | 要件 |
|---|---|
| テレメトリ | クライアントサイドテレメトリは**禁止** |
| ネットワーク通信 | 機能に必須の場合のみ。明確な開示と明示的オプトインが必要 |
| リモートコード | リモートコードの取得・実行、`eval` は**禁止** |
| Vault外アクセス | Vault外のファイルアクセスは明確な理由の説明が必要 |
| コード難読化 | **禁止** |
| プライバシー | Vaultの内容、ファイル名、個人情報の収集は最小限。必要な場合は明示的同意が必要 |
| 自動更新 | 通常のリリース以外でのプラグインコードの自動更新は**禁止** |

### 実践的なガイドライン

- デフォルトはローカル・オフライン動作
- 外部サービスを使う場合は README と設定画面で明示
- `register*` ヘルパーで全てのリスナーをクリーンアップ
- 広告やスパム通知を出さない

---

## 16. バージョニングとリリース

### バージョンバンプの手順

1. `manifest.json` の `minAppVersion` を必要に応じて更新
2. `npm version patch|minor|major` を実行
   - `package.json` の `version` が更新される
   - `version` スクリプトにより `manifest.json` と `versions.json` も更新される
3. Git tag を作成（`npm version` が自動で作成）

### GitHub Release

1. **タグ名** = `manifest.json` の `version` と完全一致（`v` プレフィックス不可）
2. 以下のファイルをバイナリアセットとして添付：
   - `manifest.json`
   - `main.js`
   - `styles.css`（存在する場合）
3. **ドラフトリリースやプレリリースは Obsidian の更新メカニズムに認識されない**

### GitHub Actions によるリリース自動化

公式ドキュメント [Release your plugin with GitHub Actions](https://docs.obsidian.md/Plugins/Releasing/Release+your+plugin+with+GitHub+Actions) に沿って設定可能。タグのプッシュをトリガーにビルド → リリース作成 → アセット添付を自動化する。

---

## 17. コミュニティプラグインへの提出

### 提出フロー

1. GitHub Release を作成（上記参照）
2. [obsidian-releases](https://github.com/obsidianmd/obsidian-releases) リポジトリの `community-plugins.json` に PR を送る
3. 自動バリデーション（`validate-plugin-entry.yml`）が実行される
4. Obsidian チームおよびコミュニティがコードレビュー

### community-plugins.json のエントリ

```json
{
  "id": "your-plugin-id",
  "name": "Your Plugin Name",
  "author": "Your Name",
  "description": "A description of what this plugin does.",
  "repo": "username/repo-name"
}
```

### 提出前チェックリスト

- [ ] `README.md` がルートにある
- [ ] `LICENSE` ファイルがある
- [ ] `manifest.json` がルートにある
- [ ] GitHub Release が正しい形式で作成されている
- [ ] `id`、`name`、`description` が `community-plugins.json` と `manifest.json` で一致
- [ ] リポジトリの Issues が有効化されている
- [ ] モバイルでテスト済み（`isDesktopOnly: false` の場合）
- [ ] ESLint（obsidianmd ルール含む）がパスする
- [ ] Developer Policies に準拠している

### 初回提出後

初回の提出のみ PR が必要。以降のバージョンアップは GitHub Release を作成するだけで、ユーザーは Obsidian 内から自動更新を受け取れる。

---

## 18. CI/CD

### GitHub Actions（推奨構成）

```yaml
name: Node.js build

on:
  push:
    branches: ["**"]
  pull_request:
    branches: ["**"]

jobs:
  build:
    runs-on: ubuntu-latest
    strategy:
      matrix:
        node-version: [20.x, 22.x]
    steps:
      - uses: actions/checkout@v4
      - name: Use Node.js ${{ matrix.node-version }}
        uses: actions/setup-node@v4
        with:
          node-version: ${{ matrix.node-version }}
          cache: "npm"
      - run: npm ci
      - run: npm run build --if-present
      - run: npm run lint
```

### テスト

Obsidian プラグインには公式のテストフレームワークがない。テストは主に手動で行う。

- **開発用 Vault** を用意する（個人の Vault とは別にする）
- `<Vault>/.obsidian/plugins/<plugin-id>/` にビルド成果物をコピー
- Obsidian をリロードしてプラグインを有効化
- デスクトップとモバイルの両方でテスト

---

## 19. 開発上の知見・Tips

### import type の活用

循環参照を防ぐため、型のみのインポートには `import type` を使う。

```typescript
// Modal から Plugin を参照する場合
import type TimelineNoteLauncherPlugin from "./main";
```

### Modal パターン

全てのモーダルに共通するパターン：

- `plugin` 参照を受け取る（`import type` で型付け）
- ドラフト（未保存の入力内容）を `data.json` に保存・復元
- `Ctrl+Enter` / `Mod+Enter` で確認操作
- `onOpen()` で UI 構築、`onClose()` で `contentEl.empty()`

```typescript
class MyModal extends Modal {
  private plugin: TimelineNoteLauncherPlugin;

  constructor(app: App, plugin: TimelineNoteLauncherPlugin) {
    super(app);
    this.plugin = plugin;
  }

  onOpen(): void {
    // UI 構築
    this.scope.register(["Mod"], "Enter", () => {
      this.confirm();
      this.close();
    });
  }

  onClose(): void {
    this.contentEl.empty();
  }
}
```

### リンク生成

ユーザーの wiki link / markdown link の設定を尊重する：

```typescript
const link = this.app.fileManager.generateMarkdownLink(file, sourcePath);
```

### ファイルタイプの判定

拡張子からファイルタイプを判定するヘルパーを用意する。Obsidian は Markdown 以外にも画像、PDF、音声、動画等をサポートしている。

### ブックマーク API（内部 API）

ブックマーク機能はドキュメント化されていない内部APIとして提供される。型定義を自前で用意する必要がある。

```typescript
interface BookmarkPluginInstance {
  items: BookmarkItem[];
}

const bookmarkPlugin = this.app.internalPlugins.getPluginById("bookmarks");
```

### ソースコメントの言語

既存のコードベースのコメント言語に合わせる。本プロジェクトでは日本語でコメントを記述している。

### 開発用 Vault のセットアップ

プラグイン開発は個人のメインVaultとは別の開発用Vaultで行う。手順：

1. 新しい Vault を作成
2. `.obsidian/plugins/<plugin-id>/` にシンボリックリンクまたはコピー
3. `npm run dev` でファイル変更を監視
4. Obsidian で「Ctrl+P → Reload app without saving」でリロード

### デバッグ

- **デベロッパーツール**：`Ctrl+Shift+I`（デスクトップ）で開く
- **`console.log`**：開発中のデバッグに使い、リリース前に削除
- **起動時間の確認**：Settings → About → Startup time で確認

---

## 20. 参考リンク

### 公式リソース

| リソース | URL |
|---|---|
| Developer Documentation | https://docs.obsidian.md |
| Sample Plugin | https://github.com/obsidianmd/obsidian-sample-plugin |
| API 型定義 | https://github.com/obsidianmd/obsidian-api |
| Developer Policies | https://docs.obsidian.md/Developer+policies |
| Plugin Guidelines | https://docs.obsidian.md/Plugins/Releasing/Plugin+guidelines |
| Submission Requirements | https://docs.obsidian.md/Plugins/Releasing/Submission+requirements+for+plugins |
| Submit Your Plugin | https://docs.obsidian.md/Plugins/Releasing/Submit+your+plugin |
| Release with GitHub Actions | https://docs.obsidian.md/Plugins/Releasing/Release+your+plugin+with+GitHub+Actions |
| Manifest Reference | https://docs.obsidian.md/Reference/Manifest |
| Versions Reference | https://docs.obsidian.md/Reference/Versions |
| Load Time Optimization | https://docs.obsidian.md/Plugins/Guides/Optimizing+plugin+load+time |
| CSS Variables | https://docs.obsidian.md/Reference/CSS+variables/About+styling |
| Style Guide | https://help.obsidian.md/style-guide |
| Plugin Security | https://help.obsidian.md/plugin-security |
| Obsidian Releases | https://github.com/obsidianmd/obsidian-releases |

### コミュニティリソース

| リソース | URL |
|---|---|
| eslint-plugin-obsidianmd | https://github.com/obsidianmd/eslint-plugin |
| Unofficial Plugin Developer Docs | https://marcusolsson.github.io/obsidian-plugin-docs |
| Obsidian Forum | https://forum.obsidian.md |
| Obsidian Discord | https://discord.gg/obsidianmd |
| Theme Migration Guide (1.0) | https://obsidian.md/blog/1-0-theme-migration-guide/ |

---

*最終更新: 2026-02-10*
