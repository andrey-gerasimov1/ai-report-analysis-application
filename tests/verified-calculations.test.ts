import { describe, expect, it } from "vitest";
import { buildVerifiedCalculation } from "@/lib/verified-calculations";
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
    excerpt: "Orion Robotics 62.5%; Vela Automation 24.0%.",
    figures,
    relevance: 99,
  };
}

describe("verified calculations", () => {
  it("calculates the requested warehouse robotics share gap from cited operands", () => {
    const answer = buildVerifiedCalculation(
      "Compare Orion Robotics and Vela Automation warehouse robotics shares and calculate the gap.",
      [citation("S3", ["62.5%", "24.0%", "2024"])],
    );

    expect(answer).toContain("62.5% - 24.0% = 38.5 percentage points");
    expect(answer).toContain("[S3]");
  });

  it("refuses to calculate when either cited operand is missing", () => {
    expect(buildVerifiedCalculation(
      "Calculate the Orion Robotics and Vela Automation warehouse robotics gap.",
      [citation("S1", ["62.5%"])],
    )).toBeNull();
  });
});
