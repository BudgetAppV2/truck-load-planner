# CLAUDE.md — Instructions for Claude Code

## Project
Truck Load Planner — **Universal** 3D truck loading optimizer.
Anyone with a Google Sheet of cases + dimensions can optimize their truck load.

## Read First
- `PLAN.md` — Complete project plan, UNIVERSAL sheet format, extraction map, phases

## Key Principle: UNIVERSAL TOOL
This is NOT a company-specific tool. The Google Sheet IS the configuration.
Each row in the sheet has: name, width, depth, height. That's all the solver needs.
No BLOCK_DIMS lookup, no SUBGROUP_BLOCK mapping for the default path.

The `config/blocks-gb.json` exists ONLY as a legacy fallback for one specific company (Grands Ballets)
whose existing sheet doesn't have dimensions in the columns. New users never need it.

## Source Code
The solver algorithm is at:
`/Users/benoitarchambault/CAD_Automation/gb-truck-loader/viewer/truck-viewer.html`
Lines ~2112-3146 = WallPlanner solver.

**CRITICAL**: Keep the solver algorithm EXACTLY as-is. Only changes:
- Replace BLOCK_DIMS lookups → use case.w / case.d / case.h directly
- Replace SUBGROUP_BLOCK → use case.group
- Replace SUBGROUP_DEPT → use case.dept
- Replace hardcoded WP_TRUCK_WIDTH/LENGTH/HEIGHT → from truckConfig parameter
- Replace WP_DEPT_PRIORITY → auto-generate from unique dept values in cases
- Skip Phase 3A (KB recipes) when no knowledge base is provided
- Floor panels: triggered by case.isFloor flag, not by block config lookup

## Sheet Parser (Universal)
The sheet parser in `js/sheet-loader.js` must:
1. Accept column aliases (nom/name, largeur/width, profondeur/depth, hauteur/height, etc.)
2. Read dimensions DIRECTLY from the sheet — this is the primary path
3. Expand qty column (qty=3 → 3 case objects)
4. Set smart defaults (stackable=false, maxStack=1, dept="GENERAL", allowRotation=true)
5. The `group` column = grouping key for the solver (cases in same group prefer same wall)
6. Legacy fallback: if dimensions are missing AND blocks config is loaded, try lookup

## Architecture
- No build tools — vanilla JS with `<script type="module">`
- Config loaded from JSON at runtime (only trucks.json required)
- Single index.html entry point
- Test by opening in browser (may need local server for fetch)

## Git
Commit after each implementation phase.
Use conventional commits: `feat:`, `refactor:`, `fix:`, `docs:`

## Current Status
- Phase 1 ✅ — Scaffold + 3D viewer (commit f1994ab)
- Phase 2 ✅ — Config + Sheet loading (commit 2e634f5)
- Phase 3 → IN PROGRESS — Solver integration (universal mode)
