# Obsidian Community Plugin: Requirements + Local ESLint Repro (for Claude Code / Codex)

## 0. このリポジトリの前提
- 私は Obsidian Community Plugin をTypeScriptで実装し、バンドル済みの `main.js` を配布する。Obsidianは `manifest.json` を読み、`main.js` をロードする。 :contentReference[oaicite:1]{index=1}
- 私は配布物として `main.js` と `manifest.json` を必ず用意し、`styles.css` を使う場合は同梱する。 :contentReference[oaicite:2]{index=2}
- 私は外部依存をランタイムで要求しない。私は依存をバンドルして `main.js` 単体で動くようにする（例外を作るなら、その理由と影響範囲を明記する）。 :contentReference[oaicite:3]{index=3}

## 1. Node / パッケージマネージャ / ビルド
- 私は Node.js の現行LTS系を使う（sampleは Node 18+ を推奨している）。私は npm スクリプトを前提にする。 :contentReference[oaicite:4]{index=4}
- sample plugin は esbuild を使う。私が別ツールに替えるなら、私は同等に `main.js` を生成して、配布要件を満たす。 :contentReference[oaicite:5]{index=5}
- sample plugin のスクリプト構成は次を満たす：
  - dev: watchビルド
  - build: `tsc` の型チェック後にproductionビルド
  - lint: `eslint .` :contentReference[oaicite:6]{index=6}

## 2. manifest.json の必須要件（ローカル開発・公開共通）
- 私は `manifest.json` に必須キーを入れる：`id, name, description, author, version, minAppVersion, isDesktopOnly`。 :contentReference[oaicite:7]{index=7}
- 私は許可されないキーを追加しない。私は許可される追加キー（例：`authorUrl, fundingUrl, helpUrl`）以外を入れない。 :contentReference[oaicite:8]{index=8}
- 私はローカル開発中、`id` をプラグインフォルダ名と一致させる（一致しないと一部コールバックが呼ばれない）。 :contentReference[oaicite:9]{index=9}
- 私は公開後に `id` を変更しない。 :contentReference[oaicite:10]{index=10}
- 私は `isDesktopOnly` を、Node/Electron依存の有無に合わせて正しく設定する。 :contentReference[oaicite:11]{index=11}

## 3. コミュニティ掲載（obsidian-releases）で落ちる典型要件
### 3.1 プラグインIDの制約
- 私は `id` に "obsidian" を含めない。
- 私は `id` を "plugin" で終えない。
- 私は `id` を小文字英数字と `-` `_` だけで構成する。 :contentReference[oaicite:12]{index=12}

### 3.2 name / description の制約（審査ボット準拠）
- 私は name に "Obsidian" を入れない。私は name を "plugin" で終えない。 :contentReference[oaicite:13]{index=13}
- 私は description に "Obsidian" を入れない。
- 私は description を250文字以下にする。
- 私は description の末尾に `. ? ! )` のいずれかを置く。 :contentReference[oaicite:14]{index=14}

### 3.3 リポジトリとリリースの必須条件
- 私はリポジトリ直下に `manifest.json` を置く。 :contentReference[oaicite:15]{index=15}
- 私は GitHub Release を `manifest.version` と同じタグ名で作る（先頭に `v` を付けない）。 :contentReference[oaicite:16]{index=16}
- 私は Release のassetsとして少なくとも `main.js` と `manifest.json` を個別ファイルで添付する（source.zipだけを添付しない）。 :contentReference[oaicite:17]{index=17}
- 私は README.md に目的と使い方を書く。 :contentReference[oaicite:18]{index=18}
- 私は LICENSE を置く。 :contentReference[oaicite:19]{index=19}
- 私は `authorUrl` を `https://obsidian.md` にしない。私は `authorUrl` を自分のプラグインrepoにしない。 :contentReference[oaicite:20]{index=20}
- 私は `fundingUrl` を空文字にしない。私は `https://obsidian.md/pricing` を `fundingUrl` にしない。 :contentReference[oaicite:21]{index=21}

## 4. versions.json（互換性の制御）
- 私は `minAppVersion` を上げたとき、`versions.json` に「プラグインversion → 最小Obsidian version」の対応を追加して、古いObsidianにフォールバック版を配れるようにする。 :contentReference[oaicite:22]{index=22}
- 私は `minAppVersion` を変えないリリースでは `versions.json` を毎回更新しない。 :contentReference[oaicite:23]{index=23}

## 5. ローカルでESLintを再現する要件（sample準拠）
### 5.1 何が「正」としてチェックされるか
- 私は `npm run lint` をCI相当の入口として使う（sampleは `lint: "eslint ."`）。 :contentReference[oaicite:24]{index=24}
- 私は flat config の `eslint.config.mts` を正とする。設定は `typescript-eslint` と `eslint-plugin-obsidianmd` の recommended を読み込み、`node_modules` や生成物を ignore する。 :contentReference[oaicite:25]{index=25}

### 5.2 ESLint設定の重要ポイント（詰まりやすい所）
- 私は `package.json` の `"type": "module"` を前提にし、ESMとしてESLint設定を評価する。 :contentReference[oaicite:26]{index=26}
- 私は TypeScriptのパーサ設定で `manifest.json` をlint対象に入れる（extraFileExtensionsに `.json` が入る）。 :contentReference[oaicite:27]{index=27}
- 私は ignore 対象に `dist`, `main.js` などの生成物を入れる。 :contentReference[oaicite:28]{index=28}

### 5.3 ローカル再現コマンド（最小）
- install: `npm install`
- lint: `npm run lint`
- build検証: `npm run build`（型チェックが絡むため、lintが通ってもbuildが落ちるケースを残す） :contentReference[oaicite:29]{index=29}

## 6. AI（Claude Code / Codex）への制約（破りやすい順）
- 私は `manifest.json` の必須キー/禁止キー/ID制約を絶対に破らない。 :contentReference[oaicite:30]{index=30}
- 私は `npm run lint` を必ず通す変更だけを採用する。 :contentReference[oaicite:31]{index=31}
- 私は Release asset 要件（main.js/manifest.json）とタグ一致要件を破る変更を採用しない。 :contentReference[oaicite:32]{index=32}
- 私は `minAppVersion` を引き上げたら `versions.json` を更新する。 :contentReference[oaicite:33]{index=33}
