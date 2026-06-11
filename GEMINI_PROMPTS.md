# Gemini / Imagen prompts — Petrol Station game assets

Všechny obrázky generuj v **Google AI Studio → Imagen 3** (nebo Gemini Advanced s image generation).  
Po vygenerování zmenši na cílové rozměry (viz každá sekce).

---

## Obecný styl — zkopíruj do každého promptu

Přidej na konec každého promptu tuto větu, pokud není uvedeno jinak:

> *No text, no labels, no watermarks.*

---

## 🚗 CAR SPRITES (chalk/spray style)

**Cílová velikost:** generuj v poměru **2:1**, ideálně 1024×512 px, pak zmenši na **168×80 px** (2× ingame size).  
**Průhledné pozadí:** v AI Studiu zaškrtni "transparent background" pokud je dostupné, jinak exportuj na bílém pozadí a odstraň bílou (např. remove.bg nebo Photoshop).  
**Top-down pohled:** auto viděné přímo shora, jede doprava.

### car_fabia.png
```
Top-down 2D game sprite, single Škoda Fabia hatchback viewed from directly above,
driving to the right. Art style: child's chalk drawing on dark asphalt — rough
outlines, slightly wobbly lines, pastel chalk texture, hand-drawn look.
Red body, visible wheels at four corners, small windshield hint at the front.
Transparent background. No shadow. 2:1 aspect ratio. Clean isolated object,
no background scenery. No text, no labels, no watermarks.
```

### car_kodiaq.png
```
Top-down 2D game sprite, single Škoda Kodiaq SUV viewed from directly above,
driving to the right. Art style: child's chalk drawing on dark asphalt — rough
outlines, slightly wobbly lines, pastel chalk texture, hand-drawn look.
Dark charcoal black body, slightly wider and longer than a hatchback,
visible wheels at four corners, small windshield hint at the front.
Transparent background. No shadow. 2:1 aspect ratio. Clean isolated object,
no background scenery. No text, no labels, no watermarks.
```

### car_octavia.png
```
Top-down 2D game sprite, single Škoda Octavia sedan viewed from directly above,
driving to the right. Art style: child's chalk drawing on dark asphalt — rough
outlines, slightly wobbly lines, pastel chalk texture, hand-drawn look.
Cobalt blue body, visible wheels at four corners, small windshield hint at the front.
Transparent background. No shadow. 2:1 aspect ratio. Clean isolated object,
no background scenery. No text, no labels, no watermarks.
```

### car_enyaq.png
```
Top-down 2D game sprite, single Škoda Enyaq electric SUV viewed from directly above,
driving to the right. Art style: child's chalk drawing on dark asphalt — rough
outlines, slightly wobbly lines, pastel chalk texture, hand-drawn look.
Bright emerald green body, slightly boxy SUV silhouette, visible wheels at four corners,
small windshield hint at the front.
Transparent background. No shadow. 2:1 aspect ratio. Clean isolated object,
no background scenery. No text, no labels, no watermarks.
```

### car_dirty.png
```
Top-down 2D game sprite, single generic hatchback car viewed from directly above,
driving to the right. Art style: child's chalk drawing on dark asphalt — rough
outlines, slightly wobbly lines, pastel chalk texture, hand-drawn look.
Beige or light grey body covered in irregular brown mud splatter patches,
like a chalk drawing of a dirty car. Visible wheels at four corners.
Transparent background. No shadow. 2:1 aspect ratio. Clean isolated object,
no background scenery. No text, no labels, no watermarks.
```

### car_police.png
```
Top-down 2D game sprite, single police car viewed from directly above,
driving to the right. Art style: child's chalk drawing on dark asphalt — rough
outlines, slightly wobbly lines, pastel chalk texture, hand-drawn look.
Dark navy blue body, a red-and-blue light bar strip drawn across the roof centre,
visible wheels at four corners, small windshield hint at the front.
Transparent background. No shadow. 2:1 aspect ratio. Clean isolated object,
no background scenery. No text, no labels, no watermarks.
```

---

## ⛽ STATION ICONS (chalk/spray style)

**Cílová velikost:** generuj **1:1** (1024×1024 px), pak zmenši na cca **120×120 px** — kód je vykreslí do boxu stanice dynamicky.  
**Průhledné pozadí.**  
**Styl:** stejný chalk/spray jako auta — konzistence je klíčová.

### station_petrol.png
```
2D game icon, a petrol fuel pump viewed from a slight front angle, simple and iconic.
Art style: spray paint graffiti on asphalt, bold outlines, slightly rough edges,
vivid colours, hand-drawn energy. Red pump body, black hose, yellow nozzle.
Transparent background. No shadow. Square 1:1 format. Centered object.
No text, no labels, no watermarks.
```

### station_diesel.png
```
2D game icon, a diesel fuel pump viewed from a slight front angle, simple and iconic.
Art style: spray paint graffiti on asphalt, bold outlines, slightly rough edges,
vivid colours, hand-drawn energy. Dark charcoal black pump body, black hose,
grey nozzle, chunky industrial look.
Transparent background. No shadow. Square 1:1 format. Centered object.
No text, no labels, no watermarks.
```

### station_cng.png
```
2D game icon, a CNG compressed natural gas fuelling post viewed from a slight front
angle, simple and iconic. Art style: spray paint graffiti on asphalt, bold outlines,
slightly rough edges, vivid colours, hand-drawn energy. Cobalt blue post body,
coiled hose, rounded nozzle, a small flame symbol on the side.
Transparent background. No shadow. Square 1:1 format. Centered object.
No text, no labels, no watermarks.
```

### station_electric.png
```
2D game icon, an electric vehicle charging station / wallbox viewed from a slight
front angle, simple and iconic. Art style: spray paint graffiti on asphalt, bold
outlines, slightly rough edges, vivid colours, hand-drawn energy. Bright emerald
green enclosure, white lightning bolt symbol, coiled charging cable.
Transparent background. No shadow. Square 1:1 format. Centered object.
No text, no labels, no watermarks.
```

### station_carwash.png
```
2D game icon, a car wash entrance arch viewed from a slight front angle,
simple and iconic — just the archway with spinning brushes and water sprays visible.
Art style: spray paint graffiti on asphalt, bold outlines, slightly rough edges,
vivid colours, hand-drawn energy. Teal/cyan arch, blue foam bubbles,
white water droplet splashes.
Transparent background. No shadow. Square 1:1 format. Centered object.
No text, no labels, no watermarks.
```

---

## 🌄 BACKGROUNDS (normal painted style)

**Cílová velikost:** generuj v poměru **16:9** (Imagen nabídne jako volbu), pak zmenši na **960×530 px**.  
**Styl:** watercolour + gouache ilustrace, pohádkový naivní styl — *ne* chalk, ne spray.  
**Bez průhlednosti** (JPEG nebo PNG, bílé/plné pozadí).  
**Kompozice:** vlevo nebe + mraky + dálkový horizont s motivem levelu; vpravo přechod do silniční krajiny; dole tmavě šedé pruhy silnic střídané pásy emerald + electric green trávy.

### bg_oil.png — levely 1–2
```
2D side-scrolling game background, 16:9 landscape. Foreground: dark charcoal grey
road strips alternating with vivid emerald green and electric green grass strips,
running horizontally. Middle distance: flat Czech countryside. Far horizon on the
right: silhouettes of two or three oil derricks (pump jacks) slowly nodding,
and a small oil refinery with a tall chimney stack and faint smoke.
Sky: soft afternoon blue with fluffy white cumulus clouds.
Style: watercolour and gouache painted illustration, slightly naive storybook look,
warm afternoon light. No characters, no cars, no text, no labels, no watermarks.
```

### bg_oil_wash.png — levely 3–5
```
2D side-scrolling game background, 16:9 landscape. Foreground: dark charcoal grey
road strips alternating with vivid emerald green and electric green grass strips,
running horizontally. Middle distance: flat Czech countryside. Far horizon on the
right: silhouettes of oil derricks and a small refinery with chimney stacks;
to one side a cheerful car wash building with a colourful arch and foam bubbles.
Sky: soft afternoon blue with fluffy white cumulus clouds.
Style: watercolour and gouache painted illustration, slightly naive storybook look,
warm afternoon light. No characters, no cars, no text, no labels, no watermarks.
```

### bg_cng.png — levely 6–8
```
2D side-scrolling game background, 16:9 landscape. Foreground: dark charcoal grey
road strips alternating with vivid emerald green and electric green grass strips,
running horizontally. Middle distance: flat countryside with light industrial feel.
Far horizon on the right: a natural gas terminal with large cylindrical storage
tanks and pipework; on a railway track in the middle distance, a freight train
with silver cylindrical gas cistern wagons.
Sky: slightly overcast blue-grey with white and light grey clouds.
Style: watercolour and gouache painted illustration, slightly naive storybook look,
cool afternoon light. No characters, no cars, no text, no labels, no watermarks.
```

### bg_electric.png — levely 9–10
```
2D side-scrolling game background, 16:9 landscape. Foreground: dark charcoal grey
road strips alternating with vivid emerald green and electric green grass strips,
running horizontally. Middle distance: open rolling green fields. Far horizon:
a row of tall white wind turbines with slowly turning blades; in the distance,
a high-voltage electricity pylon line. The mood is clean and optimistic.
Sky: bright blue with crisp white clouds and a feeling of open space.
Style: watercolour and gouache painted illustration, slightly naive storybook look,
bright clean light. No characters, no cars, no text, no labels, no watermarks.
```

---

## 📐 Přehled cílových rozměrů

| Asset | Generovat v | Zmenšit na |
|---|---|---|
| car_*.png (6×) | 2:1, ~1024×512 | 168×80 px |
| station_*.png (5×) | 1:1, ~1024×1024 | 120×120 px |
| bg_*.png (4×) | 16:9, ~1920×1080 | 960×530 px |

**Doporučený nástroj na resize:** ImageMagick (`mogrify -resize 168x80 car_*.png`),
nebo online: squoosh.app / photopea.com.

---

## 🔧 Poznámky k integraci (pro Claude Code)

Po přípravě assetů stačí říct:  
*"Integruj složku assets/ do hry — nahraď fillRect v drawCar() a drawStation() za drawImage()."*

Claude Code přidá:
1. Asset preloader (Promise.all s Image objekty)
2. Náhradu `fillRect` v `drawCar()` za `ctx.drawImage(sprites[car.model], ...)`
3. Náhradu station boxu za `ctx.drawImage(stationIcons[fuelKey], ...)`
4. Dynamické background switching podle `state.level`
5. Fallback na původní barevné fillRect pokud obrázek nedokázal načíst

Doporučená složka: `PETROL_STATION/assets/cars/`, `assets/stations/`, `assets/backgrounds/`
