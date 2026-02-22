// solver.js — WallPlanner engine (extracted from truck-viewer.html lines ~2112-3146)
// 5-phase depth-based wall grouping algorithm
//
// CRITICAL: This solver logic has been extensively debugged.
// Only parameterization changes were made — the algorithm is preserved exactly.
//
// Changes from monolith:
//   - BLOCK_DIMS lookup → case.width/depth/height directly
//   - SUBGROUP_BLOCK mapping → case.group directly
//   - SUBGROUP_DEPT mapping → case.dept directly
//   - WP_TRUCK_WIDTH → config.truckWidth parameter
//   - WP_DEPT_PRIORITY → config.deptPriority (auto-generated)
//   - WP_LX_SG_PRIORITY → not used in universal mode
//   - WP_NEVER_STACKED → case.stackable/maxStack from sheet
//   - knowledgePatterns → config.kbPatterns (empty array = skip Phase 3A)
//   - wallSections → returned as part of result

// Wall reliability tiers (lower = more reliable = goes to fond/cab)
const WP_RELIABILITY = {
  FULL_WALL: 1,
  KB_COMBO: 2,
  TIGHT_FIT: 3,
  ORPHAN_SAME_DEPT: 4,
  ORPHAN_MIXED: 5,
};

// Constants (unchanged from original)
const WP_MIN_FILL = 0.80;
const WP_GAP_THRESH = 0.95;

/**
 * Run the WallPlanner solver.
 *
 * @param {Object[]} cases — Array of case objects from sheet parser:
 *   { nom, name, width, depth, height, dept, subgroup, group, stackable, maxStack, isFloor, allowRotation, rotation }
 * @param {Object} config — Solver configuration:
 *   { truckWidth, truckLength, truckHeight, deptPriority, kbPatterns }
 * @returns {{ placements: Object[], wallSections: Object[] }}
 */
export function wallPlannerSolve(cases, config) {
  if (!cases.length) return { placements: [], wallSections: [] };

  const WP_TRUCK_WIDTH = config.truckWidth || 98;
  const deptPriority = config.deptPriority || {};
  const kbPatterns = config.kbPatterns || [];
  const wallSections = [];

  // Helper: get dept for a group name (handles suffixed split names like "Alpha (34x34)")
  function wpGetDept(sg) {
    // Look up dept from cases with this group
    const c = cases.find(c => c.group === sg || c.subgroup === sg);
    if (c) return c.dept || 'GENERAL';
    const base = sg.replace(/\s*\(\d+x\d+\)$/, '');
    const cb = cases.find(c => c.group === base || c.subgroup === base);
    return cb ? (cb.dept || 'GENERAL') : 'GENERAL';
  }

  // Helper: get majority department for a wall
  function wpWallDept(wall) {
    const deptCount = {};
    for (const sg of wall.subgroups) {
      const d = wpGetDept(sg);
      deptCount[d] = (deptCount[d] || 0) + 1;
    }
    return Object.entries(deptCount).sort((a, b) => b[1] - a[1])[0][0];
  }

  // Helper: pick best rotation for orphan/gap-fill packing
  function wpBestRotation(caseObj) {
    const allowRot = caseObj.allowRotation !== false;
    const w = caseObj.width, d = caseObj.depth, rot = caseObj.rotation || 0;
    if (!allowRot || Math.abs(w - d) < 0.5) return { w, d, rot };
    const iprDef = Math.floor(WP_TRUCK_WIDTH / w);
    const fillDef = iprDef * w;
    const rW = d, rD = w, rRot = (rot + 90) % 360;
    const iprRot = Math.floor(WP_TRUCK_WIDTH / rW);
    const fillRot = iprRot * rW;
    if (fillRot > fillDef + 0.5 || (Math.abs(fillRot - fillDef) < 0.5 && iprRot > iprDef))
      return { w: rW, d: rD, rot: rRot };
    return { w, d, rot };
  }

  // Helper: resolve stacking from case object
  function wpResolveStacking(caseObj) {
    return {
      stackable: caseObj.stackable || false,
      maxStack: caseObj.maxStack || 1,
    };
  }

  // Helper: wall score for sorting (Phase 4)
  // Lower score = closer to cab (fond). Cab-end walls must be flat, full-width, tall.
  function wpWallScore(w) {
    const rel = w.reliability || 99;
    const relGroup = rel <= 3 ? rel : 4;
    const fillRatio = Math.min(w.widthFill / WP_TRUCK_WIDTH, 1.0);
    const effectiveH = (w.maxHeight || 0) * fillRatio;
    const heightInv = Math.round(100 - effectiveH);
    const deptPri = deptPriority[wpWallDept(w)] || 99;
    let score = (heightInv * 100) + (deptPri * 4) + relGroup;
    // Flat-top penalty: uneven height surfaces are unstable for the wall behind them
    if (w.items && w.items.length > 0) {
      const heights = w.items.map(it => it.stackedH);
      const heightRange = Math.max(...heights) - Math.min(...heights);
      if (heightRange > 10) {
        score += Math.round((heightRange / (config.truckHeight || 110)) * 3000);
      }
    }
    // Column count bonus: more columns = fuller/more stable surface → toward cab
    if (w.items) score -= Math.min(w.items.length, 4) * 50;
    // Penalize sparse walls (1-2 columns, <90% fill) — not stable enough for cab end
    if (w.items && w.items.length <= 2 && fillRatio < 0.90) score += 2000;
    // Very weak walls (<50% fill) always go near the door
    if (fillRatio < 0.50) score += 5000;
    return score;
  }

  // Helper: merge weak walls
  function wpMergeWeakWalls(walls) {
    if (!walls.length) return walls;
    const strong = walls.filter(w => (w.widthFill / WP_TRUCK_WIDTH) >= WP_MIN_FILL);
    let weak = walls.filter(w => (w.widthFill / WP_TRUCK_WIDTH) < WP_MIN_FILL);
    if (weak.length < 2) return walls;

    for (let pass = 0; pass < 2; pass++) {
      const allowCrossDept = (pass === 1);
      weak.sort((a, b) => b.widthFill - a.widthFill);
      const merged = [];
      const used = new Set();

      for (let i = 0; i < weak.length; i++) {
        if (used.has(i)) continue;
        let current = weak[i];
        used.add(i);

        let changed = true;
        while (changed) {
          changed = false;
          let bestJ = -1, bestFill = 0;
          for (let j = i + 1; j < weak.length; j++) {
            if (used.has(j)) continue;
            if (!allowCrossDept && wpWallDept(weak[j]) !== wpWallDept(current)) continue;
            if (Math.abs(current.depth - weak[j].depth) > 8) continue;
            const combined = current.widthFill + weak[j].widthFill;
            if (combined <= WP_TRUCK_WIDTH + 0.5 && combined > bestFill) {
              bestFill = combined;
              bestJ = j;
            }
          }
          if (bestJ >= 0) {
            const wb = weak[bestJ];
            used.add(bestJ);
            for (const item of wb.items) item.xOff += current.widthFill;
            const items = current.items.concat(wb.items);
            const heights = items.map(it => it.stackedH);
            current = {
              items, widthFill: current.widthFill + wb.widthFill,
              maxHeight: Math.max(...heights), depth: Math.max(current.depth, wb.depth),
              isFlatTop: new Set(heights.map(h => Math.round(h * 10))).size <= 1,
              subgroups: [...new Set(current.subgroups.concat(wb.subgroups))].sort(),
              reliability: allowCrossDept ? WP_RELIABILITY.ORPHAN_MIXED :
                Math.max(current.reliability || WP_RELIABILITY.ORPHAN_SAME_DEPT, wb.reliability || WP_RELIABILITY.ORPHAN_SAME_DEPT),
            };
            changed = true;
          }
        }
        merged.push(current);
      }
      weak = merged;
    }
    const mergeCount = walls.length - strong.length - weak.length;
    if (mergeCount > 0) console.log(`[WallPlanner] Merged ${mergeCount} weak walls (${walls.length - strong.length} → ${weak.length})`);
    return strong.concat(weak);
  }

  // ── Phase 0: Split Mixed Subgroups ──
  // Group cases by subgroup, then split groups with mixed dimensions
  const sgGroups = {};
  for (const c of cases) {
    const sg = c.group || c.subgroup || c.nom;
    if (!sgGroups[sg]) sgGroups[sg] = [];
    sgGroups[sg].push(c);
  }

  // Split groups where cases have different dimensions (mixed subgroups)
  const inventories = [];
  for (const [sg, grp] of Object.entries(sgGroups)) {
    const dimGroups = {};
    for (const c of grp) {
      const w = c.width, d = c.depth, h = c.height;
      const key = `${w}x${d}x${h}`;
      if (!dimGroups[key]) dimGroups[key] = { w, d, h, cases: [] };
      dimGroups[key].cases.push(c);
    }
    const keys = Object.keys(dimGroups);
    if (keys.length === 1) {
      const dg = dimGroups[keys[0]];
      const stacking = wpResolveStacking(grp[0]);
      const best = wpBestRotation(grp[0]);
      inventories.push({
        sg, blockName: grp[0].block_name || sg,
        w: best.w, d: best.d, h: dg.h,
        rot: best.rot,
        stackable: stacking.stackable,
        maxStack: stacking.maxStack,
        stackedH: dg.h * stacking.maxStack,
        cases: dg.cases.slice(),
        dept: grp[0].dept,
        isFloor: grp[0].isFloor || false,
        allowRotation: grp[0].allowRotation !== false,
      });
    } else {
      console.log(`[WallPlanner] Phase 0: splitting "${sg}" into ${keys.length} dimension groups`);
      for (const [key, dg] of Object.entries(dimGroups)) {
        const splitName = `${sg} (${key.replace(/x/g, 'x')})`;
        const stacking = wpResolveStacking(dg.cases[0]);
        const best = wpBestRotation(dg.cases[0]);
        inventories.push({
          sg: splitName, blockName: dg.cases[0].block_name || sg,
          w: best.w, d: best.d, h: dg.h,
          rot: best.rot,
          stackable: stacking.stackable,
          maxStack: stacking.maxStack,
          stackedH: dg.h * stacking.maxStack,
          cases: dg.cases.slice(),
          dept: dg.cases[0].dept,
          isFloor: dg.cases[0].isFloor || false,
          allowRotation: dg.cases[0].allowRotation !== false,
        });
      }
    }
  }

  // ── Phase 1: Inventory Analysis ──
  console.log(`[WallPlanner] Phase 1: ${inventories.length} inventory groups from ${cases.length} cases`);
  for (const inv of inventories) {
    const itemsPerRow = Math.max(1, Math.floor(WP_TRUCK_WIDTH / inv.w));
    const rows = Math.ceil(inv.cases.length / (itemsPerRow * inv.maxStack));
    inv.idealRows = rows;
    inv.itemsPerRow = itemsPerRow;
    console.log(`  ${inv.sg}: ${inv.cases.length} cases, ${inv.w}×${inv.d}×${inv.h}", ${itemsPerRow}/row, stack=${inv.maxStack}, rows=${rows}, floor=${inv.isFloor}`);
  }

  // ── Phase 1.5: Floor Panels ──
  const floorInvs = inventories.filter(inv => inv.isFloor);
  const floorWalls = [];
  const WP_LOADBAR_GAP = 2;

  if (floorInvs.length > 0) {
    console.log(`[WallPlanner] Phase 1.5: ${floorInvs.length} floor panel groups`);
    for (const fInv of floorInvs) {
      const fw = fInv.w, fd = fInv.d, fh = fInv.h;
      const perRow = Math.floor(WP_TRUCK_WIDTH / fw);
      while (fInv.cases.length > 0) {
        const wall = {
          items: [], widthFill: 0, maxHeight: fh, depth: fd, isFlatTop: true,
          subgroups: [fInv.sg], reliability: WP_RELIABILITY.FULL_WALL,
        };
        let x = 0;
        for (let col = 0; col < perRow && fInv.cases.length > 0; col++) {
          const c = fInv.cases.shift();
          wall.items.push({
            blockName: fInv.blockName, sg: fInv.sg, w: fw, d: fd, h: fh,
            rot: fInv.rot, xOff: x, stackCount: 1, stackedH: fh, cases: [c],
          });
          x += fw;
        }
        wall.widthFill = x;
        floorWalls.push(wall);
        // Load bar spacer between floor rows
        if (fInv.cases.length > 0) {
          floorWalls.push({
            _isLoadBar: true,
            items: [], widthFill: 0, maxHeight: 0, depth: WP_LOADBAR_GAP,
            isFlatTop: true, subgroups: ['LOADBAR'],
            reliability: WP_RELIABILITY.FULL_WALL,
          });
        }
      }
    }
    console.log(`[WallPlanner] Phase 1.5: ${floorWalls.filter(w => !w._isLoadBar).length} floor walls`);
  }

  // ── Phase 2: Build Full Walls (single-group grids) ──
  const fullWalls = [];
  const orphanPools = [];

  for (const inv of inventories) {
    if (inv.isFloor || inv.cases.length === 0) continue;

    const wall = { items: [], widthFill: 0, maxHeight: 0, depth: inv.d, isFlatTop: true, subgroups: [inv.sg], reliability: WP_RELIABILITY.FULL_WALL };
    let x = 0;
    while (inv.cases.length > 0 && x + inv.w <= WP_TRUCK_WIDTH) {
      const stack = Math.min(inv.maxStack, inv.cases.length);
      const stackedH = inv.h * stack;
      const stackCases = inv.cases.splice(0, stack);
      wall.items.push({
        blockName: inv.blockName, sg: inv.sg, w: inv.w, d: inv.d, h: inv.h,
        rot: inv.rot, xOff: x, stackCount: stack, stackedH, cases: stackCases,
      });
      x += inv.w;
      wall.maxHeight = Math.max(wall.maxHeight, stackedH);
    }
    wall.widthFill = x;
    const heights = wall.items.map(i => i.stackedH);
    wall.isFlatTop = new Set(heights.map(h => Math.round(h * 10))).size <= 1;

    if (wall.widthFill / WP_TRUCK_WIDTH < WP_MIN_FILL) {
      wall.reliability = WP_RELIABILITY.ORPHAN_SAME_DEPT;
    }

    // If there are leftover cases, they go to orphan pool
    if (inv.cases.length > 0) {
      const orphanCols = inv.cases.length;
      if (orphanCols * inv.w >= WP_TRUCK_WIDTH * WP_MIN_FILL) {
        // Enough for another full-ish wall, keep building
        while (inv.cases.length > 0) {
          const oWall = { items: [], widthFill: 0, maxHeight: 0, depth: inv.d, isFlatTop: true, subgroups: [inv.sg], reliability: WP_RELIABILITY.FULL_WALL };
          let ox = 0;
          while (inv.cases.length > 0 && ox + inv.w <= WP_TRUCK_WIDTH) {
            const stack = Math.min(inv.maxStack, inv.cases.length);
            const stackedH = inv.h * stack;
            const stackCases = inv.cases.splice(0, stack);
            oWall.items.push({
              blockName: inv.blockName, sg: inv.sg, w: inv.w, d: inv.d, h: inv.h,
              rot: inv.rot, xOff: ox, stackCount: stack, stackedH, cases: stackCases,
            });
            ox += inv.w;
            oWall.maxHeight = Math.max(oWall.maxHeight, stackedH);
          }
          oWall.widthFill = ox;
          if (oWall.widthFill / WP_TRUCK_WIDTH < WP_MIN_FILL) {
            oWall.reliability = WP_RELIABILITY.ORPHAN_SAME_DEPT;
          }
          fullWalls.push(oWall);
        }
      } else {
        // Too few leftovers → orphan pool for consolidation
        orphanPools.push({
          sg: inv.sg, blockName: inv.blockName,
          w: inv.w, d: inv.d, h: inv.h,
          rot: inv.rot,
          stackable: inv.stackable, maxStack: inv.maxStack,
          stackedH: inv.stackedH,
          cases: inv.cases.splice(0),
          dept: inv.dept,
          allowRotation: inv.allowRotation,
        });
      }
    }
    // If this wall is too weak (< 80% fill), send its items to orphan pool for consolidation
    if (wall.widthFill / WP_TRUCK_WIDTH < WP_MIN_FILL) {
      orphanPools.push({
        sg: inv.sg, blockName: inv.blockName,
        w: inv.w, d: inv.d, h: inv.h,
        rot: inv.rot,
        stackable: inv.stackable, maxStack: inv.maxStack,
        stackedH: inv.stackedH,
        cases: wall.items.flatMap(item => item.cases),
        dept: inv.dept,
        allowRotation: inv.allowRotation,
      });
    } else {
      fullWalls.push(wall);
    }
  }

  console.log(`[WallPlanner] Phase 2: ${fullWalls.length} full walls, ${orphanPools.length} orphan pools (${orphanPools.reduce((s, p) => s + p.cases.length, 0)} cases)`);

  // ── Phase 2.5: Gap-fill orphans into full walls with gaps ──
  for (const wall of fullWalls) {
    const fillRatio = wall.widthFill / WP_TRUCK_WIDTH;
    if (fillRatio >= WP_GAP_THRESH) continue;
    let gap = WP_TRUCK_WIDTH - wall.widthFill;
    const wallDept = wpGetDept(wall.subgroups[0]);
    const itemsBefore = wall.items.length;

    for (const pool of orphanPools) {
      if (pool.cases.length === 0 || wpGetDept(pool.sg) !== wallDept) continue;
      if (Math.abs(wall.depth - pool.d) > 8) continue;

      while (pool.cases.length > 0 && gap >= pool.w - 0.5) {
        const stack = Math.min(pool.maxStack, pool.cases.length);
        const stackedH = pool.h * stack;
        const stackCases = pool.cases.splice(0, stack);
        wall.items.push({
          blockName: pool.blockName, sg: pool.sg, w: pool.w, d: pool.d, h: pool.h,
          rot: pool.rot, xOff: wall.widthFill, stackCount: stack, stackedH, cases: stackCases,
        });
        wall.widthFill += pool.w;
        gap -= pool.w;
        wall.maxHeight = Math.max(wall.maxHeight, stackedH);
        wall.depth = Math.max(wall.depth, pool.d);
        if (!wall.subgroups.includes(pool.sg)) wall.subgroups.push(pool.sg);
      }
    }
    if (wall.items.length > itemsBefore) wall.reliability = WP_RELIABILITY.TIGHT_FIT;
  }

  // ── Phase 3A: KB Recipe Matching ──
  const kbWalls = [];
  if (kbPatterns.length > 0) {
    console.log(`[WallPlanner] Phase 3A: ${kbPatterns.length} KB patterns available`);
    // KB recipe matching logic would go here
    // Skipped in universal mode (kbPatterns = [])
  } else {
    console.log('[WallPlanner] Phase 3A: no KB patterns — skipping');
  }

  // ── Phase 3B: Rotation-aware depth-grouped FFD (2-pass) ──
  const remaining = orphanPools.filter(p => p.cases.length > 0);
  console.log(`[WallPlanner] Phase 3B: ${remaining.length} orphan pools (${remaining.reduce((s, p) => s + p.cases.length, 0)} cases)`);

  // Try better rotation for each remaining pool
  for (const pool of remaining) {
    if (!pool.allowRotation || Math.abs(pool.w - pool.d) < 0.5) continue;

    // Calculate both orientations' ability to group with OTHER orphans
    const otherPools = remaining.filter(p => p !== pool && p.cases.length > 0);
    const orient1 = { w: pool.w, d: pool.d, rot: pool.rot };
    const orient2 = { w: pool.d, d: pool.w, rot: (pool.rot + 90) % 360 };

    // Count depth-compatible pools for each orientation
    function countCompatible(orient) {
      if (orient.w > WP_TRUCK_WIDTH) return -1;
      let count = 0;
      for (const other of otherPools) {
        if (Math.abs(orient.d - other.d) <= 8) count += other.cases.length;
      }
      // Also consider how many fit per row
      const ipr = Math.floor(WP_TRUCK_WIDTH / orient.w);
      return count * 100 + ipr;
    }

    const score1 = countCompatible(orient1);
    const score2 = countCompatible(orient2);

    const orient = score2 > score1 ? orient2 : orient1;
    if (orient !== orient1) {
      console.log(`[WallPlanner] Phase 3B: rotating "${pool.sg}" ${pool.w}×${pool.d} → ${orient.w}×${orient.d} (depth ${orient.d}" matches more orphans)`);
    }
    pool.w = orient.w;
    pool.d = orient.d;
    pool.rot = orient.rot;
    pool.stackedH = pool.h * pool.maxStack;
  }

  // Step 1: Group remaining orphans by department
  const orphansByDept = {};
  for (const pool of remaining) {
    const dept = wpGetDept(pool.sg);
    if (!orphansByDept[dept]) orphansByDept[dept] = [];
    orphansByDept[dept].push(pool);
  }

  // Step 2: FFD bin-packing by depth group
  const WP_DEPTH_STRICT = 2;
  const WP_DEPTH_RELAXED = 8;

  let orphanWalls = [];

  function ffdByDepth(deptPools, depthTol, reliabilityLevel) {
    const walls = [];
    const active = deptPools.filter(p => p.cases.length > 0);
    if (!active.length) return walls;

    const depthGroups = [];
    const used = new Set();
    for (let i = 0; i < active.length; i++) {
      if (used.has(i) || active[i].cases.length === 0) continue;
      const group = [active[i]];
      used.add(i);
      for (let j = i + 1; j < active.length; j++) {
        if (used.has(j) || active[j].cases.length === 0) continue;
        if (Math.abs(active[i].d - active[j].d) <= depthTol) {
          group.push(active[j]);
          used.add(j);
        }
      }
      depthGroups.push(group);
    }

    for (const group of depthGroups) {
      group.sort((a, b) => b.w - a.w);
      while (group.some(p => p.cases.length > 0)) {
        const wall = { items: [], widthFill: 0, maxHeight: 0, depth: 0, isFlatTop: true, subgroups: [], reliability: reliabilityLevel };
        let x = 0;
        for (const pool of group) {
          while (pool.cases.length > 0 && x + pool.w <= WP_TRUCK_WIDTH) {
            const stack = Math.min(pool.maxStack, pool.cases.length);
            const stackedH = pool.h * stack;
            const stackCases = pool.cases.splice(0, stack);
            wall.items.push({
              blockName: pool.blockName, sg: pool.sg, w: pool.w, d: pool.d, h: pool.h,
              rot: pool.rot, xOff: x, stackCount: stack, stackedH, cases: stackCases,
            });
            x += pool.w;
            if (!wall.subgroups.includes(pool.sg)) wall.subgroups.push(pool.sg);
            wall.maxHeight = Math.max(wall.maxHeight, stackedH);
            wall.depth = Math.max(wall.depth, pool.d);
          }
        }
        if (wall.items.length === 0) break;
        wall.widthFill = x;
        const heights = wall.items.map(i => i.stackedH);
        wall.isFlatTop = new Set(heights.map(h => Math.round(h * 10))).size <= 1;
        walls.push(wall);
      }
    }
    return walls;
  }

  // Pass 1: strict flat-face (±2") per department
  for (const dept of Object.keys(orphansByDept)) {
    const deptPools = orphansByDept[dept].filter(p => p.cases.length > 0);
    if (!deptPools.length) continue;
    const newWalls = ffdByDepth(deptPools, WP_DEPTH_STRICT, WP_RELIABILITY.ORPHAN_SAME_DEPT);
    if (newWalls.length) console.log(`[WallPlanner] Phase 3B pass 1 [${dept}]: ${newWalls.length} walls (strict ±${WP_DEPTH_STRICT}")`);
    orphanWalls.push(...newWalls);
  }

  // Pass 2: relaxed flat-face (±8") for remaining orphans — cross-dept
  const stillRemaining = orphanPools.filter(p => p.cases.length > 0);
  if (stillRemaining.length > 0) {
    const relaxedCount = stillRemaining.reduce((s, p) => s + p.cases.length, 0);
    const depthInfo = stillRemaining.map(p => `${p.sg}:${p.d}"`).join(', ');
    console.log(`[WallPlanner] Phase 3B pass 2: ${relaxedCount} cases remaining [${depthInfo}], relaxing to ±${WP_DEPTH_RELAXED}"`);
    const newWalls = ffdByDepth(stillRemaining, WP_DEPTH_RELAXED, WP_RELIABILITY.ORPHAN_MIXED);
    if (newWalls.length) console.log(`[WallPlanner] Phase 3B pass 2: ${newWalls.length} consolidated walls`);
    orphanWalls.push(...newWalls);
  }

  // Merge weak orphan walls
  orphanWalls = wpMergeWeakWalls(orphanWalls);

  // ── Phase 3C: Absorb very weak walls into stronger walls with gaps ──
  const WP_ABSORB_THRESH = 0.50;
  const veryWeak = orphanWalls.filter(w => (w.widthFill / WP_TRUCK_WIDTH) < WP_ABSORB_THRESH);
  const allTargets = [...orphanWalls.filter(w => (w.widthFill / WP_TRUCK_WIDTH) >= WP_ABSORB_THRESH), ...fullWalls, ...kbWalls];

  for (const vw of veryWeak) {
    const absorbed = [];
    for (const item of vw.items) {
      let placed = false;
      for (const target of allTargets) {
        if (Math.abs(target.depth - item.d) > 8) continue;
        if (target.widthFill + item.w > WP_TRUCK_WIDTH + 0.5) continue;
        item.xOff = target.widthFill;
        target.items.push(item);
        target.widthFill += item.w;
        target.maxHeight = Math.max(target.maxHeight, item.stackedH);
        target.depth = Math.max(target.depth, item.d);
        if (!target.subgroups.includes(item.sg)) target.subgroups.push(item.sg);
        target.reliability = Math.max(target.reliability, WP_RELIABILITY.ORPHAN_MIXED);
        console.log(`[WallPlanner] Phase 3C: absorbed "${item.sg}" (${item.w}×${item.d}) into wall [${target.subgroups.join('+')}] → ${Math.round(target.widthFill/WP_TRUCK_WIDTH*100)}% fill`);
        placed = true;
        break;
      }
      if (placed) absorbed.push(item);
    }
    for (const item of absorbed) {
      const idx = vw.items.indexOf(item);
      if (idx >= 0) vw.items.splice(idx, 1);
    }
    if (vw.items.length > 0) {
      vw.widthFill = vw.items.reduce((s, it) => s + it.w, 0);
    }
  }
  orphanWalls = orphanWalls.filter(w => w.items.length > 0);

  // ── Phase 3D: Column-Level Bin Packing ──
  // Decompose weak walls into individual columns and re-pack with best-fit scoring
  {
    const weakWalls3D = orphanWalls.filter(w => (w.widthFill / WP_TRUCK_WIDTH) < WP_MIN_FILL);

    if (weakWalls3D.length >= 2) {
      const weakDepthBefore = weakWalls3D.reduce((s, w) => s + w.depth, 0);
      const weakCountBefore = weakWalls3D.length;

      // STEP 1: Decompose weak walls into individual columns
      const availableColumns = [];

      for (const wall of weakWalls3D) {
        for (const item of wall.items) {
          availableColumns.push({
            sg: item.sg,
            blockName: item.blockName,
            w: item.w,
            d: item.d,
            h: item.h,
            rot: item.rot,
            stackCount: item.stackCount,
            stackedH: item.stackedH,
            cases: item.cases.slice(),
            dept: wpGetDept(item.sg),
          });
        }
      }

      // Also add remaining orphan pools with cases
      for (const pool of orphanPools) {
        if (pool.cases.length === 0) continue;
        while (pool.cases.length > 0) {
          const stack = Math.min(pool.maxStack, pool.cases.length);
          const stackedH = pool.h * stack;
          const stackCases = pool.cases.splice(0, stack);
          availableColumns.push({
            sg: pool.sg,
            blockName: pool.blockName,
            w: pool.w,
            d: pool.d,
            h: pool.h,
            rot: pool.rot,
            stackCount: stack,
            stackedH,
            cases: stackCases,
            dept: wpGetDept(pool.sg),
          });
        }
      }

      // Remove the weak walls from orphanWalls
      orphanWalls = orphanWalls.filter(w => (w.widthFill / WP_TRUCK_WIDTH) >= WP_MIN_FILL);

      // STEP 2: Sort columns by width descending (biggest first)
      availableColumns.sort((a, b) => b.w - a.w);

      // STEP 3: Build walls with best-fit scoring
      const newWalls3D = [];

      while (availableColumns.length > 0) {
        // Start new wall with widest remaining column as anchor
        const wall = {
          items: [], widthFill: 0, maxHeight: 0, depth: 0,
          minDepth: Infinity, subgroups: [], reliability: WP_RELIABILITY.ORPHAN_MIXED,
        };

        const anchor = availableColumns.shift();
        anchor.xOff = 0;
        wall.items.push(anchor);
        wall.widthFill = anchor.w;
        wall.maxHeight = anchor.stackedH;
        wall.depth = anchor.d;
        wall.minDepth = anchor.d;
        if (!wall.subgroups.includes(anchor.sg)) wall.subgroups.push(anchor.sg);

        // Iteratively find best column to add
        let changed = true;
        while (changed) {
          changed = false;
          let bestIdx = -1;
          let bestScore = -1;

          for (let i = 0; i < availableColumns.length; i++) {
            const col = availableColumns[i];

            // Width check
            if (wall.widthFill + col.w > WP_TRUCK_WIDTH + 0.5) continue;

            // Flat-face check (strict: delta <= 8")
            const newMinD = Math.min(wall.minDepth, col.d);
            const newMaxD = Math.max(wall.depth, col.d);
            if (newMaxD - newMinD > 8) continue;

            // Score this addition
            const newFill = (wall.widthFill + col.w) / WP_TRUCK_WIDTH;
            const depthDelta = (newMaxD - newMinD) / 8; // 0 to 1, lower is better
            const heightDiff = Math.abs(wall.maxHeight - col.stackedH) / (config.truckHeight || 110);
            const sameDept = (col.dept === wpWallDept(wall)) ? 0.1 : 0;

            const score = newFill * 0.60
                        + (1 - depthDelta) * 0.25
                        + (1 - heightDiff) * 0.10
                        + sameDept * 0.05;

            if (score > bestScore) {
              bestScore = score;
              bestIdx = i;
            }
          }

          if (bestIdx >= 0) {
            const chosen = availableColumns.splice(bestIdx, 1)[0];
            chosen.xOff = wall.widthFill;
            wall.items.push(chosen);
            wall.widthFill += chosen.w;
            wall.maxHeight = Math.max(wall.maxHeight, chosen.stackedH);
            wall.depth = Math.max(wall.depth, chosen.d);
            wall.minDepth = Math.min(wall.minDepth, chosen.d);
            if (!wall.subgroups.includes(chosen.sg)) wall.subgroups.push(chosen.sg);
            changed = true;
          }
        }

        // Set reliability based on composition
        if (wall.subgroups.length === 1) {
          wall.reliability = WP_RELIABILITY.ORPHAN_SAME_DEPT;
        } else {
          const depts = new Set(wall.items.map(it => wpGetDept(it.sg)));
          wall.reliability = depts.size === 1 ? WP_RELIABILITY.ORPHAN_SAME_DEPT : WP_RELIABILITY.ORPHAN_MIXED;
        }

        // Flat-top check
        const heights = wall.items.map(i => i.stackedH);
        wall.isFlatTop = new Set(heights.map(h => Math.round(h * 10))).size <= 1;

        newWalls3D.push(wall);
      }

      // STEP 4: Compare and use Phase 3D result
      const weakDepthAfter = newWalls3D.reduce((s, w) => s + w.depth, 0);
      orphanWalls.push(...newWalls3D);

      console.log(`[WallPlanner] Phase 3D: consolidated ${weakCountBefore} weak walls into ${newWalls3D.length} walls (depth: ${Math.round(weakDepthBefore)}" → ${Math.round(weakDepthAfter)}")`);
    } else {
      console.log(`[WallPlanner] Phase 3D: skipped (fewer than 2 weak walls)`);
    }
  }

  // Log weak walls for diagnostics
  const weakWalls = orphanWalls.filter(w => (w.widthFill / WP_TRUCK_WIDTH) < WP_MIN_FILL);
  if (weakWalls.length > 0) {
    console.log(`[WallPlanner] Phase 3B: ${weakWalls.length} weak orphan walls (<${Math.round(WP_MIN_FILL*100)}% fill): ${weakWalls.map(w => `${w.subgroups.join('+')} ${Math.round(w.widthFill)}"/${WP_TRUCK_WIDTH}" (${Math.round(w.widthFill/WP_TRUCK_WIDTH*100)}%)`).join(', ')}`);
  }

  // ── Phase 4: Order Stages (stability-aware) ──
  const sortableWalls = fullWalls.concat(kbWalls, orphanWalls);
  const WP_STAGE_HEIGHT_TOL = 15;

  const relLabels = { 1:'FULL', 2:'KB', 3:'FIT', 4:'ORPHAN', 5:'MIXED' };

  sortableWalls.sort((a, b) => {
    const scoreA = wpWallScore(a), scoreB = wpWallScore(b);
    if (scoreA !== scoreB) return scoreA - scoreB;
    const deptA = deptPriority[wpWallDept(a)] || 99;
    const deptB = deptPriority[wpWallDept(b)] || 99;
    if (deptA !== deptB) return deptA - deptB;
    return (b.widthFill / WP_TRUCK_WIDTH) - (a.widthFill / WP_TRUCK_WIDTH);
  });

  // Floor walls first, then sorted remaining
  const allWalls = floorWalls.concat(sortableWalls);

  // Group into stages
  const stages = [];
  let curGroup = [];
  let curHeight = allWalls.length ? allWalls[0].maxHeight : 0;
  let curDept = allWalls.length ? wpWallDept(allWalls[0]) : '';
  let curRel = allWalls.length ? (allWalls[0].reliability || 99) : 0;
  for (const wall of allWalls) {
    const wallDept = wpWallDept(wall);
    const wallRel = wall.reliability || 99;
    const sameStage = (wallRel === curRel) && (wallDept === curDept) && (Math.abs(wall.maxHeight - curHeight) <= WP_STAGE_HEIGHT_TOL);
    if (sameStage) {
      curGroup.push(wall);
    } else {
      if (curGroup.length) stages.push({ walls: curGroup, idx: stages.length });
      curGroup = [wall];
      curHeight = wall.maxHeight;
      curDept = wallDept;
      curRel = wallRel;
    }
  }
  if (curGroup.length) stages.push({ walls: curGroup, idx: stages.length });

  // Label stages
  for (const s of stages) {
    const subs = new Set();
    for (const w of s.walls) w.subgroups.forEach(sg => subs.add(sg));
    const stageDept = wpWallDept(s.walls[0]);
    const stageRel = relLabels[s.walls[0].reliability] || '?';
    s.label = `Stage ${s.idx} [${stageDept} ${stageRel}] — ${[...subs].sort().join(', ')}`;
    s.maxHeight = Math.max(...s.walls.map(w => w.maxHeight));
    s.totalDepth = s.walls.reduce((sum, w) => sum + w.depth, 0);
  }

  // Log final wall order
  console.log(`[WallPlanner] Phase 4 wall order (fond→door):`);
  for (let i = 0; i < allWalls.length; i++) {
    const w = allWalls[i];
    if (w._isLoadBar) { console.log(`  ${i+1}. [LOADBAR] — 2" spacer`); continue; }
    const fill = Math.round(w.widthFill / WP_TRUCK_WIDTH * 100);
    const rel = relLabels[w.reliability] || '?';
    const score = wpWallScore(w);
    console.log(`  ${i+1}. [${rel}] ${w.subgroups.join('+')} — ${Math.round(w.widthFill)}"/${WP_TRUCK_WIDTH}" (${fill}%) h=${w.maxHeight}" depth=${Math.round(w.depth)}" score=${score}`);
  }

  // ── Phase 5: Calculate Coordinates + Register Walls ──
  const allPlacements = [];
  const spilloverItems = [];
  let yPos = 0;
  let wallIdx = 0;

  for (const stage of stages) {
    for (const wall of stage.walls) {
      if (wall._isLoadBar) {
        yPos += wall.depth;
        continue;
      }
      const wallId = 'wp_' + (wallIdx++);
      const wallPlacements = [];
      const yStart = yPos;
      let actualMaxDepth = 0;

      let cumulX = 0;
      for (const item of wall.items) {
        const itemW = item.w;

        if (cumulX + itemW > WP_TRUCK_WIDTH + 0.5) {
          console.warn(`[WallPlanner] Phase 5 SPILLOVER: ${item.sg} x=${cumulX}+w=${itemW}=${cumulX + itemW} > ${WP_TRUCK_WIDTH} → re-queued`);
          for (const c of item.cases) {
            spilloverItems.push({
              blockName: item.blockName, sg: item.sg,
              nom: c.nom || item.sg, caseId: c.num_caisse || '',
              w: itemW, d: item.d, h: item.h,
              dims: { w: itemW, d: item.d, h: item.h, rot: item.rot, stackable: false, maxStack: 1 },
              caseData: c,
            });
          }
          continue;
        }
        for (let si = 0; si < item.stackCount; si++) {
          const c = item.cases[si];
          const z = item.h * si;
          const blockName = c.block_name || item.blockName;
          const ph = (c.height > 0) ? c.height : item.h;
          actualMaxDepth = Math.max(actualMaxDepth, item.d);
          wallPlacements.push({
            block_name: blockName,
            subgroup: c.subgroup || c.group || item.sg,
            dept: c.dept || wpGetDept(item.sg),
            name: c.nom || c.name || `${item.sg} #${si + 1}`,
            case_id: c.num_caisse || '',
            x: cumulX, y: yPos, z,
            width: itemW, depth: item.d, height: ph,
            rotation: item.rot || 0,
            _wallId: wallId,
            _wallPlannerStage: stage.idx,
          });
        }
        cumulX += itemW;
      }

      const wallDepth = Math.max(wall.depth, actualMaxDepth);
      const yEnd = yPos + wallDepth;
      const actualFillWidth = Math.max(cumulX, wall.widthFill);
      const fillPct = Math.round((actualFillWidth / WP_TRUCK_WIDTH) * 100);
      wallSections.push({
        id: wallId,
        label: wall.subgroups.join(' + '),
        section: `Stage ${stage.idx}`,
        patternId: null,
        yStart, yEnd,
        wallWidth: Math.round(actualFillWidth),
        fillPct,
        placements: wallPlacements.slice(),
        status: 'pending',
        caseCount: wallPlacements.length,
        depth: Math.round(wall.depth),
      });

      allPlacements.push(...wallPlacements);
      yPos = yEnd;
    }
  }

  // ── Phase 5B: Place spillover cases ──
  if (spilloverItems.length > 0) {
    console.log(`[WallPlanner] Phase 5B: ${spilloverItems.length} spillover cases to re-place`);
    const spillByDepth = {};
    for (const item of spilloverItems) {
      const dKey = Math.round(item.d);
      if (!spillByDepth[dKey]) spillByDepth[dKey] = [];
      spillByDepth[dKey].push(item);
    }
    for (const [dKey, items] of Object.entries(spillByDepth)) {
      items.sort((a, b) => b.w - a.w);
      while (items.length > 0) {
        const wallId = 'wp_' + (wallIdx++);
        const wallPlacements = [];
        const yStart = yPos;
        let x = 0, maxD = 0;
        const placed = [];
        for (let i = 0; i < items.length; i++) {
          const item = items[i];
          if (x + item.w > WP_TRUCK_WIDTH + 0.5) continue;
          const c = item.caseData;
          wallPlacements.push({
            block_name: item.blockName,
            subgroup: c.subgroup || c.group || item.sg,
            dept: c.dept || wpGetDept(item.sg),
            name: item.nom,
            case_id: item.caseId,
            x, y: yPos, z: 0,
            width: item.w, depth: item.d, height: item.h,
            rotation: item.dims.rot || 0,
            _wallId: wallId,
            _wallPlannerStage: -1,
          });
          x += item.w;
          maxD = Math.max(maxD, item.d);
          placed.push(i);
        }
        for (let j = placed.length - 1; j >= 0; j--) items.splice(placed[j], 1);
        if (wallPlacements.length === 0) break;

        const yEnd = yPos + maxD;
        wallSections.push({
          id: wallId, label: 'Spillover', section: 'SPILLOVER',
          patternId: null, yStart, yEnd,
          wallWidth: Math.round(x),
          fillPct: Math.round((x / WP_TRUCK_WIDTH) * 100),
          placements: wallPlacements.slice(),
          status: 'pending', caseCount: wallPlacements.length,
          depth: Math.round(maxD),
        });
        allPlacements.push(...wallPlacements);
        yPos = yEnd;
      }
    }
  }

  console.log(`[WallPlanner] ${allPlacements.length} caisses, ${wallSections.length} walls, depth: ${Math.round(yPos)}"/${config.truckLength || '?'}"`);

  // Physical constraint validation
  const violations = wpValidatePlacements(allPlacements, WP_TRUCK_WIDTH);
  if (violations.length > 0) {
    console.error(`[WallPlanner] ${violations.length} PHYSICAL VIOLATIONS — load is INVALID`);
    violations.forEach(v => console.error('  ', v));
  } else {
    console.log('[WallPlanner] All physical constraints satisfied');
  }

  return { placements: allPlacements, wallSections };
}

// ── Post-placement physical constraint validation ──
function wpValidatePlacements(placements, truckWidth) {
  const errors = [];
  const TRUCK_W = truckWidth || 98;
  const TOLERANCE = 0.5;
  const DEPTH_TOL = 2;

  for (let i = 0; i < placements.length; i++) {
    const a = placements[i];
    if (a.x < -TOLERANCE)
      errors.push(`BOUNDS: "${a.name}" x=${a.x.toFixed(1)} < 0 (outside truck left)`);
    if (a.x + a.width > TRUCK_W + TOLERANCE)
      errors.push(`BOUNDS: "${a.name}" x+w=${(a.x + a.width).toFixed(1)} > ${TRUCK_W} (outside truck right)`);
    if (a.z < -TOLERANCE)
      errors.push(`BOUNDS: "${a.name}" z=${a.z.toFixed(1)} < 0 (below floor)`);
    if (a.y < -TOLERANCE)
      errors.push(`BOUNDS: "${a.name}" y=${a.y.toFixed(1)} < 0 (behind cab wall)`);

    for (let j = i + 1; j < placements.length; j++) {
      const b = placements[j];
      const ox = a.x < b.x + b.width - TOLERANCE && b.x < a.x + a.width - TOLERANCE;
      const oy = a.y < b.y + b.depth - TOLERANCE && b.y < a.y + a.depth - TOLERANCE;
      const oz = a.z < b.z + b.height - TOLERANCE && b.z < a.z + a.height - TOLERANCE;
      if (ox && oy && oz) {
        errors.push(`OVERLAP: "${a.name}" and "${b.name}" at (${a.x.toFixed(0)},${a.y.toFixed(0)},${a.z.toFixed(0)}) vs (${b.x.toFixed(0)},${b.y.toFixed(0)},${b.z.toFixed(0)})`);
      }
    }
  }

  const wallGroups = {};
  for (const p of placements) {
    const wid = p._wallId || 'unknown';
    if (!wallGroups[wid]) wallGroups[wid] = [];
    wallGroups[wid].push(p);
  }
  for (const [wallId, wps] of Object.entries(wallGroups)) {
    if (wps.length < 2) continue;
    const depths = wps.map(p => p.depth);
    const minD = Math.min(...depths), maxD = Math.max(...depths);
    const delta = maxD - minD;
    if (delta > 8) {
      errors.push(`FLAT-FACE: wall ${wallId} — depth range ${minD}"-${maxD}" (delta=${delta}" > 8" — CRITICAL)`);
    } else if (delta > DEPTH_TOL) {
      errors.push(`FLAT-FACE: wall ${wallId} — depth range ${minD}"-${maxD}" (delta=${delta}" > ${DEPTH_TOL}" — acceptable)`);
    }
  }

  return errors;
}

/**
 * Auto-generate department priority from case list.
 * Departments are ordered by first appearance, with common priorities:
 * LX=1, SON=2, CARP=3, then alphabetical for the rest.
 */
export function buildDeptPriority(cases) {
  const known = { LX: 1, SON: 2, CARP: 3, VDO: 4, PROPS: 5, COST: 6, ADM: 7 };
  const seen = new Set();
  const deptOrder = [];
  for (const c of cases) {
    const d = c.dept || 'GENERAL';
    if (!seen.has(d)) {
      seen.add(d);
      deptOrder.push(d);
    }
  }
  const priority = {};
  let nextPri = 1;
  // First assign known priorities
  for (const d of deptOrder) {
    if (known[d]) {
      priority[d] = known[d];
    }
  }
  // Then fill in unknown ones
  for (const d of deptOrder) {
    if (!priority[d]) {
      while (Object.values(priority).includes(nextPri)) nextPri++;
      priority[d] = nextPri++;
    }
  }
  return priority;
}

/**
 * Auto-generate department color map from case list.
 * Returns { deptCode: { label, color } } for all unique depts.
 */
export function buildDeptColors(cases) {
  const palette = [
    '#4CAF50', '#2196F3', '#FF9800', '#9C27B0', '#F44336',
    '#00BCD4', '#FFEB3B', '#795548', '#607D8B', '#E91E63',
    '#3F51B5', '#8BC34A', '#FF5722', '#009688', '#CDDC39',
  ];
  const known = {
    LX: { label: 'Éclairage', color: '#4CAF50' },
    SON: { label: 'Son', color: '#2196F3' },
    CARP: { label: 'Carpentry', color: '#FF9800' },
    VDO: { label: 'Vidéo', color: '#9C27B0' },
    PROPS: { label: 'Props', color: '#F44336' },
    COST: { label: 'Costumes', color: '#E91E63' },
    ADM: { label: 'Admin', color: '#607D8B' },
    GENERAL: { label: 'General', color: '#78909C' },
    AUTRE: { label: 'Other', color: '#9E9E9E' },
  };
  const depts = {};
  let pi = 0;
  const seen = new Set();
  for (const c of cases) {
    const d = c.dept || 'GENERAL';
    if (seen.has(d)) continue;
    seen.add(d);
    if (known[d]) {
      depts[d] = known[d];
    } else {
      depts[d] = { label: d, color: palette[pi % palette.length] };
      pi++;
    }
  }
  return depts;
}
