import "server-only";
import { randomUUID } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { z } from "zod";
import { isReportAllowedForUser } from "@/lib/report-registry";
import type { ReportDefinition, ReportId, UserId } from "@/lib/types";

const PURCHASE_DIRECTORY = path.join(process.cwd(), ".data", "demo-purchases");

const PurchaseItemSchema = z.object({
  reportId: z.string().min(1),
  unitPriceCents: z.number().int().nonnegative(),
});

const PurchaseRecordSchema = z.object({
  id: z.string().uuid(),
  userId: z.enum(["alex", "jordan", "taylor"]),
  createdAt: z.string().datetime(),
  currency: z.literal("USD"),
  totalCents: z.number().int().nonnegative(),
  items: z.array(PurchaseItemSchema).min(1),
});

const PurchaseRecordsSchema = z.array(PurchaseRecordSchema);
type PurchaseRecord = z.infer<typeof PurchaseRecordSchema>;

declare global {
  // eslint-disable-next-line no-var
  var __reportAnalysisDemoPurchases: Map<UserId, PurchaseRecord[]> | undefined;
  // eslint-disable-next-line no-var
  var __reportAnalysisDemoPurchaseWrites: Map<UserId, Promise<void>> | undefined;
}

const testPurchases = globalThis.__reportAnalysisDemoPurchases ?? new Map<UserId, PurchaseRecord[]>();
const writeQueues = globalThis.__reportAnalysisDemoPurchaseWrites ?? new Map<UserId, Promise<void>>();
globalThis.__reportAnalysisDemoPurchases = testPurchases;
globalThis.__reportAnalysisDemoPurchaseWrites = writeQueues;

function purchasePath(userId: UserId): string {
  return path.join(PURCHASE_DIRECTORY, `${userId}.json`);
}

async function readPurchases(userId: UserId): Promise<PurchaseRecord[]> {
  if (process.env.NODE_ENV === "test") return testPurchases.get(userId) ?? [];

  try {
    const parsed = PurchaseRecordsSchema.safeParse(
      JSON.parse(await readFile(purchasePath(userId), "utf8")),
    );
    if (parsed.success) return parsed.data;
    console.warn("Ignored invalid simulated purchase history.", { userId });
  } catch (error) {
    const code = error && typeof error === "object" && "code" in error ? error.code : undefined;
    if (code !== "ENOENT") console.error("Could not read simulated purchases.", { userId, code });
  }
  return [];
}

async function writePurchases(userId: UserId, purchases: PurchaseRecord[]): Promise<void> {
  if (process.env.NODE_ENV === "test") {
    testPurchases.set(userId, purchases);
    return;
  }

  await mkdir(PURCHASE_DIRECTORY, { recursive: true });
  await writeFile(purchasePath(userId), JSON.stringify(purchases, null, 2), {
    encoding: "utf8",
    mode: 0o600,
  });
}

async function settledPurchases(userId: UserId): Promise<PurchaseRecord[]> {
  await writeQueues.get(userId)?.catch(() => undefined);
  return readPurchases(userId);
}

export async function listPurchasedReportIds(userId: UserId): Promise<Set<ReportId>> {
  const purchases = await settledPurchases(userId);
  return new Set(purchases.flatMap((purchase) => purchase.items.map((item) => item.reportId)));
}

export function hasEffectiveReportAccess(
  report: ReportDefinition,
  userId: UserId,
  purchasedReportIds: ReadonlySet<ReportId>,
): boolean {
  return isReportAllowedForUser(report, userId) || purchasedReportIds.has(report.id);
}

export async function recordDemoPurchase(input: {
  userId: UserId;
  items: Array<{ reportId: ReportId; unitPriceCents: number }>;
}): Promise<PurchaseRecord | null> {
  const previous = writeQueues.get(input.userId) ?? Promise.resolve();
  let created: PurchaseRecord | null = null;
  const next = previous.catch(() => undefined).then(async () => {
    const purchases = await readPurchases(input.userId);
    const owned = new Set(
      purchases.flatMap((purchase) => purchase.items.map((item) => item.reportId)),
    );
    const uniqueItems = [...new Map(
      input.items
        .filter((item) => !owned.has(item.reportId))
        .map((item) => [item.reportId, item]),
    ).values()];
    if (!uniqueItems.length) return;

    created = PurchaseRecordSchema.parse({
      id: randomUUID(),
      userId: input.userId,
      createdAt: new Date().toISOString(),
      currency: "USD",
      totalCents: uniqueItems.reduce((sum, item) => sum + item.unitPriceCents, 0),
      items: uniqueItems,
    });
    await writePurchases(input.userId, [created, ...purchases]);
  });
  writeQueues.set(input.userId, next);
  try {
    await next;
  } finally {
    if (writeQueues.get(input.userId) === next) writeQueues.delete(input.userId);
  }
  return created;
}
