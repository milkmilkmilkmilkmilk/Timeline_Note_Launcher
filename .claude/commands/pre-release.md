# リリース前チェック

以下のチェックをすべて実行し、結果を報告してください。

## チェック項目

### 1. Lint
`npm run lint` を実行してエラーがないことを確認。

### 2. ビルド
`npm run build` を実行して正常にビルドされることを確認。`main.js` が生成されていること。

### 3. バージョン整合性
以下のファイル間でバージョンが一致しているか確認：
- `package.json` の `version`
- `manifest.json` の `version`
- `versions.json` の最新エントリ

### 4. manifest.json の確認
- `minAppVersion` が `versions.json` と一致しているか
- `id`, `name`, `author` が正しいか

### 5. 変更内容の要約
最後のリリースタグ以降の `git log` を確認し、以下の形式で変更内容を要約：

```markdown
## What's Changed
### New Features
- ...
### Bug Fixes
- ...
### Improvements
- ...
```

## 最終報告
すべてのチェック結果を一覧で報告し、リリース可能かどうかの判定を出してください。
