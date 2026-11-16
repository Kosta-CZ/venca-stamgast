import { readFileSync } from 'node:fs';
import { describe, expect, it, vi } from 'vitest';
import {
  checkSources, checkSpecialVenca, confirmInvite, confirmResult, findInvite, findResult, parseInvite, parseRecord, pickEvent,
  specialCaption, specialDisclaimer, specialId, specialUserMessage, toPrague, type InviteReport, type ResultReport, type SpecialEvent,
} from '../src/special.ts';
import { specialHtml } from '../src/render/special.ts';
import { approvalText } from '../src/telegram.ts';
import { draftIdFromIssue, issueBody, type Draft } from '../src/draft.ts';
import { parseCallback } from '../worker/src/index.ts';

const EVENT = JSON.parse(readFileSync(new URL('../data/specialy/2026-11-21-prochazka.json', import.meta.url), 'utf8')) as SpecialEvent;

const inviteA: InviteReport = {
  found: true, opponent: 'Navajo Stirling', czechRecord: '32-6-1', opponentRecord: '11-0-0', city: 'Dauhá', arena: 'ABHA Arena',
  date: '2026-11-21', start: { time: '1:00 PM', zone: 'ET' }, weightClass: 'polotěžká', rounds: 5, sources: ['https://www.ufc.com/event/x'], note: '',
};
const inviteB: InviteReport = { ...inviteA, city: 'Doha', arena: 'Abha Arena', start: { time: '19:00', zone: 'SEČ' }, sources: ['https://isport.blesk.cz/clanek/1'] };
const resultA: ResultReport = { finished: true, winner: 'Jiří Procházka', method: 'TKO', round: 2, time: '3:12', sources: ['https://www.ufc.com/event/x'], note: '' };
const resultB: ResultReport = { ...resultA, winner: 'Procházka', method: 'KO', time: '03:12', sources: ['https://isport.blesk.cz/clanek/2'] };

describe('speciál: akce a časy', () => {
  it('popis akce na sobotu 21. 11.', () => {
    expect(EVENT.cech).toBe('Jiří Procházka');
    expect(specialId(EVENT, 'pozvanka')).toBe('2026-11-21-mma-pozvanka');
    expect(parseCallback(`vydat:${specialId(EVENT, 'vysledek')}`)?.id).toBe('2026-11-21-mma-vysledek');
  });

  it('pozvánka jen v den akce, výsledek i den po ní', () => {
    expect(pickEvent([EVENT], 'pozvanka', '2026-11-21')).toBe(EVENT);
    expect(pickEvent([EVENT], 'pozvanka', '2026-11-22')).toBeUndefined();
    expect(pickEvent([EVENT], 'vysledek', '2026-11-22')).toBe(EVENT);
    expect(pickEvent([EVENT], 'vysledek', '2026-11-23')).toBeUndefined();
  });

  it('čas ze zdroje převede kód na pražský čas', () => {
    expect(toPrague('2026-11-21', '13:00', 'ET')).toEqual({ date: '2026-11-21', time: '19:00' });
    expect(toPrague('2026-11-21', '1:00 PM', 'ET')).toEqual({ date: '2026-11-21', time: '19:00' });
    expect(toPrague('2026-11-21', '10:00 AM', 'PT')).toEqual({ date: '2026-11-21', time: '19:00' });
    expect(toPrague('2026-11-21', '21:00', 'místní čas', 'Asia/Qatar')).toEqual({ date: '2026-11-21', time: '19:00' });
    expect(toPrague('2026-11-21', '21:00', 'GMT+3')).toEqual({ date: '2026-11-21', time: '19:00' });
    expect(toPrague('2026-11-21', '19.00', 'SEČ')).toEqual({ date: '2026-11-21', time: '19:00' });
    expect(toPrague('2026-11-21', '18:00', 'UTC')).toEqual({ date: '2026-11-21', time: '19:00' });
    expect(toPrague('2026-07-04', '13:00', 'ET')).toEqual({ date: '2026-07-04', time: '19:00' });
    expect(toPrague('2026-11-21', '23:30', 'ET')).toEqual({ date: '2026-11-22', time: '05:30' });
    expect(toPrague('2026-11-21', 'večer', 'ET')).toBeNull();
    expect(toPrague('2026-11-21', '13:00', 'Mars')).toBeNull();
  });

  it('bilance', () => {
    expect(parseRecord('32-6-1')).toEqual([32, 6, 1]);
    expect(parseRecord('32–6–1 (1 NC)')).toEqual([32, 6, 1]);
    expect(parseRecord('11-0')).toEqual([11, 0, 0]);
    expect(parseRecord(null)).toBeNull();
  });
});

describe('speciál: dva nezávislé zdroje', () => {
  it('pozvánka: shoda obou zdrojů (Doha = Dauhá, ET = SEČ) projde bez výhrad', () => {
    const { facts, pozor } = confirmInvite(EVENT, inviteA, inviteB, []);
    expect(pozor).toEqual([]);
    expect(facts.czech).toEqual({ name: 'Jiří Procházka', record: '32-6-1' });
    expect(facts.opponent).toEqual({ name: 'Navajo Stirling', record: '11-0-0' });
    expect(facts.rows).toEqual([
      { label: 'Akce', value: 'UFC Fight Night' },
      { label: 'Místo', value: 'ABHA Arena, Dauhá' },
      { label: 'Hlavní karta', value: 'sobota 19:00 našeho času' },
      { label: 'Zápas', value: 'polotěžká váha · 5 kol' },
    ]);
  });

  it('pozvánka: rozpor, chybějící údaj a jiný soupeř jdou do pozor', () => {
    const { pozor } = confirmInvite(EVENT, { ...inviteA, opponentRecord: '12-0-0', opponent: 'Carlos Ulberg' }, { ...inviteB, start: null, opponent: 'Carlos Ulberg' }, []);
    const p = pozor.join('\n');
    expect(p).toContain('Bilance soupeře: zdroje se liší (12-0-0 × 11-0-0)');
    expect(p).toContain('Začátek hlavní karty: jen v jednom zdroji');
    expect(p).toContain('Soupeř se změnil?');
  });

  it('výsledek: KO a TKO se berou jako shoda, 03:12 = 3:12', () => {
    const r = confirmResult(EVENT, resultA, resultB, [], { czech: { name: 'Jiří Procházka', record: '32-6-1' }, opponent: { name: 'Navajo Stirling', record: '11-0-0' } })!;
    expect(r.pozor).toEqual([]);
    expect(r.facts.winner).toBe('Jiří Procházka');
    expect(r.facts.rows).toEqual([{ label: 'Způsob', value: 'TKO' }, { label: 'Kolo', value: '2.' }, { label: 'Čas', value: '3:12' }]);
    expect(r.facts.czech.record).toBe('32-6-1');
  });

  it('výsledek: jiné kolo nebo vítěz jde do pozor, nedohraný zápas dá null', () => {
    const r = confirmResult(EVENT, resultA, { ...resultB, round: 3, winner: 'Navajo Stirling' }, [])!;
    expect(r.pozor.join('\n')).toContain('Kolo: zdroje se liší (2 × 3)');
    expect(r.pozor.join('\n')).toContain('Vítěz: zdroje se liší');
    expect(confirmResult(EVENT, resultA, { ...resultB, finished: false }, [])).toBeNull();
  });

  it('odkazy jen z povolených webů a jen ty, které Claude viděl', () => {
    const pozor: string[] = [];
    const good = checkSources('Zdroje A', ['https://www.ufc.com/event/x', 'https://www.ufc.com/vymysl', 'https://www.idnes.cz/x'], EVENT.zdroje_a, ['https://ufc.com/event/x'], pozor);
    expect(good).toEqual(['https://www.ufc.com/event/x']);
    expect(pozor.join('\n')).toContain('nebyl ve výsledcích hledání');
    expect(pozor.join('\n')).toContain('mimo povolené weby');
  });

  it('celé hledání: dvě nezávislá hledání s různými weby a porovnání', async () => {
    const bodies: { tools: { allowed_domains: string[] }[] }[] = [];
    const reply = (domains: string[]) => {
      const a = domains.includes('ufc.com');
      const url = a ? 'https://www.ufc.com/event/x' : 'https://isport.blesk.cz/clanek/1';
      const r = a ? inviteA : inviteB;
      const json = { nalezeno: true, souper: r.opponent, bilance_cecha: r.czechRecord, bilance_soupere: r.opponentRecord, mesto: r.city, arena: r.arena, datum: r.date, hlavni_karta: { cas: r.start!.time, pasmo: r.start!.zone }, vaha: r.weightClass, pocet_kol: r.rounds, zdroje: [url], poznamka: '' };
      return {
        id: 'm', type: 'message', role: 'assistant', model: 'claude-sonnet-5-5', stop_reason: 'end_turn', stop_sequence: null,
        usage: { input_tokens: 1, output_tokens: 1, server_tool_use: { web_search_requests: 1, web_fetch_requests: 0 } },
        content: [
          { type: 'server_tool_use', id: 's1', name: 'web_search', input: { query: 'q' } },
          { type: 'web_search_tool_result', tool_use_id: 's1', content: [{ type: 'web_search_result', url, title: 't', encrypted_content: 'e', page_age: null }] },
          { type: 'text', text: JSON.stringify(json) },
        ],
      };
    };
    const f = vi.fn(async (_url: unknown, init?: RequestInit) => {
      const body = JSON.parse(String(init?.body));
      bodies.push(body);
      return new Response(JSON.stringify(reply(body.tools[0].allowed_domains)), { headers: { 'content-type': 'application/json' } });
    });
    const res = await findInvite({ fetch: f as unknown as typeof fetch, apiKey: 'k', model: 'claude-sonnet-5-5' }, EVENT);
    expect(res.pozor).toEqual([]);
    expect(res.facts.sources).toEqual(['https://www.ufc.com/event/x', 'https://isport.blesk.cz/clanek/1']);
    expect(bodies.map((b) => b.tools[0]!.allowed_domains)).toEqual(expect.arrayContaining([EVENT.zdroje_a, EVENT.zdroje_b]));
  });

  it('výsledek, který ještě není ve zdrojích, vrátí čekání', async () => {
    const f = vi.fn(async () => new Response(JSON.stringify({
      id: 'm', type: 'message', role: 'assistant', model: 'x', stop_reason: 'end_turn', stop_sequence: null, usage: { input_tokens: 1, output_tokens: 1 },
      content: [{ type: 'text', text: '{"skonceno": false, "poznamka": "zápas ještě běží"}' }],
    }), { headers: { 'content-type': 'application/json' } }));
    const r = await findResult({ fetch: f as unknown as typeof fetch, apiKey: 'k', model: 'x' }, EVENT, undefined);
    expect('waiting' in r && r.waiting).toContain('zápas ještě běží');
  });

  it('JSON z hledání: nenalezený zápas', () => {
    expect(parseInvite('{"nalezeno": false, "poznamka": "nic"}').found).toBe(false);
  });
});

describe('speciál: Venca a šablona', () => {
  const invite = confirmInvite(EVENT, inviteA, inviteB, ['https://www.ufc.com/event/x', 'https://isport.blesk.cz/clanek/1']).facts;
  const result = confirmResult(EVENT, resultA, resultB, invite.sources, invite)!.facts;

  it('čísla z dat projdou, posměch knockoutu a vymyšlené číslo jdou do pozor', () => {
    const ok = checkSpecialVenca({ titulek: 'Jirka v sobotu v 19:00', hlaska: 'Bilance 32-6-1 a nervy na dranc.', popisek: 'Budete koukat?', hashtagy: [], vyraz: 'nervozita', pozor: [] }, invite, EVENT.hashtagy);
    expect(ok.pozor).toEqual([]);
    expect(ok.hashtagy).toEqual(EVENT.hashtagy);
    const bad = checkSpecialVenca({ titulek: 'Uspal ho ve 2. kole', hlaska: 'Stirling šel spát po 14 sekundách.', popisek: 'P', vyraz: 'vztek' }, result, EVENT.hashtagy);
    const p = bad.pozor.join('\n');
    expect(p).toContain('posměch');
    expect(p).toContain('14');
    expect(bad.vyraz).toBe('zklamani');
  });

  it('data pro Vencu: formát a vítěz', () => {
    expect(specialUserMessage(invite)).toContain('FORMÁT: mma_pozvanka');
    const msg = specialUserMessage(result);
    expect(msg).toContain('FORMÁT: mma_vysledek');
    expect(msg).toContain('"vitez": "Jiří Procházka"');
  });

  it('popisek a patička se zdroji', () => {
    expect(specialDisclaimer(invite.sources)).toBe('Fiktivní AI postava. Údaje ověřené ve dvou zdrojích: UFC, iSport.');
    expect(specialCaption({ popisek: 'P', hashtagy: ['#UFC'] }, invite.sources)).toContain('Fiktivní AI postava');
  });

  it('šablona: pozvánka s údaji, výsledek s vítězem', () => {
    const v = { titulek: '<b>T</b>', hlaska: 'H', vyraz: 'nervozita' as const };
    const a = specialHtml({ facts: invite, venca: v, disclaimer: 'D' });
    expect(a).toContain('PROCHÁZKA');
    expect(a).toContain('STIRLING');
    expect(a).toContain('ABHA Arena, Dauhá');
    expect(a).toContain('POZVÁNKA · SOBOTA 21. 11.');
    expect(a).toContain('&lt;b&gt;T&lt;/b&gt;');
    expect(a).not.toContain('VÍTĚZ');
    const b = specialHtml({ facts: result, venca: v, disclaimer: 'D' });
    expect(b).toContain('VÍTĚZ');
    expect(b).toContain('TKO');
    expect(b).toContain('3:12');
  });

  it('zpráva ke schválení a issue', () => {
    const d: Draft = {
      id: specialId(EVENT, 'vysledek'), kind: 'special', stage: 'vysledek', date: EVENT.datum, dayLabel: 'sobota 21. 11.', caption: 'C',
      venca: { titulek: 'T', hlaska: 'H', popisek: 'C', hashtagy: [], vyraz: 'radost', pozor: [] }, facts: result, pozor: [], model: null, createdAt: '',
    };
    const t = approvalText(d);
    expect(t).toContain('Speciál UFC · výsledek: vítěz Jiří Procházka');
    expect(t).toContain('Zdroje (dvě nezávislá hledání)');
    expect(t).toContain('isport.blesk.cz/clanek/1');
    expect(draftIdFromIssue(issueBody(d))).toBe('2026-11-21-mma-vysledek');
  });
});
