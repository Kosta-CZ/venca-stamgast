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
3. `.github/workflows/kotel.yml` v sobotu ráno vyrobí Extraligový kotel z posledního odehraného kola: výsledky
   z TheSportsDB (`src/sportsdb.ts`, kola uložená v R2), střelci přes Claude API s vyhledáváním v českých zdrojích
   (`src/scorers.ts`, `src/claude.ts`), tabulka a kolo (`src/kotel.ts`), texty Vency (`src/kotelVenca.ts`), šablona
   `src/render/kotel.ts`. Schvaluje a vydává se stejně jako Ranní pivo.
4. `.github/workflows/fotbal.yml` v pondělí ráno vyrobí kolo fotbalové 1. ligy stejným kódem jako Kotel
   (`src/leagues.ts`; v textech vždy „1. liga“, oficiální název nese jméno sázkové kanceláře).
   `.github/workflows/prehledy.yml` dělá přehledy ze dvou zdrojů (`src/digest.ts`, `data/prehledy/*.json`):
   Češi ve fotbale v cizině v pondělí (tenis kvůli ceně a hokejoví legionáři kvůli chybějícím zdrojům jsou vypnutí).
5. `.github/workflows/specialy.yml` dělá speciál k velké akci Čecha podle `data/specialy/*.json`: odpoledne pozvánku,
   po zápase výsledek (`src/special.ts`, šablona `src/render/special.ts`). Fakta ze dvou nezávislých hledání
   (mezinárodní a české zdroje), kód je porovná údaj po údaji. Obě verze se schvalují v Telegramu.
6. Nastavení (secrets, R2, token) je v `docs/nastaveni.md`.

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
npm run venca -- kotel --demo                       # ukázka Kotle z 19. kola bez sítě
npm run venca -- kotel --round 19 --no-ai           # kolo z TheSportsDB (bez R2 ukládá kola do out/kola)
npm run venca -- special --stage pozvanka --event 2026-11-21-prochazka --no-ai
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

### Extraligový kotel

- Vychází v sobotu ráno (poslední odehrané kolo a tabulka), schvaluje se v Telegramu jako Ranní pivo, nikdy sám.
  Id konceptu je `<poslední den kola>-kotel`, např. `2026-11-15-kotel`.
- Výsledky: TheSportsDB `eventsround` (limit asi 10 dotazů za minutu, pak 429 a 2 minuty pauza; dotazy jdou po 7 s).
  Kola se ukládají do R2 `kotel/<sezóna>/kolo-NN.json` a znovu se stahují jen ta, kde mohl přibýt výsledek.
  Předehrávky a dohrávky jsou běžné: tabulka se počítá ze všech dohraných zápasů do posledního dne kola
  (3-2-1-0; při rovnosti bodů rozdíl skóre a vstřelené góly jako u ČTK, vzájemné zápasy až po základní části).
  Celá tabulka po 19. kole sedí s tabulkou ČTK (test s fixture `test/fixtures/extraliga-2026-2027.json`).
- Střelci: Claude API s web search a web fetch jen na ceskenoviny.cz, hokej.cz, sport.ceskatelevize.cz. Skóre do zadání
  nejde, zdroj ho musí přinést sám; kód porovná skóre zdroje i součet gólů střelců s TheSportsDB a odkazy s tím, co
  Claude ve vyhledávání opravdu viděl. Pravidlo 1 má tak jednu výjimku (majitel souhlasil): střelce dodává AI ze zpráv,
  kód je ale vždy porovná s výsledkem.
- Claude API se volá přes oficiální SDK (`@anthropic-ai/sdk`, verze API 2026-10-21, klíč jde jako Bearer)
  se záložním modelem při odmítnutí (server-side fallback).

### Speciály k velkým akcím

- Hotovo pro Procházku – Stirlinga (UFC Fight Night, Dauhá, sobota 21. 11. 2026, hlavní karta 19:00 našeho času):
  pozvánka 13:23, výsledek 23:23, záloha 0:53. Bible má sekci 8 o MMA (bez posměchu knockoutům a zraněním, respekt
  k soupeři, MMA jen u velkých zápasů Čechů); kód navíc hlídá rizikové výrazy (`MMA_TABOO`) a u výsledku nepustí výraz vztek.
- Fakta: dvě hledání (`zdroje_a` mezinárodní, `zdroje_b` české), každý údaj musí sedět v obou, odkazy musí být
  z povolených webů a z výsledků hledání. Časy převádí kód (`toPrague`), ne AI. U výsledku se hledá postupně
  (české zdroje jen když mezinárodní výsledek už mají).
- Další akce = nový JSON v `data/specialy/` a řádky `cron` ve `specialy.yml`. Zkouška celé cesty na minulém zápase:
  `zkouska-2026-04-11-ufc327` (ručně, bez odeslání).

### Fotbalová 1. liga a přehledy (od 16. 11. 2026)

- **1. liga** (`fotbal.yml`): pondělí 7:53 (čeká, až se kolo dohraje), záloha v úterý; kolo starší než 3 dny
  (po reprezentační pauze) se neposílá. TheSportsDB liga 4631, kola v R2 `liga/<sezóna>/`, id `<den>-liga`.
  Tabulka po 14. kole sedí s ČTK (test). Nadstavba po 30. kole (skupiny) zatím počítaná není.
- **Přehledy** (`prehledy.yml`): Češi ve fotbale v cizině v pondělí 11:23: góly a asistence, u brankářů čisté konto
  (v grafice „nula“; zdroje ho musí potvrdit oba a kód ho zkontroluje se skóre). Volná strukturovaná data nejsou:
  české zdroje (B) hledají po hráčích ze seznamu `hraci` v `data/prehledy/cizina.json` (udržuje se ručně, přestupy
  v lednu a v létě), mezinárodní (A) dostanou jen to, které zápasy ověřit (hráč, tým, soutěž, den, soupeř) a čísla
  (skóre, výsledek, góly, asistence) dohledají samy. Do grafiky jde jen to, co sedí v obou. Když B nic nenajde,
  A se nespouští.
- Vypnuté (rozhodnutí majitele 17. 11. 2026, zapínají se řádkem `cron`): tenis denně 9:23 kvůli ceně
  (`data/prehledy/tenis.json`, období do konce Australian Open) a hokejoví legionáři (SHL, Liiga, DEL, National
  League, ICEHL, AHL; **KHL nikdy**), protože česká média o nich zápas po zápasu nepíšou; NHL je v Ranním pivu.

### Cena (měřeno 16. 11. 2026, Claude API, data jsou zdarma)

- Log každého běhu ukazuje tokeny a cenu, koncept ji nese v `costUsd` a zpráva ke schválení ji ukáže („💰“).
- Hledání posílá `cache_control` (opakované čtení nalezeného za 5 % ceny) a střelci se berou ze souhrnu kola ČTK
  (strop 8 hledání a 8 stránek). Kolo ligy asi 4,4 Kč, Kotel 3,4 Kč (hledání střelců $0.12–0.17, texty ~$0.03),
  Ranní pivo pod 1 Kč, Češi v cizině 16–19 Kč týdně (hledání po hráčích ~$0.7, ověření ~$0.1), prázdný týden méně.
  Zkoušky: 2.–8. 11. Schickův gól v Kolíně; 19.–25. 10. Kinského nula proti Chelsea, góly Hložka a Daňka. Zadání hledání
  nese dnešní datum (bez něj Claude usoudil, že týden „ještě nenastal“). Výsledek speciálu: nejdřív mezinárodní zdroje, české jen když
  výsledek už mají.
- Hledání „všichni Češi za týden“ bylo moc široké a nic nenašlo; proto seznam hráčů a ověřování konkrétních zápasů.

### Plán dál (dohodnuto s majitelem 16. 11. 2026)

- Výsledky z víkendu vycházejí hned (v neděli večer nebo v pondělí ráno). Do týdne se rozkládají jen příspěvky
  nezávislé na čase (vzpomínky, kvíz, Venca vs. Jarda).
