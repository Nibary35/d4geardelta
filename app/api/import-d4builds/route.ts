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
  sourceName: string;
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

const MAXROLL_SLOT_LABELS: Record<string, string> = {
  "4": "Helm",
  "5": "Chest Armor",
  "10": "Weapon",
  "11": "Dual-Wield 1",
  "12": "Dual-Wield 2",
  "13": "Gloves",
  "14": "Pants",
  "15": "Boots",
  "16": "Ring 1",
  "17": "Ring 2",
  "18": "Amulet",
  "20": "Seal",
  "21": "Charm 1",
  "22": "Charm 2",
  "23": "Charm 3",
  "24": "Charm 4",
  "25": "Charm 5",
  "26": "Charm 6",
};

export const runtime = "edge";
export const dynamic = "force-dynamic";

export async function GET(request: NextRequest) {
  const url = request.nextUrl.searchParams.get("url")?.trim();

  if (!url) {
    return NextResponse.json(
      { error: "Paste a D4Builds, Maxroll planner, or Mobalytics URL first." },
      { status: 400 },
    );
  }

  try {
    const build = await importBuildUrl(url);
    return NextResponse.json(build, {
      headers: {
        "Cache-Control": "s-maxage=900, stale-while-revalidate=3600",
      },
    });
  } catch (error) {
    return NextResponse.json({ error: errorMessage(error) }, { status: 400 });
  }
}

async function importBuildUrl(value: string): Promise<ImportedBuild> {
  const parsed = parseLooseUrl(value);
  const host = parsed ? normalizedHost(parsed.hostname) : "";

  if (host === "d4builds.gg" || !host) {
    return importD4BuildsUrl(value);
  }
  if (host === "maxroll.gg" && parsed) {
    return importMaxrollPlannerUrl(parsed.toString());
  }
  if (host === "mobalytics.gg") {
    return importMobalyticsUrl();
  }

  throw new Error("Supported build sources are D4Builds, Maxroll planners, and Mobalytics guides.");
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

  const variants = extractD4BuildsVariants(build);
  if (!variants.length) {
    throw new Error("The imported build did not include gear or variant data.");
  }

  const selectedVariantIndex =
    requestedVariant === null
      ? 0
      : Math.max(0, Math.min(requestedVariant, variants.length - 1));
  const selected = variants[selectedVariantIndex];

  return {
    sourceName: "D4Builds",
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

async function importMaxrollPlannerUrl(url: string): Promise<ImportedBuild> {
  const parsed = new URL(url);
  const plannerId = parsed.pathname.match(/\/d4\/planner\/([^/?#]+)/)?.[1];
  if (!plannerId) {
    throw new Error("Paste a Maxroll planner URL like https://maxroll.gg/d4/planner/...");
  }

  const html = await fetchText(parsed.toString(), "text/html");
  const context = extractRemixContext(html);
  const loaderData = getRecord(getRecord(getRecord(context, "state"), "loaderData"), "d4planner-by-id");
  const profile = getRecord(loaderData, "profile");
  if (!Object.keys(profile).length) {
    throw new Error("Maxroll did not return readable planner data.");
  }

  const plannerData = parseMaybeJsonRecord(profile.data, "Maxroll planner data");
  const plannerProfiles = getArray(plannerData.profiles).filter(isRecord);
  if (!plannerProfiles.length) {
    throw new Error("This Maxroll planner did not include a readable character profile.");
  }

  const sourceClass = getString(profile, "class", "");
  const sourceSeason = getNumber(profile, "season", 0);
  const searchMetadata = getRecord(profile, "search_metadata");
  const itemNames = cleanList(searchMetadata.items);
  const skillNames = cleanList(searchMetadata.skills);

  const variants = plannerProfiles.map((plannerProfile, index) =>
    extractMaxrollVariant({
      sourceClass,
      sourceSeason,
      plannerProfile,
      plannerData,
      itemNames,
      skillNames,
      fallbackName: `Planner Profile ${index + 1}`,
    }),
  );

  const selectedVariantIndex = 0;
  const selected = variants[selectedVariantIndex];
  const lastUpdated = getString(profile, "date", "");
  const buildName = getString(profile, "name", selected.name || `Maxroll ${plannerId}`);
  const maxrollNote = [
    `Imported from Maxroll planner ${plannerId}.`,
    "Maxroll exposes planner item IDs and numeric affix IDs in the page data; exact affix display names are shown when the source provides them.",
    selected.skills.length ? `Skills: ${selected.skills.join(", ")}` : "",
  ]
    .filter(Boolean)
    .join("\n");

  return {
    sourceName: "Maxroll",
    sourceUrl: parsed.toString(),
    pageTitle: buildName,
    documentId: getString(profile, "id", plannerId),
    name: buildName,
    className: selected.className || sourceClass,
    season: selected.season || sourceSeason,
    lastUpdated,
    selectedVariantIndex,
    variants,
    notesExcerpt: notesExcerpt(maxrollNote),
  };
}

async function importMobalyticsUrl(): Promise<ImportedBuild> {
  throw new Error(
    "Mobalytics currently returns a browser verification page to server imports, so D4 Gear Delta cannot safely read those build pages yet. Use a D4Builds or Maxroll planner link for direct import, or paste Mobalytics gear text into the scan fields for now.",
  );
}

function extractMaxrollVariant({
  sourceClass,
  sourceSeason,
  plannerProfile,
  plannerData,
  itemNames,
  skillNames,
  fallbackName,
}: {
  sourceClass: string;
  sourceSeason: number;
  plannerProfile: AnyRecord;
  plannerData: AnyRecord;
  itemNames: string[];
  skillNames: string[];
  fallbackName: string;
}): ImportedVariant {
  const itemsById = getRecord(plannerData, "items");
  const profileItems = getRecord(plannerProfile, "items");
  const className = sourceClass || stringClassName(plannerProfile.class);
  const season = sourceSeason || getNumber(plannerProfile, "season", 0);
  const usedItemNames = new Set<string>();
  let equipmentNameIndex = 0;
  const gearSlots: ImportedGearSlot[] = [];
  const affixTargets: string[] = [];
  const aspectTargets: string[] = [];

  for (const [slotId, itemReference] of Object.entries(profileItems).sort(
    ([left], [right]) => Number(left) - Number(right),
  )) {
    const item = getRecord(itemsById, String(itemReference));
    const itemId = getString(item, "id", "");
    if (!itemId) {
      continue;
    }

    const displayName = maxrollDisplayName({
      itemId,
      itemNames,
      slotId,
      usedItemNames,
      equipmentNameIndex,
    });
    if (Number(slotId) < 20 && displayName !== humanizeMaxrollId(itemId)) {
      equipmentNameIndex += 1;
    }

    const slot = inferMaxrollSlot(slotId, itemId);
    const affixes = getArray(item.explicits).map((affix) => formatMaxrollAffix(affix, "Affix"));
    const tempers = getArray(item.tempered).map((affix) => formatMaxrollAffix(affix, "Temper"));
    const gems = cleanList(item.sockets).map(humanizeMaxrollId);
    const power = getNumber(item, "power", 0);
    const target = power ? `${displayName} (${power} power)` : displayName;
    const kind = maxrollItemKind(itemId);

    appendUnique(aspectTargets, displayName);
    for (const affix of [...affixes, ...tempers]) {
      appendUnique(affixTargets, cleanAffixName(affix));
    }

    gearSlots.push({
      slot,
      target,
      kind,
      affixes,
      tempers,
      gems,
    });
  }

  const skillBar = cleanList(plannerProfile.skillBar).map(humanizeMaxrollId);

  return {
    name: getString(plannerProfile, "name", fallbackName),
    className,
    season,
    skills: skillNames.length ? skillNames : skillBar,
    gearSlots,
    affixTargets,
    aspectTargets,
  };
}

function maxrollDisplayName({
  itemId,
  itemNames,
  slotId,
  usedItemNames,
  equipmentNameIndex,
}: {
  itemId: string;
  itemNames: string[];
  slotId: string;
  usedItemNames: Set<string>;
  equipmentNameIndex: number;
}): string {
  if (Number(slotId) < 20) {
    const name = itemNames[equipmentNameIndex];
    if (name) {
      usedItemNames.add(name);
      return name;
    }
  }

  if (itemId.startsWith("Talisman_Seal")) {
    const sealName = itemNames.find((name) => !usedItemNames.has(name) && /\bseal\b/i.test(name));
    if (sealName) {
      usedItemNames.add(sealName);
      return sealName;
    }
  }

  if (itemId.startsWith("Talisman_Charm_Unique")) {
    const charmName = itemNames.find((name) => !usedItemNames.has(name) && !/\bseal\b/i.test(name));
    if (charmName) {
      usedItemNames.add(charmName);
      return charmName;
    }
  }

  return humanizeMaxrollId(itemId);
}

function inferMaxrollSlot(slotId: string, itemId: string): string {
  const lowered = itemId.toLowerCase();
  if (lowered.includes("bow") || lowered.includes("crossbow")) {
    return "Ranged Weapon";
  }
  if (lowered.includes("2h") || lowered.includes("twohand") || lowered.includes("quarterstaff")) {
    return "Two-Handed Weapon";
  }
  if (lowered.includes("focus") || lowered.includes("totem") || lowered.includes("shield")) {
    return "Offhand";
  }
  return MAXROLL_SLOT_LABELS[slotId] ?? slotFromItemId(itemId) ?? `Slot ${slotId}`;
}

function slotFromItemId(itemId: string): string | null {
  const lowered = itemId.toLowerCase();
  if (lowered.includes("helm")) return "Helm";
  if (lowered.includes("chest")) return "Chest Armor";
  if (lowered.includes("gloves")) return "Gloves";
  if (lowered.includes("pants")) return "Pants";
  if (lowered.includes("boots")) return "Boots";
  if (lowered.includes("amulet") || lowered.includes("amul")) return "Amulet";
  if (lowered.includes("ring")) return "Ring";
  if (lowered.includes("seal")) return "Seal";
  if (lowered.includes("charm")) return "Charm";
  if (lowered.includes("weapon") || lowered.includes("dagger") || lowered.includes("sword")) return "Weapon";
  return null;
}

function maxrollItemKind(itemId: string): string {
  if (itemId.toLowerCase().includes("mythicunique")) return "Mythic";
  if (itemId.toLowerCase().includes("unique")) return "Unique";
  if (itemId.toLowerCase().includes("legendary")) return "Aspect";
  return "Item";
}

function formatMaxrollAffix(value: unknown, prefix: string): string {
  if (!isRecord(value)) {
    return `${prefix}: ${String(value)}`;
  }
  const id = getString(value, "name", getString(value, "id", getString(value, "nid", "Unknown")));
  const numbers = getArray(value.values).map(formatPlannerNumber);
  const greater = value.greater ? " greater" : "";
  const suffix = numbers.length ? `: ${numbers.join(" / ")}` : "";
  return `${prefix}${greater} ${id}${suffix}`;
}

function formatPlannerNumber(value: unknown): string {
  const number = Number(value);
  if (!Number.isFinite(number)) {
    return String(value);
  }
  return number.toLocaleString("en-US", {
    maximumFractionDigits: Math.abs(number) < 10 ? 3 : 1,
  });
}

function humanizeMaxrollId(value: string): string {
  const cleaned = value
    .replace(/^S\d+_/i, "")
    .replace(/^BSK_/i, "")
    .replace(/^Talisman_/i, "")
    .replace(/_x\d+$/i, "")
    .replace(/_\d+$/i, "")
    .replace(/\b(Generic|Legendary)\b/gi, "")
    .replace(/([a-z])([A-Z])/g, "$1 $2")
    .replace(/[_-]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();

  return cleaned
    .split(" ")
    .filter(Boolean)
    .map((word) => {
      if (/^(1H|2H)$/i.test(word)) return word.toUpperCase();
      if (/^[A-Z0-9]+$/.test(word)) return word;
      return word.charAt(0).toUpperCase() + word.slice(1).toLowerCase();
    })
    .join(" ");
}

function stringClassName(value: unknown): string {
  return typeof value === "string" && /[A-Za-z]/.test(value) ? value : "";
}

function extractRemixContext(html: string): AnyRecord {
  const match = html.match(/window\.__remixContext\s*=\s*(\{[\s\S]*?\});\s*<\/script>/);
  if (!match) {
    throw new Error("Maxroll planner data was not found on the page.");
  }
  return parseJsonRecord(match[1], "Maxroll page data");
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

async function fetchText(url: string, accept: string): Promise<string> {
  const response = await fetch(url, {
    headers: {
      accept,
      "user-agent": "D4 Gear Delta Web/0.1",
    },
  });

  if (!response.ok) {
    throw new Error(`Import request failed with HTTP ${response.status}.`);
  }

  return response.text();
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

function extractD4BuildsVariants(build: AnyRecord): ImportedVariant[] {
  const variants = [extractD4BuildsVariant(build, getString(build, "variantName", "Base Build"))];

  getArray(build.variants).forEach((variant, index) => {
    if (isRecord(variant)) {
      variants.push(
        extractD4BuildsVariant(variant, getString(variant, "variantName", `Variant ${index + 1}`), build),
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

function extractD4BuildsVariant(source: AnyRecord, name: string, parent: AnyRecord = {}): ImportedVariant {
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

function parseLooseUrl(value: string): URL | null {
  const trimmed = value.trim();
  try {
    const parsed = new URL(
      /^https?:\/\//i.test(trimmed) ? trimmed : `https://${trimmed.replace(/^\/+/, "")}`,
    );
    return parsed.hostname.includes(".") ? parsed : null;
  } catch {
    return null;
  }
}

function normalizedHost(value: string): string {
  return value.toLowerCase().replace(/^www\./, "");
}

function parseMaybeJsonRecord(value: unknown, label: string): AnyRecord {
  if (isRecord(value)) {
    return value;
  }
  if (typeof value === "string") {
    return parseJsonRecord(value, label);
  }
  throw new Error(`${label} was not readable JSON.`);
}

function parseJsonRecord(value: string, label: string): AnyRecord {
  try {
    const parsed = JSON.parse(value);
    if (!isRecord(parsed)) {
      throw new Error("not an object");
    }
    return parsed;
  } catch {
    throw new Error(`${label} was not readable JSON.`);
  }
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
