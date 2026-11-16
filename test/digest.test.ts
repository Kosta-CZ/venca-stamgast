import { readFileSync } from 'node:fs';
import { describe, expect, it, vi } from 'vitest';
import {
  checkDigestVenca, confirmDigest, digestCaption, digestFacts, digestRows, digestUserMessage, findDigest, isActive, parseDigest, period, periodLabel, scoreKey,
  type DigestConfig, type DigestReport, type Performance,
} from '../src/digest.ts';
import { digestHtml, MAX_ROWS } from '../src/render/digest.ts';
import { approvalText } from '../src/telegram.ts';
import { draftIdFromIssue, issueBody, issueTitle, type Draft } from '../src/draft.ts';
import { parseCallback } from '../worker/src/index.ts';

const load = (id: string) => JSON.parse(readFileSync(new URL(`../data/prehledy/${id}.json`, import.meta.url), 'utf8')) as DigestConfig;
const LEG = load('legionari');
const TEN = load('tenis');
const CIZ = load('cizina');

const perf = (o: Partial<Performance>): Performance => ({ player: 'David Kämpf', team: 'Rögle', competition: 'SHL', stage: '', date: '2026-11-18', opponent: 'Frölunda', score: '4:2', won: true, goals: 1, assists: 1, ...o });
const rep = (items: Performance[], sources: string[] = [], note = ''): DigestReport => ({ items, sources, note });
const P = { from: '2026-11-16', to: '2026-11-22' };

describe('přehledy: období a popisy', () => {
  it('týden do neděle a včerejšek', () => {
    expect(period(LEG, '2026-11-23')).toEqual({ from: '2026-11-16', to: '2026-11-22' });
    expect(periodLabel(period(LEG, '2026-11-23'))).toBe('16.–22. 11.');
    expect(periodLabel(period(LEG, '2026-12-03'))).toBe('26. 11.–2. 12.');
    expect(periodLabel(period(TEN, '2027-01-20'))).toBe('19. 1.');
  });

  it('popisy přehledů: KHL vyloučená, tenis jen do konce Australian Open', () => {
    expect(LEG.vyloucit).toContain('KHL');
    expect(LEG.zadani).not.toMatch(/\bKHL\b/);
    expect(isActive(TEN, '2027-01-20')).toBe(true);
    expect(isActive(TEN, '2027-02-02')).toBe(false);
    expect(isActive(CIZ, '2030-01-01')).toBe(true);
    for (const c of [LEG, TEN, CIZ]) {
      expect(c.zdroje_a.some((d) => c.zdroje_b.includes(d))).toBe(false);
      expect(c.zdroje_a).not.toContain('idnes.cz');
      expect(c.zdroje_b).not.toContain('idnes.cz');
    }
  });
});

describe('přehledy: dvě nezávislá hledání', () => {
  it('JSON odpovědi: neplatné datum se zahodí, čísla jako text se přečtou', () => {
    const r = parseDigest('```json\n{"vykony":[{"hrac":"David Kämpf","tym":"Rögle","soutez":"SHL","datum":"2026-11-18","souper":"Frölunda","skore":"4:2","vyhra":true,"goly":"1","asistence":1},{"hrac":"X","datum":"včera"}],"zdroje":["https://www.shl.se/x"],"poznamka":""}\n```');
    expect(r.items).toHaveLength(1);
    expect(r.items[0]).toMatchObject({ goals: 1, assists: 1, won: true });
    expect(r.sources).toEqual(['https://www.shl.se/x']);
    expect(() => parseDigest('nic')).toThrow();
  });

  it('skóre bez přípon a tiebreaků', () => {
    expect(scoreKey('7:6(5) 6:4')).toBe('7:6 6:4');
    expect(scoreKey('3:2 pp')).toBe('3:2');
    expect(scoreKey('4–2')).toBe('4:2');
  });

  it('do grafiky jen výkon, který sedí v obou; den ±1 kvůli časovým pásmům; rozpor a KHL ne', () => {
    const a = rep([
      perf({}),
      perf({ player: 'Jakub Flek', team: 'Tappara', competition: 'Liiga', opponent: 'HIFK', score: '3:1', goals: 2, assists: 0, date: '2026-11-19' }),
      perf({ player: 'Radim Šimek', team: 'Bridgeport', competition: 'AHL', opponent: 'Hartford', score: '5:4 pp', goals: 0, assists: 1, date: '2026-11-21' }),
      perf({ player: 'Ivan Novák', team: 'SKA', competition: 'KHL', opponent: 'CSKA', score: '2:1' }),
      perf({ player: 'Tomáš Jedlička', team: 'Mannheim', competition: 'DEL', opponent: 'Köln', score: '2:3', won: false, goals: 1, assists: 0, date: '2026-11-20' }),
    ], [], 'jeden zápas nejistý');
    const b = rep([
      perf({ player: 'Kämpf', opponent: 'Frolunda HC' }),
      perf({ player: 'J. Flek', team: 'Tappara', opponent: 'HIFK', score: '3:1', goals: 1, assists: 1, date: '2026-11-19' }),
      perf({ player: 'Radim Šimek', team: 'Bridgeport', opponent: 'Hartford Wolf Pack', score: '5:4', goals: 0, assists: 1, date: '2026-11-22' }),
      perf({ player: 'Ivan Novák', team: 'SKA', competition: 'KHL', opponent: 'CSKA', score: '2:1' }),
      perf({ player: 'Pavel Jiný', team: 'Lugano', competition: 'NL', opponent: 'Bern', score: '1:0', date: '2026-11-17' }),
    ]);
    const c = confirmDigest(LEG, a, b, P);
    expect(c.items.map((x) => x.player)).toEqual(['David Kämpf', 'Radim Šimek']);
    const p = c.pozor.join('\n');
    expect(p).toContain('Jakub Flek');
    expect(p).toContain('góly 2 × 1');
    expect(p).toContain('2 výkony byly jen v jednom zdroji');
    expect(p).toContain('jeden zápas nejistý');
    expect(p).not.toContain('Novák');
  });

  it('hokej: hráč za týden sečtený, tenis: každý zápas zvlášť', () => {
    const rows = digestRows('hokej', [perf({}), perf({ date: '2026-11-20', opponent: 'Luleå', score: '2:3', won: false, goals: 1, assists: 0 }), perf({ player: 'Jan Rutta', team: 'Ambrì', opponent: 'Zug', goals: 0, assists: 1 })]);
    expect(rows[0]).toMatchObject({ player: 'David Kämpf', value: '2+1', detail: 'Frölunda 4:2 · Luleå 2:3' });
    expect(rows[1]).toMatchObject({ player: 'Jan Rutta', value: '0+1' });
    const t = digestRows('tenis', [perf({ player: 'Jiří Lehečka', team: '', competition: 'Australian Open', stage: '2. kolo', opponent: 'Alcaraz', score: '3:6 6:7(4) 4:6', won: false, goals: null, assists: null }), perf({ player: 'Karolína Muchová', team: '', competition: 'Australian Open', stage: '2. kolo', opponent: 'Kasatkina', score: '6:4 6:2', won: true, goals: null, assists: null })]);
    expect(t.map((r) => r.player)).toEqual(['Karolína Muchová', 'Jiří Lehečka']);
    expect(t[1]).toMatchObject({ where: 'Australian Open, 2. kolo', detail: 'prohra · Alcaraz', value: '3:6 6:7(4) 4:6' });
  });

  it('celé hledání: dvě skupiny webů, potvrzený výkon a odkazy z obou', async () => {
    const bodies: string[][] = [];
    const reply = (domains: string[]) => {
      const a = domains.includes('eliteprospects.com');
      const url = a ? 'https://www.eliteprospects.com/game/1' : 'https://www.hokej.cz/legionari/1';
      const json = { vykony: [{ hrac: 'David Kämpf', tym: 'Rögle', soutez: 'SHL', datum: '2026-11-18', souper: 'Frölunda', skore: '4:2', vyhra: true, goly: 1, asistence: 1 }], zdroje: [url], poznamka: '' };
      return {
        id: 'm', type: 'message', role: 'assistant', model: 'claude-sonnet-5-5', stop_reason: 'end_turn', stop_sequence: null, usage: { input_tokens: 1, output_tokens: 1 },
        content: [
          { type: 'server_tool_use', id: 's1', name: 'web_search', input: { query: 'q' } },
          { type: 'web_search_tool_result', tool_use_id: 's1', content: [{ type: 'web_search_result', url, title: 't', encrypted_content: 'e', page_age: null }] },
          { type: 'text', text: JSON.stringify(json) },
        ],
      };
    };
    const f = vi.fn(async (_u: unknown, init?: RequestInit) => {
      const body = JSON.parse(String(init?.body));
      bodies.push(body.tools[0].allowed_domains);
      return new Response(JSON.stringify(reply(body.tools[0].allowed_domains)), { headers: { 'content-type': 'application/json' } });
    });
    const r = await findDigest({ fetch: f as unknown as typeof fetch, apiKey: 'k', model: 'claude-sonnet-5-5' }, LEG, '2026-11-23');
    expect(r.pozor).toEqual([]);
    expect(r.facts.rows).toEqual([expect.objectContaining({ player: 'David Kämpf', value: '1+1' })]);
    expect(r.facts.sources).toHaveLength(2);
    expect(bodies).toEqual(expect.arrayContaining([LEG.zdroje_a, LEG.zdroje_b]));
  });
});

describe('přehledy: Venca, grafika, schválení', () => {
  const items = Array.from({ length: 9 }, (_, i) => perf({ player: `Hráč${String.fromCharCode(65 + i)} Příjmení${i}`, team: `Tým ${i}`, goals: i % 3, assists: 1, opponent: `Soupeř ${i}` }));
  const facts = digestFacts(LEG, P, items, ['https://www.eliteprospects.com/g', 'https://www.hokej.cz/l']);

  it('hrdina musí být v datech, čísla z dat, KHL a sponzor do pozor', () => {
    const ok = checkDigestVenca({ hrdina: 'Příjmení2', titulek: 'Týden legionářů', hlaska: 'Dva góly a 9 hráčů v akci.', popisek: 'Kdo vás potěšil?', vyraz: 'radost' }, facts, LEG.hashtagy);
    expect(ok.pozor).toEqual([]);
    expect(ok.hrdina).toBe('HráčC Příjmení2');
    expect(ok.hashtagy).toEqual(LEG.hashtagy);
    const bad = checkDigestVenca({ hrdina: 'Jágr', titulek: 'T', hlaska: 'Lepší než v KHL, 17 gólů.', popisek: 'Tipsport bonus.', vyraz: 'radost' }, facts, LEG.hashtagy);
    const p = bad.pozor.join('\n');
    expect(p).toContain('Jágr');
    expect(p).toContain('17');
    expect(p).toContain('KHL');
    expect(p).toContain('sázkovou kancelář');
  });

  it('data pro Vencu: formát podle přehledu, výkony a hráči v grafice', () => {
    const msg = digestUserMessage(facts);
    expect(msg).toContain('FORMÁT: legionari');
    expect(msg).toContain('"hraci_v_grafice"');
  });

  it('grafika: hrdina nahoře, ostatní pod ním, zbytek do popisku stejně jako v grafice', () => {
    const f = { ...facts, hero: facts.rows[5]!.player };
    const html = digestHtml({ facts: f, venca: { titulek: '<T>', hlaska: 'H', vyraz: 'radost' }, disclaimer: 'D' });
    expect(html).toContain('LEGIONÁŘI · <span');
    expect(html).toContain('ČEŠI V EVROPĚ A AHL');
    expect(html).toContain(f.hero.toUpperCase());
    expect(html).toContain('+ 2 další v popisku');
    expect(html).toContain('&lt;T&gt;');
    const others = f.rows.filter((r) => r.player !== f.hero);
    const caption = digestCaption({ popisek: 'P', hashtagy: ['#hokej'] }, f, MAX_ROWS);
    for (const r of others.slice(MAX_ROWS)) expect(caption).toContain(r.player);
    for (const r of others.slice(0, MAX_ROWS)) expect(caption).not.toContain(r.player);
    expect(caption).toContain('Fiktivní AI postava');
  });

  it('koncept přehledu v Telegramu a v issue', () => {
    const d: Draft = {
      id: '2026-11-22-legionari', kind: 'prehled', digest: 'legionari', date: '2026-11-22', dayLabel: facts.periodLabel, caption: 'C',
      venca: { hrdina: 'HráčA Příjmení0', titulek: 'T', hlaska: 'H', popisek: 'C', hashtagy: [], vyraz: 'radost', pozor: [] },
      facts, pozor: [], model: null, createdAt: '',
    };
    expect(approvalText(d)).toContain('🏒 <b>Legionáři · 16.–22. 11.</b>');
    expect(approvalText(d)).toContain('Zdroje (dvě nezávislá hledání)');
    expect(issueTitle(d)).toBe('Ke schválení: Legionáři 16.–22. 11.');
    expect(draftIdFromIssue(issueBody(d))).toBe('2026-11-22-legionari');
    expect(parseCallback(`zahodit:${d.id}`)?.id).toBe(d.id);
  });
});
