import type { Citation } from "@/lib/types";

export type EvidenceTarget = {
  citation: Citation;
  focusText?: string;
};

export function answerFigures(value: string): string[] {
  return value.match(
    /(?:[$€£¥]\s*\d[\d,.]*(?:\s*(?:million|billion|trillion))?|\b\d[\d,.]*\s*(?:%|percentage(?:-|\s+)points?|million|billion|trillion|CAGR)?)/gi,
  ) ?? [];
}

export function sameFigure(answerFigure: string, sourceFigure: string): boolean {
  const answerNumber = answerFigure.match(/\d[\d,.]*/)?.[0].replace(/,/g, "");
  const sourceNumber = sourceFigure.match(/\d[\d,.]*/)?.[0].replace(/,/g, "");
  if (!answerNumber || !sourceNumber || Number(answerNumber) !== Number(sourceNumber)) return false;
  if (answerFigure.includes("%") && !sourceFigure.includes("%")) return false;
  const answerCurrency = answerFigure.match(/[$€£¥]/)?.[0];
  const sourceCurrency = sourceFigure.match(/[$€£¥]/)?.[0];
  return !answerCurrency || answerCurrency === sourceCurrency;
}

export function figureEvidenceTargets(
  answerFigure: string,
  line: string,
  citations: Citation[],
): EvidenceTarget[] {
  const targetsFor = (figure: string) => citations.flatMap((citation) => {
    const sourceFigures = citation.figures?.length ? citation.figures : answerFigures(citation.excerpt);
    return sourceFigures
      .filter((sourceFigure) => sameFigure(figure, sourceFigure))
      .map((focusText) => ({ citation, focusText }));
  });
  const uniqueTargets = (targets: EvidenceTarget[]) => [...new Map(
    targets.map((target) => [
      `${target.citation.id}:${target.focusText?.toLowerCase()}`,
      target,
    ]),
  ).values()];

  const direct = uniqueTargets(targetsFor(answerFigure));
  if (direct.length) return direct;

  const inputs = answerFigures(line).filter((figure) => {
    if (figure === answerFigure || sameFigure(answerFigure, figure)) return false;
    return /[$€£¥%]|million|billion|trillion|CAGR/i.test(figure);
  });
  return uniqueTargets(inputs.flatMap(targetsFor)).slice(0, 8);
}
