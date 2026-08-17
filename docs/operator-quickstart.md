# operator quickstart — app-legal-corpus

**この手順は 2026-08-17 UTC に上から順に実際に実行し、exit code と出力を
突き合わせてある。** 数字（パッケージ数・所要時間）は 1 回の実測値であって
契約ではない。exit code と件数は契約として読んでよい。

計測に使った環境: macOS (darwin 25.3.0, arm64) / **node v26.3.0** / **npm 11.16.0**。

この repo に**デプロイ手順は無い**。ここに在るのは `@etzhayyim/sdk` の上に建つ
ライブラリ 4 本とそのテストで、サーバも Worker も CLI も無い
（`CLAUDE.md` が書く K8s の LangGraph パイプラインは別 repo。README §2）。
つまり quickstart の完了条件は「**型が通り、テストが緑になること**」である。

## 0. 前提

必要なのは node と npm だけ。**etzhayyim 組織へのアクセス権は要らない** ——
依存 2 本はどちらも public repo を commit SHA で固定している（README §4）。

## 1. install

```bash
cd kotoba
npm install --no-audit --no-fund
```

**実測**: `added 135 packages in 3m`（初回・キャッシュ無し）。

### ⚠ このマシンでは、ここで落ちる（repo の欠陥ではない）

npm **11.16.0** は、git 依存を準備するための内部 install で
`--allow-scripts` を受け付けない。`~/.npmrc` に

```
allow-scripts[]=@anthropic-ai/claude-code
```

の行があると、その設定が内部 install に継承されて **`EALLOWSCRIPTS` で落ちる**:

```
npm error code EALLOWSCRIPTS
npm error --allow-scripts is not allowed in project-scoped installs.
npm error git dep preparation failed
```

**これは環境の問題であって、この repo の問題ではない。** だから `.npmrc` を
repo には足していない。回避は「その行だけ落とした userconfig を 1 回きり渡す」:

```bash
grep -v '^allow-scripts' ~/.npmrc > /tmp/npmrc-no-allowscripts
npm install --userconfig /tmp/npmrc-no-allowscripts --no-audit --no-fund
```

install の最後に出る

```
npm warn allow-scripts 8 packages have install scripts not yet covered by allowScripts:
```

は **警告であって失敗ではない**（`@etzhayyim/*` 7 本の `prepare: tsc` と
`@signalapp/libsignal-client` の 1 本）。exit code は 0 で、以降の手順は通る。

## 2. typecheck

```bash
npm run typecheck        # tsc --noEmit
```

**期待**: 出力なし・**exit 0**。（実測どおり。`strict: true`）

## 3. test

```bash
npm test                 # vitest run
```

**期待**:

```
 Test Files  1 passed (1)
      Tests  9 passed (9)
```

**実測**: vitest 4.1.10 / 9 passed / 497 ms。**exit 0**。

9 件の内訳は `test/legal-corpus.test.ts` の 3 グループ:

| グループ | 件数 | 何を固定しているか |
|---|---|---|
| `helpers` | 2 | `isValidCanonicalUri` / `normalizeUri`（内部空白を畳む）/ `docRkey` が URI 由来で安定 |
| `ingestDocument` | 4 | 取り込み・**canonicalUri に対する冪等**（2 回目は `alreadyExists`）・不正 URI の拒否・`getDocument` 往復 |
| `list + coverage` | 3 | `source` 絞り込み・`docType` 絞り込み・`coverage` の集計 |

## 4. テストが本当に discriminate することを確かめる

**緑を信じる前に、赤くなることを 1 度見る。** 実装を 1 箇所壊して、
**壊した場所と落ちるテストが対応すること**を確認する（壊し方を間違えた赤は
「成功した実演」に見える。CLAUDE.md の 5 問）。

冪等性を壊す例 —— `src/registry.ts` の `ingestDocument` で既存レコードを見る分岐

```ts
  if (existing.records[0]?.value) {
```

を

```ts
  if (false) {
```

に変えて `npm test`:

**実測**: `Tests 8 passed | 1 failed`。落ちたのは
`ingestDocument > is idempotent on canonicalUri`（`expected 'ingested' to be 'alreadyExists'`）
の **1 件だけ** —— 壊した不変条件と一致する。確認したら元に戻す
（`git checkout -- src/registry.ts`）。

## 5. 実測した 2 つの欠陥を自分で再現する

README §3 の 2 件は、この probe をそのまま置けば再現できる。**probe は repo に
commit していない**ので、確認したら消すこと。

```bash
cd kotoba
cat > test/probe.test.ts <<'EOF'
import { describe, it, expect, beforeEach } from "vitest";
import { MockEtzhayyim } from "@etzhayyim/sdk-mock";
import { ingestDocument, listDocuments, coverage } from "../src/index.js";

describe("probe", () => {
  let e: any;
  beforeEach(() => { e = new MockEtzhayyim({ did: "did:web:legal-corpus.etzhayyim.com" }); });

  it("A: withEmbedding counts bodyTextCid, not embeddings", async () => {
    await ingestDocument(e, { canonicalUri: "celex:1", source: "eur-lex",
      docType: "regulation", title: "no embedding anywhere", bodyTextCid: "bafyfake1" });
    const cov = await coverage(e);
    console.log("  A -> withEmbedding =", cov.withEmbedding);
    expect(cov.withEmbedding).toBe(1);
  });

  it("B: listDocuments filters AFTER paging; total is page-local", async () => {
    for (let i = 0; i < 7; i++) {
      await ingestDocument(e, { canonicalUri: `celex:us${i}`, source: "courtlistener",
        docType: "opinion", title: `US ${i}` });
    }
    await ingestDocument(e, { canonicalUri: "celex:eu1", source: "eur-lex",
      docType: "regulation", title: "the only EU doc" });
    const page = await listDocuments(e, { source: "eur-lex", limit: 3 });
    console.log("  B -> items =", page.items.length, ", total =", page.total,
                ", cursor =", JSON.stringify(page.cursor));
    expect(page.items.length).toBe(0);
  });
});
EOF
npx vitest run test/probe.test.ts --reporter=verbose
rm test/probe.test.ts
```

**実測**（2 件とも pass = 欠陥が再現したということ）:

```
  A -> withEmbedding = 1
  B -> items = 0 , total = 0 , cursor = "doc_a1fd2eeb"
```

A は embedding を 1 バイトも持たないレコードが embedding として数えられたこと、
B は実在する EU 文書が返らず、しかも `cursor` が非 null なので呼び出し側が
「該当なし」と「このページに無いだけ」を区別できないことを示す。

## 6. ライブラリとして使う

サーバは無いので、`@etzhayyim/sdk` の `Etzhayyim` を渡して直接呼ぶ。

```ts
import { ingestDocument, getDocument, listDocuments, coverage } from "./src/index.js";

const r = await ingestDocument(e, {
  canonicalUri: "celex:32016R0679",     // ← 冪等キー
  source: "eur-lex",
  docType: "regulation",
  title: "GDPR — Regulation (EU) 2016/679",
  jurisdiction: "EU",
});
// r.status: "ingested" | "alreadyExists" | "rejected"
```

- レコードは `com.etzhayyim.apps.legalCorpus.document`、rkey は
  `doc_{djb2(canonicalUri)}`（8 桁 hex）。**同じ `canonicalUri` を 2 回入れても
  上書きされず `alreadyExists` が返る。**
- 本文テキストは**インラインしない** —— `bodyTextCid` で IPFS の CID を参照する。
- `listDocuments` / `coverage` を使う前に **README §3 の欠陥 B / A を読むこと。**
