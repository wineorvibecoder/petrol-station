---
register: brand
---

# Škoda Pit Stop — PRODUCT

## Produkt

Arkádová 2D top-down time-management hra ve značkovém světě Škoda. Auta (reálné modely
Fabia, Octavia, Kodiaq, Enyaq) přijíždějí zleva a hráč je šipkami navádí do správné
stanice podle pohonu (benzín, diesel, CNG, elektro) nebo do myčky. Celé herní UI se
vykresluje procedurálně do HTML5 canvasu v čistém vanilla JS, bez frameworků a bez
build kroku. Hra je trojjazyčná (CZ / EN / DE) s názvy „Škoda netankovat / Pit Stop /
Boxenstopp" a běží v prohlížeči (primárně Edge na Windows 11).

Tady je design **součástí produktu**, ne jen jeho obalem: vzhled, barvy, typografie a
pocit jsou zážitek samotný. Proto register `brand`.

## Cílové publikum

- **Dětský režim (Kid mode)** — děti a rodiny. Klidnější tempo, 5 životů, doplňování
  života po každém levelu. Tón vlídný, přehledný, odpouštějící.
- **Závodní režim (Racing mode)** — dospělí a náročnější hráči. Rychlejší auta, 3 životy,
  bez doplňování. Tón svižnější, ale stále čistý.

## Tón a hlas

Hravý, čistý, sebevědomě „automotive". Krátké, věcné instrukce; pozitivní zpětná vazba
při úspěchu; klidná, neobviňující sdělení při chybě. Žádný infantilní jazyk ani křečovitá
„zábavnost". Voice je konzistentní napříč jazyky; tón se mění podle okamžiku (oslava při
+1 a level-upu, vážnější u konce hry).

## Značkové reference

- **Škoda Emerald Green** — povrch, panely, chrome (tmavá smaragdová identita).
- **Škoda Electric Green** — akcent, nadpisy, zvýraznění, pozitivní feedback.
- Funkční barvy stanic (červená benzín, černá diesel, modrá CNG, zelená elektro, hnědá
  myčka) slouží **hratelnosti** — jsou rozlišovací kód, ne dekorace, a zůstávají stabilní.
- Ručně malované sprity aut a stojanů (painterly, ne ploché vektory ani stock ikony).

## Anti-reference (čemu se vyhnout)

- Generický „AI-slop" arkádový look: neonová duha na černé, defaultní modrá/oranžová,
  glassmorphismus, gradientový text, ozdobné bounce/elastic animace.
- Čistá bílá `#fff` a čistá černá `#000` — vše tónované ke značkové emerald hue.
- Žluté „varovné" texty roztroušené po UI (nahrazeno electric green).
- Em dash (—) a `--` v textech.
- Nahodilá typografie bez škály a barvy bez tokenů.

## Strategické principy

1. **Barva = identita povrchu.** Strategie „Committed": emerald/electric green nese
   vizuální identitu; akcent je vzácný a tím silný. Barvy stanic jsou nedotknutelný
   funkční kód.
2. **Hierarchie skrz škálu + váhu.** Jedna rodina (systémový Segoe UI stack), modulární
   škála (poměr ≥1.25), žádné nahodilé velikosti.
3. **Pohyb decelerací.** Ease-out exponenciální křivky, nikdy bounce ani elastic.
4. **Delight jen v okamžicích.** Oslava úspěchu, level-up, milníky — ne na každém pixelu.
5. **Hratelnost je svatá.** Vizuál, texty a pocit se ladí; pravidla, obtížnost, časování
   a ovládání se nemění.
