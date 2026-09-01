import { describe, expect, it } from "vitest";
import { compileFalkorFullTextQuery } from "../src/adapters/memory/falkordb-retrieval-store.js";

describe("FalkorDB full-text query compilation", () => {
  it("drops punctuation fragments that contain only underscores", () => {
    const query = compileFalkorFullTextQuery(String.raw`можем навесить инструмент \_\_LucyTest просто скриптом`);

    expect(query).toBe("можем|навесить|инструмент|_lucytest|просто|скриптом");
    expect(query).not.toMatch(/(?:^|\|)_+(?:\||$)/u);
  });

  it("returns null when no searchable letters or digits remain", () => {
    expect(compileFalkorFullTextQuery("___ ---")).toBeNull();
  });
});
