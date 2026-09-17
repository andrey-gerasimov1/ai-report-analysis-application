export const REPORT_START_ANCHOR = "report-analysis-report-start";
export const SOURCE_FOCUS_ANCHOR = "report-analysis-source-focus";

export function fallbackSectionAnchor(index: number): string {
  return `report-analysis-section-${index}`;
}

export function fallbackEvidenceAnchor(index: number): string {
  return `report-analysis-evidence-${index}`;
}

function idFromAttributes(attributes: string): string | null {
  const match = attributes.match(/\bid\s*=\s*(?:"([^"]+)"|'([^']+)'|([^\s>]+))/i);
  return match?.[1] ?? match?.[2] ?? match?.[3] ?? null;
}

export function htmlElementAnchor(
  attributes: string,
  innerHtml: string,
  fallback: string,
): string {
  const headingId = idFromAttributes(attributes);
  if (headingId) return headingId;

  for (const element of innerHtml.matchAll(/<[a-z][a-z0-9:-]*\b([^>]*)>/gi)) {
    const nestedId = idFromAttributes(element[1]);
    if (nestedId) return nestedId;
  }

  return fallback;
}

export function htmlHeadingAnchor(
  attributes: string,
  innerHtml: string,
  headingIndex: number,
): string {
  return htmlElementAnchor(attributes, innerHtml, fallbackSectionAnchor(headingIndex));
}
