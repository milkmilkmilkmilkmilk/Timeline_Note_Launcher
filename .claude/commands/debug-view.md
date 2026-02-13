# TimelineViewのデバッグ支援

$ARGUMENTS の問題を調査してください。

## 調査手順

### 1. データフローの追跡
以下のパイプラインのどこで問題が発生しているか特定：
1. `enumerateTargetNotes()` — ファイルフィルタリング
2. `createCandidateCard()` — 軽量カード生成
3. `selectCards()` — 選択アルゴリズム適用
4. `createTimelineCard()` — フルコンテンツ取得
5. `TimelineView` のDOM描画

### 2. 設定値の確認
問題に関連しそうな設定（`PluginSettings`のフィールド）を特定し、デフォルト値とエッジケースを確認。

### 3. モバイル/デスクトップ差異
`Platform.isMobile` や `mobileViewOnDesktop` が影響していないか確認。

### 4. 修正案
問題の根本原因と修正案を報告。修正が複数ファイルにまたがる場合は影響範囲を明示。
