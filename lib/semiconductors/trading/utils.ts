import type { TradeBlockReason } from "./types";

export function blockReason(
  source: TradeBlockReason["source"],
  code: string,
  message: string,
  severity: TradeBlockReason["severity"] = "error"
): TradeBlockReason {
  return { source, code, message, severity };
}

export function roundMoney(value: number) {
  return Math.round(value * 100) / 100;
}

export function roundQuantity(value: number) {
  return Math.max(0, Math.floor(value));
}

export function compactBlockReasonMessages(reasons: TradeBlockReason[]) {
  return reasons.map((reason) => `${reason.code}: ${reason.message}`);
}

export function stableId(prefix: string, parts: unknown[]) {
  const value = stableStringify(parts);
  let hash = 0x811c9dc5;

  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 0x01000193);
  }

  return `${prefix}_${(hash >>> 0).toString(36)}`;
}

function stableStringify(value: unknown): string {
  if (value === null || typeof value !== "object") {
    return JSON.stringify(value);
  }

  if (Array.isArray(value)) {
    return `[${value.map((item) => stableStringify(item)).join(",")}]`;
  }

  const entries = Object.entries(value as Record<string, unknown>).sort(([left], [right]) => left.localeCompare(right));
  return `{${entries.map(([key, entryValue]) => `${JSON.stringify(key)}:${stableStringify(entryValue)}`).join(",")}}`;
}
