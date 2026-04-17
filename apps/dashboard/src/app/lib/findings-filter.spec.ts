import { filterFindings, sortFindings } from "./findings-filter";
import type { AnalyzerFinding } from "./report-schema";

const baseFinding: Omit<AnalyzerFinding, "severity" | "code" | "category" | "filePath" | "message"> = {
  confidence: "high",
  whyItMatters: "matters",
  suggestedActions: ["a"],
  metadata: {}
};

describe("filterFindings/sortFindings", () => {
  const findings: AnalyzerFinding[] = [
    { ...baseFinding, severity: "warning", category: "components", code: "a", message: "m1", filePath: "b.ts" },
    { ...baseFinding, severity: "error", category: "imports", code: "b", message: "m2", filePath: "a.ts" },
    { ...baseFinding, severity: "info", category: "services", code: "a", message: "m3", filePath: "c.ts" }
  ];

  it("filters by severity", () => {
    const out = filterFindings(findings, { severity: "error", category: "all", codeQuery: "", textQuery: "" });
    expect(out.length).toBe(1);
    expect(out[0]?.severity).toBe("error");
  });

  it("filters by codeQuery", () => {
    const out = filterFindings(findings, { severity: "all", category: "all", codeQuery: "b", textQuery: "" });
    expect(out.length).toBe(1);
    expect(out[0]?.code).toBe("b");
  });

  it("sorts by severity then file", () => {
    const out = sortFindings([...findings], "severity");
    expect(out.map((f) => f.severity)).toEqual(["error", "warning", "info"]);
  });
});

