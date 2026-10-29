import { createMemo, For } from 'solid-js';

export type Match = { score: number; positions: number[] };

// Ordered subsequences, favoring adjacent characters and word boundaries.
export function fuzzyMatch(text: string, query: string): Match | undefined {
  if (!query) return { score: 0, positions: [] };
  const lower = text.toLowerCase();
  let best: Match | undefined;
  for (let start = 0; start < lower.length; start++) {
    if (lower[start] !== query[0]) continue;
    const positions: number[] = [];
    let cursor = start;
    let score = -start - text.length * 0.01;
    for (let queryIndex = 0; queryIndex < query.length; queryIndex++) {
      const char = query[queryIndex];
      const found = lower.indexOf(char, cursor);
      if (found < 0) break;
      const previous = positions.at(-1);
      score += 10;
      if (previous !== undefined) score += found === previous + 1 ? 18 : -(found - previous - 1);
      if (found === 0 || /[\s_\-/.:]/.test(text[found - 1])) score += 14;
      if (found > 0 && /[a-z]/.test(text[found - 1]) && /[A-Z]/.test(text[found])) score += 8;
      positions.push(found);
      cursor = found + 1;
    }
    if (positions.length === query.length && (!best || score > best.score)) best = { score, positions };
  }
  return best;
}

export function MatchText(props: { text: string; positions: number[] }) {
  const segments = createMemo(() => {
    const matches = new Set(props.positions);
    const parts: { text: string; matched: boolean }[] = [];
    for (let i = 0; i < props.text.length; i++) {
      const matched = matches.has(i);
      const previous = parts.at(-1);
      if (previous?.matched === matched) previous.text += props.text[i];
      else parts.push({ text: props.text[i], matched });
    }
    return parts;
  });
  return <For each={segments()}>{part => <span classList={{ 'picker-match': part.matched }}>{part.text}</span>}</For>;
}

