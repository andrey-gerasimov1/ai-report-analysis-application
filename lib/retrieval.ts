import "server-only";
import path from "node:path";
import { readReportFile } from "@/lib/report-registry";
import {
  fallbackEvidenceAnchor,
  fallbackSectionAnchor,
  htmlElementAnchor,
  htmlHeadingAnchor,
  REPORT_START_ANCHOR,
} from "@/lib/report-anchors";
import type { AuthorizedReport, ReportDefinition, RetrievedChunk } from "@/lib/types";

const chunkCache = new Map<string, RetrievedChunk[]>();

const STOP_WORDS = new Set([
  "about",
  "across",
  "after",
  "also",
  "and",
  "are",
  "both",
  "can",
  "compare",
  "could",
  "does",
  "for",
  "from",
  "have",
  "how",
  "into",
  "licensed",
  "main",
  "market",
  "more",
  "report",
  "reports",
  "show",
  "that",
  "the",
  "their",
  "these",
  "this",
  "what",
  "when",
  "which",
  "while",
  "with",
]);

const HTML_ENTITIES: Record<string, string> = {
  amp: "&",
  apos: "'",
  gt: ">",
  hellip: "…",
  ldquo: "“",
  lsquo: "‘",
  lt: "<",
  mdash: "—",
  nbsp: " ",
  ndash: "–",
  quot: '"',
  rdquo: "”",
  reg: "®",
  rsquo: "’",
  trade: "™",
};

function decodeHtml(value: string): string {
  return value
    .replace(/&#x([0-9a-f]+);/gi, (_, code: string) =>
      String.fromCodePoint(Number.parseInt(code, 16)),
    )
    .replace(/&#(\d+);/g, (_, code: string) =>
      String.fromCodePoint(Number.parseInt(code, 10)),
    )
    .replace(/&([a-z]+);/gi, (entity, name: string) => HTML_ENTITIES[name.toLowerCase()] ?? entity);
}

function cleanHtmlFragment(fragment: string): string {
  return decodeHtml(
    fragment
      .replace(/<br\s*\/?>/gi, " ")
      .replace(/<[^>]+>/g, " ")
      .replace(/\s+/g, " ")
      .trim(),
  );
}

function assembleChunks(
  report: ReportDefinition,
  blocks: { kind: "heading" | "body"; text: string; anchor?: string; sourceOffset?: number }[],
): RetrievedChunk[] {
  const chunks: RetrievedChunk[] = [];
  let section = "Report overview";
  let sectionAnchor = REPORT_START_ANCHOR;
  let buffer: string[] = [];
  let bufferLength = 0;
  let bufferAnchor: string | null = null;
  let bufferSourceOffset: number | null = null;

  const flush = () => {
    const text = buffer.join(" ").replace(/\s+/g, " ").trim();
    if (text.length >= 30) {
      chunks.push({
        documentId: report.id,
        title: report.title,
        shortTitle: report.shortTitle,
        code: report.code,
        section,
        anchor: bufferAnchor ?? sectionAnchor,
        sourceOffset: bufferSourceOffset,
        text,
        score: 0,
      });
    }
    buffer = [];
    bufferLength = 0;
    bufferAnchor = null;
    bufferSourceOffset = null;
  };

  for (const block of blocks) {
    if (block.kind === "heading") {
      flush();
      section = block.text.replace(/^\d+(?:\.\d+)*\s*/, "").trim() || section;
      sectionAnchor = block.anchor ?? sectionAnchor;
      continue;
    }

    if (block.text.length < 18) continue;
    let remaining = block.text;
    while (remaining.length > 1_600) {
      const splitAt = Math.max(800, remaining.lastIndexOf(" ", 1_600));
      const segment = remaining.slice(0, splitAt).trim();
      if (bufferLength + segment.length > 1_700) flush();
      if (!buffer.length) {
        bufferAnchor = block.anchor ?? sectionAnchor;
        bufferSourceOffset = block.sourceOffset ?? null;
      }
      buffer.push(segment);
      bufferLength += segment.length;
      flush();
      remaining = remaining.slice(splitAt).trim();
    }
    if (bufferLength + remaining.length > 1_700) flush();
    if (!buffer.length) {
      bufferAnchor = block.anchor ?? sectionAnchor;
      bufferSourceOffset = block.sourceOffset ?? null;
    }
    buffer.push(remaining);
    bufferLength += remaining.length;
  }
  flush();

  return chunks;
}

function createHtmlChunks(report: ReportDefinition, html: string): RetrievedChunk[] {
  const blocks: { kind: "heading" | "body"; text: string; anchor?: string; sourceOffset?: number }[] = [];
  const blockPattern = /<(h[1-6]|p|li|tr)\b([^>]*)>([\s\S]*?)<\/\1>/gi;
  let headingIndex = 0;
  let bodyIndex = 0;

  for (const match of html.matchAll(blockPattern)) {
    const isHeading = match[1].startsWith("h");
    if (isHeading) headingIndex += 1;
    else bodyIndex += 1;
    const text = cleanHtmlFragment(match[3]);
    if (text.length < 2) continue;
    blocks.push({
      kind: isHeading ? "heading" : "body",
      text,
      anchor: isHeading
        ? htmlHeadingAnchor(match[2], match[3], headingIndex)
        : htmlElementAnchor(match[2], match[3], fallbackEvidenceAnchor(bodyIndex)),
      sourceOffset: match.index,
    });
  }
  return assembleChunks(report, blocks);
}

function createTextChunks(report: ReportDefinition, content: string): RetrievedChunk[] {
  const blocks: { kind: "heading" | "body"; text: string; anchor?: string; sourceOffset?: number }[] = [];
  const paragraphs = content.replace(/\r\n/g, "\n").split(/\n\s*\n/);
  let headingIndex = 0;
  let bodyIndex = 0;
  for (const paragraph of paragraphs) {
    const text = paragraph.replace(/^#+\s*/m, "").replace(/\s+/g, " ").trim();
    if (text.length < 2) continue;
    const firstLine = paragraph.trim().split("\n")[0];
    const isHeading = /^#{1,6}\s+/.test(firstLine)
      || (firstLine.length < 100 && firstLine === firstLine.toUpperCase() && /[A-Z]/.test(firstLine));
    if (isHeading) headingIndex += 1;
    else bodyIndex += 1;
    blocks.push({
      kind: isHeading ? "heading" : "body",
      text,
      anchor: isHeading ? fallbackSectionAnchor(headingIndex) : fallbackEvidenceAnchor(bodyIndex),
      sourceOffset: undefined,
    });
  }
  return assembleChunks(report, blocks);
}

async function getReportChunks(report: AuthorizedReport): Promise<RetrievedChunk[]> {
  const cacheKey = `${report.id}:${report.version}`;
  const cached = chunkCache.get(cacheKey);
  if (cached) return cached;

  const content = await readReportFile(report);
  const extension = path.extname(report.filename).toLowerCase();
  const chunks = extension === ".html" || extension === ".htm"
    ? createHtmlChunks(report, content)
    : createTextChunks(report, content);
  for (const key of chunkCache.keys()) {
    if (key.startsWith(`${report.id}:`) && key !== cacheKey) chunkCache.delete(key);
  }
  chunkCache.set(cacheKey, chunks);
  return chunks;
}

function queryTerms(question: string): string[] {
  return [...new Set(
    question
      .toLowerCase()
      .replace(/[^a-z0-9%$.-]+/g, " ")
      .split(/\s+/)
      .filter((term) => term.length > 2 && !STOP_WORDS.has(term)),
  )];
}

function scoreChunk(chunk: RetrievedChunk, terms: string[]): number {
  const section = chunk.section.toLowerCase();
  const text = chunk.text.toLowerCase();
  let score = 0;

  for (const term of terms) {
    const root = term.replace(/(ing|ed|es|s)$/i, "");
    const needle = root.length >= 4 ? root : term;
    if (section.includes(needle)) score += 5;
    if (text.includes(needle)) {
      const occurrences = text.split(needle).length - 1;
      score += Math.min(occurrences, 5) * 1.6;
    }
  }

  if (/\$|%|cagr|forecast|share/i.test(chunk.text)) score += 0.6;
  return Number(score.toFixed(1));
}

export async function retrieveEvidence(
  reports: AuthorizedReport[],
  question: string,
  perReport = 6,
): Promise<{ chunks: RetrievedChunk[]; scannedCount: number }> {
  const terms = queryTerms(question);
  const grouped = await Promise.all(
    reports.map(async (report) => {
      const chunks = await getReportChunks(report);
      const ranked = chunks
        .map((chunk) => ({ ...chunk, score: scoreChunk(chunk, terms) }))
        .filter((chunk) => chunk.score > 0)
        .sort((a, b) => b.score - a.score)
        .slice(0, perReport);
      return { ranked, count: chunks.length };
    }),
  );

  return {
    chunks: grouped
      .flatMap(({ ranked }) => ranked)
      .sort((a, b) => b.score - a.score),
    scannedCount: grouped.reduce((total, item) => total + item.count, 0),
  };
}

export function clearRetrievalCache() {
  chunkCache.clear();
}
