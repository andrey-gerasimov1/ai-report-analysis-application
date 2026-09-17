import "server-only";
import { createHash } from "node:crypto";
import { readFile, readdir, stat } from "node:fs/promises";
import path from "node:path";
import { z } from "zod";
import type { AuthorizedReport, ReportDefinition, UserId } from "@/lib/types";

export const REPORTS_DIRECTORY = path.join(process.cwd(), "data", "reports");
const CONFIG_PATH = path.join(process.cwd(), "data", "reports.config.json");
const SUPPORTED_EXTENSIONS = new Set([".html", ".htm", ".md", ".markdown", ".txt"]);

const UserIdSchema = z.enum(["alex", "jordan", "taylor"]);
const ReportMetadataSchema = z.object({
  id: z.string().min(1).optional(),
  code: z.string().min(1).optional(),
  title: z.string().min(1).optional(),
  shortTitle: z.string().min(1).optional(),
  published: z.string().min(1).optional(),
  geography: z.string().min(1).optional(),
  category: z.string().min(1).optional(),
  description: z.string().min(1).optional(),
  priceCents: z.number().int().positive().optional(),
  color: z.enum(["teal", "coral"]).optional(),
  keywords: z.array(z.string().min(1)).optional(),
  allowedUsers: z.array(UserIdSchema).optional(),
});
const RegistryConfigSchema = z.object({
  defaults: ReportMetadataSchema.optional(),
  reports: z.record(z.string(), ReportMetadataSchema).default({}),
});

type RegistryConfig = z.infer<typeof RegistryConfigSchema>;
type MetadataCacheEntry = { version: string; report: ReportDefinition };
const metadataCache = new Map<string, MetadataCacheEntry>();

function titleFromFilename(filename: string): string {
  return path.basename(filename, path.extname(filename))
    .replace(/[-_]+/g, " ")
    .replace(/\b\w/g, (letter) => letter.toUpperCase());
}

function stableId(filename: string): string {
  const slug = path.basename(filename, path.extname(filename))
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "")
    .slice(0, 42) || "document";
  const suffix = createHash("sha1").update(filename.toLowerCase()).digest("hex").slice(0, 6);
  return `report-${slug}-${suffix}`;
}

function inferredKeywords(metadata: string): string[] {
  return [...new Set(metadata
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .split(/\s+/)
    .filter((word) => word.length > 3))]
    .slice(0, 40);
}

function formatBytes(bytes: number): string {
  if (bytes < 1_024) return `${bytes} B`;
  if (bytes < 1_048_576) return `${Math.round(bytes / 1_024)} KB`;
  return `${(bytes / 1_048_576).toFixed(1)} MB`;
}

async function loadConfig(): Promise<RegistryConfig> {
  try {
    const value = JSON.parse(await readFile(CONFIG_PATH, "utf8"));
    const parsed = RegistryConfigSchema.safeParse(value);
    if (parsed.success) return parsed.data;
    console.warn("Ignoring invalid data/reports.config.json", parsed.error.issues);
  } catch (error) {
    const code = error && typeof error === "object" && "code" in error ? error.code : undefined;
    if (code !== "ENOENT") console.warn("Could not read data/reports.config.json", error);
  }
  return { reports: {}, defaults: { allowedUsers: ["alex"] } };
}

export async function listReports(): Promise<ReportDefinition[]> {
  const config = await loadConfig();
  const entries = await readdir(REPORTS_DIRECTORY, { withFileTypes: true });
  const filenames = entries
    .filter((entry) =>
      entry.isFile()
      && !entry.name.startsWith(".")
      && !entry.name.startsWith("_")
      && !entry.name.toLowerCase().startsWith("readme.")
      && SUPPORTED_EXTENSIONS.has(path.extname(entry.name).toLowerCase()),
    )
    .map((entry) => entry.name)
    .sort((a, b) => a.localeCompare(b));

  const registeredFilenames = filenames.filter((filename) => Boolean(config.reports[filename]));
  const reports = await Promise.all(registeredFilenames.map(async (filename, index) => {
    const filePath = path.join(REPORTS_DIRECTORY, filename);
    const fileStat = await stat(filePath);
    const configured = config.reports[filename] ?? {};
    const version = `${fileStat.size}:${fileStat.mtimeMs}:${index}:${JSON.stringify(config.defaults)}:${JSON.stringify(configured)}`;
    const cached = metadataCache.get(filename);
    if (cached?.version === version) return cached.report;

    const defaults = config.defaults ?? {};
    const title = configured.title ?? titleFromFilename(filename);
    const baseName = path.basename(filename, path.extname(filename));
    const shortTitle = configured.shortTitle ?? (title.length > 52 ? `${title.slice(0, 49).trim()}…` : title);
    const description = configured.description ?? defaults.description ?? "A registered report available to the research assistant.";
    const geography = configured.geography ?? defaults.geography ?? "Custom";
    const category = configured.category ?? defaults.category ?? "Imported report";
    const report: ReportDefinition = {
      id: configured.id ?? stableId(filename),
      code: configured.code ?? `LOCAL-${baseName.replace(/[^a-z0-9]/gi, "-").toUpperCase().slice(0, 18)}`,
      title,
      shortTitle,
      filename,
      published: configured.published ?? title.match(/\b(?:19|20)\d{2}\b/)?.[0] ?? "Local",
      geography,
      category,
      size: formatBytes(fileStat.size),
      color: configured.color ?? (index % 2 === 0 ? "teal" : "coral"),
      description,
      priceCents: configured.priceCents ?? defaults.priceCents ?? 19_900,
      currency: "USD",
      keywords: configured.keywords ?? inferredKeywords([
        filename,
        title,
        shortTitle,
        description,
        geography,
        category,
      ].join(" ")),
      allowedUsers: configured.allowedUsers ?? defaults.allowedUsers ?? ["alex"],
      version,
    };
    metadataCache.set(filename, { version, report });
    return report;
  }));

  const currentFiles = new Set(registeredFilenames);
  for (const filename of metadataCache.keys()) {
    if (!currentFiles.has(filename)) metadataCache.delete(filename);
  }
  const seenIds = new Set<string>();
  for (const report of reports) {
    if (seenIds.has(report.id)) {
      throw new Error(`Duplicate report id "${report.id}". Give each configured report a unique id.`);
    }
    seenIds.add(report.id);
  }
  return reports;
}

export async function listQuarantinedReportFiles(): Promise<string[]> {
  const config = await loadConfig();
  const entries = await readdir(REPORTS_DIRECTORY, { withFileTypes: true });
  return entries
    .filter((entry) =>
      entry.isFile()
      && !entry.name.startsWith(".")
      && !entry.name.startsWith("_")
      && !entry.name.toLowerCase().startsWith("readme.")
      && SUPPORTED_EXTENSIONS.has(path.extname(entry.name).toLowerCase())
      && !config.reports[entry.name],
    )
    .map((entry) => entry.name)
    .sort((a, b) => a.localeCompare(b));
}

export function isReportAllowedForUser(report: ReportDefinition, userId: UserId): boolean {
  return report.allowedUsers.includes(userId);
}

export async function readReportFile(report: AuthorizedReport): Promise<string> {
  const resolvedDirectory = path.resolve(REPORTS_DIRECTORY);
  const resolvedFile = path.resolve(REPORTS_DIRECTORY, report.filename);
  if (!resolvedFile.startsWith(`${resolvedDirectory}${path.sep}`)) {
    throw new Error("Refusing to read a report outside the configured report directory.");
  }
  return readFile(resolvedFile, "utf8");
}
