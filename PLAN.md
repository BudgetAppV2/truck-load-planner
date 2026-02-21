# Truck Load Planner — Project Plan

## Vision
A standalone, shareable 3D truck loading optimizer for touring productions.
Users provide a Google Sheet inventory of road cases → the app optimizes wall placement and shows an interactive 3D view.

## Source
Extracted from `/Users/benoitarchambault/CAD_Automation/gb-truck-loader/viewer/truck-viewer.html`
That file is a 6300-line monolith. We extract only what's needed.

## Repo Location
`/Users/benoitarchambault/truck-load-planner/`

## Architecture

```
truck-load-planner/
├── index.html              ← Main app (clean UI, no clutter)
├── README.md               ← User documentation
├── config/
│   ├── trucks.json         ← Truck dimensions (20', 36', 53') ✅ DONE
│   └── blocks-gb.json      ← GB block config (example) ✅ DONE
├── js/
│   ├── app.js              ← App initialization, UI wiring, config loading
│   ├── solver.js           ← WallPlanner engine (all placement phases)
│   ├── viewer3d.js         ← Three.js 3D rendering
│   ├── sheet-loader.js     ← Google Sheet CSV fetch + parsing
│   └── config-loader.js    ← Load trucks.json + blocks config
├── css/
│   └── style.css           ← All styles extracted from HTML
├── knowledge/
│   └── patterns.json       ← KB learned patterns
└── templates/
    └── SHEET_TEMPLATE.md   ← Instructions for creating a compatible Google Sheet
```

## UI Requirements

### What to INCLUDE
- 3D truck viewer (Three.js) — empty truck on load, populated after Fetch Sheet
- Top bar: truck size selector, block config selector, Google Sheet URL input, Fetch Sheet button
- Stats bar: case count, depth used, depth %, wall count
- 3D controls: orbit, zoom, pan
- Wall section overlays (colored sections showing wall boundaries)
- Department color legend
- Placement mode tabs: WallPlanner (auto) | Editor (manual drag-drop in future)
- LISP export button (for AutoCAD users)

### What to EXCLUDE (not in v1)
- Validation panel (the overlap/bounds/flat-face checker) — keep logic internally but no UI panel
- Test Lab (pattern variant generation)
- Recipe Discovery system
- Wall Builder drag-drop (keep for v2)
- Pre-loaded cases on startup — start with EMPTY truck
- Pattern-based placement engine (old engine, replaced by WallPlanner)

### Startup Flow
1. App loads → shows empty 3D truck (default 53')
2. User selects truck size (dropdown) → truck resizes in 3D
3. User pastes Google Sheet URL or ID
4. User clicks "Fetch Sheet" → cases load → WallPlanner runs → 3D populates
5. Stats update with results

## Source Code Extraction Map

From `truck-viewer.html` (line numbers approximate):

| Lines | Section | Extract to | Action |
|-------|---------|-----------|--------|
| 1-600 | HTML + CSS | `index.html` + `css/style.css` | Simplify HTML, extract CSS |
| 601-1348 | Three.js viewer setup | `js/viewer3d.js` | Extract, parameterize truck dims |
| 1349-1440 | Block registry + config + sheet fetch | `js/config-loader.js` + `js/sheet-loader.js` | Replace hardcoded with JSON load |
| 1441-1650 | Sheet fetch + filtering | `js/sheet-loader.js` | Keep fetch logic, add URL input |
| 1651-2111 | Pattern placement engine | **SKIP** | Old engine, not needed |
| 2112-3146 | WallPlanner solver | `js/solver.js` | Extract as-is, parameterize config |
| 3147-3290 | Validation panel | **SKIP UI** | Keep validation logic inside solver |
| 3291-3393 | LISP export | `js/lisp-export.js` (optional) | Keep for AutoCAD users |
| 3394-3895 | Test Lab | **SKIP** | Not in v1 |
| 3896-4493 | Wall Builder | **SKIP** | v2 feature |
| 4494-5794 | Truck Editor | **SKIP** | v2 feature |
| 5795-end | Recipe Discovery | **SKIP** | Not in v1 |

## Configuration System

### trucks.json ✅ DONE
```json
{
  "trucks": {
    "20ft": { "interiorWidth": 98, "interiorLength": 240, "interiorHeight": 96 },
    "36ft": { "interiorWidth": 98, "interiorLength": 432, "interiorHeight": 96 },
    "53ft": { "interiorWidth": 98, "interiorLength": 624, "interiorHeight": 108 }
  }
}
```

### blocks-gb.json ✅ DONE
Contains: blocks (dimensions), subgroupBlock (mapping), subgroupDept (mapping), departments (colors/priorities)

### How a new user adds their own blocks
1. Copy `blocks-gb.json` → `blocks-mycompany.json`
2. Define their case types with dimensions
3. Map their sheet subgroup names → block names
4. Map subgroups → departments
5. Select their config in the UI dropdown

## Solver (WallPlanner) — Key Parameters to Externalize

Currently hardcoded constants that should come from config or be smart defaults:
- `WP_TRUCK_WIDTH` → from trucks.json
- `WP_TRUCK_LENGTH` → from trucks.json  
- `WP_TRUCK_HEIGHT` → from trucks.json
- `BLOCK_DIMS` → from blocks config JSON
- `SUBGROUP_BLOCK` → from blocks config JSON
- `SUBGROUP_DEPT` → from blocks config JSON
- `WP_DEPT_PRIORITY` → from blocks config JSON (departments.priority)
- `WP_LX_SG_PRIORITY` → this is GB-specific, should be in blocks-gb.json

## Google Sheet Format

Required columns (case-insensitive matching):
| Column | Description | Required |
|--------|-------------|----------|
| subgroup | Case category name | ✅ |
| nom | Case display name | ✅ |
| block_name | Block type (matches blocks config) | Optional (fallback to subgroupBlock mapping) |
| width | Width in inches | Optional (fallback to blocks config) |
| depth | Depth in inches | Optional (fallback to blocks config) |
| height | Height in inches | Optional (fallback to blocks config) |
| dept | Department code | Optional (fallback to subgroupDept mapping) |
| camion | Truck assignment number | Optional (for multi-truck) |

## Implementation Phases

### Phase 1: Scaffold + Empty Viewer
- [ ] Clean index.html with simplified UI
- [ ] Extract CSS to style.css
- [ ] Extract Three.js viewer to viewer3d.js
- [ ] Load trucks.json, render empty truck
- [ ] Truck size dropdown works (changes 3D truck)
- [ ] Git init + commit

### Phase 2: Config + Sheet Loading
- [ ] config-loader.js: loads trucks.json + selected blocks JSON
- [ ] sheet-loader.js: fetch Google Sheet by URL/ID
- [ ] URL input field with localStorage persistence
- [ ] Block config dropdown (loads different JSON files)
- [ ] Cases parsed but not placed yet (just logged)

### Phase 3: Solver Integration
- [ ] Extract WallPlanner to solver.js
- [ ] Parameterize all constants (truck dims, block config, dept priority)
- [ ] solver.js exports `runWallPlanner(cases, truckConfig, blockConfig) → placements[]`
- [ ] Wire up: Fetch Sheet → solver → 3D rendering
- [ ] Stats bar updates

### Phase 4: Polish
- [ ] Department color legend
- [ ] Wall section overlays in 3D
- [ ] LISP export (optional module)
- [ ] README with setup instructions
- [ ] Sheet template documentation
- [ ] Git tag v1.0

### Phase 5: Future (v2)
- [ ] Manual editor (drag-drop walls)
- [ ] Multi-truck support
- [ ] Custom block editor in UI
- [ ] Knowledge base / recipe system
- [ ] Save/load placement JSON

## Key Technical Notes

### WallPlanner Solver Phases (preserve exactly)
1. Phase 0: Split mixed subgroups
2. Phase 1: Build inventory (stack counting)
3. Phase 1.5: Floor panels (planchers) with load bars — always first at fond
4. Phase 2: Build full walls (subgroup-pure)
5. Phase 2.5: Gap-fill orphans into full walls
6. Phase 3A: KB recipe matching
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
Lower score → closer to fond (cab). Creates descending staircase.

### Floor Panel Rule
When `isFloor: true` in block config:
- Placed first at fond (cab)
- 2 per row (45+45=90" < 98")
- Load bar spacer (2") between rows
- Always before any other walls

### Physical Constraints
- Truck width: 98" (all sizes)
- Flat-face: ±2" ideal, ±8" acceptable, >8" critical
- Stacking: same block type only, maxStack from config
- No overlaps, no out-of-bounds

## CLAUDE.md for Claude Code
When working in this repo, Claude Code should:
- Read this PLAN.md first for context
- Reference the source at `/Users/benoitarchambault/CAD_Automation/gb-truck-loader/viewer/truck-viewer.html`
- Extract code sections according to the extraction map
- Keep the solver logic EXACTLY as-is (it's been heavily debugged)
- Test in browser after each phase (just open index.html)
- No build tools needed — vanilla JS with ES modules
