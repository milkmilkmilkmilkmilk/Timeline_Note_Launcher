# TypeScript + Obsidian Plugin ルール

## 型安全性
- `any` 型を使わない（`noImplicitAny` 有効）
- 配列・Mapアクセス後は必ずundefinedチェック（`noUncheckedIndexedAccess` 有効）
- null/undefinedの可能性がある値はオプショナルチェーン `?.` またはガード節で処理
- 型のみのインポートには `import type` を使用

## Obsidian API
- `obsidian`, `electron`, CodeMirror はランタイム提供。bundleに含めない
- イベントリスナーは `this.registerEvent()`, `this.registerDomEvent()` でクリーンアップ登録
- タイマーは `this.registerInterval(window.setInterval(...))` で登録
- コマンドIDは一度リリースしたら変更しない
- `Platform.isMobile` でモバイル固有の分岐を行う

## コーディングスタイル
- ソースコード内のコメントは日本語で書く
- JavaScriptファイルを作成しない（TypeScriptのみ）
- ESLint disable コメントには必ず理由を記述: `// eslint-disable-next-line rule-name -- 理由`

## ESLint obsidianmd ルール
- Settings UIの `.setName()` はsentence case（先頭のみ大文字）
- Settings UIのセクション見出しには `.addHeading()` を使用
- `containerEl.style` への直接代入禁止（CSSクラスを使う）

## 設定追加の定型パターン
新しい設定を追加する時は必ず3箇所を更新:
1. `src/types.ts` — `PluginSettings` interface + `DEFAULT_SETTINGS`
2. `src/settings.ts` — UI コントロール
3. 参照するファイル — `this.plugin.settings.フィールド名`
