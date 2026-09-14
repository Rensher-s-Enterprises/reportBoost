import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { pdfSafeText } from "./pdf-text.ts";

describe("pdfSafeText", () => {
  it("turns smart quotes and dashes into PDF-safe ASCII", () => {
    assert.equal(pdfSafeText("Nick “closed” CHK-1—done"), 'Nick "closed" CHK-1-done');
  });

  it("strips CID / private-use junk from extracted PDF text", () => {
    assert.equal(pdfSafeText("CHK-1 \uE000!@#\uFFFD bent finger"), "CHK-1 !@# bent finger");
  });

  it("keeps Latin names", () => {
    assert.equal(pdfSafeText("José Muñoz"), "José Muñoz");
  });
});
