# app-legal-corpus

**`legal-corpus` は分野名であって機能名ではないので、まず名乗る —— この repo に
在るのは「世界各国の一次法源カタログ」の *kotoba 参照実装*、すなわち
`@etzhayyim/sdk` の AT PDS レコードの上に建てた 4 本の関数
（`ingestDocument` / `getDocument` / `listDocuments` / `coverage`）である。**
TypeScript 約 13 KB と vitest のテスト 1 本、それだけ。

**そして最初に言っておくべきこととして、[`AGENTS.md`](AGENTS.md) はこの repo に
無いものを記述している。** あちらが書くのは K8s 上の LangGraph パイプライン
（bge-m3 1024 次元の embedding・IVF/cosine 検索・5 つの取り込み CronJob・MCP
サーバ）で、**その実装ファイルは 1 つもここに切り出されていない**（§2）。
`AGENTS.md` を設計の正本として読むのは正しいが、**この repo の中身の説明として
読むと必ず間違える。**

この README が書くのは設計ではなく、**いま実際に何が在って、何が動いて、
何が壊れているか**である。

## 1. この repo に在るもの（11 ファイル）

`etzhayyim/root` の `60-apps/etzhayyim-project-legal-corpus`（rev `1fb8430a`、
9 ファイル / 24,278 バイト）から切り出した standalone artifact（`migration.edn`）。
`README.edn` と `migration.edn` が追加の 2 件で、**この `README.md` と
`docs/operator-quickstart.md` はさらに後から足している** —— fleet の他の repo
（`app-kaigo` / `app-karute` など）と同じ扱いで、切り出し契約の更新漏れであって
逸脱ではない。

| パス | 中身 | 手元で動くか |
|---|---|---|
| **`kotoba/src/types.ts`**（3,964 B） | レコード型・`LegalSource` 6 種・`DocType` 8 種と、`normalizeUri` / `isValidCanonicalUri` / `docKey`（djb2 → 8 桁 hex）/ `docDid` / `docRkey` | **動く** |
| **`kotoba/src/registry.ts`**（5,352 B） | 4 本の本体。コレクションは `com.etzhayyim.apps.legalCorpus.document`、rkey は `doc_{djb2(canonicalUri)}` で **canonicalUri に対して冪等** | **動く**（ただし §3 の 2 件の欠陥あり） |
| **`kotoba/src/index.ts`**（420 B） | barrel。`Slice 1: 4 of 4 canonical lexicons ported` と書くが、**この数え方は `PROJECT.jsonld` と合わない**（§2） | — |
| **`kotoba/test/legal-corpus.test.ts`**（3,330 B） | `MockEtzhayyim` に対する 9 ケース | **動く**（9 passed / 497 ms） |
| `kotoba/package.json` / `tsconfig.json` / `vitest.config.ts` | 依存は 2 本とも **public repo の commit 固定**（§4） | — |
| `AGENTS.md`（6,911 B） | 設計の正本 —— ただし別のシステムのもの（§2） | — |
| `PROJECT.jsonld`（3,036 B） | actor 記述。lexicon 6 本・BPMN 8 本・graph table 5 本を列挙するが、**そのファイルはどれもここに無い** | — |
| `README.edn` / `migration.edn` | 機械可読な同定 / 切り出しの出所 | — |

**注記**: 実装は TypeScript なので、fleet の成熟度スキャナ
（`scripts/itonami-maturity-scan.cljs`、拡張子 `cljc/cljs/clj/kotoba` のみを数える）
からは **substrate も test も 0 バイトに見える**。これは測定の盲点であって、
実装が無いという意味ではない。

## 2. 現在地（2026-08-17 UTC 実測）

### `AGENTS.md` / `PROJECT.jsonld` が指すファイルは、1 つもここに無い

細部のドリフトではない。**参照先が丸ごと別 repo に在る。**

| 参照元 | 参照しているパス | この repo に在るか |
|---|---|---|
| `AGENTS.md` | `50-infra/k8s/legal-corpus-langgraph/*`（LangGraph graph・FastAPI worker・Deployment・CronJob 6 本） | **無い** |
| `AGENTS.md` | `30-graph/graph-schema/migrations/20260427230000_vertex_legal_corpus.ts` | **無い** |
| `AGENTS.md` / `PROJECT.jsonld` | `etzhayyim-root/00-contracts/bpmn/.../*.bpmn`（8 本） | **無い** |
| `PROJECT.jsonld` | `00-contracts/lexicons/.../*.json`（6 本） | **無い** |

`AGENTS.md` が表にする 11 個の task type（`legal.corpus.embedDocument` /
`searchDocument` / `fetchEurLexDelta` …）も、**この repo には 1 つも実装が無い**。
embedding も検索も取り込みも、ここではなくパイプライン側の仕事である。

### 「4 of 4 canonical」は `PROJECT.jsonld` の 6 本と噛み合っていない

`index.ts` は 4 本を canonical lexicon の全部として数えるが、`PROJECT.jsonld` が
列挙する lexicon は 6 本で、**重なっているのは 2 本だけ**:

| | ingestDocument | getDocument | listDocuments | coverage | embedDocument | searchDocument | listJurisdictions | registerSource |
|---|---|---|---|---|---|---|---|---|
| `kotoba/` に実装 | ✅ | ✅ | ✅ | ✅ | — | — | — | — |
| `PROJECT.jsonld` に記載 | ✅ | ✅ | — | — | ✅ | ✅ | ✅ | ✅ |

つまり **実装されていて記載が無いものが 2 本**（`listDocuments` / `coverage`）、
**記載されていて実装が無いものが 4 本**。どちらが正かはこの repo からは決まらない。

## 3. 実測した 2 つの欠陥（どちらも未修正）

**テストは 9 件とも通る。通ったうえで、次の 2 つは間違っている。**
いずれも読んで疑い、`MockEtzhayyim` に対する使い捨ての probe を書いて確かめた
（probe は commit していない。再現手順は
[quickstart §5](docs/operator-quickstart.md#5-実測した-2-つの欠陥を自分で再現する)）。

### 欠陥 A — `coverage().withEmbedding` は embedding を数えていない

`registry.ts` は `if (v.bodyTextCid) withEmbedding += 1;` と書く。しかし
`bodyTextCid` は **本文テキストの IPFS CID** であって embedding ではなく、
`LegalDocRecord` に embedding のフィールドは **1 つも無い**（`types.ts`）。

実測: embedding を 1 バイトも持たず `bodyTextCid` だけを持つレコードを 1 件入れると
**`withEmbedding = 1`** が返る。この値は「本文 CID を持つ件数」であって、
`AGENTS.md` が言う embedding coverage ではない。

**しかも既存テストがこの意味を固定している** ——
`it("coverage aggregates + counts embeddings")` が `expect(cov.withEmbedding).toBe(1)`
と書いており、名前と実体のずれをテストが承認してしまっている。

### 欠陥 B — `listDocuments` はページングの *後* に絞り込む

`registry.ts` は `limit` を PDS の `read` にそのまま渡し、**返ってきた 1 ページ分に対して**
`source` / `jurisdiction` / `docType` を `filter` する。したがって:

- 条件に合う文書が存在しても、**そのページに載っていなければ 0 件が返る。**
- `total` は `items.length`（絞り込み後・**そのページ限り**）であって、
  条件に合う総数ではない。

実測: `courtlistener` の文書 7 件と `eur-lex` の文書 1 件を入れ、
`listDocuments({ source: "eur-lex", limit: 3 })` を呼ぶと
**`items = 0` / `total = 0` / `cursor = "doc_a1fd2eeb"`**。EU 文書は実在するのに
返らず、しかも `cursor` が非 null なので、呼び出し側は「該当が無い」のか
「このページに無いだけ」なのかを **区別できない**。

## 4. 依存（2 本とも public・commit 固定）

| 依存 | 用途 | pin | 到達性 |
|---|---|---|---|
| `@etzhayyim/sdk` | `Etzhayyim`（`read` / `write`） | `12314a0c`（2026-07-17） | **public**・SHA 解決確認済み |
| `@etzhayyim/sdk-mock` | `MockEtzhayyim`（test 専用） | `c857ff9b`（2026-07-17） | **public**・SHA 解決確認済み |

どちらも `git+https://github.com/etzhayyim/…` を commit SHA で固定しているので、
**組織アクセス権が無くても install できる**。

## 5. 動かし方

[`docs/operator-quickstart.md`](docs/operator-quickstart.md)。install → typecheck →
test の 3 ステップで、**2026-08-17 UTC に全ステップを実際に踏んで exit code と
出力を突き合わせてある**（`typecheck` exit 0 / **9 passed**）。

このマシン固有の罠（npm 11.16.0 + `~/.npmrc` の `allow-scripts[]` で
`npm install` が `EALLOWSCRIPTS` で落ちる）とその回避も quickstart に書いた ——
**repo の欠陥ではない**ので `.npmrc` は repo に足していない。

## 6. 未着手（次に手を付けるならここ）

- **欠陥 A / B の修正。** どちらも `registry.ts` の変更を伴う。A はテストが誤った
  意味を固定しているのでテストも直す必要がある（`withEmbedding` → `withBodyText`
  への改名か、本物の embedding フィールド追加か、決めるのは API の持ち主）。
- **テストが触れていない経路**: `ingestDocument` の `missingRequiredFields`、
  `getDocument` の `notFound` と `invalidCanonicalUri`、`listDocuments` の
  `jurisdiction` 絞り込みと `limit` の 200 上限、`coverage` の `maxScan` / `truncated`、
  2 ページ目以降のページング。
- **`PROJECT.jsonld` と実装の突き合わせ**（§2 の 2 本 / 4 本のずれ）。
- **`.gitignore` が無い。** quickstart の step 1 を踏むと `kotoba/node_modules/` と
  `kotoba/package-lock.json` が未追跡ファイルとして残り、`git status` が汚れる。
  lockfile も未 commit なので install は **再現可能でない**（依存 2 本は SHA 固定
  だが、推移依存 135 パッケージは固定されていない）。
