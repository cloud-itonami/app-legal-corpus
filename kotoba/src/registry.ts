/**
 * legal-corpus kotoba — document catalog registry (slice 1, 4/4 canonical).
 *
 *   ingestDocument — register a legal doc (rkey=doc_{djb2(canonicalUri)},
 *                    idempotent on canonicalUri, matching vendor
 *                    legal.corpus.ingestDocument).
 *   getDocument    — by canonicalUri.
 *   listDocuments  — cursor + source/jurisdiction/docType filter.
 *   coverage       — counts by source/jurisdiction/docType + embedded count.
 *
 * Replaces vendor createKyselyDb()/vertex_legal_corpus_* with AT PDS records
 * (no RW). Public legal documents → 3-axis clean. Embedding/IVF search stays in
 * the pipeline; bodyTextCid references the heavy payload on IPFS.
 */

import type { Etzhayyim } from "@etzhayyim/sdk";
import {
  docDid,
  docRkey,
  isValidCanonicalUri,
  normalizeUri,
  type CoverageInput,
  type CoverageOutput,
  type DocType,
  type GetDocumentInput,
  type GetDocumentOutput,
  type IngestDocumentInput,
  type IngestDocumentOutput,
  type LegalDocRecord,
  type LegalDocView,
  type LegalSource,
  type ListDocumentsInput,
  type ListDocumentsOutput,
} from "./types.js";

const DOC_COLLECTION = "com.etzhayyim.apps.legalCorpus.document";

const PAGE_LIMIT = 100;
const DEFAULT_MAX_SCAN = 10_000;

export async function ingestDocument(
  e: Etzhayyim,
  input: IngestDocumentInput
): Promise<IngestDocumentOutput> {
  if (!input.canonicalUri || !input.title || !input.source || !input.docType) {
    return { status: "rejected", error: "missingRequiredFields" };
  }
  if (!isValidCanonicalUri(input.canonicalUri)) {
    return { status: "rejected", error: "invalidCanonicalUri" };
  }
  const canonicalUri = normalizeUri(input.canonicalUri);

  const rkey = docRkey(canonicalUri);
  const existing = await e
    .read<LegalDocRecord>({ collection: DOC_COLLECTION, rkey })
    .catch(() => ({ records: [] }));
  if (existing.records[0]?.value) {
    return {
      status: "alreadyExists",
      docUri: existing.records[0].uri,
      did: existing.records[0].value.did,
      canonicalUri,
    };
  }

  const did = docDid(canonicalUri);
  const now = new Date().toISOString();
  const record: LegalDocRecord = {
    did,
    canonicalUri,
    source: input.source,
    jurisdiction: input.jurisdiction,
    docType: input.docType,
    title: input.title,
    court: input.court,
    citation: input.citation,
    decidedAt: input.decidedAt,
    language: input.language,
    summary: input.summary,
    bodyTextCid: input.bodyTextCid,
    collectedAt: now,
    createdAt: now,
  };
  const receipt = await e.write({
    collection: DOC_COLLECTION,
    record: record as unknown as Record<string, unknown>,
    rkey,
  });
  return { status: "ingested", docUri: receipt.uri, did, canonicalUri };
}

export async function getDocument(
  e: Etzhayyim,
  input: GetDocumentInput
): Promise<GetDocumentOutput> {
  if (!input.canonicalUri || !isValidCanonicalUri(input.canonicalUri)) {
    return { error: "invalidCanonicalUri" };
  }
  const resp = await e
    .read<LegalDocRecord>({
      collection: DOC_COLLECTION,
      rkey: docRkey(normalizeUri(input.canonicalUri)),
    })
    .catch(() => ({ records: [] }));
  const r = resp.records[0];
  if (!r) return { error: "notFound" };
  return { document: { ...r.value, docUri: r.uri } };
}

export async function listDocuments(
  e: Etzhayyim,
  input: ListDocumentsInput = {}
): Promise<ListDocumentsOutput> {
  const limit = Math.min(input.limit ?? 50, 200);
  const resp = await e.read<LegalDocRecord>({
    collection: DOC_COLLECTION,
    cursor: input.cursor,
    limit,
  });
  const items: LegalDocView[] = resp.records
    .filter((r) => {
      const v = r.value;
      if (input.source && v.source !== input.source) return false;
      if (input.jurisdiction && v.jurisdiction !== input.jurisdiction) return false;
      if (input.docType && v.docType !== input.docType) return false;
      return true;
    })
    .map((r) => ({ ...r.value, docUri: r.uri }));
  return { items, cursor: resp.cursor, total: items.length };
}

export async function coverage(
  e: Etzhayyim,
  input: CoverageInput = {}
): Promise<CoverageOutput> {
  const maxScan = Math.min(input.maxScan ?? DEFAULT_MAX_SCAN, DEFAULT_MAX_SCAN);
  let cursor: string | undefined;
  let scanned = 0;
  const bySource: Record<string, number> = {};
  const byJurisdiction: Record<string, number> = {};
  const byDocType: Record<string, number> = {};
  let withEmbedding = 0;
  while (scanned < maxScan) {
    const page = await e.read<LegalDocRecord>({
      collection: DOC_COLLECTION,
      cursor,
      limit: PAGE_LIMIT,
    });
    for (const r of page.records) {
      if (scanned >= maxScan) break;
      const v = r.value;
      bySource[v.source as LegalSource] = (bySource[v.source as LegalSource] ?? 0) + 1;
      if (v.jurisdiction) {
        byJurisdiction[v.jurisdiction] = (byJurisdiction[v.jurisdiction] ?? 0) + 1;
      }
      byDocType[v.docType as DocType] = (byDocType[v.docType as DocType] ?? 0) + 1;
      if (v.bodyTextCid) withEmbedding += 1;
      scanned += 1;
    }
    if (scanned >= maxScan || !page.cursor || page.records.length < PAGE_LIMIT) {
      break;
    }
    cursor = page.cursor;
  }
  return {
    total: scanned,
    bySource,
    byJurisdiction,
    byDocType,
    withEmbedding,
    truncated: scanned >= maxScan,
  };
}
