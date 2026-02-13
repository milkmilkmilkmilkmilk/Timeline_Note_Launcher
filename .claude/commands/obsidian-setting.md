# 新しいObsidian設定項目の追加

引数で指定された設定を追加してください: $ARGUMENTS

## 手順

以下の3ファイルを整合性を保って更新してください。順番を守ること。

### Step 1: `src/types.ts`
- `PluginSettings` interfaceに新しいフィールドを追加
- `DEFAULT_SETTINGS` に適切なデフォルト値を設定
- 必要なら新しいtype/enumも定義

### Step 2: `src/settings.ts`
- Settings UIに対応するコントロール（トグル、テキスト、ドロップダウン等）を追加
- ESLint obsidianmd ルールに従うこと:
  - セクション見出しは `addHeading()` を使用
  - `.setName()` はsentence case（先頭のみ大文字）
- `display()` メソッド内の適切な位置に配置

### Step 3: 参照箇所の更新
- `src/timelineView.ts` や他のファイルで新設定を実際に使用するコードを追加
- `this.plugin.settings.新フィールド名` でアクセス

## 注意事項
- コメントは日本語で書くこと
- 型は明示的に指定すること（`noImplicitAny` 有効）
- 設定変更後は `await this.plugin.saveData(this.plugin.data)` で永続化すること
