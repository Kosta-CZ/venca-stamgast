// Šablona příspěvku Ranní pivo (styl v2 z plátna): štítek ŠTAMGAST, muž noci, další Češi,
// Venca s bublinou. Čistá funkce: fakta + Vencovy texty → HTML 1080 × 1350.

import type { PostFacts } from '../facts.ts';
import type { VencaOut } from '../venca.ts';
import { vencaSvg } from './avatar.ts';

export const SIZE = { w: 1080, h: 1350 };

const BG = '#10291F', CARD = '#17382B', MUTED = '#9FB8AC', SOFT = '#C9D6CE', INK = '#F4EFE4', ACC = '#F5B027';
const MONO = "font-family:'JetBrains Mono',monospace;";
const COND = 'font-stretch:75%;';

export function esc(text: string): string {
  return text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

/** Velikost písma jména muže noci, aby se vešlo na jeden řádek (úzké verzálky ≈ 0,48 em na znak). */
export function heroFontSize(name: string, width = 936, max = 150): number {
  return Math.min(max, Math.floor(width / (name.length * 0.48)));
}

export interface RanniPivoInput {
  dayLabel: string;
  facts: PostFacts;
  venca: Pick<VencaOut, 'titulek' | 'hlaska' | 'vyraz'>;
}

export function ranniPivoHtml({ dayLabel, facts, venca }: RanniPivoInput): string {
  const { hero, others, more } = facts;
  const rows = others.map((r) => `
<div style="display:grid;grid-template-columns:minmax(0,1fr) auto;gap:20px;align-items:center;padding:14px 0;border-top:2px solid #23473A">
  <div style="display:flex;align-items:baseline;gap:14px;min-width:0">
    <span style="font-size:32px;font-weight:800;white-space:nowrap">${esc(r.jmeno)}</span>
    <span style="${MONO}font-size:18px;color:${MUTED}">${esc(r.team)}</span>
    <span style="font-size:22px;color:${SOFT};white-space:nowrap;overflow:hidden;text-overflow:ellipsis">${esc(r.context)}</span>
  </div>
  <div style="${MONO}font-size:34px;font-weight:700;color:${ACC}">${esc(r.value)}</div>
</div>`).join('');

  const othersBlock = others.length
    ? `<div style="position:relative;display:flex;flex-direction:column">
  <div style="${MONO}font-size:20px;letter-spacing:3px;color:${MUTED};padding-bottom:6px">DALŠÍ ČEŠI PŘES NOC</div>
  ${rows}
  ${more ? `<div style="${MONO}font-size:20px;color:${MUTED};padding-top:10px">+ ${more} další v popisku</div>` : ''}
</div>`
    : '';

  const name = hero.jmeno.toUpperCase();
  return `<!doctype html>
<html lang="cs">
<head>
<meta charset="utf-8">
<title>Ranní pivo ${esc(dayLabel)}</title>
<link rel="preconnect" href="https://fonts.googleapis.com">
<link href="https://fonts.googleapis.com/css2?family=Archivo:wdth,wght@62..125,400..900&family=JetBrains+Mono:wght@400;700&display=swap" rel="stylesheet">
<style>html,body{margin:0;background:${BG}}</style>
</head>
<body>
<div style="width:${SIZE.w}px;height:${SIZE.h}px;box-sizing:border-box;position:relative;overflow:hidden;padding:56px 72px;background:${BG};color:${INK};font-family:'Archivo',sans-serif;display:flex;flex-direction:column;gap:26px">
  <div aria-hidden="true" style="position:absolute;top:-170px;right:-150px;width:460px;height:460px;border-radius:50%;border:16px solid rgba(245,176,39,0.10)"></div>
  <div aria-hidden="true" style="position:absolute;top:-120px;right:-60px;width:400px;height:400px;border-radius:50%;border:6px solid rgba(245,176,39,0.07)"></div>

  <div style="position:relative;display:flex;justify-content:space-between;align-items:center">
    <div style="display:flex;align-items:center;gap:14px">
      <div style="background:${ACC};color:${BG};font-weight:900;${COND}font-size:34px;letter-spacing:1px;padding:6px 16px;border-radius:8px">ŠTAMGAST</div>
      <div style="${MONO}font-size:20px;color:${MUTED};letter-spacing:2px">SPORT OD STOLU</div>
    </div>
    <div style="${MONO}font-size:22px;letter-spacing:2px;border:2px solid #2C5A47;padding:8px 14px;border-radius:8px">RANNÍ PIVO · <span style="color:${ACC}">${esc(dayLabel.toUpperCase())}</span></div>
  </div>

  <div style="position:relative;display:flex;flex-direction:column;gap:6px">
    <div style="${MONO}font-size:22px;letter-spacing:3px;color:${ACC}">MUŽ NOCI · ${esc(hero.team)}</div>
    <div id="hero-name" style="font-size:${heroFontSize(name)}px;font-weight:900;${COND}line-height:0.95;letter-spacing:-2px;white-space:nowrap;padding-top:6px">${esc(name)}</div>
    <div style="font-size:30px;font-weight:800;color:${SOFT}">${esc(venca.titulek)}</div>
  </div>

  <div style="position:relative;display:flex;align-items:center;gap:36px;background:${CARD};border-radius:22px;padding:24px 36px">
    <div style="display:flex;align-items:baseline;gap:12px">
      <div style="font-size:180px;font-weight:900;${COND}line-height:0.8;color:${ACC}">${hero.big}</div>
      <div style="font-size:42px;font-weight:900;${COND}text-transform:uppercase;line-height:1">${esc(hero.unit)}</div>
    </div>
    <div style="flex:1;display:flex;flex-direction:column;gap:8px;font-size:26px;color:${SOFT};line-height:1.3">
      ${hero.lines.map((l, i) => `<div${i === 0 ? ` style="color:${INK};font-weight:800"` : ''}>${esc(l)}</div>`).join('')}
    </div>
  </div>

  ${othersBlock}

  <div style="margin-top:auto;position:relative;display:flex;align-items:flex-end;gap:22px">
    ${vencaSvg(venca.vyraz, 140)}
    <div style="flex:1;background:${INK};color:#1C1C1A;border-radius:26px 26px 26px 6px;padding:24px 30px;display:flex;flex-direction:column;gap:6px">
      <div style="${MONO}font-size:18px;font-weight:700;letter-spacing:2px;color:#6B655A">VENCA ŠTAMGAST · AI POSTAVA</div>
      <div style="font-size:31px;font-weight:800;line-height:1.25">„${esc(venca.hlaska)}“</div>
    </div>
  </div>
  <div style="${MONO}font-size:18px;color:${MUTED};text-align:right">Fiktivní AI postava. Výsledky z dat NHL.</div>
</div>
<script>
// Pojistka: jméno muže noci se po načtení písem zmenší, dokud se nevejde (renderer volá window.fit).
window.fit = () => {
  const el = document.getElementById('hero-name');
  let size = parseFloat(getComputedStyle(el).fontSize);
  while (el.scrollWidth > el.clientWidth && size > 40) { size -= 2; el.style.fontSize = size + 'px'; }
};
</script>
</body>
</html>`;
}
