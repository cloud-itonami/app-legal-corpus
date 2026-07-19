import { describe, it, expect, beforeEach } from "vitest";
import { MockEtzhayyim } from "@etzhayyim/sdk-mock";
import {
  ingestDocument,
  getDocument,
  listDocuments,
  coverage,
  isValidCanonicalUri,
  normalizeUri,
  docRkey,
} from "../src/index.js";

describe("legal-corpus kotoba", () => {
  let e: any;
  beforeEach(() => {
    e = new MockEtzhayyim({ did: "did:web:legal-corpus.etzhayyim.com" });
  });

  describe("helpers", () => {
    it("validates + normalizes canonical URIs", () => {
      expect(isValidCanonicalUri("celex:32016R0679")).toBe(true);
      expect(isValidCanonicalUri("ab")).toBe(false);
      expect(normalizeUri("  https://x.test/a b ")).toBe("https://x.test/ab");
    });
    it("rkey is stable + URI-derived", () => {
      expect(docRkey("celex:32016R0679")).toBe(docRkey("celex:32016R0679"));
      expect(docRkey("celex:32016R0679").startsWith("doc_")).toBe(true);
    });
  });

  describe("ingestDocument", () => {
    const gdpr = {
      canonicalUri: "celex:32016R0679",
      source: "eur-lex" as const,
      docType: "regulation" as const,
      title: "GDPR — Regulation (EU) 2016/679",
      jurisdiction: "EU",
      decidedAt: "2016-04-27",
      language: "en",
    };
    it("ingests a document", async () => {
      const r = await ingestDocument(e, gdpr);
      expect(r.status).toBe("ingested");
      expect(r.did).toContain("doc:");
    });
    it("is idempotent on canonicalUri", async () => {
      await ingestDocument(e, gdpr);
      const again = await ingestDocument(e, gdpr);
      expect(again.status).toBe("alreadyExists");
    });
    it("rejects an invalid canonicalUri", async () => {
      const r = await ingestDocument(e, { ...gdpr, canonicalUri: "x" });
      expect(r.status).toBe("rejected");
      expect(r.error).toBe("invalidCanonicalUri");
    });
    it("round-trips via getDocument", async () => {
      await ingestDocument(e, gdpr);
      const got = await getDocument(e, { canonicalUri: "celex:32016R0679" });
      expect(got.document?.title).toContain("GDPR");
      expect(got.document?.jurisdiction).toBe("EU");
    });
  });

  describe("list + coverage", () => {
    beforeEach(async () => {
      await ingestDocument(e, {
        canonicalUri: "celex:32016R0679",
        source: "eur-lex",
        docType: "regulation",
        title: "GDPR",
        jurisdiction: "EU",
        bodyTextCid: "bafyfake1",
      });
      await ingestDocument(e, {
        canonicalUri: "https://courtlistener.test/opinion/1",
        source: "courtlistener",
        docType: "opinion",
        title: "Some v. Case",
        jurisdiction: "US",
      });
    });
    it("filters by source", async () => {
      const eu = await listDocuments(e, { source: "eur-lex" });
      expect(eu.total).toBe(1);
    });
    it("filters by docType", async () => {
      const ops = await listDocuments(e, { docType: "opinion" });
      expect(ops.total).toBe(1);
      expect(ops.items[0].jurisdiction).toBe("US");
    });
    it("coverage aggregates + counts embeddings", async () => {
      const cov = await coverage(e);
      expect(cov.total).toBe(2);
      expect(cov.bySource?.["eur-lex"]).toBe(1);
      expect(cov.byJurisdiction?.US).toBe(1);
      expect(cov.byDocType?.regulation).toBe(1);
      expect(cov.withEmbedding).toBe(1);
    });
  });
});
