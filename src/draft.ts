// Koncept příspěvku: co se vyrobilo, co se má zkontrolovat a jak vypadá issue ke schválení.

import type { PostFacts } from './facts.ts';
import type { VencaOut } from './venca.ts';

export interface Draft {
  id: string;
  kind: 'ranni-pivo';
  date: string;
  dayLabel: string;
  caption: string;
  venca: VencaOut;
  facts: PostFacts;
  /** Co má před vydáním zkontrolovat člověk; prázdné = kontrola prošla. */
  pozor: string[];
  model: string | null;
  createdAt: string;
  /** Veřejná adresa obrázku po nahrání do úložiště. */
  imageUrl?: string;
}

export const draftId = (date: string, kind: Draft['kind']): string => `${date}-${kind}`;

export const DRAFT_MARK = (id: string): string => `<!-- venca:draft=${id} -->`;

/** Id konceptu z těla issue (značka, kterou tam dala ranní úloha). */
export function draftIdFromIssue(body: string): string | null {
  const m = /<!-- venca:draft=([0-9]{4}-[0-9]{2}-[0-9]{2}-[a-z-]+) -->/.exec(body);
  return m?.[1] ?? null;
}

export function issueTitle(d: Pick<Draft, 'kind' | 'dayLabel'>): string {
  return `Ke schválení: Ranní pivo ${d.dayLabel}`;
}

/** Tělo issue: náhled, popisek, co zkontrolovat a jak vydat. */
export function issueBody(d: Draft): string {
  const check = d.pozor.length ? d.pozor.map((p) => `- ⚠️ ${p}`).join('\n') : '- Nic. Čísla v textech sedí s daty.';
  const quoted = d.caption.split('\n').map((l) => `> ${l}`).join('\n');
  return `${DRAFT_MARK(d.id)}
${d.imageUrl ? `![Ranní pivo ${d.dayLabel}](${d.imageUrl})` : '_(obrázek se nenahrál, je v artefaktu běhu)_'}

**Popisek na Instagram**

${quoted}

**Ke kontrole**

${check}

---
**Vydat:** napiš komentář \`/vydat\`. **Zahodit:** napiš \`/zahodit\`.
Vydat smí jen majitel repozitáře. Výraz Vency: \`${d.venca.vyraz}\`${d.model ? `, model \`${d.model}\`` : ''}.`;
}
