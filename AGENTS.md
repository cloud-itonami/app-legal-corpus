# legal-corpus.etzhayyim.com

ADR-0049 — グローバル法源 ingest + bge-m3 (1024d) embedding + IVF cosine search。
CF Worker は **存在しない**。

## Runtime (2026-05-14 移行済)

**LangGraph Server + Granian on K8s** (ADR-2605080600)。BPMN ファイルは process contract / audit document として残存。

| コンポーネント | 場所 |
|---|---|
| LangGraph graphs | `50-infra/k8s/legal-corpus-langgraph/legal_corpus_langgraph.py` |
| LangServerWorker (FastAPI) | `50-infra/k8s/legal-corpus-langgraph/legal_corpus_worker.py` |
| K8s Deployment (embed/search always-on) | `50-infra/k8s/legal-corpus-langgraph/deployment.yaml` |
| CronJobs (source fetches) | `50-infra/k8s/legal-corpus-langgraph/cronjob-*.yaml` |
| BPMN process contracts | `etzhayyim-root/00-contracts/bpmn/com/etzhayyim/legal-corpus/*.bpmn` |

## NSID / Task types

| NSID / task_type | 実装 | 役割 |
|---|---|---|
| `legal.corpus.ingestDocument` | `ingest_document_graph` | 1 doc 取り込み (idempotent on canonicalUri) |
| `legal.corpus.embedDocument` | `embed_document_graph` | bge-m3 で 1024d embedding 計算 + write |
| `legal.corpus.embedText` | `_embed_text` | raw embed (text → {embedding, dim}) |
| `legal.corpus.searchDocument` | `search_document_graph` | embed + inline-vec cosine search |
| `legal.corpus.fetchBodyText` | handler | EUR-Lex XHTML fetch + SPARQL fallback |
| `legal.corpus.fetchAndEmbed` | `fetch_and_embed_graph` | fetchBody → write → embed → write |
| `legal.corpus.fetchCourtListenerDelta` | `fetch_courtlistener_graph` | CronJob `0 3 * * *`, US opinions |
| `legal.corpus.fetchEurLexDelta` | `fetch_eurlex_graph` | CronJob `0 4 * * *`, EU SPARQL |
| `legal.corpus.fetchBailiiDelta` | `fetch_bailii_graph` | CronJob `0 5 * * *`, UK/IE Atom |
| `legal.corpus.fetchWorldLiiDelta` | `fetch_worldlii_graph` | CronJob `0 2 * * 0`, OAI-PMH weekly |
| `legal.corpus.fetchCanLiiDelta` | `fetch_canlii_graph` | CronJob `0 6 * * *`, SCC |

## Source Availability (2026-05-14)

| Source | Status | Notes |
|---|---|---|
| EUR-Lex | ✅ Working | 295 docs ingested (6-month backfill); daily SPARQL delta active |
| BAILII | ❌ Blocked | Cloudflare bot challenge blocks Vultr VKE IPs; daily scraper returns error gracefully |
| WorldLii | ❌ Blocked | HTTP 403 from Vultr VKE IPs; OAI-PMH endpoint blocks datacenter ranges |
| CourtListener | ⚠️ Needs credentials | `vault:courtlistener-api-token` → K8s secret `lg-legal-corpus-secrets` key `COURTLISTENER_API_TOKEN` not yet provisioned |
| CanLII | ⚠️ Needs credentials | `vault:canlii-api-key` → K8s secret `lg-legal-corpus-secrets` key `CANLII_API_KEY` not yet provisioned |

BAILII/WorldLii fix: request Vultr egress IP allowlist or use residential proxy egress.
CourtListener/CanLII fix: obtain API tokens and run:
```bash
kubectl -n mitama-udf create secret generic lg-legal-corpus-secrets \
  --from-literal=COURTLISTENER_API_TOKEN=<token> \
  --from-literal=CANLII_API_KEY=<key>
```

## Graph tables

- `vertex_legal_corpus_source` — 5 sources のメタ + watermark cursor
- `vertex_legal_corpus_document` — 1 doc = 1 row, `embedding_vec vector(1024)`、IVF cluster id 列 (live index: FLAT brute-force `<=>` — IVF/HNSW は Phase B+ で検討)
- `vertex_legal_corpus_document_pii` — Tier 3、arbitration award / sealed filings
- `edge_legal_corpus_cites` — 出典引用 graph
- `mv_legal_corpus_jurisdiction_coverage` — jurisdiction × source の document count + last_fetched_at

Migration: `30-graph/graph-schema/migrations/20260427230000_vertex_legal_corpus.ts`

## Embedding

- モデル: `BAAI/bge-m3` (1024d, multilingual) — sentence-transformers CPU encode
- 経由: `embed_document_graph` → `_embed_text` → `asyncio.to_thread(model.encode(...))`
- **CRITICAL (RisingWave vector quirk)**: psycopg3 は `::vector(1024)` を prepared statement parameter として拒否する。
  vec literal を SQL 文字列にインライン展開: `f"'{vec_literal}'::vector(1024)"`

## MCP Server (external agent access, 2026-05-14)

| エンドポイント | 用途 |
|---|---|
| `https://legal-corpus.etzhayyim.com/` | MCP JSON-RPC 2.0 (external AI agents) |
| `http://legal-corpus-mcp.mitama-udf.svc.cluster.local:8080` | MCP in-cluster |
| `http://legal-corpus-worker.mitama-udf.svc.cluster.local:8080` | LangServer (bge-m3, internal only) |

MCP tools:
- `legalCorpus.document.search` — semantic search via bge-m3 (proxied to LangServer worker)
- `legalCorpus.document.list` — metadata list/filter from RW
- `legalCorpus.corpus.status` — aggregate stats + embedding coverage
- `legalCorpus.source.list` — ingest source registry

Auth: `Authorization: Bearer <MCP_AUTH_TOKEN>` (key `MCP_AUTH_TOKEN` in `lg-legal-corpus-secrets`, `optional: true`).

## Automated Embedding (CronJob, 2026-05-14)

`cronjob-embed-pending.yaml` runs at **07:00 UTC daily** (after all source-fetch CronJobs at 02:00–06:00 UTC). Embeds any docs with `embedding_vec IS NULL` using bge-m3. Safe to re-run (idempotent).

## Build & Deploy 手順 (Ops)

```bash
# 1. Image build (BuildKit remote)
docker buildx build \
  --builder etzhayyim-vke \
  --platform linux/amd64 \
  --cache-from ghcr.io/etzhayyim/build-cache:main \
  --cache-to   ghcr.io/etzhayyim/build-cache:main \
  -t ghcr.io/etzhayyim/legal-corpus-langgraph:latest-amd64 \
  --push \
  50-infra/k8s/legal-corpus-langgraph/

# 2. K8s apply
kubectl apply -f 50-infra/k8s/legal-corpus-langgraph/deployment.yaml
kubectl apply -f 50-infra/k8s/legal-corpus-langgraph/cronjob-courtlistener.yaml
kubectl apply -f 50-infra/k8s/legal-corpus-langgraph/cronjob-eurlex.yaml
kubectl apply -f 50-infra/k8s/legal-corpus-langgraph/cronjob-bailii.yaml
kubectl apply -f 50-infra/k8s/legal-corpus-langgraph/cronjob-worldlii.yaml
kubectl apply -f 50-infra/k8s/legal-corpus-langgraph/cronjob-canlii.yaml
kubectl apply -f 50-infra/k8s/legal-corpus-langgraph/cronjob-embed-pending.yaml

# 3. Ingress (first time: create TLS secret with CF Origin Cert)
kubectl create secret tls legal-corpus-etzhayyim-ai-tls \
  --cert=origin.pem --key=origin-key.pem -n mitama-udf
kubectl apply -f 50-infra/k8s/legal-corpus-langgraph/ingress.yaml

# 4. Verify health
kubectl -n mitama-udf rollout status deploy/legal-corpus-worker
kubectl -n mitama-udf rollout status deploy/legal-corpus-mcp
kubectl -n mitama-udf exec deploy/legal-corpus-mcp -- \
  curl -s http://localhost:8081/health | python3 -m json.tool

## 関連 ADR

- ADR-0049 グローバル法源 ingest (本 actor の正規化 ADR)
- ADR-2605080600 LangGraph Server + Granian L3 Runtime (移行先 runtime)
- ADR-2605082000 LangGraph Graph Definition as Data (CRITICAL — 将来 graph topology を RisingWave に移行する場合の参照先)
- ADR-0044 RisingWave UDF language strategy (per-row compute path 選定)
- ADR-0018 PII Tier 3 + cohort-first
- ADR-0016 Legal cluster topology (本 actor が gap 1 を埋める)
