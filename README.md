# 🚛 Truck Load Planner

A 3D truck loading optimizer for touring productions — theater, concerts, events.

## What it does

Given a Google Sheet inventory of road cases (flight cases), this tool:
1. **Automatically plans wall configurations** using bin-packing algorithms
2. **Visualizes the load in 3D** with an interactive Three.js viewer
3. **Validates physical constraints** (overlaps, flat-face, truck bounds)
4. **Orders walls for stability** (heaviest/tallest at back, lightest at door)

## Quick Start

1. **Copy the template sheet**: [Template Sheet](TODO: link)
2. **Add your cases** — fill in subgroup, name, width, depth, height
3. **Open `viewer/truck-viewer.html`** in a browser
4. **Paste your Sheet URL** and click Load

## Google Sheet Format

Your sheet needs these columns:

| Column | Description | Example |
|--------|-------------|---------|
| subgroup | Case category | `Alpha (moving)` |
| nom | Case name | `ALPHA #1` |
| block_name | Block type identifier | `CAM_LX_Alpha` |
| width | Width in inches | `31` |
| depth | Depth in inches | `29` |
| height | Height in inches | `36` |
| num_caisse | Case ID number | `C-001` |
| dept | Department | `LX` |

## Truck Sizes

| Size | Interior Width | Interior Length | Interior Height |
|------|---------------|----------------|-----------------|
| 20'  | 98" | 240" | 96" |
| 36'  | 98" | 432" | 96" |
| 53'  | 98" | 624" | 108" |

## Configuration

### Adding your own cases

Edit the `BLOCK_DIMS` object in `viewer/truck-viewer.html` to define your case types:

```javascript
'YOUR_BLOCK_NAME': {w:31, d:29, h:36, rot:0, stackable:true, maxStack:2},
```

Properties:
- `w`: width (inches) — the side that faces the truck wall
- `d`: depth (inches) — how far into the truck the case extends  
- `h`: height (inches)
- `rot`: default rotation (0 or 90)
- `stackable`: can cases be stacked on this type?
- `maxStack`: maximum stack height (1 = no stacking)
- `isFloor`: (optional) marks as floor panel — placed first with load bars

### Subgroup mapping

Map your sheet's subgroup names to block types in `SUBGROUP_BLOCK`:

```javascript
'Your Subgroup Name': 'YOUR_BLOCK_NAME',
```

### Department mapping

Map subgroups to departments in `SUBGROUP_DEPT`:

```javascript
'Your Subgroup Name': 'LX',  // or SON, CARP, VDO, etc.
```

## Algorithm Overview

The WallPlanner uses a multi-phase approach:

1. **Phase 0** — Split mixed subgroups into uniform block types
2. **Phase 1.5** — Floor panels placed first (with load bar spacers)
3. **Phase 2** — Build full walls from single subgroups
4. **Phase 2.5** — Fill gaps in full walls with compatible orphans
5. **Phase 3A** — Match known recipes from the knowledge base
6. **Phase 3B** — Rotation-aware depth-grouped FFD for remaining orphans
7. **Phase 3C** — Absorb very weak walls into stronger ones
8. **Phase 4** — Score-based wall ordering (height × fill%, dept, reliability)
9. **Phase 5** — Final coordinate calculation with spillover recovery

### Key Constraints

- **Flat-face criterion**: All cases in a wall must have similar depth (±2" ideal, ±8" acceptable) so the door-facing surface is flat for strapping
- **Truck width**: 98" interior — no case can exceed this
- **Stacking**: Max 2 high, same block type only
- **Stability**: Walls ordered tallest→shortest from cab to door

## Development

Built with:
- Three.js for 3D visualization
- Vanilla JavaScript for the solver (no build step needed)
- Python CLI for AutoCAD LISP generation

## License

MIT
