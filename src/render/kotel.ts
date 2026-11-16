// Šablona Extraligového kotle (styl v2): kolo extraligy s výsledky a střelci, špička tabulky a Venca.
// Čistá funkce: fakta + Vencovy texty → HTML 1080 × 1350.

import { played, shortDate, SUFFIX, type KotelFacts, type KotelGame, type KotelScorer } from '../kotel.ts';
import type { VencaOut } from '../venca.ts';
import { vencaSvg } from './avatar.ts';
import { esc, SIZE } from './ranniPivo.ts';

export { SIZE };

const BG = '#10291F', CARD = '#17382B', MUTED = '#9FB8AC', SOFT = '#C9D6CE', INK = '#F4EFE4', ACC = '#F5B027';
const MONO = "font-family:'JetBrains Mono',monospace;";
const COND = 'font-stretch:75%;';

export const KOTEL_DISCLAIMER = 'Fiktivní AI postava. Výsledky z TheSportsDB, střelci ze zpráv ČTK.';

export interface KotelInput {
  facts: KotelFacts;
  venca: Pick<VencaOut, 'titulek' | 'hlaska' | 'vyraz'>;
}

function scorers(list: readonly KotelScorer[], hero?: string): string {
  return list
    .map((s) => {
      const text = esc(s.goals > 1 ? `${s.name} ${s.goals}` : s.name);
      return hero && s.name === hero ? `<b style="color:${ACC}">${text}</b>` : text;
    })
    .join(', ');
}

function gameRow(g: KotelGame, hero?: string): string {
  const teams = `<span class="t">${esc(g.home)} – ${esc(g.away)}</span>`;
  if (!played(g)) {
    const when = g.postponedTo ? `hraje se ${shortDate(g.postponedTo)}` : 'bez výsledku';
    return `<div class="g"><div class="r">${teams}<span class="p">${esc(when)}</span></div></div>`;
  }
  const suffix = SUFFIX[g.ending] ? `<small>${SUFFIX[g.ending]}</small>` : '';
  const goals = [scorers(g.homeScorers, hero), scorers(g.awayScorers, hero)].filter(Boolean).join(' – ');
  const so = g.ending === 'so' && g.shootoutWinner ? ` · rozhodl nájezd ${esc(g.shootoutWinner)}` : '';
  return `<div class="g">
  <div class="r">${teams}<span class="s">${g.homeGoals}:${g.awayGoals}${suffix}</span></div>
  <div class="sc">${goals}${so}</div>
</div>`;
}

export function kotelHtml({ facts, venca }: KotelInput): string {
  const hero = facts.hero?.name;
  const tiles = facts.table.slice(0, 4).map((r) => `
<div style="background:${CARD};border-radius:14px;padding:14px 18px;display:flex;flex-direction:column;gap:4px;min-width:0">
  <div style="${MONO}font-size:17px;color:${MUTED};white-space:nowrap;overflow:hidden;text-overflow:ellipsis">${r.pos}. ${esc(r.team.toUpperCase())}</div>
  <div style="font-size:34px;font-weight:900;${COND}">${r.points} b</div>
</div>`).join('');

  return `<!doctype html>
<html lang="cs">
<head>
<meta charset="utf-8">
<title>Extraligový kotel ${facts.round}. kolo</title>
<link rel="preconnect" href="https://fonts.googleapis.com">
<link href="https://fonts.googleapis.com/css2?family=Archivo:wdth,wght@62..125,400..900&family=JetBrains+Mono:wght@400;700&display=swap" rel="stylesheet">
<style>
html,body{margin:0;background:${BG}}
.g{padding:10px 0 11px;border-top:2px solid #23473A;display:flex;flex-direction:column;gap:3px}
.r{display:flex;justify-content:space-between;align-items:baseline;gap:20px}
.t{font-size:var(--t,31px);font-weight:800;white-space:nowrap}
.s{${MONO}font-size:var(--sz,33px);font-weight:700;color:${ACC};white-space:nowrap}
.s small{font-size:20px;color:${MUTED};margin-left:8px}
.sc{font-size:var(--sc,21px);color:${SOFT};line-height:1.3}
.p{${MONO}font-size:20px;color:${MUTED};white-space:nowrap}
</style>
</head>
<body>
<div id="root" style="width:${SIZE.w}px;height:${SIZE.h}px;box-sizing:border-box;position:relative;overflow:hidden;padding:56px 72px;background:${BG};color:${INK};font-family:'Archivo',sans-serif;display:flex;flex-direction:column;gap:22px">
  <div aria-hidden="true" style="position:absolute;top:-170px;right:-150px;width:460px;height:460px;border-radius:50%;border:16px solid rgba(245,176,39,0.10)"></div>
  <div aria-hidden="true" style="position:absolute;top:-120px;right:-60px;width:400px;height:400px;border-radius:50%;border:6px solid rgba(245,176,39,0.07)"></div>

  <div style="position:relative;display:flex;justify-content:space-between;align-items:center">
    <div style="display:flex;align-items:center;gap:14px">
      <div style="background:${ACC};color:${BG};font-weight:900;${COND}font-size:34px;letter-spacing:1px;padding:6px 16px;border-radius:8px">ŠTAMGAST</div>
      <div style="${MONO}font-size:20px;color:${MUTED};letter-spacing:2px">SPORT OD STOLU</div>
    </div>
    <div style="${MONO}font-size:22px;letter-spacing:2px;border:2px solid #2C5A47;padding:8px 14px;border-radius:8px">EXTRALIGOVÝ KOTEL · <span style="color:${ACC}">${facts.round}. KOLO</span></div>
  </div>

  <div style="position:relative;display:flex;flex-direction:column;gap:8px">
    <div style="${MONO}font-size:22px;letter-spacing:3px;color:${ACC}">${esc(facts.dayLabel.toUpperCase())}</div>
    <div style="font-size:66px;font-weight:900;${COND}line-height:0.98;letter-spacing:-1px">${esc(venca.titulek)}</div>
  </div>

  <div id="games" style="position:relative;display:flex;flex-direction:column">
    ${facts.games.map((g) => gameRow(g, hero)).join('')}
  </div>

  <div style="position:relative;display:flex;flex-direction:column;gap:8px">
    <div style="${MONO}font-size:18px;letter-spacing:3px;color:${MUTED}">TABULKA</div>
    <div style="display:grid;grid-template-columns:repeat(4,minmax(0,1fr));gap:12px">${tiles}</div>
  </div>

  <div style="margin-top:auto;position:relative;display:flex;align-items:flex-end;gap:22px">
    ${vencaSvg(venca.vyraz, 124)}
    <div style="flex:1;background:${INK};color:#1C1C1A;border-radius:26px 26px 26px 6px;padding:20px 28px;display:flex;flex-direction:column;gap:6px">
      <div style="${MONO}font-size:17px;font-weight:700;letter-spacing:2px;color:#6B655A">VENCA ŠTAMGAST · AI POSTAVA</div>
      <div style="font-size:29px;font-weight:800;line-height:1.25">„${esc(venca.hlaska)}“</div>
    </div>
  </div>
  <div style="${MONO}font-size:17px;color:${MUTED};text-align:right">${esc(KOTEL_DISCLAIMER)}</div>
</div>
<script>
// Pojistka: když se kolo nevejde (dlouhá jména, víc zápasů), písmo výsledků se po načtení zmenší.
window.fit = () => {
  const root = document.getElementById('root');
  let t = 31, s = 33, sc = 21;
  while (root.scrollHeight > root.clientHeight && sc > 15) {
    t -= 1; s -= 1; sc -= 0.5;
    root.style.setProperty('--t', t + 'px'); root.style.setProperty('--sz', s + 'px'); root.style.setProperty('--sc', sc + 'px');
  }
};
</script>
</body>
</html>`;
}
