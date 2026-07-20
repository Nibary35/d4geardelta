import { NextRequest, NextResponse } from "next/server";

const D4BUILDS_BASE_URL = "https://d4builds.gg";
const FIRESTORE_BUILD_URL =
  "https://firestore.googleapis.com/v1/projects/d4builds-a3254/databases/(default)/documents/builds/";

type AnyRecord = Record<string, unknown>;

type ImportedGearSlot = {
  slot: string;
  target: string;
  kind: string;
  affixes: string[];
  tempers: string[];
  gems: string[];
};

type ImportedVariant = {
  name: string;
  className: string;
  season: number;
  skills: string[];
  gearSlots: ImportedGearSlot[];
  affixTargets: string[];
  aspectTargets: string[];
};

type ImportedBuild = {
  sourceUrl: string;
  pageTitle: string;
  documentId: string;
  name: string;
  className: string;
  season: number;
  lastUpdated: string;
  selectedVariantIndex: number;
  variants: ImportedVariant[];
  notesExcerpt: string;
};

export const runtime = "edge";
export const dynamic = "force-dynamic";

export async function GET(request: NextRequest) {
  const url = request.nextUrl.searchParams.get("url")?.trim();

  if (!url) {
    return NextResponse.json({ error: "Paste a D4Builds URL first." }, { status: 400 });
  }

  try {
    const build = await importD4BuildsUrl(url);
    return NextResponse.json(build, {
      headers: {
        "Cache-Control": "s-maxage=900, stale-while-revalidate=3600",
      },
    });
  } catch (error) {
    return NextResponse.json({ error: errorMessage(error) }, { status: 400 });
  }
}

async function importD4BuildsUrl(url: string): Promise<ImportedBuild> {
  const { slug, requestedVariant } = parseD4BuildsUrl(url);
  const pageData = await fetchJson(pageDataUrl(slug));
  const context = getRecord(getRecord(pageData, "result"), "pageContext");
  const documentId = getString(context, "seoId", slug);
  const pageTitle = getString(context, "seoName", `D4Builds ${slug}`);

  const document = await fetchJson(`${FIRESTORE_BUILD_URL}${encodeURIComponent(documentId)}`);
  const fields = getRecord(document, "fields");
  if (!Object.keys(fields).length) {
    throw new Error("D4Builds did not return a readable build document.");
  }

  const build: AnyRecord = {};
  for (const [key, value] of Object.entries(fields)) {
    build[key] = firestoreValueToNative(value);
  }

  const variants = extractVariants(build);
  if (!variants.length) {
    throw new Error("The imported build did not include gear or variant data.");
  }

  const selectedVariantIndex =
    requestedVariant === null
      ? 0
      : Math.max(0, Math.min(requestedVariant, variants.length - 1));
  const selected = variants[selectedVariantIndex];

  return {
    sourceUrl: url,
    pageTitle,
    documentId,
    name: getString(build, "name", pageTitle),
    className: getString(build, "class", selected.className),
    season: getNumber(build, "season", selected.season),
    lastUpdated: getString(build, "lastUpdated", ""),
    selectedVariantIndex,
    variants,
    notesExcerpt: notesExcerpt(getString(build, "notes", "")),
  };
}

function parseD4BuildsUrl(value: string): { slug: string; requestedVariant: number | null } {
  const trimmed = value.trim();
  let parsed: URL;

  try {
    parsed = new URL(
      /^https?:\/\//i.test(trimmed)
        ? trimmed
        : `${D4BUILDS_BASE_URL}/${trimmed.replace(/^\/+/, "")}`,
    );
  } catch {
    throw new Error("Paste a D4Builds URL like https://d4builds.gg/builds/...");
  }

  const host = parsed.hostname.toLowerCase();
  if (host !== "d4builds.gg" && host !== "www.d4builds.gg") {
    throw new Error("Only d4builds.gg build URLs are supported.");
  }

  const match = parsed.pathname.match(/\/builds\/([^/]+)\/?/);
  if (!match) {
    throw new Error("Paste a D4Builds URL like https://d4builds.gg/builds/...");
  }

  const variantParam = parsed.searchParams.get("var");
  const parsedVariant = variantParam === null ? Number.NaN : Number.parseInt(variantParam, 10);

  return {
    slug: match[1],
    requestedVariant: Number.isFinite(parsedVariant) ? parsedVariant : null,
  };
}

function pageDataUrl(slug: string): string {
  return `${D4BUILDS_BASE_URL}/page-data/builds/${encodeURIComponent(slug)}/page-data.json`;
}

async function fetchJson(url: string): Promise<AnyRecord> {
  const response = await fetch(url, {
    headers: {
      accept: "application/json",
      "user-agent": "D4 Gear Delta Web/0.1",
    },
  });

  if (!response.ok) {
    throw new Error(`Import request failed with HTTP ${response.status}.`);
  }

  const data = await response.json();
  if (!isRecord(data)) {
    throw new Error("Import response was not JSON.");
  }
  return data;
}

function firestoreValueToNative(value: unknown): unknown {
  if (!isRecord(value)) {
    return value;
  }

  if ("nullValue" in value) {
    return null;
  }
  if ("stringValue" in value) {
    return value.stringValue;
  }
  if ("integerValue" in value) {
    return Number(value.integerValue);
  }
  if ("doubleValue" in value) {
    return Number(value.doubleValue);
  }
  if ("booleanValue" in value) {
    return Boolean(value.booleanValue);
  }
  if (isRecord(value.arrayValue)) {
    const values = value.arrayValue.values;
    return Array.isArray(values) ? values.map(firestoreValueToNative) : [];
  }
  if (isRecord(value.mapValue)) {
    const fields = getRecord(value.mapValue, "fields");
    const result: AnyRecord = {};
    for (const [key, item] of Object.entries(fields)) {
      result[key] = firestoreValueToNative(item);
    }
    return result;
  }

  return value;
}

function extractVariants(build: AnyRecord): ImportedVariant[] {
  const variants = [extractVariant(build, getString(build, "variantName", "Base Build"))];

  getArray(build.variants).forEach((variant, index) => {
    if (isRecord(variant)) {
      variants.push(
        extractVariant(variant, getString(variant, "variantName", `Variant ${index + 1}`), build),
      );
    }
  });

  return variants.filter(
    (variant) =>
      variant.gearSlots.length > 0 ||
      variant.affixTargets.length > 0 ||
      variant.aspectTargets.length > 0,
  );
}

function extractVariant(source: AnyRecord, name: string, parent: AnyRecord = {}): ImportedVariant {
  const className = getString(source, "class", getString(parent, "class", ""));
  const season = getNumber(source, "season", getNumber(parent, "season", 0));
  const skills = cleanList(source.skills);

  const gear = mergeMapping(parent.gear, source.gear);
  const newStats = mergeMapping(parent.newStats, source.newStats);
  const oldStats = mergeMapping(parent.stats, source.stats);
  const tempers = mergeMapping(parent.temperingStats, source.temperingStats);
  const newGems = mergeMapping(parent.newGems, source.newGems);

  const gearSlots: ImportedGearSlot[] = [];
  const affixTargets: string[] = [];
  const aspectTargets: string[] = [];

  for (const slot of Object.keys(gear).sort((a, b) => a.localeCompare(b))) {
    const target = gear[slot];
    if (!target) {
      continue;
    }

    const targetText = String(target);
    const affixes = cleanList(newStats[slot] ?? oldStats[slot]);
    const temperValues = cleanList(tempers[slot]);
    const gemValues = cleanList(newGems[slot]);
    const kind = aspectKind(targetText);

    if (["Aspect", "Unique", "Mythic", "Item"].includes(kind)) {
      appendUnique(aspectTargets, targetText);
    }
    for (const affix of [...affixes, ...temperValues]) {
      appendUnique(affixTargets, cleanAffixName(affix));
    }

    gearSlots.push({
      slot,
      target: targetText,
      kind,
      affixes,
      tempers: temperValues,
      gems: gemValues,
    });
  }

  return {
    name,
    className,
    season,
    skills,
    gearSlots,
    affixTargets,
    aspectTargets,
  };
}

function mergeMapping(base: unknown, override: unknown): AnyRecord {
  const result = isRecord(base) ? { ...base } : {};
  if (isRecord(override)) {
    Object.assign(result, override);
  }
  return result;
}

function cleanList(value: unknown): string[] {
  if (!Array.isArray(value)) {
    return [];
  }
  return value.map((item) => String(item).trim()).filter(Boolean);
}

function appendUnique(values: string[], value: string): void {
  const cleaned = value.trim();
  if (cleaned && !values.includes(cleaned)) {
    values.push(cleaned);
  }
}

function cleanAffixName(value: string): string {
  return value.replace(/\s+\([^)]+\)$/g, "").trim();
}

function aspectKind(name: string): string {
  const lowered = name.toLowerCase();
  if (lowered.includes("mythic")) {
    return "Mythic";
  }
  if (lowered.includes("aspect")) {
    return "Aspect";
  }
  return name ? "Unique" : "Item";
}

function notesExcerpt(notes: string): string {
  const cleaned = notes
    .replace(/[*_~`#>-]+/g, "")
    .replace(/\n{2,}/g, "\n")
    .trim();
  if (cleaned.length <= 900) {
    return cleaned;
  }
  return `${cleaned.slice(0, 900).replace(/\s+\S*$/g, "")}...`;
}

function getString(source: AnyRecord, key: string, fallback = ""): string {
  const value = source[key];
  return value === undefined || value === null || value === "" ? fallback : String(value);
}

function getNumber(source: AnyRecord, key: string, fallback = 0): number {
  const value = Number(source[key] ?? fallback);
  return Number.isFinite(value) ? value : fallback;
}

function getRecord(source: unknown, key: string): AnyRecord {
  if (!isRecord(source)) {
    return {};
  }
  const value = source[key];
  return isRecord(value) ? value : {};
}

function getArray(value: unknown): unknown[] {
  return Array.isArray(value) ? value : [];
}

function isRecord(value: unknown): value is AnyRecord {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : "Import failed.";
}
