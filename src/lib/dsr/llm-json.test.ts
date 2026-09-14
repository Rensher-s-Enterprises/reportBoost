import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { extractJsonObject, parseJson } from "./llm-json.ts";

describe("extractJsonObject", () => {
  it("reads a fenced json block", () => {
    const raw = "Sure.\n```json\n{\"text\":\"Arrived on site.\"}\n```\n";
    assert.equal(extractJsonObject(raw), '{"text":"Arrived on site."}');
  });

  it("reads json after reasoning prose", () => {
    const raw = "The crew arrived.\n{\"comments\":\"Work day.\",\"entries\":[]}";
    assert.ok(extractJsonObject(raw)?.startsWith('{"comments"'));
  });
});

describe("parseJson", () => {
  it("returns the object", () => {
    const parsed = parseJson<{ text: string }>('{"text":"Closed CHK-1 after torqueing."}');
    assert.equal(parsed?.text, "Closed CHK-1 after torqueing.");
  });

  it("returns null on garbage", () => {
    assert.equal(parseJson("no json here"), null);
  });
});
