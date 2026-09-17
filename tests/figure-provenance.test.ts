import { describe, expect, it } from "vitest";
import { figureEvidenceTargets, sameFigure } from "@/lib/figure-provenance";
import type { Citation } from "@/lib/types";

function citation(id: string, figures: string[]): Citation {
  return {
    id,
    documentId: "report-robotics",
    title: "Warehouse Robotics",
    code: "DEMO-ROBOTICS-02",
    section: "Competitive Market Share Analysis",
    anchor: `report-analysis-evidence-${id}`,
    sourceOffset: 1_000,
    excerpt: "Licensed market-share evidence.",
    figures,
    relevance: 98,
  };
}

describe("claim-level figure provenance", () => {
  it("maps a displayed figure to its exact source value", () => {
    const targets = figureEvidenceTargets(
      "62.5%",
      "Orion Robotics held 62.5% of the market.",
      [citation("S1", ["62.5%", "2024"])],
    );

    expect(targets).toHaveLength(1);
    expect(targets[0]).toMatchObject({ focusText: "62.5%", citation: { id: "S1" } });
  });

  it("links a calculated result to each of its source inputs", () => {
    const targets = figureEvidenceTargets(
      "38.5 percentage-point",
      "62.5% less 24.0% is a 38.5 percentage-point gap.",
      [citation("S1", ["62.5%"]), citation("S2", ["24.0%"])],
    );

    expect(targets.map((target) => target.focusText)).toEqual(["62.5%", "24.0%"]);
  });

  it("treats equivalent decimal formatting as the same figure", () => {
    expect(sameFigure("$520.0 million", "$520 million")).toBe(true);
  });
});
