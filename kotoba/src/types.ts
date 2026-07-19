/**
 * legal-corpus kotoba — record types.
 *
 * Per ADR-2605203000 Option B (PDS XRPC). Global legal-document catalog —
 * EUR-Lex / CourtListener / BAILII / WorldLII / CanLII. Public legal documents
 * (no PII, no payment) → 3-axis clean. ADR-2605172000 kotoba.
 *
 * The heavy bits (bge-m3 1024d embeddings + IVF/cosine search) stay in the
 * pipeline; this registry holds the public document catalog (idempotent on
 * canonicalUri, per the vendor `legal.corpus.ingestDocument`). Body text is
 * referenced by IPFS CID, not inlined.
 *
 * Identity hierarchy:
 *   did:web:legal-corpus.etzhayyim.com                       — controller
 *   did:web:legal-corpus.etzhayyim.com:doc:{key}             — a legal document
 */

export const LC_DID_PREFIX = "did:web:legal-corpus.etzhayyim.com:" as const;

export type LegalSource =
  | "eur-lex"
  | "courtlistener"
  | "bailii"
  | "worldlii"
  | "canlii"
  | "other";

export type DocType =
  | "opinion"
  | "case"
  | "statute"
  | "regulation"
  | "directive"
  | "decision"
  | "treaty"
  | "other";

export interface LegalDocRecord {
  did: string;
  /** Canonical URI / identifier (CELEX, CourtListener URL, …) — idempotency key. */
  canonicalUri: string;
  source: LegalSource;
  /** ISO 3166-1 alpha-2 or court-system code (e.g. "EU", "US", "GB", "CA"). */
  jurisdiction?: string;
  docType: DocType;
  title: string;
  court?: string;
  citation?: string;
  decidedAt?: string;
  /** ISO 639-1 / 639-3. */
  language?: string;
  summary?: string;
  /** IPFS CID of the full body text (heavy payload referenced, not inlined). */
  bodyTextCid?: string;
  collectedAt: string;
  createdAt: string;
}

export interface LegalDocView extends LegalDocRecord {
  docUri: string;
}

export interface IngestDocumentInput {
  canonicalUri: string;
  source: LegalSource;
  docType: DocType;
  title: string;
  jurisdiction?: string;
  court?: string;
  citation?: string;
  decidedAt?: string;
  language?: string;
  summary?: string;
  bodyTextCid?: string;
}

export interface IngestDocumentOutput {
  status: "ingested" | "alreadyExists" | "rejected";
  docUri?: string;
  did?: string;
  canonicalUri?: string;
  error?: string;
}

export interface GetDocumentInput {
  canonicalUri: string;
}

export interface GetDocumentOutput {
  document?: LegalDocView;
  error?: string;
}

export interface ListDocumentsInput {
  source?: LegalSource;
  jurisdiction?: string;
  docType?: DocType;
  limit?: number;
  cursor?: string;
}

export interface ListDocumentsOutput {
  items: LegalDocView[];
  cursor?: string;
  total: number;
}

export interface CoverageInput {
  maxScan?: number;
}

export interface CoverageOutput {
  total?: number;
  bySource?: Record<string, number>;
  byJurisdiction?: Record<string, number>;
  byDocType?: Record<string, number>;
  withEmbedding?: number;
  truncated?: boolean;
  error?: string;
}

// ─── Helpers ────────────────────────────────────────────────────────

/** Trim + collapse internal whitespace in a canonical URI. */
export function normalizeUri(uri: string): string {
  return uri.trim().replace(/\s+/g, "");
}

/** True for a plausible canonical URI (non-trivial, no whitespace). */
export function isValidCanonicalUri(uri: string): boolean {
  const u = normalizeUri(uri);
  return u.length >= 4 && !/\s/.test(u);
}

/** djb2 → 8-hex stable key from a canonical URI. */
export function docKey(canonicalUri: string): string {
  const v = normalizeUri(canonicalUri);
  let h = 5381;
  for (let i = 0; i < v.length; i++) {
    h = ((h << 5) + h + v.charCodeAt(i)) >>> 0;
  }
  return h.toString(16).padStart(8, "0");
}

export function docDid(canonicalUri: string): string {
  return `${LC_DID_PREFIX}doc:${docKey(canonicalUri)}`;
}

export function docRkey(canonicalUri: string): string {
  return `doc_${docKey(canonicalUri)}`;
}
