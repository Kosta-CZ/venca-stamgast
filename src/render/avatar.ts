// Venca Štamgast jako plochá ilustrace (SVG) v osmi výrazech. Stejná kresba jako charakterový list
// na plátně (sada výrazů v1, čepice přes celé temeno, „říkal“ drží tiket, ne prst).

import type { Expression } from '../venca.ts';

const INK = '#1C1C1A', SKIN = '#E8B48F', SKIN2 = '#DFA47E', NECK = '#D9A27E';
const CAP = '#5B4A3A', BRIM = '#46382B', MUST = '#7A6A5C', MOUTH = '#7A3E30';
const SWEATER = '#8A3B2E', AMB = '#F5B027', RED = '#E8553D', WHITE = '#F4EFE4';

const MUST_STD = 'M128 262 C150 238 185 246 200 254 C215 246 250 238 272 262 C250 272 222 268 200 263 C178 268 150 272 128 262 Z';
const MUST_DROOP = 'M126 280 C140 246 182 246 200 256 C218 246 260 246 274 280 C252 270 224 268 200 265 C176 268 148 270 126 280 Z';
const MUST_UP = 'M124 250 C148 236 184 244 200 254 C216 244 252 236 276 250 C256 268 224 268 200 262 C176 268 144 268 124 250 Z';

const eyeDot = (x: number, y: number, r = 9) => `<circle cx="${x}" cy="${y}" r="${r}" fill="${INK}"/>`;
const eyeBig = (x: number, y: number, dx = 0, dy = 0, r = 17) => `<circle cx="${x}" cy="${y}" r="${r}" fill="${WHITE}"/><circle cx="${x + dx}" cy="${y + dy}" r="8" fill="${INK}"/>`;
const line = (d: string, w = 6, c = INK) => `<path d="${d}" stroke="${c}" stroke-width="${w}" fill="none" stroke-linecap="round" stroke-linejoin="round"/>`;
const brow = (d: string, w = 8) => line(d, w, CAP);

function mug(x: number, y: number, rot = 0): string {
  return `<g transform="translate(${x} ${y}) rotate(${rot})">
<path d="M58 22 C86 22 86 70 58 70" stroke="${WHITE}" stroke-width="9" fill="none"/>
<rect x="0" y="12" width="62" height="88" rx="8" fill="${AMB}"/>
<rect x="8" y="30" width="8" height="58" rx="4" fill="#FFD27A"/>
<path d="M-4 18 C2 0 18 4 22 8 C28 -2 44 -2 48 8 C56 2 68 6 66 18 Z" fill="${WHITE}"/>
<circle cx="-2" cy="66" r="20" fill="${SKIN}"/></g>`;
}

function star(x: number, y: number, s = 14): string {
  const p = (dx: number, dy: number) => `${x + dx * s} ${y + dy * s}`;
  return `<path d="M${p(0, -1)} L${p(0.3, -0.3)} L${p(1, 0)} L${p(0.3, 0.3)} L${p(0, 1)} L${p(-0.3, 0.3)} L${p(-1, 0)} L${p(-0.3, -0.3)} Z" fill="${AMB}"/>`;
}

function drop(x: number, y: number, s = 1): string {
  return `<path d="M${x} ${y} C${x - 10 * s} ${y + 16 * s} ${x - 12 * s} ${y + 26 * s} ${x} ${y + 30 * s} C${x + 12 * s} ${y + 26 * s} ${x + 10 * s} ${y + 16 * s} ${x} ${y} Z" fill="#9FD3F2"/>`;
}

interface Face {
  eyes: string;
  brows: string;
  mustache: string;
  mouth: string;
  cheeks?: number;
  front?: string;
}

const FACES: Record<Expression, Face> = {
  klid: {
    eyes: eyeDot(160, 202) + eyeDot(240, 202),
    brows: brow('M140 182 L178 184') + brow('M222 184 L260 182'),
    mustache: MUST_STD, mouth: line('M184 282 Q200 290 216 282', 5, MOUTH),
  },
  radost: {
    eyes: line('M146 206 Q160 188 174 206') + line('M226 206 Q240 188 254 206'),
    brows: brow('M140 168 Q158 158 178 166') + brow('M222 166 Q242 158 260 168'),
    mustache: MUST_UP,
    mouth: `<path d="M170 274 Q200 322 230 274 Z" fill="${MOUTH}"/><path d="M186 296 Q200 312 214 296 Z" fill="#E07A6A"/>`,
    cheeks: 0.7, front: mug(300, 230, -14),
  },
  nadseni: {
    eyes: eyeBig(160, 200) + eyeBig(240, 200),
    brows: brow('M138 162 Q158 146 180 160') + brow('M220 160 Q242 146 262 162'),
    mustache: MUST_UP, mouth: `<ellipse cx="200" cy="292" rx="16" ry="20" fill="${MOUTH}"/>`,
    cheeks: 0.6, front: star(70, 90) + star(330, 70, 18) + star(350, 150, 10) + star(52, 160, 9),
  },
  zklamani: {
    eyes: line('M148 206 L174 206') + line('M226 206 L252 206') + line('M150 210 Q161 218 172 210', 4) + line('M228 210 Q239 218 250 210', 4),
    brows: brow('M140 188 L178 176') + brow('M222 176 L260 188'),
    mustache: MUST_DROOP, mouth: line('M182 298 Q200 284 218 298', 5, MOUTH), cheeks: 0.25,
  },
  vztek: {
    eyes: eyeDot(162, 204, 8) + eyeDot(238, 204, 8),
    brows: brow('M136 170 L182 192', 10) + brow('M218 192 L264 170', 10),
    mustache: MUST_STD,
    mouth: `<rect x="178" y="276" width="44" height="18" rx="4" fill="${WHITE}" stroke="${MOUTH}" stroke-width="4"/><path d="M193 276 L193 294 M207 276 L207 294" stroke="${MOUTH}" stroke-width="3"/>`,
    cheeks: 0.85,
    front: `<path d="M292 96 L304 108 M304 96 L292 108 M286 102 L310 102 M298 90 L298 114" stroke="${RED}" stroke-width="6" stroke-linecap="round"/>`
      + `<circle cx="70" cy="190" r="14" fill="${WHITE}" opacity="0.5"/><circle cx="52" cy="166" r="10" fill="${WHITE}" opacity="0.4"/>`
      + `<circle cx="330" cy="190" r="14" fill="${WHITE}" opacity="0.5"/><circle cx="348" cy="166" r="10" fill="${WHITE}" opacity="0.4"/>`,
  },
  rikal: {
    eyes: eyeDot(160, 202) + line('M226 204 L254 202'),
    brows: brow('M138 172 Q158 156 180 170') + brow('M222 190 L260 190'),
    mustache: MUST_STD, mouth: line('M184 286 Q206 292 224 276', 5, MOUTH), cheeks: 0.5,
    front: `<g transform="translate(18 240) rotate(-10)"><rect x="0" y="0" width="88" height="108" rx="6" fill="${WHITE}"/><path d="M12 18 L64 18 M12 32 L52 32" stroke="#B9A98F" stroke-width="5" stroke-linecap="round"/><path d="M20 66 L38 84 L70 48" stroke="#2E9E5B" stroke-width="11" fill="none" stroke-linecap="round" stroke-linejoin="round"/><circle cx="78" cy="104" r="22" fill="${SKIN}"/></g>`,
  },
  nevericne: {
    eyes: eyeBig(160, 200, 0, 2, 18) + line('M226 204 Q240 198 254 204'),
    brows: brow('M138 160 Q158 148 180 162') + brow('M222 192 L262 184'),
    mustache: MUST_STD, mouth: line('M178 288 Q189 280 200 288 Q211 296 222 288', 5, MOUTH), cheeks: 0.4,
    front: `<text x="318" y="118" font-family="Archivo, sans-serif" font-size="64" font-weight="900" fill="${AMB}">?!</text>`,
  },
  nervozita: {
    eyes: eyeBig(160, 202, 7, 0, 16) + eyeBig(240, 202, 7, 0, 16),
    brows: brow('M140 178 L178 170') + brow('M222 170 L260 178'),
    mustache: MUST_STD,
    mouth: `<path d="M184 280 L216 280 L212 290 L188 290 Z" fill="${WHITE}" stroke="${MOUTH}" stroke-width="3"/>`,
    cheeks: 0.35, front: drop(106, 150, 1) + drop(296, 170, 0.8) + drop(84, 196, 0.7),
  },
};

/** SVG Vency ve výrazu `expr`, velikost `size` px. */
export function vencaSvg(expr: Expression, size: number): string {
  const f = FACES[expr];
  const c = f.cheeks ?? 0.45;
  return `<svg viewBox="0 0 400 400" width="${size}" height="${size}" role="img" aria-label="Venca Štamgast" style="flex-shrink:0">
<defs><clipPath id="vc-${expr}"><circle cx="200" cy="200" r="200"/></clipPath></defs>
<circle cx="200" cy="200" r="200" fill="#1C4636"/>
<g clip-path="url(#vc-${expr})">
<path d="M56 430 C64 334 128 302 200 302 C272 302 336 334 344 430 Z" fill="${SWEATER}"/>
<path d="M120 330 L140 430 M280 330 L260 430" stroke="#7A3328" stroke-width="6"/>
<rect x="172" y="268" width="56" height="44" fill="${NECK}"/>
<path d="M162 304 L200 352 L238 304 Z" fill="${WHITE}"/>
<path d="M176 304 L200 334 L224 304" stroke="#D8D0C0" stroke-width="4" fill="none"/>
</g>
<ellipse cx="104" cy="205" rx="16" ry="24" fill="${SKIN2}"/>
<ellipse cx="296" cy="205" rx="16" ry="24" fill="${SKIN2}"/>
<ellipse cx="200" cy="195" rx="96" ry="108" fill="${SKIN}"/>
<circle cx="140" cy="246" r="19" fill="#E8917A" opacity="${c}"/>
<circle cx="260" cy="246" r="19" fill="#E8917A" opacity="${c}"/>
<path d="M96 164 C88 48 312 40 310 162 Z" fill="${CAP}"/>
<path d="M136 104 C168 82 234 80 270 100" stroke="#4A3B2E" stroke-width="4" fill="none"/>
<path d="M96 158 L330 146 C336 158 332 170 322 172 L98 178 Z" fill="${BRIM}"/>
${f.brows}
${f.eyes}
<ellipse cx="200" cy="232" rx="22" ry="18" fill="#D98E6E"/>
<ellipse cx="206" cy="226" rx="6" ry="4" fill="#EDB094" opacity="0.8"/>
${f.mouth}
<path d="${f.mustache}" fill="${MUST}"/>
${f.front ?? ''}
</svg>`;
}
