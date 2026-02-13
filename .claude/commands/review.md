# コードレビュー

git diffのstaged changes（なければunstaged changes）を以下の観点でレビューしてください。

## レビュー観点

1. **型安全性**: `strictNullChecks` / `noUncheckedIndexedAccess` に違反していないか。配列アクセスやオプショナルプロパティにundefinedチェックがあるか
2. **リソースリーク**: イベントリスナーやタイマーに `this.register*` / `this.registerEvent()` を使っているか。`onunload` で解放すべきリソースが漏れていないか
3. **モバイル互換性**: `Platform.isMobile` の分岐が必要な箇所はないか。タッチ操作への配慮はあるか
4. **Obsidian API**: 非推奨APIを使っていないか。`app.vault.adapter` の直接使用を避けているか
5. **パフォーマンス**: 不要なファイルI/O（`vault.read` の重複呼び出し等）やDOM操作（ループ内のappendChild等）がないか
6. **日本語コメント**: ソースコメントが日本語で書かれているか
7. **ESLint準拠**: `eslint-disable` に理由が記述されているか（`-- reason` 形式）

## 出力形式

問題を発見した場合は以下の形式で報告してください：

```
[重要度: 高/中/低] ファイル名:行番号
  問題: 説明
  修正案: 具体的な修正方法
```

問題がなければ「レビュー完了：指摘事項なし」と報告してください。
