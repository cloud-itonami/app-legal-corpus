/**
 * legal-corpus kotoba — barrel.
 *
 * Per ADR-2605203000 Option B Phase E reference impl. Global legal-document
 * catalog on the etzhayyim substrate (AT PDS records; no RW).
 *
 * Slice 1: 4 of 4 canonical lexicons ported.
 *   ingestDocument + getDocument + listDocuments + coverage
 */

export * from "./types.js";
export {
  ingestDocument,
  getDocument,
  listDocuments,
  coverage,
} from "./registry.js";
