# Truck Load Planner — Project Plan

## Vision
A **universal** 3D truck loading optimizer for anyone who needs to pack road cases into trucks.
No proprietary config needed — just a Google Sheet with your cases and their dimensions.
Works for theater, concerts, events, moving companies, freight — anyone with boxes and a truck.

## Principles
1. **Universal first** — the app works with ANY set of cases, no company-specific config required
2. **Dimensions in the sheet** — each row has name, width, depth, height. That's the source of truth.
3. **Zero config startup** — pick truck size, paste sheet URL, click Fetch. Done.
4. **Optional power features** — department colors, stacking rules, floor panels are opt-in via sheet columns

## Source
Solver logic extracted from `/Users/benoitarchambault/CAD_Automation/gb-truck-loader/viewer/truck-viewer.html`
That file is a 6300-line monolith. We extract only the solver + 3D viewer.

## Repo Location
`/Users/benoitarchambault/truck-load-planner/`

## Architecture

```
truck-load-planner/
├── index.html              ← Main app (clean UI)
├── README.md               ← User documentation
├── config/
│   └── trucks.json         ← Truck dimensions (20', 36', 53') ✅ DONE
├── js/
│   ├── app.js              ← App init, UI wiring ✅ DONE (Phase 1-2)
│   ├── solver.js           ← WallPlanner engine (all placement phases)
│   ├── viewer3d.js         ← Three.js 3D rendering ✅ DONE (Phase 1)
│   ├── sheet-loader.js     ← Google Sheet fetch + parsing ✅ DONE (Phase 2)
│   └── config-loader.js    ← Load trucks.json ✅ DONE (Phase 1)
├── css/
│   └── style.css           ← Styles ✅ DONE (Phase 1)
└── templates/
    └── SHEET_TEMPLATE.md   ← How to create a compatible Google Sheet
```

Note: `config/blocks-gb.json` still exists as a LEGACY OVERRIDE for the GB-specific sheet
that uses subgroup names without dimensions. New users don't need it.

## Google Sheet Template (Universal)

This is the CORE of the universal approach. The sheet IS the configuration.

### Required Columns
| Column | Description | Example |
|--------|-------------|---------|
| **nom** | Case name / identifier | `Alpha #1` |
| **largeur** | Width in inches (side facing truck wall) | `31` |
| **profondeur** | Depth in inches (into the truck) | `29` |
| **hauteur** | Height in inches | `36` |

### Optional Columns (power features)
| Column | Description | Default if missing |
|--------|-------------|-------------------|
| **dept** | Department code (for colors/grouping) | `GENERAL` |
| **qty** | Quantity (duplicate this row N times) | `1` |
| **stackable** | Can other cases stack on this? (oui/yes/true) | `false` |
| **max_stack** | Max stack count | `1` |
| **is_floor** | Floor panel — placed first with load bars (oui/yes/true) | `false` |
| **allow_rotation** | Can the solver rotate 90°? (oui/yes/true) | `true` |
| **camion** | Truck assignment number (for multi-truck) | `1` |
| **group** | Group name — cases with same group stay in the same wall | (none) |

### Column Name Aliases (case-insensitive)
The parser accepts multiple names for each column:
- nom: `nom`, `name`, `case_name`, `description`
- largeur: `largeur`, `width`, `w`, `larg`
- profondeur: `profondeur`, `depth`, `d`, `prof`
- hauteur: `hauteur`, `height`, `h`, `haut`
- dept: `dept`, `department`, `departement`, `dep`
- stackable: `stackable`, `empilable`
- is_floor: `is_floor`, `plancher`, `floor`
- allow_rotation: `allow_rotation`, `rotation`
- group: `group`, `groupe`, `subgroup`, `sous_groupe`

### How It Works
1. User creates a Google Sheet with their cases
2. Each row = one case type (use qty column for multiples)
3. Dimensions are RIGHT THERE in the sheet — no external config needed
4. Publish the sheet (File > Share > Publish to web)
5. Paste URL in the app, click Fetch

### Example Sheet

| nom | largeur | profondeur | hauteur | dept | qty | stackable |
|-----|---------|------------|---------|------|-----|-----------|
| Coffre éclairage A | 31 | 29 | 36 | LX | 3 | oui |
| Rack son | 38 | 20 | 48 | SON | 1 | non |
| Console | 44 | 30 | 18 | LX | 2 | oui |
| Plancher | 45 | 100 | 60 | CARP | 6 | non |
| Câblage | 44 | 30 | 36 | LX | 2 | non |
| Moniteur | 31 | 24 | 32 | SON | 4 | oui |

## Legacy Override (blocks-gb.json)

For the Grands Ballets specifically, their existing sheet uses `subgroup` names without
explicit dimensions. The `blocks-gb.json` file provides:
- `blocks`: subgroup name → dimensions (width, depth, height, stackable, etc.)
- `subgroupBlock`: subgroup name aliases → canonical block name
- `subgroupDept`: subgroup name → department

**This is ONLY loaded when "Grands Ballets" is selected in the config dropdown.**
The universal path ignores it entirely — dimensions come from the sheet.

The config dropdown should have:
- "Universal (dimensions in sheet)" ← DEFAULT
- "Grands Ballets (legacy)" ← loads blocks-gb.json for GB-specific sheet

## UI Requirements

### What to INCLUDE
- 3D truck viewer (Three.js) — empty truck on load, populated after Fetch Sheet
- Top bar: truck size selector, (optional) legacy config selector, Google Sheet URL input, Fetch Sheet button
- Stats bar: case count, depth used, depth %, wall count
- 3D controls: orbit, zoom, pan (camera buttons)
- Wall section overlays in 3D
- Department color legend (auto-generated from dept column)
- Case list sidebar with case details

### What to EXCLUDE (not in v1)
- Validation panel UI
- Test Lab
- Recipe Discovery
- Wall Builder / Truck Editor drag-drop
- Pre-loaded cases on startup — start with EMPTY truck
- Pattern-based placement engine (old, replaced by WallPlanner)
- LISP export (too niche for universal tool — maybe v2)

### Startup Flow
1. App loads → shows empty 3D truck (default 53')
2. User selects truck size (dropdown) → truck resizes
3. User pastes Google Sheet URL or ID
4. User clicks "Fetch Sheet" → cases parsed → WallPlanner runs → 3D populates
5. Stats update with results

## Solver (WallPlanner) — Universal Adaptation

### Input
The solver receives a flat array of case objects:
```javascript
[
  { nom: "Alpha #1", w: 31, d: 29, h: 36, dept: "LX", stackable: true, maxStack: 2, group: "Alpha", isFloor: false, allowRotation: true },
  { nom: "Console", w: 44, d: 30, h: 18, dept: "LX", stackable: true, maxStack: 2, group: "Console", isFloor: false, allowRotation: true },
  ...
]
```

### How the sheet parser builds case objects
1. Read each row from sheet
2. Get dimensions directly from largeur/profondeur/hauteur columns
3. If dimensions missing AND legacy config loaded → fallback to blocks config lookup
4. If dimensions still missing → skip row with warning
5. Expand qty column (qty=3 → 3 separate case objects)
6. Set defaults: stackable=false, maxStack=1, isFloor=false, allowRotation=true, dept="GENERAL"
7. `group` field = the group/subgroup column value (cases with same group prefer same wall)

### Solver Changes for Universal Mode
The WallPlanner algorithm stays the same, but:

1. **No BLOCK_DIMS lookup** — dimensions come from case objects directly
2. **No SUBGROUP_BLOCK mapping** — the `group` field IS the grouping key
3. **No SUBGROUP_DEPT mapping** — `dept` comes from sheet directly
4. **WP_DEPT_PRIORITY** — auto-generated from unique dept values in order of appearance, or alphabetical
5. **WP_LX_SG_PRIORITY** — not used in universal mode (was GB-specific)
6. **KB recipes (Phase 3A)** — skipped in universal mode (no knowledge base)
7. **Floor panels (Phase 1.5)** — triggered by `isFloor: true` on any case

### What the solver needs from config
```javascript
{
  truckWidth: 98,      // from trucks.json
  truckLength: 624,    // from trucks.json
  truckHeight: 108,    // from trucks.json
  deptPriority: { LX: 1, SON: 2, CARP: 3 },  // auto-generated from cases
  kbPatterns: []       // empty in universal mode
}
```

## Source Code Extraction Map

From `truck-viewer.html` (line numbers approximate):

| Lines | Section | Extract to | Action |
|-------|---------|-----------|--------|
| 1-600 | HTML + CSS | `index.html` + `css/style.css` | ✅ DONE (Phase 1) |
| 601-1348 | Three.js viewer | `js/viewer3d.js` | ✅ DONE (Phase 1) |
| 1349-1440 | Config + sheet fetch | `js/config-loader.js` + `js/sheet-loader.js` | ✅ DONE (Phase 1-2) |
| 1441-1650 | Sheet filtering | `js/sheet-loader.js` | ✅ DONE (Phase 2) |
| 1651-2111 | Pattern engine | **SKIP** | Old engine |
| 2112-3146 | WallPlanner | `js/solver.js` | Phase 3 — extract + parameterize |
| 3147-3290 | Validation | **SKIP UI** | Keep logic in solver |
| 3291-3393 | LISP export | **SKIP v1** | Maybe v2 |
| 3394-3895 | Test Lab | **SKIP** | |
| 3896-4493 | Wall Builder | **SKIP** | v2 |
| 4494-5794 | Truck Editor | **SKIP** | v2 |
| 5795-end | Recipe Discovery | **SKIP** | |

## Implementation Phases

### Phase 1: Scaffold + Empty Viewer ✅ DONE
- [x] Clean index.html with simplified UI
- [x] Extract CSS to style.css
- [x] Extract Three.js viewer to viewer3d.js
- [x] Load trucks.json, render empty truck
- [x] Truck size dropdown works

### Phase 2: Config + Sheet Loading ✅ DONE
- [x] config-loader.js: loads trucks.json
- [x] sheet-loader.js: fetch Google Sheet by URL/ID
- [x] URL input field with localStorage persistence
- [x] Cases parsed and displayed in sidebar

### Phase 3: Solver Integration (UNIVERSAL) ✅ DONE
- [x] Extract WallPlanner to solver.js from source lines ~2112-3146
- [x] **Universal input**: solver takes case objects with dimensions directly (no BLOCK_DIMS lookup)
- [x] **Grouping by `group` field** instead of subgroup/block_name mapping
- [x] **Auto-generate deptPriority** from unique dept values in cases
- [x] **Skip KB recipes** (Phase 3A) when no knowledge base loaded
- [x] **Floor panels** triggered by isFloor flag on case objects
- [x] **Sheet parser update**: read dimensions from sheet directly, expand qty, set defaults
- [x] Wire up: Fetch Sheet → solver → 3D rendering → stats update
- [x] Test with GB sheet (legacy mode) AND a fresh universal sheet

### Phase 4: Polish ✅ DONE
- [x] Department color legend (auto from dept values)
- [x] Wall section overlays in 3D
- [x] README rewrite for universal audience
- [x] Sheet template documentation + example sheet
- [x] Git tag v1.0

### Phase 5: Future (v2)
- [ ] Manual editor (drag-drop)
- [ ] Multi-truck support
- [ ] LISP export module
- [ ] Knowledge base / recipe system (opt-in)
- [ ] Save/load placement JSON
- [ ] Custom truck dimensions input

## Key Technical Notes

### WallPlanner Solver Phases (preserve exactly)
1. Phase 0: Split mixed groups (cases with same `group` but different dimensions)
2. Phase 1: Build inventory (stack counting)
3. Phase 1.5: Floor panels (isFloor cases) with load bars — always first at fond
4. Phase 2: Build full walls (single-group)
5. Phase 2.5: Gap-fill orphans into full walls
6. Phase 3A: KB recipe matching — **SKIP if no KB loaded**
7. Phase 3B: Rotation-aware depth-grouped FFD (2-pass: strict ±2", relaxed ±8")
8. Phase 3C: Absorb very weak walls (<50% fill) into stronger ones
9. Phase 3D: Multi-wall merge (same-dept then cross-dept)
10. Phase 4: Score-based ordering (effectiveHeight × fillRatio, dept, reliability)
11. Phase 5: Coordinate calculation with spillover recovery

### Scoring Formula (Phase 4)
```
effectiveH = maxHeight × fillRatio
heightInv = round(100 - effectiveH)
score = (heightInv × 100) + (deptPriority × 4) + reliabilityGroup
```

### Floor Panel Rule
When `isFloor: true` on a case:
- Placed first at fond (cab)
- As many per row as fit (floor.width × N ≤ truckWidth)
- Load bar spacer (2") between rows

### Physical Constraints
- Truck width: from trucks.json (typically 98")
- Flat-face: ±2" ideal, ±8" acceptable
- Stacking: same group only, maxStack from case data
- No overlaps, no out-of-bounds
