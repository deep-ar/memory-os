import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import {
  composeCombinedReport,
  parseCuratorReport,
  parseIntegratedReport,
  parseKernelReport,
} from "../src/reporting/combined-report.js";
import { loadJsonReport } from "../src/reporting/load-report.js";

describe("canonical combined report", () => {
  it("preserves track evidence boundaries and report provenance", async () => {
    const [kernel, curator, integrated] = await Promise.all([
      loadJsonReport(resolve("artifacts/controlled-v0.1-report.json"), parseKernelReport),
      loadJsonReport(resolve("artifacts/curator-oracle-v0.1-report.json"), parseCuratorReport),
      loadJsonReport(resolve("artifacts/integrated-calibration-v0.1-report.json"), parseIntegratedReport),
    ]);
    const report = composeCombinedReport({ kernel, curator, integrated, generatedAt: "2026-09-01T00:00:00.000Z" });

    expect(report.status).toBe("completed");
    expect(report.sections.kernel.evidenceLevel).toBe("live_system_measurement");
    expect(report.sections.curator.evidenceLevel).toBe("evaluator_calibration");
    expect(report.sections.integrated.evidenceLevel).toBe("evaluator_calibration");
    expect(report.sections.integrated.memoryContextSources).toContain("fixture_full");
    expect(report.warnings.join(" ")).toMatch(/not a live-agent quality measurement/u);
    expect(report.warnings.join(" ")).toMatch(/did not use a live MemoryOS/u);
    expect(report.sections.kernel.sourceReport.sha256).toMatch(/^[a-f0-9]{64}$/u);
  });

  it("rejects a report assigned to the wrong track", async () => {
    await expect(loadJsonReport(
      resolve("artifacts/curator-oracle-v0.1-report.json"),
      parseIntegratedReport,
    )).rejects.toThrow();
  });
});
