/**
 * Applies only high-confidence Small Tools name spelling fixes.
 * Leaves ambiguous product classes (e.g. GENERATOR vs GENNY) unchanged.
 */
export function normalizeObviousInventoryItemName(name: string): string {
  let next = name;

  // Longer typo first so GENNEY is not partially rewritten by GENY.
  next = replaceWholeWord(next, 'GENNEY', 'GENNY');
  next = replaceWholeWord(next, 'GENY', 'GENNY');
  next = replaceWholeWord(next, 'LAZER', 'LASER');
  next = replaceWholeWord(next, 'STHIL', 'STIHL');
  next = replaceWholeWord(next, 'CAT4', 'CAT 4');
  next = replaceWholeWord(next, 'e CAT 4', 'CAT 4 E');
  next = replaceWholeWord(next, 'circle saw', 'CIRCULAR SAW');

  // Slash spacing: "GENNY /CAT" -> "GENNY / CAT"
  next = next.replace(/\/(?=\S)/g, '/ ');

  // Whole-name lowercase cleanup only (inventory is mostly UPPERCASE).
  if (next.length > 0 && next === next.toLowerCase() && next !== next.toUpperCase()) {
    next = next.toUpperCase();
  }

  return next.replace(/\s+/g, ' ').trim();
}

function replaceWholeWord(value: string, from: string, to: string): string {
  const pattern = new RegExp(`(^|[^A-Za-z0-9])(${escapeRegExp(from)})(?=[^A-Za-z0-9]|$)`, 'gi');
  return value.replace(pattern, (_match, prefix: string) => `${prefix}${to}`);
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}
