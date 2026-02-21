# CLAUDE.md — Instructions for Claude Code

## Project
Truck Load Planner — 3D truck loading optimizer for touring productions.

## Read First
- `PLAN.md` — Complete project plan, architecture, extraction map, implementation phases
- `config/trucks.json` — Truck dimension configs (done)
- `config/blocks-gb.json` — Example block configuration for Grands Ballets (done)

## Source Code
The original monolithic viewer is at:
`/Users/benoitarchambault/CAD_Automation/gb-truck-loader/viewer/truck-viewer.html`
(6305 lines — HTML + CSS + JS all in one file)

Extract code according to the extraction map in PLAN.md.
**CRITICAL**: Keep the WallPlanner solver logic (lines ~2112-3146) EXACTLY as-is.
It has been extensively debugged — do not refactor the algorithm, only extract and parameterize.

## Architecture
- No build tools — vanilla JS with `<script type="module">`
- Config loaded from JSON files at runtime
- Single `index.html` that imports JS modules
- Open in browser to test (no server needed, but may need local server for fetch)

## Key Rules
1. The solver works — don't change its algorithm, only wrap it
2. Start with empty truck — no pre-loaded cases
3. No validation panel, test lab, recipe discovery, wall builder, truck editor in v1
4. Keep it simple — someone should fork, add their blocks JSON, and go
5. Floor panels (isFloor:true) always load first with load bar spacers

## Testing
Open index.html in browser. Check console for solver logs.
The Google Sheet fetch requires the sheet to be published (File > Share > Publish to web).

## Git
Commit after each implementation phase.
Use conventional commits: `feat:`, `refactor:`, `fix:`, `docs:`
