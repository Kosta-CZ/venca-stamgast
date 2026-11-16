# Venca Štamgast – pravidla projektu

AI postava sportovního účtu na Instagramu (@venca_stamgast): Venca, štamgast od třetího stolu,
komentuje fotbal a hokej s důrazem na Čechy. Česky komunikujeme, kód a identifikátory anglicky,
komentáře česky.

## Jak to funguje

1. `.github/workflows/ranni-pivo.yml` každé ráno stáhne noc z NHL (`src/nhl.ts`), spočítá fakta
   (`src/facts.ts`), nechá Vencu napsat texty přes Claude API (`src/venca.ts`, prompt `prompts/system.md`),
   vykreslí obrázek (`src/render/`) a nahraje koncept do Cloudflare R2 (`src/storage.ts`).
2. Pošle koncept ke schválení do Telegramu (`src/telegram.ts`) s tlačítky ✅ Vydat / 🗑 Zahodit. Ťuknutí
   zachytí Worker `venca-bot` (`worker/`, nasazuje `.github/workflows/bot.yml`) a spustí
   `.github/workflows/vydat.yml`, které koncept vydá přes Instagram API (`src/instagram.ts`) a odpoví
   v Telegramu. Bez bota jde koncept jako issue „Ke schválení…“ (`src/draft.ts`) a vydává se komentářem `/vydat`.
3. Nastavení (secrets, R2, token) je v `docs/nastaveni.md`.

## Pravidla (povinná)

1. **Čísla dělá kód, ne AI.** Jména, body, výsledky a úspěšnost jdou do grafiky jen z dat (`facts.ts`).
   Venca dodává titulek, hlášku, popisek, výraz a výběr muže noci. `checkVenca` hlídá čísla v jeho textech;
   co nesedí, jde do `pozor` a koncept čeká na člověka.
2. **Nic nevychází bez schválení**, dokud majitel nezapne `AUTO_RANNI_PIVO`. I pak jen při `pozor = 0`.
   Názorové formáty (hodnocení, Venca vs. Jarda) se vždy schvalují.
3. **Bible postavy je `prompts/system.md`.** Výkon ano, člověk ne; žádné soukromí, zranění, sázení
   ani politika; postava je vždy označená jako AI (popisek i grafika).
4. **Výrazy Vency** jsou v `src/render/avatar.ts` (stejná kresba jako charakterový list). Gesta rukou
   jen taková, která nejdou vyložit jako urážka.
5. **Tajné údaje jen v GitHub Secrets.** Nikdy je nevypisovat; chyby od Instagramu token maskují.
6. Repozitář je veřejný: úloha `vydat.yml` poslouchá jen majitele (`github.repository_owner`), Worker jen
   `TELEGRAM_CHAT_ID` a jen požadavky s tajnou hlavičkou webhooku (SHA-256 z tokenu bota). Vydání má
   pojistku proti dvojímu vydání (`published/<id>.json` v R2).
7. Nový Čech v NHL se připíše do `data/czech-nhl.json` (hledá se podle iniciály a příjmení bez diakritiky).
8. Po změně kódu `npm test` a `npm run typecheck`.

## Příkazy

```bash
npm run venca -- make --demo                # ukázka z 9. 11. bez sítě (out/)
npm run venca -- make --date 2026-11-17     # skutečná noc (potřebuje síť, bez klíče suché texty)
npm run venca -- upload --id 2026-11-17-ranni-pivo
npm run venca -- publish --id 2026-11-17-ranni-pivo --dry-run
npm test
```

Místní vykreslení bez Playwright prohlížeče: `CHROME_PATH=/cesta/k/chrome npm run venca -- make --demo`.

## Co bude dál

Další formáty z plánu (Víkendová účtenka, Extraligový kotel, Štamgast hodnotí, Venca vs. Jarda); šablony v2
jsou na plátně „Štamgast – ukázkové příspěvky“. **Za data se neplatí** (rozhodnutí majitele), berou se z volných
zdrojů s výslovným svolením, ne stahováním cizích webů. Hlavní je TheSportsDB (veřejný klíč `123`, bez registrace):
extraliga 4923, Chance Liga 4631. Zdarma dává celé kolo (`eventsround`; konec `FT`, prodloužení `AOT`, nájezdy `AP`,
odložené `NS` s novým datem), ale z `eventspastleague` jen jeden zápas, ze sezóny jen 15 zápasů, fotbalovou tabulku
zkrácenou, extraligovou vůbec a žádné střelce ani karty; po pár rychlých dotazech vrací 429. Tabulky se proto
počítají z uložených výsledků kol (extraliga 3-2-1-0). Názvy týmů jsou smíšené (s diakritikou i bez, „Sparta
Prague“), převádí se vlastní tabulkou. API-Sports (`API_SPORTS_KEY`) by uměl i střelce a karty, ale aktuální sezónu
jen placeně (Free má 2022–2024). Co který zdroj vrací, ukáže ruční úloha `zdroje.yml` (`scripts/sources-free.mjs`,
`scripts/sources.mjs`).
Plán příspěvků se dá ukázat na publeague.eu/venca_stamgast/ (statická stránka čtoucí koncepty z R2).

### Extraligový kotel (rozpracovaný)

- Hotovo: tvary dat a kontroly (`src/kotel.ts`: skóre, střelci proti skóre, body 3-2-1-0, tabulka z výsledků),
  šablona (`src/render/kotel.ts`) a ukázka z 19. kola podle ČTK (`src/kotelSample.ts`, `npm run venca -- kotel --demo`).
- Další krok jsou data. Výsledky kola dodá TheSportsDB (pomalu kvůli 429; kola se ukládají do R2 a tabulka se počítá
  z nich; názvy týmů převádí vlastní tabulka). Střelce dohledá Claude API s nástrojem web search (jen české zdroje:
  ceskenoviny.cz, hokej.cz, sport.ceskatelevize.cz…) jako JSON s odkazy na zdroje. `checkScorers` je porovná se skóre,
  rozpory jdou do `pozor` a odkazy do zprávy v Telegramu. Pravidlo 1 má tak jednu výjimku (majitel souhlasil): střelce
  dodává AI ze zpráv, kód je ale vždy porovná s výsledkem.
- Vychází v sobotu ráno (poslední kolo a tabulka) a schvaluje se v Telegramu jako Ranní pivo.

### Plán dál (dohodnuto s majitelem 16. 11. 2026)

- Speciál k zápasu Jiřího Procházky (UFC, sobota 21. 11. večer, Dauhá, soupeř Navajo Stirling): odpoledne pozvánka,
  po zápase výsledek, který musí sedět ve dvou zdrojích. Do bible: MMA bez posměchu knockoutům a zraněním, k soupeři
  respekt; MMA jen u velkých zápasů Čechů.
- Potom hokejoví legionáři (Švédsko, Finsko, Německo, Švýcarsko, Rakousko, AHL; **KHL nikdy**), tenis do Australian
  Open (každý výsledek ze dvou zdrojů, do bible přibude tenis) a fotbal v cizině.
- Výsledky z víkendu vycházejí hned (v neděli večer nebo v pondělí ráno). Do týdne se rozkládají jen příspěvky
  nezávislé na čase (vzpomínky, kvíz, Venca vs. Jarda).
