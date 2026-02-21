# Truck Load Planner

A 3D truck loading optimizer. Pack road cases, boxes, or freight into trucks — automatically.

Works for theater, concerts, events, moving companies, freight — anyone with boxes and a truck. No proprietary config needed — just a Google Sheet with your cases and their dimensions.

## How It Works

1. **Create a Google Sheet** with your cases (name, width, depth, height)
2. **Open the app** in a browser — an empty 3D truck appears
3. **Paste your Sheet URL** and click Fetch Sheet
4. The solver **automatically plans wall configurations** using bin-packing algorithms
5. The load is **visualized in 3D** with colored departments, wall overlays, and stats

## Quick Start

1. Create a Google Sheet with these columns:

   | nom | largeur | profondeur | hauteur |
   |-----|---------|------------|---------|
   | Alpha spot | 31 | 29 | 36 |
   | Sound rack | 38 | 20 | 48 |

2. Share the sheet: **File > Share > Publish to web**
3. Open `index.html` in a browser (or serve with any HTTP server)
4. Select truck size, paste the Sheet URL, click **Fetch Sheet**

That's it. The sheet IS the configuration — dimensions are right there in each row.

## Google Sheet Format

### Required Columns

| Column | Description | Example |
|--------|-------------|---------|
| **nom** | Case name | `Alpha spot` |
| **largeur** | Width in inches (side facing truck wall) | `31` |
| **profondeur** | Depth in inches (into the truck) | `29` |
| **hauteur** | Height in inches | `36` |

### Optional Columns

| Column | What it does | Default |
|--------|-------------|---------|
| **dept** | Department — color-codes cases in 3D | `GENERAL` |
| **qty** | Quantity — duplicates the row N times | `1` |
| **stackable** | Can other cases stack on this? | `false` |
| **max_stack** | Maximum stack height | `1` |
| **is_floor** | Floor panel — loads first at back of truck | `false` |
| **allow_rotation** | Can the solver rotate this 90 degrees? | `true` |
| **group** | Group name — keeps cases together in same wall | (none) |
| **camion** | Truck assignment number | (none) |

Boolean columns accept: `oui`, `yes`, `true`, `1`

### Column Name Aliases

Column names are flexible (case-insensitive). Use whichever language you prefer:

- **nom**: `nom`, `name`, `case_name`, `description`
- **largeur**: `largeur`, `width`, `w`, `larg`
- **profondeur**: `profondeur`, `depth`, `d`, `prof`
- **hauteur**: `hauteur`, `height`, `h`, `haut`
- **dept**: `dept`, `department`
- **group**: `group`, `groupe`, `subgroup`, `sous-groupe`

## Truck Sizes

| Size | Width | Length | Height |
|------|-------|--------|--------|
| 20' | 98" | 240" | 96" |
| 36' | 98" | 432" | 96" |
| 53' | 98" | 624" | 108" |

## 3D Viewer Controls

- **Left-click drag** — rotate the view
- **Right-click drag** or **middle-click drag** — pan
- **Scroll wheel** — zoom
- **Click a case** — select it, see details in the sidebar
- **Hover** — tooltip with case info

Camera presets: **Reset**, **Top**, **Front**, **Side**, **Perspective/Orthographic**

## Algorithm

The WallPlanner solver uses a multi-phase bin-packing approach:

1. **Split mixed groups** — separate cases with different dimensions
2. **Floor panels first** — `is_floor` cases placed at back with load bars
3. **Build full walls** — single-group grids packed to truck width
4. **Gap-fill** — fit orphan cases into wall gaps (same department)
5. **Depth-grouped FFD** — rotation-aware first-fit-decreasing for remaining cases
6. **Absorb weak walls** — merge underfilled walls into stronger ones
7. **Stability ordering** — tallest/fullest walls at back (cab), lightest at door
8. **Coordinate calculation** — final placement with spillover recovery
9. **Validation** — checks overlaps, bounds, flat-face constraints

### Key Constraints

- **Flat-face**: cases in a wall must have similar depth (ideal ±2", max ±8") for strapping
- **No overlaps**: physical constraint validation catches any issues
- **Stacking**: only cases with `stackable = true`, limited by `max_stack`
- **Stability**: walls sorted by height x fill ratio, heaviest at back

## Running the App

No build step needed. Just serve the files:

```bash
# Option 1: Python
python3 -m http.server 8080

# Option 2: Node
npx serve .

# Option 3: Just open index.html in your browser
# (JSONP sheet fetch works from file:// too)
```

## Project Structure

```
truck-load-planner/
├── index.html            ← Main app
├── css/style.css         ← Styles
├── js/
│   ├── app.js            ← App init, UI wiring
│   ├── solver.js         ← WallPlanner engine
│   ├── viewer3d.js       ← Three.js 3D rendering
│   ├── sheet-loader.js   ← Google Sheet fetch + parsing
│   └── config-loader.js  ← Truck config loader
├── config/
│   └── trucks.json       ← Truck dimensions
└── templates/
    └── SHEET_TEMPLATE.md ← How to create a compatible sheet
```

## Built With

- [Three.js](https://threejs.org/) — 3D visualization
- Vanilla JavaScript — no build tools, no framework
- Google Visualization API (JSONP) — sheet data fetching

## License

MIT
