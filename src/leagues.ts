// Ligy, které sledujeme po kolech: hokejová extraliga (Extraligový kotel) a fotbalová 1. liga.
// Obě běží stejně: výsledky z TheSportsDB, kola v R2, střelci ze zpráv přes Claude API, tabulka z výsledků.
// Názvy soutěží píšeme bez sponzorů (sázkové kanceláře): „extraliga“, „1. liga“.

import { extraligaPoints, footballPoints, type PointsRule } from './kotel.ts';
import { EXTRALIGA_ID, FOTBAL_ID } from './sportsdb.ts';

export type LeagueId = 'extraliga' | 'fotbal';

export interface League {
  id: LeagueId;
  sport: 'hokej' | 'fotbal';
  tsdbId: number;
  /** Prefix uložených kol v R2 a přípona id konceptu: 2026-11-15-kotel, 2026-11-22-liga. */
  key: string;
  teamsFile: string;
  /** Název do zpráv a štítek v grafice. */
  title: string;
  label: string;
  emoji: string;
  /** Soutěž v 2. pádě do zadání pro hledání střelců. */
  competition: string;
  /** Formát pro Vencu v prompts/system.md. */
  vencaFormat: string;
  scorerDomains: string[];
  hashtags: string[];
  points: PointsRule;
}

export const LEAGUES: Record<LeagueId, League> = {
  extraliga: {
    id: 'extraliga',
    sport: 'hokej',
    tsdbId: EXTRALIGA_ID,
    key: 'kotel',
    teamsFile: 'data/extraliga-tymy.json',
    title: 'Extraligový kotel',
    label: 'EXTRALIGOVÝ KOTEL',
    emoji: '🏒',
    competition: 'hokejové extraligy',
    vencaFormat: 'kotel',
    scorerDomains: ['ceskenoviny.cz', 'hokej.cz', 'sport.ceskatelevize.cz'],
    hashtags: ['#extraliga', '#hokej', '#ExtraligovyKotel'],
    points: extraligaPoints,
  },
  fotbal: {
    id: 'fotbal',
    sport: 'fotbal',
    tsdbId: FOTBAL_ID,
    key: 'liga',
    teamsFile: 'data/fotbal-tymy.json',
    title: 'Fotbalová liga',
    label: '1. LIGA',
    emoji: '⚽',
    competition: 'fotbalové 1. ligy',
    vencaFormat: 'liga',
    scorerDomains: ['ceskenoviny.cz', 'sport.ceskatelevize.cz', 'fotbal.cz'],
    hashtags: ['#fotbal', '#1liga', '#CeskyFotbal'],
    points: footballPoints,
  },
};

/** Liga konceptu (starší koncepty Kotle ligu nemají: extraliga). */
export const leagueOf = (d: { league?: LeagueId }): League => LEAGUES[d.league ?? 'extraliga'];
