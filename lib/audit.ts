import "server-only";
import { appendFile, mkdir, readFile } from "node:fs/promises";
import path from "node:path";
import type { AuditEvent, UserId } from "@/lib/types";

declare global {
  // eslint-disable-next-line no-var
  var __reportAnalysisAuditEvents: AuditEvent[] | undefined;
}

const auditEvents = globalThis.__reportAnalysisAuditEvents ?? [];
globalThis.__reportAnalysisAuditEvents = auditEvents;
const AUDIT_DIRECTORY = path.join(process.cwd(), ".data");
const AUDIT_PATH = process.env.AUDIT_LOG_PATH
  ? path.resolve(process.env.AUDIT_LOG_PATH)
  : path.join(AUDIT_DIRECTORY, "report-analysis-audit-events.jsonl");

function isAuditEvent(value: unknown): value is AuditEvent {
  if (!value || typeof value !== "object") return false;
  const event = value as Partial<AuditEvent>;
  return typeof event.id === "string"
    && typeof event.timestamp === "string"
    && typeof event.userId === "string"
    && typeof event.question === "string"
    && Array.isArray(event.searchedReports)
    && Array.isArray(event.blockedReports)
    && typeof event.citationCount === "number"
    && typeof event.mode === "string"
    && typeof event.reasonCode === "string";
}

async function persistedEvents(): Promise<AuditEvent[]> {
  try {
    const content = await readFile(AUDIT_PATH, "utf8");
    return content
      .split(/\r?\n/)
      .filter(Boolean)
      .map((line) => {
        try {
          return JSON.parse(line) as unknown;
        } catch {
          return null;
        }
      })
      .filter(isAuditEvent)
      .reverse()
      .slice(0, 40);
  } catch (error) {
    const code = error && typeof error === "object" && "code" in error ? error.code : undefined;
    if (code !== "ENOENT") console.error("Could not read the audit log.", { code });
    return [];
  }
}

export async function appendAuditEvent(event: Omit<AuditEvent, "id" | "timestamp">): Promise<AuditEvent> {
  const stored: AuditEvent = {
    ...event,
    id: `AUD-${Date.now().toString(36).toUpperCase()}-${Math.random().toString(36).slice(2, 6).toUpperCase()}`,
    timestamp: new Date().toISOString(),
  };

  if (process.env.NODE_ENV === "test") {
    auditEvents.unshift(stored);
    auditEvents.splice(40);
  } else {
    await mkdir(path.dirname(AUDIT_PATH), { recursive: true });
    await appendFile(AUDIT_PATH, `${JSON.stringify(stored)}\n`, { encoding: "utf8", mode: 0o600 });
  }
  return stored;
}

export async function getAuditEvents(userId?: UserId): Promise<AuditEvent[]> {
  const events = process.env.NODE_ENV === "test" ? auditEvents : await persistedEvents();
  return userId ? events.filter((event) => event.userId === userId) : events;
}
