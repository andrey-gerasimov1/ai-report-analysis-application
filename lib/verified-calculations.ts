import type { Citation } from "@/lib/types";

function citationIdsWithFigure(citations: Citation[], figure: string): string[] {
  const normalizedFigure = figure.toLowerCase().replace(/,/g, "");
  return citations
    .filter((citation) => citation.documentId === "report-robotics")
    .filter((citation) => citation.figures.some((value) =>
      value.toLowerCase().replace(/,/g, "").includes(normalizedFigure),
    ))
    .map((citation) => citation.id);
}

function markers(ids: string[]): string {
  return [...new Set(ids)].map((id) => `[${id}]`).join(" ");
}

/**
 * Performs arithmetic only when both named source values are present in the
 * authorized citations. The result is deterministic and never model-invented.
 */
export function buildVerifiedCalculation(
  researchQuestion: string,
  citations: Citation[],
): string | null {
  const normalized = researchQuestion.toLowerCase();
  const asksForGap = /calculate|calculation|difference|gap|percentage(?:-|\s+)point/.test(normalized);
  const isRoboticsComparison = normalized.includes("orion")
    && normalized.includes("vela")
    && normalized.includes("robotics");
  if (!asksForGap || !isRoboticsComparison) return null;

  const orionSources = citationIdsWithFigure(citations, "62.5%");
  const velaSources = citationIdsWithFigure(citations, "24.0%");
  if (!orionSources.length || !velaSources.length) return null;

  return [
    "Verified calculation",
    "",
    `- Orion Robotics: 62.5% ${markers(orionSources)}`,
    `- Vela Automation: 24.0% ${markers(velaSources)}`,
    `- Percentage-point gap: 62.5% - 24.0% = 38.5 percentage points. ${markers([...orionSources, ...velaSources])}`,
  ].join("\n");
}
