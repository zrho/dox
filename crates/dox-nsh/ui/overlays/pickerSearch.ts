import { computed } from "nsh";
import type { PickerItem } from "./Picker";

function normalize(text: string): string {
  return text.normalize("NFC").toLowerCase();
}

function matchRank(text: string, term: string): number {
  if (text === term) return 0;
  const position = text.indexOf(term);
  if (position === 0) return 1;
  if (position > 0) return 2 + position / text.length;

  // For a subsequence, prefer compact matches near the start of the text.
  let end = -1;
  let start = -1;
  for (const char of term) {
    end = text.indexOf(char, end + 1);
    if (end < 0) return Infinity;
    if (start < 0) start = end;
  }
  return 3 + (end - start + end) / (2 * text.length);
}

export function createPickerSearch(items: () => readonly PickerItem[], query: () => string) {
  const candidates = computed(() => items().map((item) => ({
    item,
    fields: [item.title, item.id, item.search ?? "", item.detail ?? ""].map(normalize),
  })));

  return computed(() => {
    const needle = normalize(query().trim());
    if (!needle) return items();
    const terms = needle.split(/\s+/);
    return candidates()
      .map(({ item, fields }) => ({
        item,
        rank: terms.reduce((total, term) => total + Math.min(
          ...fields.map((field, index) => matchRank(field, term) + index * 0.15),
        ), 0),
      }))
      .filter(({ rank }) => Number.isFinite(rank))
      .sort((a, b) => a.rank - b.rank)
      .map(({ item }) => item);
  });
}
