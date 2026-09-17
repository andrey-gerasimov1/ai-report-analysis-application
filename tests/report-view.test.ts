import { describe, expect, it } from "vitest";
import { prepareFocusedReportForViewing, prepareReportForViewing } from "@/lib/report-view";
import type { ReportDefinition } from "@/lib/types";

const report: ReportDefinition = {
  id: "report-test",
  code: "TEST-01",
  title: "Viewer Test",
  shortTitle: "Viewer Test",
  filename: "viewer-test.html",
  published: "2026",
  geography: "Test",
  category: "Test",
  size: "1 KB",
  color: "teal",
  description: "Test report",
  priceCents: 19_900,
  currency: "USD",
  keywords: ["test"],
  allowedUsers: ["alex"],
  version: "1",
};

describe("authorized report viewer preparation", () => {
  it("preserves report content while disabling executable markup", () => {
    const result = prepareReportForViewing(report, `<!doctype html><html><head></head><body>
      <script>window.parent.location = "https://example.com"</script>
      <h2 onclick="alert(1)">Market overview</h2>
      <h2><a id="existing-section">Competition</a></h2>
      <a href="javascript:alert(1)">unsafe link</a>
      <p>Orion Robotics held 62.5% of the market.</p>
    </body></html>`, {
      focusText: "62.5%",
      fallbackAnchor: "report-analysis-section-1",
    });

    expect(result).not.toMatch(/<script|onclick=|javascript:/i);
    expect(result).toContain('id="report-analysis-section-1"');
    expect(result).toContain('id="existing-section"');
    expect(result).toContain('id="report-analysis-report-start"');
    expect(result).toContain('<mark id="report-analysis-source-focus">62.5%</mark>');
  });

  it("renders only the relevant source section for the fast evidence view", () => {
    const content = `<!doctype html><html><head><style>p { color: black; }</style></head><body>
      <h2>Unrelated section</h2><p>${"Earlier content. ".repeat(100)}</p>
      <h2>Market-share evidence</h2><p>Orion Robotics held 62.5% of the market.</p>
      <h2>Later section</h2><p>${"Later content. ".repeat(100)}</p>
    </body></html>`;
    const sourceOffset = content.indexOf("<p>Orion Robotics");
    const result = prepareFocusedReportForViewing(report, content, sourceOffset, {
      focusText: "62.5%",
    });

    expect(result).toContain("Market-share evidence");
    expect(result).toContain('<mark id="report-analysis-source-focus">62.5%</mark>');
    expect(result).not.toContain("Unrelated section");
    expect(result).not.toContain("Later section");
  });
});
