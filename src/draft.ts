// Koncept příspěvku: co se vyrobilo, co se má zkontrolovat a jak vypadá issue ke schválení.
// Druhy: Ranní pivo (NHL přes noc), Extraligový kotel (kolo extraligy).

import type { PostFacts } from './facts.ts';
import type { KotelFacts } from './kotel.ts';
import type { KotelVencaOut } from './kotelVenca.ts';
import type { Source } from './scorers.ts';
import type { VencaOut } from './venca.ts';

interface DraftBase {
  id: string;
  date: string;
  dayLabel: string;
  caption: string;
  /** Co má před vydáním zkontrolovat člověk; prázdné = kontrola prošla. */
  pozor: string[];
  model: string | null;
  createdAt: string;
  /** Veřejná adresa obrázku po nahrání do úložiště. */
  imageUrl?: string;
}

export interface RanniPivoDraft extends DraftBase {
  kind: 'ranni-pivo';
  venca: VencaOut;
  facts: PostFacts;
}

export interface KotelDraft extends DraftBase {
  kind: 'kotel';
  season: string;
  venca: KotelVencaOut;
  facts: KotelFacts;
  /** Odkud jsou střelci (jde do zprávy ke schválení). */
  sources: Source[];
}

export type Draft = RanniPivoDraft | KotelDraft;
export type DraftKind = Draft['kind'];

export const KIND_LABEL: Record<DraftKind, string> = { 'ranni-pivo': 'Ranní pivo', kotel: 'Extraligový kotel' };

/** Id konceptu: den a druh, např. 2026-11-17-ranni-pivo nebo 2026-11-15-kotel (den kola). */
export const draftId = (date: string, kind: DraftKind): string => `${date}-${kind}`;

export const DRAFT_MARK = (id: string): string => `<!-- venca:draft=${id} -->`;

/** Id konceptu z těla issue (značka, kterou tam dala úloha). */
export function draftIdFromIssue(body: string): string | null {
  const m = /<!-- venca:draft=([0-9]{4}-[0-9]{2}-[0-9]{2}-[a-z-]+) -->/.exec(body);
  return m?.[1] ?? null;
}

/** Název konceptu do zpráv: „Ranní pivo pondělí 9. 11.“, „Extraligový kotel 19. kolo“. */
export function draftTitle(d: Draft): string {
  return d.kind === 'kotel' ? `${KIND_LABEL.kotel} ${d.facts.round}. kolo` : `${KIND_LABEL[d.kind]} ${d.dayLabel}`;
}

export function issueTitle(d: Draft): string {
  return `Ke schválení: ${draftTitle(d)}`;
}

/** Tělo issue: náhled, popisek, co zkontrolovat a jak vydat. */
export function issueBody(d: Draft): string {
  const check = d.pozor.length ? d.pozor.map((p) => `- ⚠️ ${p}`).join('\n') : '- Nic. Čísla v textech sedí s daty.';
  const quoted = d.caption.split('\n').map((l) => `> ${l}`).join('\n');
  const sources = d.kind === 'kotel' && d.sources.length
    ? `\n\n**Zdroje střelců**\n\n${d.sources.map((s) => `- ${s.url} (${s.games.join(', ')})`).join('\n')}`
    : '';
  return `${DRAFT_MARK(d.id)}
${d.imageUrl ? `![${draftTitle(d)}](${d.imageUrl})` : '_(obrázek se nenahrál, je v artefaktu běhu)_'}

**Popisek na Instagram**

${quoted}

**Ke kontrole**

${check}${sources}

---
**Vydat:** napiš komentář \`/vydat\`. **Zahodit:** napiš \`/zahodit\`.
Vydat smí jen majitel repozitáře. Výraz Vency: \`${d.venca.vyraz}\`${d.model ? `, model \`${d.model}\`` : ''}.`;
}
