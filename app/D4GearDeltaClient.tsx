"use client";

import {
  Calculator,
  Clipboard,
  Download,
  FileImage,
  RefreshCw,
  Save,
  Search,
  Shield,
  Upload,
} from "lucide-react";
import { DragEvent, useEffect, useMemo, useRef, useState } from "react";
import type { CSSProperties } from "react";

type StatKey =
  | "basePower"
  | "mainStat"
  | "allStatMultiplierPct"
  | "mainStatMultiplierPct"
  | "skillCoefficientPct"
  | "skillRanks"
  | "additiveDamagePct"
  | "critAdditiveDamagePct"
  | "critChancePct"
  | "critDamagePct"
  | "vulnerableDamagePct"
  | "vulnerableUptimePct"
  | "dotMultiplierPct"
  | "allDamageMultiplierPct"
  | "attackSpeedPct"
  | "overpowerChancePct"
  | "overpowerDamagePct"
  | "multiplicativeDamagePct"
  | "dotSharePct";

type DamageStats = Record<StatKey, number>;

type StatField = {
  key: StatKey;
  label: string;
  current: number;
  candidate: number;
  item: boolean;
};

type ParsedAffix = {
  label: string;
  value: number;
  kind: "stat" | "aspect";
};

type ParsedItem = {
  name: string;
  itemType: string;
  itemPower: string;
  affixes: ParsedAffix[];
};

type SlotData = ParsedItem & {
  imageUrl: string;
  rawText: string;
  stats: DamageStats;
  mapped: number;
};

type ScanSide = SlotData;

type WeightedRow = {
  label: string;
  equipped: number;
  candidate: number;
  weight: number;
};

type ImportedGearSlot = {
  slot: string;
  target: string;
  kind: string;
  affixes: string[];
  tempers: string[];
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
  sourceName?: string;
  sourceUrl: string;
  name: string;
  className: string;
  season: number;
  lastUpdated: string;
  selectedVariantIndex: number;
  variants: ImportedVariant[];
  notesExcerpt: string;
};

type TabKey = "profile" | "gear" | "seals" | "build" | "weights";
type ScanTarget = "equipped" | "candidate";
type ScanMode = "gear" | "seal";

const FIELD_DEFS: StatField[] = [
  { key: "basePower", label: "Weapon damage / DPS", current: 1000, candidate: 1000, item: true },
  { key: "mainStat", label: "Main stat sum", current: 800, candidate: 800, item: true },
  { key: "allStatMultiplierPct", label: "[x] all stat %", current: 0, candidate: 0, item: true },
  { key: "mainStatMultiplierPct", label: "[x] main stat %", current: 0, candidate: 0, item: true },
  { key: "skillCoefficientPct", label: "Skill coefficient % at rank 1", current: 45, candidate: 45, item: false },
  { key: "skillRanks", label: "Total skill ranks", current: 1, candidate: 1, item: true },
  { key: "additiveDamagePct", label: "Shared additive damage %", current: 220, candidate: 245, item: true },
  { key: "critAdditiveDamagePct", label: "Crit-only additive damage %", current: 0, candidate: 0, item: true },
  { key: "critChancePct", label: "Critical chance %", current: 35, candidate: 35, item: true },
  { key: "critDamagePct", label: "Critical strike damage multiplier %", current: 75, candidate: 75, item: true },
  { key: "vulnerableDamagePct", label: "Vulnerable damage %", current: 40, candidate: 40, item: true },
  { key: "vulnerableUptimePct", label: "Vulnerable uptime %", current: 100, candidate: 100, item: false },
  { key: "dotMultiplierPct", label: "Damage over time multiplier %", current: 0, candidate: 0, item: true },
  { key: "allDamageMultiplierPct", label: "[x] all damage / non-physical %", current: 0, candidate: 0, item: true },
  { key: "attackSpeedPct", label: "Attack speed %", current: 0, candidate: 0, item: true },
  { key: "overpowerChancePct", label: "Overpower chance %", current: 0, candidate: 0, item: true },
  { key: "overpowerDamagePct", label: "Overpower damage %", current: 0, candidate: 0, item: true },
  { key: "multiplicativeDamagePct", label: "[x] damage %", current: 0, candidate: 0, item: true },
  { key: "dotSharePct", label: "DoT share of damage %", current: 0, candidate: 0, item: false },
];

const ITEM_FIELDS = FIELD_DEFS.filter((field) => field.item);

const GEAR_SLOTS = [
  "Helm",
  "Chest Armor",
  "Gloves",
  "Pants",
  "Boots",
  "Amulet",
  "Ring 1",
  "Ring 2",
  "Weapon",
  "Offhand",
  "Two-Handed Weapon",
  "Ranged Weapon",
  "Dual-Wield 1",
  "Dual-Wield 2",
] as const;

const LEFT_SLOTS = ["Helm", "Chest Armor", "Gloves", "Pants", "Boots", "Weapon", "Offhand"];
const RIGHT_SLOTS = ["Amulet", "Ring 1", "Ring 2", "Two-Handed Weapon", "Ranged Weapon", "Dual-Wield 1", "Dual-Wield 2"];

const SLOT_ABBREVIATIONS: Record<string, string> = {
  Helm: "H",
  "Chest Armor": "C",
  Gloves: "G",
  Pants: "P",
  Boots: "B",
  Amulet: "A",
  "Ring 1": "R1",
  "Ring 2": "R2",
  Weapon: "W",
  Offhand: "O",
  "Two-Handed Weapon": "2H",
  "Ranged Weapon": "RW",
  "Dual-Wield 1": "D1",
  "Dual-Wield 2": "D2",
};

const WEIGHT_PRESETS = [
  {
    name: "Barbarian - Weapon / Berserking",
    className: "Barbarian",
    affixes: ["Strength", "Weapon damage / DPS", "Critical strike chance %", "Critical strike damage %", "Vulnerable damage %", "Damage while Berserking %", "Overpower damage %", "Attack speed %", "Cooldown reduction %", "Ranks to main skill"],
  },
  {
    name: "Druid - Shapeshift / Overpower",
    className: "Druid",
    affixes: ["Willpower", "Weapon damage / DPS", "Critical strike chance %", "Critical strike damage %", "Vulnerable damage %", "Overpower damage %", "Damage while shapeshifted %", "Companion damage %", "Attack speed %", "Ranks to main skill"],
  },
  {
    name: "Necromancer - Minion / Shadow",
    className: "Necromancer",
    affixes: ["Intelligence", "Weapon damage / DPS", "Critical strike chance %", "Critical strike damage %", "Vulnerable damage %", "Minion damage %", "Shadow damage over time %", "Attack speed %", "Cooldown reduction %", "Ranks to main skill"],
  },
  {
    name: "Paladin - Holy / Block",
    className: "Paladin",
    affixes: ["Strength", "Weapon damage / DPS", "Critical strike chance %", "Critical strike damage %", "Vulnerable damage %", "Holy damage %", "Damage with shields %", "Block chance %", "Cooldown reduction %", "Ranks to main skill"],
  },
  {
    name: "Rogue - Crit / Vulnerable",
    className: "Rogue",
    affixes: ["Dexterity", "Weapon damage / DPS", "Critical strike chance %", "Critical strike damage %", "Vulnerable damage %", "Damage to close enemies %", "Imbuement damage %", "Attack speed %", "Cooldown reduction %", "Ranks to main skill"],
  },
  {
    name: "Sorcerer - Elemental / Cooldown",
    className: "Sorcerer",
    affixes: ["Intelligence", "Weapon damage / DPS", "Critical strike chance %", "Critical strike damage %", "Vulnerable damage %", "Elemental damage %", "Damage to burning enemies %", "Attack speed %", "Cooldown reduction %", "Ranks to main skill"],
  },
  {
    name: "Spiritborn - Speed / Spirit Hall",
    className: "Spiritborn",
    affixes: ["Dexterity", "Weapon damage / DPS", "Critical strike chance %", "Critical strike damage %", "Vulnerable damage %", "Attack speed %", "Basic skill damage %", "Core skill damage %", "Cooldown reduction %", "Ranks to main skill"],
  },
  {
    name: "Warlock - Shadow / Curses",
    className: "Warlock",
    affixes: ["Willpower", "Weapon damage / DPS", "Critical strike chance %", "Critical strike damage %", "Vulnerable damage %", "Shadow damage over time %", "Curse damage %", "Summon damage %", "Cooldown reduction %", "Ranks to main skill"],
  },
];

const STORAGE_KEY = "d4-gear-delta-web-profile-v1";

function emptyStats(): DamageStats {
  return Object.fromEntries(FIELD_DEFS.map((field) => [field.key, 0])) as DamageStats;
}

function defaultStats(candidate = false): DamageStats {
  return Object.fromEntries(FIELD_DEFS.map((field) => [field.key, candidate ? field.candidate : field.current])) as DamageStats;
}

function emptySlot(): SlotData {
  return {
    imageUrl: "",
    rawText: "",
    name: "",
    itemType: "",
    itemPower: "",
    affixes: [],
    stats: emptyStats(),
    mapped: 0,
  };
}

function emptyProfile(): Record<string, SlotData> {
  return Object.fromEntries(GEAR_SLOTS.map((slot) => [slot, emptySlot()]));
}

function parseNumber(value: unknown): number {
  if (typeof value === "number") return Number.isFinite(value) ? value : 0;
  const parsed = Number(String(value ?? "").replace(/,/g, "").replace(/%$/, "").trim());
  return Number.isFinite(parsed) ? parsed : 0;
}

function estimateScore(stats: DamageStats, className = ""): number {
  return damageBreakdown(stats, className).finalDamage;
}

function damageBreakdown(stats: DamageStats, className = "") {
  const weaponDamage = Math.max(0, stats.basePower);
  const mainStatMultiplier = 1 + Math.max(0, stats.mainStat) *
    percentMultiplier(stats.allStatMultiplierPct + stats.mainStatMultiplierPct) /
    mainStatDivisor(className);
  const skillCoefficient = Math.max(0, stats.skillCoefficientPct) / 100 *
    skillRankMultiplier(stats.skillRanks);
  const vulnerableMultiplier = uptimeMultiplier(stats.vulnerableDamagePct, stats.vulnerableUptimePct);
  const nonCritAdditive = percentMultiplier(stats.additiveDamagePct);
  const critAdditive = percentMultiplier(stats.additiveDamagePct + stats.critAdditiveDamagePct);
  const critDamageMultiplier = percentMultiplier(stats.critDamagePct);
  const dotMultiplier = percentMultiplier(stats.dotMultiplierPct);
  const allDamageMultiplier = percentMultiplier(stats.allDamageMultiplierPct);
  const attackSpeedMultiplier = percentMultiplier(stats.attackSpeedPct);
  const extraDamageMultiplier = percentMultiplier(stats.multiplicativeDamagePct);
  const overpowerMultiplier = critMultiplier(stats.overpowerChancePct, stats.overpowerDamagePct);
  const critChance = clamp(stats.critChancePct / 100, 0, 1);
  const dotShare = clamp(stats.dotSharePct / 100, 0, 1);
  const baseProduct =
    weaponDamage *
    mainStatMultiplier *
    vulnerableMultiplier *
    allDamageMultiplier *
    skillCoefficient *
    attackSpeedMultiplier *
    extraDamageMultiplier *
    0.2;
  const nonCritProduct = baseProduct * nonCritAdditive;
  const critProduct = baseProduct * critAdditive * critDamageMultiplier * 1.5;
  const directAverage = critProduct * critChance + nonCritProduct * (1 - critChance);
  const dotProduct = baseProduct * nonCritAdditive * dotMultiplier;
  const blendedDamage = directAverage * (1 - dotShare) + dotProduct * dotShare;

  return {
    weaponDamage,
    mainStatMultiplier,
    skillCoefficient,
    nonCritProduct,
    critProduct,
    dotProduct,
    directAverage,
    finalDamage: blendedDamage * overpowerMultiplier,
  };
}

function mainStatDivisor(className: string): number {
  return className.trim().toLowerCase() === "barbarian" ? 900 : 800;
}

function skillRankMultiplier(value: number): number {
  const ranks = Math.max(1, value);
  const rankTier = Math.trunc(ranks / 5);
  return Math.max(0, 1 + 0.1 * (ranks - rankTier - 1) + 0.15 * rankTier);
}

function percentMultiplier(value: number): number {
  return Math.max(0, 1 + value / 100);
}

function critMultiplier(chancePct: number, damagePct: number): number {
  const chance = Math.min(1, Math.max(0, chancePct / 100));
  return Math.max(0, 1 + chance * Math.max(0, damagePct) / 100);
}

function uptimeMultiplier(damagePct: number, uptimePct: number): number {
  const uptime = Math.min(1, Math.max(0, uptimePct / 100));
  return Math.max(0, 1 + uptime * Math.max(0, damagePct) / 100);
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

function percentDelta(current: number, candidate: number): number | null {
  if (Math.abs(current) < 1e-9) return null;
  return (candidate / current - 1) * 100;
}

function compareStats(current: DamageStats, candidate: DamageStats, className = "") {
  const currentScore = estimateScore(current, className);
  const candidateScore = estimateScore(candidate, className);
  const impacts = FIELD_DEFS.map((field) => {
    const currentValue = current[field.key];
    const candidateValue = candidate[field.key];
    const patched = { ...current, [field.key]: candidateValue };
    const patchedScore = estimateScore(patched, className);
    return {
      label: field.label,
      valueDelta: candidateValue - currentValue,
      scoreDelta: patchedScore - currentScore,
      percentDelta: percentDelta(currentScore, patchedScore),
    };
  })
    .filter((impact) => Math.abs(impact.valueDelta) > 1e-9)
    .sort((a, b) => Math.abs(b.scoreDelta) - Math.abs(a.scoreDelta));

  return {
    currentScore,
    candidateScore,
    scoreDelta: candidateScore - currentScore,
    percentDelta: percentDelta(currentScore, candidateScore),
    impacts,
  };
}

function applyItemSwap(current: DamageStats, equipped: DamageStats, candidate: DamageStats): DamageStats {
  return Object.fromEntries(
    FIELD_DEFS.map((field) => [field.key, current[field.key] - equipped[field.key] + candidate[field.key]]),
  ) as DamageStats;
}

function normalizeLabel(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9]+/g, "");
}

function classPrimaryStat(className: string): string {
  const normalized = className.trim().toLowerCase();
  if (["barbarian", "paladin"].includes(normalized)) return "strength";
  if (["rogue", "spiritborn"].includes(normalized)) return "dexterity";
  if (["sorcerer", "sorceress", "necromancer"].includes(normalized)) return "intelligence";
  if (["druid", "warlock"].includes(normalized)) return "willpower";
  return "";
}

function isDefensiveOrUtility(label: string): boolean {
  return [
    "damage reduction",
    "armor",
    "resist",
    "maximum life",
    "max life",
    "life per",
    "healing",
    "barrier",
    "fortify",
    "dodge",
    "movement speed",
    "cooldown",
    "resource",
    "lucky hit",
    "potion",
    "thorns",
    "control impaired",
    "duration",
  ].some((term) => label.includes(term));
}

function mapAffixToDamageStat(affix: ParsedAffix, className: string, mode: ScanMode | "profile" = "gear"): [StatKey, number] | null {
  if (affix.kind === "aspect") return null;
  const label = affix.label.trim();
  const lowered = label.toLowerCase();
  const normalized = normalizeLabel(label);
  const value = affix.value;
  const primary = classPrimaryStat(className);
  const sealLike = mode === "seal";

  if (sealLike) {
    if (normalized === "allstats" || normalized === "allstat") return ["allStatMultiplierPct", value];
    if (normalized === "mainstat" || lowered.includes("main stat")) return ["mainStatMultiplierPct", value];
    if (normalized === "damage") return ["multiplicativeDamagePct", value];
  }

  if (["strength", "dexterity", "intelligence", "willpower"].includes(normalized)) {
    if (!primary || normalized === primary) return ["mainStat", value];
    return null;
  }
  if (normalized === "allstats" || normalized === "allstat") return ["mainStat", value];
  if (lowered.includes("critical strike chance") || lowered.includes("critical chance") || lowered.includes("crit chance")) return ["critChancePct", value];
  if (lowered.includes("critical strike damage") || lowered.includes("critical damage") || lowered.includes("crit damage")) return ["critDamagePct", value];
  if (lowered.includes("vulnerable") && lowered.includes("damage")) return ["vulnerableDamagePct", value];
  if ((lowered.includes("damage over time") || lowered.includes("dot")) && lowered.includes("multiplier")) return ["dotMultiplierPct", value];
  if (lowered.includes("attack speed")) return ["attackSpeedPct", value];
  if (lowered.includes("overpower chance")) return ["overpowerChancePct", value];
  if (lowered.includes("overpower") && lowered.includes("damage")) return ["overpowerDamagePct", value];
  if (lowered.includes("weapon damage") || lowered.includes("damage per second") || ["dps", "weapondps"].includes(normalized)) return ["basePower", value];
  if (lowered.includes("rank") || /^to [a-z][a-z' -]+/.test(lowered)) return ["skillRanks", value];
  if (lowered.includes("multiplier") || lowered.includes("multiplicative")) return ["allDamageMultiplierPct", value];
  if (lowered.includes("damage") && !isDefensiveOrUtility(lowered)) return ["additiveDamagePct", value];
  return null;
}

function statsFromAffixes(affixes: ParsedAffix[], className: string, mode: ScanMode | "profile" = "gear"): { stats: DamageStats; mapped: number } {
  const stats = emptyStats();
  let mapped = 0;
  for (const affix of affixes) {
    const target = mapAffixToDamageStat(affix, className, mode);
    if (!target) continue;
    const [key, amount] = target;
    stats[key] += amount;
    mapped += 1;
  }
  return { stats, mapped };
}

function parseGearText(text: string): ParsedItem {
  const normalized = normalizeTooltipText(text);
  const affixes: ParsedAffix[] = [];
  const seen = new Set<string>();

  for (const rawLine of normalized.split(/\n+/)) {
    const line = cleanLine(rawLine);
    if (!line || isNoiseLine(line)) continue;
    const aspect = extractAspect(line);
    if (aspect) {
      appendUnique(affixes, seen, { label: `Aspect: ${aspect}`, value: 1, kind: "aspect" });
      continue;
    }
    const parsed = parseNumericAffix(line);
    if (parsed) appendUnique(affixes, seen, parsed);
  }

  const summary = extractItemSummary(normalized);
  return { ...summary, affixes };
}

function normalizeTooltipText(text: string): string {
  let output = text.replace(/\r\n?/g, "\n").replace(/Ã—/g, "x");
  output = output.replace(/[ \t\f\v]+/g, " ");
  output = output.replace(/\n\s*/g, "\n");
  output = output.replace(
    /(?<!^)[ \t]+(?=(?:\+|x|X)?\s*\d[\d,]*(?:\.\d+)?\s*%?\s+(?:All Resist|[A-Za-z][A-Za-z' -]{2,}))/g,
    "\n",
  );
  output = output.replace(/[ \t]+(?=Requires Level|Account Bound|Sell Value|Tempers:)/gi, "\n");
  return output;
}

function cleanLine(line: string): string {
  return line
    .replace(/[•◆◇♦◊·›»|]/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .replace(/^[-*_ [\]]+|[-*_[\]]+$/g, "");
}

function isNoiseLine(line: string): boolean {
  const lowered = line.toLowerCase();
  return [
    "item power",
    "durability",
    "requires level",
    "account bound",
    "sell value",
    "sockets",
    "requires class",
    "ancestral",
    "legendary",
    "rare amulet",
    "rare ring",
    "rare helm",
    "rare gloves",
    "rare boots",
    "rare pants",
    "rare weapon",
    "rare offhand",
    "rare chest",
    "unique equipped",
    "right click",
    "shift to compare",
    "tempers",
  ].some((term) => lowered.includes(term));
}

function extractAspect(line: string): string | null {
  const match = line.match(/\b(Aspect of [A-Za-z][A-Za-z' -]+|[A-Z][A-Za-z' -]+ Aspect)\b/);
  return match ? match[1].replace(/[ .,:;]+$/g, "") : null;
}

function parseNumericAffix(line: string): ParsedAffix | null {
  const patterns = [
    /^(?:\+|x|X)?\s*([0-9][0-9,]*(?:\.[0-9]+)?)\s*%?\s*(?:\[x\]\s*)?(.+)$/i,
    /^(.+?)\s+(?:\+|x|X)?\s*([0-9][0-9,]*(?:\.[0-9]+)?)\s*%?\s*(?:\[x\])?$/i,
  ];
  for (const pattern of patterns) {
    const match = line.match(pattern);
    if (!match) continue;
    const firstIsNumber = /^[0-9][0-9,]*(?:\.[0-9]+)?$/.test(match[1]);
    const rawValue = firstIsNumber ? match[1] : match[2];
    const rawLabel = firstIsNumber ? match[2] : match[1];
    const label = cleanLabel(rawLabel);
    if (!label || !/[A-Za-z]/.test(label) || isNoiseLine(label)) return null;
    return { label, value: parseNumber(rawValue), kind: "stat" };
  }
  return null;
}

function cleanLabel(label: string): string {
  return label
    .replace(/\[[^\]]*\]/g, "")
    .replace(/\[[^\]]*$/g, "")
    .replace(/\([^)]*\)/g, "")
    .replace(/\b(Requires Level|Account Bound|Sell Value|Tempers)\b.*$/i, "")
    .replace(/%/g, "")
    .replace(/^[ +\-.:]+|[ +\-.:]+$/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

function appendUnique(affixes: ParsedAffix[], seen: Set<string>, affix: ParsedAffix) {
  const key = `${affix.label.toLowerCase()}|${affix.value.toFixed(3)}|${affix.kind}`;
  if (seen.has(key)) return;
  seen.add(key);
  affixes.push(affix);
}

function extractItemSummary(text: string): Pick<ParsedItem, "name" | "itemType" | "itemPower"> {
  const cleaned = text.split(/\n+/).map(cleanLine).filter(Boolean).join(" ");
  const powerMatch = cleaned.match(/\b([0-9]{2,4}(?:\+[0-9]{1,2})?)\s+Item Power\b/i);
  const itemPower = powerMatch?.[1] ?? "";
  const prefix = (powerMatch ? cleaned.slice(0, powerMatch.index) : cleaned.slice(0, 160)).replace(/\b(?:Greater Affix|Tempered|Masterworked)\b/gi, "").replace(/\s+/g, " ").trim();
  const typeMatch = prefix.match(/\b((?:Ancestral|Sacred|Infernal)?\s*(?:Mythic Unique|Unique|Legendary|Rare|Magic|Common)\s+(?:Amulet|Ring|Helm|Helmet|Gloves|Boots|Pants|Chest Armor|Armor|Sword|Axe|Mace|Dagger|Bow|Crossbow|Polearm|Scythe|Staff|Wand|Focus|Totem|Shield|Offhand|Two-Handed [A-Za-z ]+|One-Handed [A-Za-z ]+))\b/i);
  if (!typeMatch) return { name: titleFromUpper(prefix), itemType: "", itemPower };
  const itemType = typeMatch[1].replace(/\s+/g, " ").trim();
  const rawName = prefix.slice(0, typeMatch.index).replace(/[ -]+$/g, "") || prefix.slice((typeMatch.index ?? 0) + typeMatch[0].length).replace(/^[ -]+/g, "");
  return { name: titleFromUpper(rawName), itemType, itemPower };
}

function titleFromUpper(value: string): string {
  const cleaned = value.replace(/\s+/g, " ").trim();
  const letters = [...cleaned].filter((char) => /[A-Za-z]/.test(char));
  if (letters.length && letters.filter((char) => char === char.toUpperCase()).length / letters.length > 0.85) {
    return cleaned.toLowerCase().replace(/\b[a-z]/g, (char) => char.toUpperCase());
  }
  return cleaned;
}

function suggestedWeightForAffix(label: string, className = ""): number {
  const text = label.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
  const classText = className.toLowerCase();
  if (text.includes("aspect") || text.includes("unique")) return 50;
  if (text.includes("rank") || ["quake", "shred", "quill volley", "bone spirit", "blizzard"].includes(text)) return 2.5;
  if (text.includes("critical strike chance") || text.includes("attack speed")) return 1.25;
  if (text.includes("cooldown reduction") || text.includes("resource generation")) return 1.1;
  if (text.includes("multiplier")) return 1.05;
  if (text.includes("vulnerable damage") || text.includes("critical strike damage")) return 0.9;
  if (text.includes("overpower")) return 0.85;
  if (["strength", "dexterity", "intelligence", "willpower", "all stats"].includes(text)) return 0.8;
  if (text.includes("maximum resource") || text.includes("maximum fury") || text.includes("maximum spirit")) return classText.includes("spiritborn") ? 0.75 : 0.55;
  if (text.includes("maximum life")) return 0.35;
  if (text.includes("movement speed") || text.includes("resistance") || text.includes("armor")) return 0.2;
  return 0.6;
}

function weightedRowsFromAffixes(equipped: ParsedAffix[], candidate: ParsedAffix[], className: string): WeightedRow[] {
  const rows = new Map<string, WeightedRow>();
  for (const target of ["equipped", "candidate"] as const) {
    const source = target === "equipped" ? equipped : candidate;
    for (const affix of source) {
      const key = affix.label.toLowerCase();
      const existing = rows.get(key) ?? {
        label: affix.label,
        equipped: 0,
        candidate: 0,
        weight: affix.kind === "aspect" ? 50 : suggestedWeightForAffix(affix.label, className),
      };
      existing[target] = affix.value;
      rows.set(key, existing);
    }
  }
  return [...rows.values()];
}

function compareWeighted(rows: WeightedRow[]) {
  let equippedScore = 0;
  let candidateScore = 0;
  const impacts = rows.map((row) => {
    equippedScore += row.equipped * row.weight;
    candidateScore += row.candidate * row.weight;
    return {
      label: row.label,
      valueDelta: row.candidate - row.equipped,
      scoreDelta: (row.candidate - row.equipped) * row.weight,
      weight: row.weight,
    };
  }).filter((impact) => Math.abs(impact.valueDelta) > 1e-9).sort((a, b) => Math.abs(b.scoreDelta) - Math.abs(a.scoreDelta));
  return { equippedScore, candidateScore, scoreDelta: candidateScore - equippedScore, percentDelta: percentDelta(equippedScore, candidateScore), impacts };
}

function formatPercent(value: number | null): string {
  if (value === null || !Number.isFinite(value)) return "n/a";
  return `${value > 0 ? "+" : ""}${value.toFixed(1)}%`;
}

function formatScore(value: number): string {
  if (Math.abs(value) >= 100000) return value.toLocaleString(undefined, { maximumFractionDigits: 0 });
  if (Math.abs(value) >= 100) return value.toLocaleString(undefined, { maximumFractionDigits: 1 });
  return value.toLocaleString(undefined, { maximumFractionDigits: 2 });
}

function formatInput(value: number): string {
  if (Math.abs(value - Math.round(value)) < 0.001) return String(Math.round(value));
  return value.toFixed(2).replace(/\.?0+$/, "");
}

function verdict(percent: number | null): string {
  if (percent === null) return "Scan Items";
  if (percent > 0.05) return "Candidate Better";
  if (percent < -0.05) return "Equipped Better";
  return "About Even";
}

function classArt(className: string) {
  const key = className.trim().toLowerCase();
  const profiles: Record<string, { name: string; motif: string; accent: string; glow: string; tag: string }> = {
    barbarian: { name: "Barbarian", motif: "AX", accent: "#c7563b", glow: "#5a1c16", tag: "Arsenal Fury" },
    druid: { name: "Druid", motif: "WD", accent: "#95b36c", glow: "#26351d", tag: "Wildshape Covenant" },
    necromancer: { name: "Necromancer", motif: "BN", accent: "#8ccfb3", glow: "#18302b", tag: "Bone & Shadow" },
    paladin: { name: "Paladin", motif: "HL", accent: "#d8c16a", glow: "#3a3112", tag: "Sacred Oath" },
    rogue: { name: "Rogue", motif: "DG", accent: "#8a73df", glow: "#211a45", tag: "Precision Strike" },
    sorcerer: { name: "Sorcerer", motif: "AR", accent: "#64b5e5", glow: "#14314a", tag: "Arcane Torrent" },
    sorceress: { name: "Sorcerer", motif: "AR", accent: "#64b5e5", glow: "#14314a", tag: "Arcane Torrent" },
    spiritborn: { name: "Spiritborn", motif: "SP", accent: "#e0aa55", glow: "#3b2811", tag: "Spirit Hall" },
    warlock: { name: "Warlock", motif: "HX", accent: "#b06be0", glow: "#2d173d", tag: "Hexbound Pact" },
  };
  return profiles[key] ?? { name: className || "Character", motif: "BD", accent: "#d7b56d", glow: "#2a1712", tag: "Build Baseline" };
}

function classForPreset(presetName: string): string {
  return WEIGHT_PRESETS.find((preset) => preset.name === presetName)?.className ?? "Druid";
}

function readFileAsDataUrl(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result ?? ""));
    reader.onerror = () => reject(reader.error);
    reader.readAsDataURL(file);
  });
}

function coerceStoredStats(value: unknown, candidate = false, empty = false): DamageStats {
  const source = typeof value === "object" && value !== null ? value as Record<string, unknown> : {};
  const stats = { ...(empty ? emptyStats() : defaultStats(candidate)) };
  for (const field of FIELD_DEFS) {
    if (source[field.key] !== undefined) {
      stats[field.key] = parseNumber(source[field.key]);
    }
  }

  if (source.primaryDamagePct !== undefined && source.mainStat === undefined) {
    const oldPrimary = parseNumber(source.primaryDamagePct);
    stats.mainStat = empty ? oldPrimary * 10 : oldPrimary / 100 * mainStatDivisor("");
  }
  if (source.skillRankBonusPct !== undefined && source.skillRanks === undefined) {
    stats.skillRanks = (empty ? 0 : stats.skillRanks) + parseNumber(source.skillRankBonusPct) / 10;
  }
  return stats;
}

function coerceStoredSlot(value: unknown): SlotData {
  if (!value || typeof value !== "object") return emptySlot();
  const raw = value as Partial<SlotData>;
  return {
    ...emptySlot(),
    ...raw,
    affixes: Array.isArray(raw.affixes) ? raw.affixes : [],
    stats: coerceStoredStats(raw.stats, false, true),
  };
}

export function D4GearDeltaClient() {
  const [activeTab, setActiveTab] = useState<TabKey>("profile");
  const [weightPreset, setWeightPreset] = useState(WEIGHT_PRESETS[1].name);
  const [currentStats, setCurrentStats] = useState<DamageStats>(() => defaultStats(false));
  const [candidateStats, setCandidateStats] = useState<DamageStats>(() => defaultStats(true));
  const [profile, setProfile] = useState<Record<string, SlotData>>(() => emptyProfile());
  const [selectedSlot, setSelectedSlot] = useState<string>("Pants");
  const [slotDraftText, setSlotDraftText] = useState("");
  const [gearScan, setGearScan] = useState<Record<ScanTarget, ScanSide>>({ equipped: emptySlot(), candidate: emptySlot() });
  const [sealScan, setSealScan] = useState<Record<ScanTarget, ScanSide>>({ equipped: emptySlot(), candidate: emptySlot() });
  const [importUrl, setImportUrl] = useState("https://d4builds.gg/builds/shred-druid-endgame/");
  const [importedBuild, setImportedBuild] = useState<ImportedBuild | null>(null);
  const [importStatus, setImportStatus] = useState("Paste a D4Builds or Maxroll planner URL when you want guide targets and class art.");
  const [ocrStatus, setOcrStatus] = useState("OCR is local in your browser. First scan can take a little longer.");
  const [isHydrated, setIsHydrated] = useState(false);
  const importFileRef = useRef<HTMLInputElement | null>(null);

  const activeClass = importedBuild?.className || classForPreset(weightPreset);
  const art = classArt(activeClass);

  const profileAggregate = useMemo(() => aggregateProfile(profile), [profile]);
  const profileAdjustedCurrent = useMemo(() => applyProfileBaseline(currentStats, profileAggregate.stats, profileAggregate.mapped), [currentStats, profileAggregate]);
  const liveComparison = useMemo(() => compareStats(currentStats, candidateStats, activeClass), [currentStats, candidateStats, activeClass]);
  const gearComparison = useMemo(() => compareScannedItems(profileAdjustedCurrent, gearScan.equipped, gearScan.candidate, activeClass), [profileAdjustedCurrent, gearScan, activeClass]);
  const sealComparison = useMemo(() => compareScannedItems(profileAdjustedCurrent, sealScan.equipped, sealScan.candidate, activeClass), [profileAdjustedCurrent, sealScan, activeClass]);
  const gearWeighted = useMemo(() => {
    const rows = weightedRowsFromAffixes(gearScan.equipped.affixes, gearScan.candidate.affixes, activeClass);
    return rows.length ? compareWeighted(rows) : null;
  }, [gearScan, activeClass]);
  const sealWeighted = useMemo(() => {
    const rows = weightedRowsFromAffixes(sealScan.equipped.affixes, sealScan.candidate.affixes, activeClass);
    return rows.length ? compareWeighted(rows) : null;
  }, [sealScan, activeClass]);
  const selectedData = profile[selectedSlot] ?? emptySlot();

  useEffect(() => {
    const saved = localStorage.getItem(STORAGE_KEY);
    if (saved) {
      try {
        const parsed = JSON.parse(saved) as {
          weightPreset?: string;
          currentStats?: DamageStats;
          candidateStats?: DamageStats;
          profile?: Record<string, unknown>;
          importedBuild?: ImportedBuild | null;
        };
        /* eslint-disable react-hooks/set-state-in-effect -- Restores client-only localStorage after mount. */
        if (parsed.weightPreset) setWeightPreset(parsed.weightPreset);
        if (parsed.currentStats) setCurrentStats(coerceStoredStats(parsed.currentStats, false));
        if (parsed.candidateStats) setCandidateStats(coerceStoredStats(parsed.candidateStats, true));
        if (parsed.profile) {
          setProfile(Object.fromEntries(GEAR_SLOTS.map((slot) => [slot, coerceStoredSlot(parsed.profile?.[slot])])) as Record<string, SlotData>);
        }
        if (parsed.importedBuild) setImportedBuild(parsed.importedBuild);
        /* eslint-enable react-hooks/set-state-in-effect */
      } catch {
        // Bad local saves should never block the calculator.
      }
    }
    setIsHydrated(true);
  }, []);

  useEffect(() => {
    if (!isHydrated) return;
    localStorage.setItem(
      STORAGE_KEY,
      JSON.stringify({
        weightPreset,
        currentStats,
        candidateStats,
        profile,
        importedBuild,
      }),
    );
  }, [candidateStats, currentStats, importedBuild, isHydrated, profile, weightPreset]);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- The draft editor follows the selected gear slot.
    setSlotDraftText(selectedData.rawText);
  }, [selectedData.rawText, selectedSlot]);

  function updateStat(group: "current" | "candidate", key: StatKey, value: string) {
    const setter = group === "current" ? setCurrentStats : setCandidateStats;
    setter((stats) => ({ ...stats, [key]: parseNumber(value) }));
  }

  function applyProfileToCurrent() {
    if (profileAggregate.mapped === 0) {
      setOcrStatus("No mapped profile stats yet. Scan or paste OCR text for at least one equipped gear slot.");
      return;
    }
    setCurrentStats((stats) => {
      const next = { ...stats };
      for (const field of ITEM_FIELDS) {
        const value = profileAggregate.stats[field.key];
        if (Math.abs(value) > 1e-9) next[field.key] = value;
      }
      return next;
    });
    setOcrStatus(`Applied ${profileAggregate.scanned} profile slot(s) and ${profileAggregate.mapped} mapped stat(s) to Current Build.`);
  }

  function parseSlotDraft() {
    const parsed = buildSlotFromText(slotDraftText, activeClass, selectedData.imageUrl);
    setProfile((profileData) => ({ ...profileData, [selectedSlot]: parsed }));
    setOcrStatus(`Saved ${selectedSlot}: ${parsed.affixes.length} parsed row(s), ${parsed.mapped} mapped formula stat(s).`);
  }

  async function handleImageFile(file: File, context: { type: "slot" } | { type: "scan"; mode: ScanMode; target: ScanTarget }) {
    if (!file.type.startsWith("image/")) return;
    const imageUrl = await readFileAsDataUrl(file);
    if (context.type === "slot") {
      setProfile((profileData) => ({ ...profileData, [selectedSlot]: { ...profileData[selectedSlot], imageUrl } }));
      setOcrStatus(`Loaded ${file.name} for ${selectedSlot}. Run OCR or paste text, then save the slot.`);
      return;
    }
    const setter = context.mode === "gear" ? setGearScan : setSealScan;
    setter((scan) => ({ ...scan, [context.target]: { ...emptySlot(), imageUrl } }));
    setOcrStatus(`Loaded ${file.name} as ${context.target}. OCR is starting automatically...`);
    await scanImageForCompare(context.mode, context.target, imageUrl);
  }

  async function pasteImage(context: { type: "slot" } | { type: "scan"; mode: ScanMode; target: ScanTarget }) {
    try {
      const items = await navigator.clipboard.read();
      for (const item of items) {
        const imageType = item.types.find((type) => type.startsWith("image/"));
        if (!imageType) continue;
        const blob = await item.getType(imageType);
        await handleImageFile(new File([blob], "clipboard-tooltip.png", { type: imageType }), context);
        return;
      }
      setOcrStatus("Clipboard did not contain an image.");
    } catch {
      setOcrStatus("Browser blocked clipboard image access. Use drag/drop or Open Image instead.");
    }
  }

  async function runOcr(context: { type: "slot" } | { type: "scan"; mode: ScanMode; target: ScanTarget }) {
    const imageUrl = context.type === "slot" ? profile[selectedSlot]?.imageUrl : (context.mode === "gear" ? gearScan : sealScan)[context.target].imageUrl;
    if (!imageUrl) {
      setOcrStatus("Load or paste a screenshot first.");
      return;
    }
    setOcrStatus("OCR starting. The first browser scan can take a moment while language data loads...");
    try {
      const text = await recognizeTooltipImage(imageUrl, "OCR");
      if (context.type === "slot") {
        setSlotDraftText(text);
        setOcrStatus("OCR complete. Review the text, then save the slot.");
      } else {
        applyParsedScan(context.mode, context.target, text, imageUrl);
      }
    } catch (error) {
      setOcrStatus(`OCR failed: ${error instanceof Error ? error.message : "unknown browser OCR error"}`);
    }
  }

  async function scanImageForCompare(mode: ScanMode, target: ScanTarget, imageUrl: string) {
    try {
      const text = await recognizeTooltipImage(imageUrl, `${target} OCR`);
      applyParsedScan(mode, target, text, imageUrl);
    } catch (error) {
      setOcrStatus(`OCR failed for ${target}: ${error instanceof Error ? error.message : "unknown browser OCR error"}`);
    }
  }

  async function recognizeTooltipImage(imageUrl: string, label: string): Promise<string> {
    const { recognize } = await import("tesseract.js");
    const result = await recognize(imageUrl, "eng", {
      logger: (message) => {
        if (message.status) {
          const progress = message.progress ? ` ${Math.round(message.progress * 100)}%` : "";
          setOcrStatus(`${label} ${message.status}${progress}`);
        }
      },
    });
    return result.data.text;
  }

  function updateScanText(mode: ScanMode, target: ScanTarget, text: string) {
    const setter = mode === "gear" ? setGearScan : setSealScan;
    setter((scan) => ({ ...scan, [target]: { ...scan[target], rawText: text } }));
  }

  function parseScanSide(mode: ScanMode, target: ScanTarget) {
    const source = mode === "gear" ? gearScan[target] : sealScan[target];
    if (!source.rawText.trim()) {
      setOcrStatus(`No OCR/manual text for ${target}. Click OCR, paste tooltip text, or load the image again.`);
      return;
    }
    applyParsedScan(mode, target, source.rawText, source.imageUrl);
  }

  function applyParsedScan(mode: ScanMode, target: ScanTarget, text: string, imageUrl: string) {
    const parsed = buildSlotFromText(text, activeClass, imageUrl, mode);
    const setter = mode === "gear" ? setGearScan : setSealScan;
    setter((scan) => ({ ...scan, [target]: parsed }));
    const mappedNote = parsed.mapped
      ? `${parsed.mapped} mapped damage stat(s)`
      : "no mapped damage stats";
    setOcrStatus(`Parsed ${target}: ${parsed.affixes.length} row(s), ${mappedNote}.`);
  }

  function clearScan(mode: ScanMode) {
    const empty = { equipped: emptySlot(), candidate: emptySlot() };
    if (mode === "gear") setGearScan(empty);
    else setSealScan(empty);
  }

  async function importBuild() {
    setImportStatus("Importing public build data...");
    try {
      const response = await fetch(`/api/import-d4builds?url=${encodeURIComponent(importUrl)}`);
      const data = await response.json() as ImportedBuild | { error?: string };
      if (!response.ok || "error" in data) throw new Error("error" in data ? data.error : "Import failed");
      const build = data as ImportedBuild;
      setImportedBuild(build);
      const matchingPreset = WEIGHT_PRESETS.find((preset) => preset.className.toLowerCase() === build.className.toLowerCase());
      if (matchingPreset) setWeightPreset(matchingPreset.name);
      setImportStatus(`Imported ${build.name} from ${build.sourceName ?? "build source"} (${build.className} S${build.season}).`);
    } catch (error) {
      setImportStatus(error instanceof Error ? error.message : "Could not import this build.");
    }
  }

  function applyImportedWeights() {
    if (!importedBuild) return;
    const variant = importedBuild.variants[importedBuild.selectedVariantIndex] ?? importedBuild.variants[0];
    const rows = [
      ...variant.aspectTargets.map((label) => `Aspect: ${label}`),
      ...variant.affixTargets,
    ].slice(0, 24);
    setOcrStatus(`Loaded ${rows.length} imported target row(s) as suggested comparison weights.`);
  }

  function exportProfile() {
    const payload = JSON.stringify({ weightPreset, currentStats, candidateStats, profile, importedBuild }, null, 2);
    const blob = new Blob([payload], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = "d4-gear-delta-profile.json";
    link.click();
    URL.revokeObjectURL(url);
  }

  async function importProfileFile(file: File) {
    try {
      const data = JSON.parse(await file.text()) as {
        weightPreset?: string;
        currentStats?: DamageStats;
        candidateStats?: DamageStats;
        profile?: Record<string, unknown>;
        importedBuild?: ImportedBuild | null;
      };
      if (data.weightPreset) setWeightPreset(data.weightPreset);
      if (data.currentStats) setCurrentStats(coerceStoredStats(data.currentStats, false));
      if (data.candidateStats) setCandidateStats(coerceStoredStats(data.candidateStats, true));
      if (data.profile) setProfile(Object.fromEntries(GEAR_SLOTS.map((slot) => [slot, coerceStoredSlot(data.profile?.[slot])])) as Record<string, SlotData>);
      if (data.importedBuild) setImportedBuild(data.importedBuild);
      setOcrStatus("Imported saved profile JSON.");
    } catch {
      setOcrStatus("Could not read that profile JSON file.");
    }
  }

  function resetAll() {
    setCurrentStats(defaultStats(false));
    setCandidateStats(defaultStats(true));
    setProfile(emptyProfile());
    setGearScan({ equipped: emptySlot(), candidate: emptySlot() });
    setSealScan({ equipped: emptySlot(), candidate: emptySlot() });
    setImportedBuild(null);
    localStorage.removeItem(STORAGE_KEY);
  }

  return (
    <main className="app-shell">
      <section className="hero-band">
        <div>
          <p className="eyebrow">Browser version</p>
          <h1>D4 Gear Delta</h1>
          <p className="hero-copy">Screenshot-assisted Diablo IV gear, seal, and charm comparisons that can run from a free URL. Local saves stay in the browser.</p>
        </div>
        <div className="hero-actions">
          <button className="primary-button" onClick={() => setActiveTab("profile")}><Shield size={16} /> Build Profile</button>
          <button className="ghost-button" onClick={exportProfile}><Download size={16} /> Export</button>
          <button className="ghost-button" onClick={() => importFileRef.current?.click()}><Upload size={16} /> Import</button>
          <input ref={importFileRef} hidden type="file" accept="application/json" onChange={(event) => event.target.files?.[0] && void importProfileFile(event.target.files[0])} />
        </div>
      </section>

      <nav className="tab-bar" aria-label="D4 Gear Delta sections">
        {[
          ["profile", "Character Profile"],
          ["gear", "Gear Compare"],
          ["seals", "Seals & Charms"],
          ["build", "Build Import"],
          ["weights", "Manual Stats"],
        ].map(([key, label]) => (
          <button key={key} className={activeTab === key ? "active" : ""} onClick={() => setActiveTab(key as TabKey)}>{label}</button>
        ))}
      </nav>

      <section className="status-strip">
        <span>{ocrStatus}</span>
        <button onClick={resetAll}><RefreshCw size={14} /> Reset local data</button>
      </section>

      {activeTab === "profile" && (
        <section className="two-column profile-layout">
          <div className="panel gear-kit-panel">
            <div className="panel-header">
              <div>
                <p className="eyebrow">Player gear set kit</p>
                <h2>{art.name} Gear Set</h2>
              </div>
              <select value={weightPreset} onChange={(event) => setWeightPreset(event.target.value)} aria-label="Class weight profile">
                {WEIGHT_PRESETS.map((preset) => <option key={preset.name}>{preset.name}</option>)}
              </select>
            </div>
            <div className="gear-kit" style={{ "--class-accent": art.accent, "--class-glow": art.glow } as CSSProperties}>
              <div className="gear-column">
                {LEFT_SLOTS.map((slot) => <GearSlotCard key={slot} slot={slot} data={profile[slot]} selected={selectedSlot === slot} onSelect={setSelectedSlot} />)}
              </div>
              <div className="class-card">
                <div className="class-glyph">{art.motif}</div>
                <strong>{art.tag}</strong>
                <div className="baseline-box">
                  <span>Slots {profileAggregate.scanned}/{GEAR_SLOTS.length}</span>
                  <span>Mapped {profileAggregate.mapped}</span>
                  <span>Power {formatInput(profileAggregate.stats.basePower)}</span>
                  <span>Main Stat {formatInput(profileAggregate.stats.mainStat)}</span>
                  <span>Crit {formatInput(profileAggregate.stats.critChancePct)}% / {formatInput(profileAggregate.stats.critDamagePct)}%</span>
                  <span>Vuln {formatInput(profileAggregate.stats.vulnerableDamagePct)}%</span>
                </div>
              </div>
              <div className="gear-column">
                {RIGHT_SLOTS.map((slot) => <GearSlotCard key={slot} slot={slot} data={profile[slot]} selected={selectedSlot === slot} onSelect={setSelectedSlot} />)}
              </div>
            </div>
          </div>

          <div className="panel">
            <div className="panel-header">
              <div>
                <p className="eyebrow">Selected slot</p>
                <h2>{selectedSlot}</h2>
              </div>
              <button className="ghost-button" onClick={applyProfileToCurrent}><Calculator size={15} /> Apply To Current</button>
            </div>
            <ImageDropZone
              imageUrl={selectedData.imageUrl}
              label={`Paste, drop, or open ${selectedSlot}`}
              onFile={(file) => handleImageFile(file, { type: "slot" })}
              onPaste={() => pasteImage({ type: "slot" })}
              onOcr={() => runOcr({ type: "slot" })}
            />
            <textarea className="ocr-textarea" value={slotDraftText} onChange={(event) => setSlotDraftText(event.target.value)} placeholder="OCR text appears here. You can paste text manually too." />
            <div className="button-row">
              <button className="primary-button" onClick={parseSlotDraft}><Save size={15} /> Save Slot</button>
              <button className="ghost-button" onClick={() => setProfile((value) => ({ ...value, [selectedSlot]: emptySlot() }))}>Clear Slot</button>
            </div>
            <ParsedAffixTable item={selectedData} />
          </div>
        </section>
      )}

      {activeTab === "gear" && (
        <CompareSection
          title="Gear Compare"
          copy="Paste or drop the equipped item and candidate item. Formula results use your profile baseline when available."
          scan={gearScan}
          comparison={gearComparison}
          weighted={gearWeighted}
          onFile={(target, file) => handleImageFile(file, { type: "scan", mode: "gear", target })}
          onPaste={(target) => pasteImage({ type: "scan", mode: "gear", target })}
          onOcr={(target) => runOcr({ type: "scan", mode: "gear", target })}
          onText={(target, text) => updateScanText("gear", target, text)}
          onParse={(target) => parseScanSide("gear", target)}
          onClear={() => clearScan("gear")}
        />
      )}

      {activeTab === "seals" && (
        <CompareSection
          title="Seals & Charms"
          copy="Use the same two-box scan flow for non-gear bonuses. Mapped damage stats are compared against the current/profile baseline."
          scan={sealScan}
          comparison={sealComparison}
          weighted={sealWeighted}
          onFile={(target, file) => handleImageFile(file, { type: "scan", mode: "seal", target })}
          onPaste={(target) => pasteImage({ type: "scan", mode: "seal", target })}
          onOcr={(target) => runOcr({ type: "scan", mode: "seal", target })}
          onText={(target, text) => updateScanText("seal", target, text)}
          onParse={(target) => parseScanSide("seal", target)}
          onClear={() => clearScan("seal")}
        />
      )}

      {activeTab === "build" && (
        <section className="two-column">
          <div className="panel">
            <div className="panel-header">
              <div>
                <p className="eyebrow">Build source import</p>
                <h2>Guide Targets</h2>
              </div>
              <button className="primary-button" onClick={importBuild}><Search size={15} /> Import</button>
            </div>
            <input className="wide-input" value={importUrl} onChange={(event) => setImportUrl(event.target.value)} />
            <p className="muted">{importStatus}</p>
            {importedBuild && (
              <div className="build-summary">
                <h3>{importedBuild.name}</h3>
                <p>{[importedBuild.sourceName, importedBuild.className, importedBuild.season ? `S${importedBuild.season}` : "", importedBuild.lastUpdated].filter(Boolean).join(" | ")}</p>
                <button className="ghost-button" onClick={applyImportedWeights}>Apply Suggested Weights</button>
              </div>
            )}
          </div>
          <div className="panel scroll-panel">
            <h2>Imported Gear Targets</h2>
            <div className="target-list">
              {(importedBuild?.variants[importedBuild.selectedVariantIndex]?.gearSlots ?? []).map((slot) => (
                <article key={`${slot.slot}-${slot.target}`} className="target-card">
                  <strong>{slot.slot}</strong>
                  <span>{slot.kind}: {slot.target}</span>
                  <small>{[...slot.affixes.slice(0, 4), ...slot.tempers.slice(0, 2)].join(", ") || "No affix targets listed"}</small>
                </article>
              ))}
            </div>
          </div>
        </section>
      )}

      {activeTab === "weights" && (
        <section className="two-column">
          <StatsEditor title="Current Build" stats={currentStats} onChange={(key, value) => updateStat("current", key, value)} />
          <StatsEditor title="Candidate Build" stats={candidateStats} onChange={(key, value) => updateStat("candidate", key, value)} />
          <ResultPanel title="Manual Build Result" comparison={liveComparison} profileNote={profileAggregate.mapped ? `Profile baseline available: ${profileAggregate.scanned} slots / ${profileAggregate.mapped} stats` : "No profile baseline yet"} weighted={null} />
        </section>
      )}

    </main>
  );
}

function aggregateProfile(profile: Record<string, SlotData>) {
  const stats = emptyStats();
  let scanned = 0;
  let mapped = 0;
  for (const slot of Object.values(profile)) {
    if (slot.imageUrl || slot.mapped) scanned += 1;
    mapped += slot.mapped;
    for (const field of ITEM_FIELDS) {
      if (field.key === "basePower") stats.basePower = Math.max(stats.basePower, slot.stats.basePower);
      else stats[field.key] += slot.stats[field.key];
    }
  }
  return { stats, scanned, mapped };
}

function applyProfileBaseline(current: DamageStats, profileStats: DamageStats, mapped: number): DamageStats {
  if (!mapped) return current;
  const next = { ...current };
  for (const field of ITEM_FIELDS) {
    const value = profileStats[field.key];
    if (Math.abs(value) > 1e-9) next[field.key] = value;
  }
  return next;
}

function buildSlotFromText(text: string, className: string, imageUrl = "", mode: ScanMode | "profile" = "gear"): SlotData {
  const parsed = parseGearText(text);
  const mapped = statsFromAffixes(parsed.affixes, className, mode);
  return {
    ...emptySlot(),
    ...parsed,
    rawText: text,
    imageUrl,
    stats: mapped.stats,
    mapped: mapped.mapped,
  };
}

function compareScannedItems(current: DamageStats, equipped: ScanSide, candidate: ScanSide, className: string) {
  if (!equipped.mapped && !candidate.mapped) return null;
  return compareStats(current, applyItemSwap(current, equipped.stats, candidate.stats), className);
}

function GearSlotCard({ slot, data, selected, onSelect }: { slot: string; data: SlotData; selected: boolean; onSelect: (slot: string) => void }) {
  const summary = slotStatSummary(data);
  return (
    <button className={`gear-slot-card ${selected ? "selected" : ""} ${data.imageUrl || data.mapped ? "scanned" : ""}`} onClick={() => onSelect(slot)}>
      <span className="slot-icon">{SLOT_ABBREVIATIONS[slot] ?? slot.slice(0, 2)}</span>
      <span>
        <strong>{slot}</strong>
        <small>{data.name || data.itemType || "Missing screenshot"}</small>
        <em>{summary}</em>
      </span>
    </button>
  );
}

function slotStatSummary(data: SlotData): string {
  const pairs = [
    ["Power", data.stats.basePower, ""],
    ["Main", data.stats.mainStat, ""],
    ["Crit", data.stats.critChancePct, "%"],
    ["CritD", data.stats.critDamagePct, "%"],
    ["Vuln", data.stats.vulnerableDamagePct, "%"],
    ["AS", data.stats.attackSpeedPct, "%"],
  ].filter(([, value]) => Math.abs(Number(value)) > 1e-9);
  if (!pairs.length) return "No mapped stats";
  return pairs.slice(0, 2).map(([label, value, suffix]) => `${label} ${formatInput(Number(value))}${suffix}`).join(", ") + (pairs.length > 2 ? `, +${pairs.length - 2}` : "");
}

function ImageDropZone({ imageUrl, label, onFile, onPaste, onOcr }: { imageUrl: string; label: string; onFile: (file: File) => void | Promise<void>; onPaste: () => void | Promise<void>; onOcr: () => void | Promise<void> }) {
  function handleDrop(event: DragEvent<HTMLDivElement>) {
    event.preventDefault();
    const file = event.dataTransfer.files?.[0];
    if (file) void onFile(file);
  }
  return (
    <div className="drop-zone" onDragOver={(event) => event.preventDefault()} onDrop={handleDrop}>
      {/* eslint-disable-next-line @next/next/no-img-element -- User screenshots are local data URLs, not deployable assets. */}
      {imageUrl ? <img src={imageUrl} alt="Tooltip preview" /> : <span>{label}</span>}
      <div className="drop-actions">
        <label className="ghost-button"><FileImage size={14} /> Open<input hidden type="file" accept="image/*" onChange={(event) => event.target.files?.[0] && void onFile(event.target.files[0])} /></label>
        <button className="ghost-button" onClick={onPaste}><Clipboard size={14} /> Paste</button>
        <button className="ghost-button" onClick={onOcr}><Search size={14} /> OCR</button>
      </div>
    </div>
  );
}

function ParsedAffixTable({ item }: { item: SlotData }) {
  return (
    <div className="parsed-table">
      <h3>{item.name || "No item parsed"}</h3>
      <p>{[item.itemType, item.itemPower ? `${item.itemPower} power` : "", `${item.mapped} mapped`].filter(Boolean).join(" | ")}</p>
      <div>
        {item.affixes.length ? item.affixes.map((affix) => (
          <span key={`${affix.label}-${affix.value}-${affix.kind}`}>{affix.label}: {formatInput(affix.value)}</span>
        )) : <span>No parsed affixes yet</span>}
      </div>
    </div>
  );
}

function CompareSection(props: {
  title: string;
  copy: string;
  scan: Record<ScanTarget, ScanSide>;
  comparison: ReturnType<typeof compareScannedItems>;
  weighted: ReturnType<typeof compareWeighted> | null;
  onFile: (target: ScanTarget, file: File) => void | Promise<void>;
  onPaste: (target: ScanTarget) => void | Promise<void>;
  onOcr: (target: ScanTarget) => void | Promise<void>;
  onText: (target: ScanTarget, text: string) => void;
  onParse: (target: ScanTarget) => void;
  onClear: () => void;
}) {
  return (
    <section className="compare-grid">
      <div className="panel compare-main">
        <div className="panel-header">
          <div>
            <p className="eyebrow">Two screenshot compare</p>
            <h2>{props.title}</h2>
            <p className="muted">{props.copy}</p>
          </div>
          <button className="ghost-button" onClick={props.onClear}>Clear</button>
        </div>
        <div className="scan-columns">
          {(["equipped", "candidate"] as const).map((target) => (
            <article className="scan-card" key={target}>
              <h3>{target === "equipped" ? "Equipped" : "Candidate"}</h3>
              <ImageDropZone imageUrl={props.scan[target].imageUrl} label={`Drop or paste ${target} tooltip`} onFile={(file) => props.onFile(target, file)} onPaste={() => props.onPaste(target)} onOcr={() => props.onOcr(target)} />
              <textarea className="ocr-textarea" value={props.scan[target].rawText} onChange={(event) => props.onText(target, event.target.value)} placeholder="OCR/manual tooltip text" />
              <button className="primary-button" onClick={() => props.onParse(target)}>Parse {target}</button>
              <ParsedAffixTable item={props.scan[target]} />
            </article>
          ))}
        </div>
      </div>
      <ResultPanel title={`${props.title} Result`} comparison={props.comparison} weighted={props.weighted} profileNote="Uses Current Build plus any scanned Character Profile baseline." />
    </section>
  );
}

function ResultPanel({ title, comparison, weighted, profileNote }: { title: string; comparison: ReturnType<typeof compareScannedItems> | ReturnType<typeof compareStats>; weighted: ReturnType<typeof compareWeighted> | null; profileNote: string }) {
  const percent = comparison?.percentDelta ?? null;
  const topImpacts = comparison?.impacts.slice(0, 4) ?? [];
  return (
    <aside className="panel result-panel">
      <p className="eyebrow">{title}</p>
      <h2 className={percent !== null && percent > 0 ? "positive" : percent !== null && percent < 0 ? "negative" : ""}>{verdict(percent)}</h2>
      <strong className="big-result">{formatPercent(percent)}</strong>
      {comparison ? <p>{formatScore(comparison.currentScore)} → {formatScore(comparison.candidateScore)}</p> : <p>OCR or paste both item tooltips to calculate a formula result.</p>}
      <p className="muted">{profileNote}</p>
      {weighted && <p className="weighted-line">Weighted score {weighted.scoreDelta > 0 ? "+" : ""}{formatScore(weighted.scoreDelta)} pts ({formatPercent(weighted.percentDelta)})</p>}
      <div className="reason-list">
        {topImpacts.length ? topImpacts.map((impact) => (
          <span key={impact.label}>{impact.scoreDelta >= 0 ? "Gain" : "Loss"}: {impact.label} {impact.valueDelta > 0 ? "+" : ""}{formatInput(impact.valueDelta)} ({formatPercent(impact.percentDelta)})</span>
        )) : weighted?.impacts.slice(0, 4).map((impact) => (
          <span key={impact.label}>{impact.scoreDelta >= 0 ? "Gain" : "Loss"}: {impact.label} {impact.valueDelta > 0 ? "+" : ""}{formatInput(impact.valueDelta)} ({impact.scoreDelta > 0 ? "+" : ""}{formatScore(impact.scoreDelta)} pts)</span>
        )) ?? <span>No reasons yet.</span>}
      </div>
    </aside>
  );
}

function StatsEditor({ title, stats, onChange }: { title: string; stats: DamageStats; onChange: (key: StatKey, value: string) => void }) {
  return (
    <div className="panel stats-editor">
      <h2>{title}</h2>
      {FIELD_DEFS.map((field) => (
        <label key={field.key}>
          <span>{field.label}</span>
          <input value={formatInput(stats[field.key])} onChange={(event) => onChange(field.key, event.target.value)} />
        </label>
      ))}
    </div>
  );
}
