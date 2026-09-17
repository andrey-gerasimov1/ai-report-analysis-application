import "server-only";
import path from "node:path";
import {
  fallbackEvidenceAnchor,
  fallbackSectionAnchor,
  htmlElementAnchor,
  htmlHeadingAnchor,
  REPORT_START_ANCHOR,
  SOURCE_FOCUS_ANCHOR,
} from "@/lib/report-anchors";
import type { ReportDefinition } from "@/lib/types";

const VIEWER_STYLES = `
<style id="report-analysis-source-viewer-styles">
  html { scroll-behavior: auto !important; }
  body {
    width: 100%;
    padding-block: clamp(22px, 3vw, 34px) 80px !important;
    padding-inline: clamp(18px, 4vw, 42px) !important;
  }
  #${REPORT_START_ANCHOR} { display: block; height: 1px; }
  #${SOURCE_FOCUS_ANCHOR} { scroll-margin-top: 48px; }
  :target { scroll-margin-top: 28px; }
  [id]:target,
  h1:has([id]:target), h2:has([id]:target), h3:has([id]:target),
  h4:has([id]:target), h5:has([id]:target), h6:has([id]:target),
  p:has([id]:target), li:has([id]:target),
  td:has([id]:target), tr:has([id]:target) {
    background: #fff2ba !important;
    border-radius: 5px;
    outline: 4px solid rgba(235, 185, 55, 0.24);
    animation: report-analysis-source-pulse 1.25s ease-out 1;
  }
  mark#${SOURCE_FOCUS_ANCHOR} {
    padding: 0.08em 0.2em;
    color: inherit;
    background: #ffd866 !important;
    border-radius: 3px;
    box-decoration-break: clone;
  }
  a[href] { pointer-events: none !important; }
  @keyframes report-analysis-source-pulse {
    0% { outline-width: 12px; outline-color: rgba(235, 185, 55, 0.5); }
    100% { outline-width: 4px; outline-color: rgba(235, 185, 55, 0.24); }
  }
</style>`;

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function removeUnsafeMarkup(html: string): string {
  return html
    .replace(/<(script|noscript|iframe|object|embed|form)\b[^>]*>[\s\S]*?<\/\1\s*>/gi, "")
    .replace(/<(script|noscript|iframe|object|embed|form)\b[^>]*\/?>/gi, "")
    .replace(/<meta\b[^>]*http-equiv\s*=\s*(?:["']?refresh["']?)[^>]*>/gi, "")
    .replace(/<(?:base|link)\b[^>]*>/gi, "")
    .replace(/\s+on[a-z][a-z0-9_-]*\s*=\s*(?:"[^"]*"|'[^']*'|[^\s>]+)/gi, "")
    .replace(/\s+(?:srcdoc|formaction)\s*=\s*(?:"[^"]*"|'[^']*'|[^\s>]+)/gi, "")
    .replace(/\s+target\s*=\s*(?:"[^"]*"|'[^']*'|[^\s>]+)/gi, "")
    .replace(
      /\s+href\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s>]+))/gi,
      (_attribute, doubleQuoted: string, singleQuoted: string, bare: string) => {
        const value = doubleQuoted ?? singleQuoted ?? bare ?? "";
        return value.trim().startsWith("#") ? ` href="${escapeHtml(value.trim())}"` : "";
      },
    )
    .replace(
      /\s+src\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s>]+))/gi,
      (_attribute, doubleQuoted: string, singleQuoted: string, bare: string) => {
        const value = (doubleQuoted ?? singleQuoted ?? bare ?? "").trim();
        if (/^(?:https:\/\/|data:image\/)/i.test(value)) return ` src="${escapeHtml(value)}"`;
        return "";
      },
    );
}

type ReportViewLocation = {
  focusText?: string;
  fallbackAnchor?: string;
};

const MAX_FOCUSED_FRAGMENT_LENGTH = 160_000;

function tagId(tag: string): string | null {
  const match = tag.match(/\bid\s*=\s*(?:"([^"]+)"|'([^']+)'|([^\s>]+))/i);
  return match?.[1] ?? match?.[2] ?? match?.[3] ?? null;
}

function findAnchorTag(html: string, anchor?: string): { index: number; tag: string } | null {
  if (!anchor) return null;
  for (const match of html.matchAll(/<[a-z][a-z0-9:-]*\b[^>]*>/gi)) {
    if (tagId(match[0]) === anchor && match.index !== undefined) {
      return { index: match.index, tag: match[0] };
    }
  }
  return null;
}

function addExactSourceFocus(html: string, location: ReportViewLocation): string {
  const anchorTag = findAnchorTag(html, location.fallbackAnchor);
  const bodyTag = html.match(/<body\b[^>]*>/i);
  const bodyStart = bodyTag?.index ?? 0;
  const searchStart = anchorTag?.index ?? bodyStart;
  const searchEnd = Math.min(
    html.length,
    searchStart + (anchorTag ? 16_000 : MAX_FOCUSED_FRAGMENT_LENGTH),
  );
  const focusText = location.focusText?.trim();

  if (focusText) {
    const window = html.slice(searchStart, searchEnd);
    const parts = window.split(/(<[^>]+>)/g);
    const pattern = new RegExp(
      focusText
        .replace(/[.*+?^${}()|[\]\\]/g, "\\$&")
        .replace(/\s+/g, "\\s+"),
      "i",
    );
    for (let index = 0; index < parts.length; index += 2) {
      if (!pattern.test(parts[index])) continue;
      parts[index] = parts[index].replace(
        pattern,
        (match) => `<mark id="${SOURCE_FOCUS_ANCHOR}">${match}</mark>`,
      );
      return `${html.slice(0, searchStart)}${parts.join("")}${html.slice(searchEnd)}`;
    }
  }

  if (anchorTag) {
    const insertionPoint = anchorTag.index + anchorTag.tag.length;
    return `${html.slice(0, insertionPoint)}<span id="${SOURCE_FOCUS_ANCHOR}" aria-hidden="true"></span>${html.slice(insertionPoint)}`;
  }

  const insertionPoint = bodyStart + (bodyTag?.[0].length ?? 0);
  return `${html.slice(0, insertionPoint)}<span id="${SOURCE_FOCUS_ANCHOR}" aria-hidden="true"></span>${html.slice(insertionPoint)}`;
}

function prepareHtmlReport(content: string, location: ReportViewLocation): string {
  let safeHtml = removeUnsafeMarkup(content);
  let headingIndex = 0;

  safeHtml = safeHtml.replace(
    /<(h[1-6])\b([^>]*)>([\s\S]*?)<\/\1>/gi,
    (full, tag: string, attributes: string, innerHtml: string) => {
      headingIndex += 1;
      const anchor = htmlHeadingAnchor(attributes, innerHtml, headingIndex);
      const hasHeadingId = /\bid\s*=/i.test(attributes);
      const hasNestedId = /<[a-z][^>]*\bid\s*=/i.test(innerHtml);
      if (hasHeadingId || hasNestedId) return full;
      return `<${tag}${attributes} id="${escapeHtml(anchor)}">${innerHtml}</${tag}>`;
    },
  );

  let bodyIndex = 0;
  safeHtml = safeHtml.replace(
    /<(p|li|tr)\b([^>]*)>([\s\S]*?)<\/\1>/gi,
    (full, tag: string, attributes: string, innerHtml: string) => {
      bodyIndex += 1;
      const anchor = htmlElementAnchor(attributes, innerHtml, fallbackEvidenceAnchor(bodyIndex));
      const hasElementId = /\bid\s*=/i.test(attributes);
      const hasNestedId = /<[a-z][^>]*\bid\s*=/i.test(innerHtml);
      if (hasElementId || hasNestedId) return full;
      return `<${tag}${attributes} id="${escapeHtml(anchor)}">${innerHtml}</${tag}>`;
    },
  );

  const startMarker = `<span id="${REPORT_START_ANCHOR}" aria-hidden="true"></span>`;
  if (/<body\b[^>]*>/i.test(safeHtml)) {
    safeHtml = safeHtml.replace(/<body\b([^>]*)>/i, `<body$1>${startMarker}`);
  } else {
    safeHtml = `<body>${startMarker}${safeHtml}</body>`;
  }

  if (/<\/head\s*>/i.test(safeHtml)) {
    safeHtml = safeHtml.replace(/<\/head\s*>/i, `${VIEWER_STYLES}</head>`);
  } else if (/<html\b[^>]*>/i.test(safeHtml)) {
    safeHtml = safeHtml.replace(/<html\b([^>]*)>/i, `<html$1><head>${VIEWER_STYLES}</head>`);
  } else {
    safeHtml = `<!doctype html><html><head><meta charset="utf-8">${VIEWER_STYLES}</head>${safeHtml}</html>`;
  }

  return addExactSourceFocus(safeHtml, location);
}

function prepareTextReport(report: ReportDefinition, content: string, location: ReportViewLocation): string {
  const paragraphs = content.replace(/\r\n/g, "\n").split(/\n\s*\n/);
  let headingIndex = 0;
  let bodyIndex = 0;
  const body = paragraphs.map((paragraph) => {
    const trimmed = paragraph.trim();
    if (!trimmed) return "";
    const firstLine = trimmed.split("\n")[0];
    const markdownHeading = firstLine.match(/^(#{1,6})\s+/);
    const isHeading = Boolean(markdownHeading)
      || (firstLine.length < 100 && firstLine === firstLine.toUpperCase() && /[A-Z]/.test(firstLine));
    const text = trimmed.replace(/^#+\s*/m, "");
    if (isHeading) {
      headingIndex += 1;
      const level = markdownHeading?.[1].length ?? 2;
      return `<h${level} id="${fallbackSectionAnchor(headingIndex)}">${escapeHtml(text)}</h${level}>`;
    }
    bodyIndex += 1;
    return `<p id="${fallbackEvidenceAnchor(bodyIndex)}">${escapeHtml(text).replace(/\n/g, "<br>")}</p>`;
  }).join("\n");

  const html = `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>${escapeHtml(report.title)}</title>
  <style>
    body { max-width: 860px; margin: 0 auto; padding: 40px; color: #26332f; background: #fff; font: 16px/1.7 Arial, sans-serif; }
    h1, h2, h3, h4, h5, h6 { color: #17453e; line-height: 1.25; margin-top: 2em; }
    p { margin: 1em 0; }
  </style>
  ${VIEWER_STYLES}
</head>
<body><span id="${REPORT_START_ANCHOR}" aria-hidden="true"></span>${body}</body>
</html>`;
  return addExactSourceFocus(html, location);
}

function lastHeadingBefore(content: string, offset: number): string {
  const searchStart = Math.max(0, offset - 30_000);
  const nearby = content.slice(searchStart, offset);
  const headings = [...nearby.matchAll(/<h[1-6]\b[^>]*>[\s\S]*?<\/h[1-6]>/gi)];
  return headings.at(-1)?.[0] ?? "";
}

function sectionFragment(content: string, sourceOffset: number): string {
  const offset = Math.max(0, Math.min(sourceOffset, content.length - 1));
  const lowercase = content.toLowerCase();
  const tableStart = lowercase.lastIndexOf("<table", offset);
  const previousTableEnd = lowercase.lastIndexOf("</table>", offset);

  if (tableStart > previousTableEnd) {
    const tableEndStart = lowercase.indexOf("</table>", offset);
    if (tableEndStart >= 0) {
      const tableEnd = tableEndStart + "</table>".length;
      if (tableEnd - tableStart <= MAX_FOCUSED_FRAGMENT_LENGTH) {
        return `${lastHeadingBefore(content, tableStart)}${content.slice(tableStart, tableEnd)}`;
      }
    }
  }

  let previousHeadingStart = -1;
  let nextHeadingStart = -1;
  for (const match of content.matchAll(/<h[1-6]\b[^>]*>/gi)) {
    if (match.index === undefined) continue;
    if (match.index <= offset) previousHeadingStart = match.index;
    else {
      nextHeadingStart = match.index;
      break;
    }
  }
  const sectionStart = previousHeadingStart >= 0 ? previousHeadingStart : Math.max(0, offset - 8_000);
  const sectionEnd = nextHeadingStart >= 0 ? nextHeadingStart : Math.min(content.length, offset + 24_000);
  if (sectionEnd - sectionStart <= MAX_FOCUSED_FRAGMENT_LENGTH) {
    return content.slice(sectionStart, sectionEnd);
  }

  const windowStart = Math.max(0, offset - 12_000);
  const windowEnd = Math.min(content.length, offset + 32_000);
  const window = content.slice(windowStart, windowEnd);
  const blocks = [...window.matchAll(/<(h[1-6]|p|li|tr)\b[^>]*>[\s\S]*?<\/\1>/gi)];
  if (!blocks.length) return window;
  const relativeOffset = offset - windowStart;
  const closestIndex = blocks.reduce((best, match, index) => {
    const bestDistance = Math.abs((blocks[best].index ?? 0) - relativeOffset);
    const distance = Math.abs((match.index ?? 0) - relativeOffset);
    return distance < bestDistance ? index : best;
  }, 0);
  return blocks
    .slice(Math.max(0, closestIndex - 2), closestIndex + 5)
    .map((match) => match[0])
    .join("\n");
}

export function prepareFocusedReportForViewing(
  report: ReportDefinition,
  content: string,
  sourceOffset: number,
  location: ReportViewLocation = {},
): string {
  const extension = path.extname(report.filename).toLowerCase();
  if (extension !== ".html" && extension !== ".htm") {
    return prepareTextReport(report, content, location);
  }

  const headContent = content.match(/<head\b[^>]*>([\s\S]*?)<\/head>/i)?.[1] ?? "";
  const fragment = sectionFragment(content, sourceOffset);
  const focusedDocument = `<!doctype html><html lang="en"><head>${headContent}</head><body><main class="report-analysis-focused-excerpt">${fragment}</main></body></html>`;
  return prepareHtmlReport(focusedDocument, location);
}

export function prepareReportForViewing(
  report: ReportDefinition,
  content: string,
  location: ReportViewLocation = {},
): string {
  const extension = path.extname(report.filename).toLowerCase();
  return extension === ".html" || extension === ".htm"
    ? prepareHtmlReport(content, location)
    : prepareTextReport(report, content, location);
}
