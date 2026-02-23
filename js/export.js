// export.js — AutoCAD LISP and SketchUp Ruby export generators
//
// Both exports read from the same placements data that the 3D viewer uses.
// Units: inches throughout (matching the solver output).

/**
 * AutoCAD color index mapping by department.
 * Standard ACI: 1=red, 2=yellow, 3=green, 4=cyan, 5=blue, 6=magenta, 7=white, 8=gray
 */
const ACAD_DEPT_COLORS = {
  LX: 2,       // yellow
  SON: 5,       // blue
  CARP: 3,      // green
  VDO: 1,       // red
  PROPS: 30,    // orange
  COST: 6,      // magenta
  ADM: 8,       // gray
  GENERAL: 8,   // gray
  AUTRE: 9,     // light gray
};

/**
 * SketchUp RGB mapping by department (matches viewer hex colors).
 */
const SKETCHUP_DEPT_COLORS = {
  LX:      [76, 175, 80],    // #4CAF50
  SON:     [33, 150, 243],   // #2196F3
  CARP:    [255, 152, 0],    // #FF9800
  VDO:     [156, 39, 176],   // #9C27B0
  PROPS:   [244, 67, 54],    // #F44336
  COST:    [233, 30, 99],    // #E91E63
  ADM:     [96, 125, 139],   // #607D8B
  GENERAL: [120, 144, 156],  // #78909C
  AUTRE:   [158, 158, 158],  // #9E9E9E
};

// Fallback palette for unknown departments (both systems)
const FALLBACK_PALETTE_RGB = [
  [0, 188, 212], [255, 235, 59], [121, 85, 72], [139, 195, 74],
  [255, 87, 34], [0, 150, 136], [205, 220, 57], [63, 81, 181],
];
const FALLBACK_ACAD = [4, 40, 34, 82, 14, 94, 54, 142];

/**
 * Sanitize a string for use in AutoCAD LISP (escape backslashes and quotes).
 */
function lispSafeStr(s) {
  return String(s).replace(/\\/g, '\\\\').replace(/"/g, '\\"');
}

/**
 * Format a number with dot decimal separator (AutoCAD FRENCH locale workaround).
 * Never use (rtos) — it produces commas in French locale.
 */
function lispNum(n) {
  return Number(n).toFixed(4);
}

// ─────────────────────────────────────────────────────────
// AutoCAD LISP Export
// ─────────────────────────────────────────────────────────

/**
 * Generate an AutoCAD LISP (.lsp) file from placements + truck config.
 *
 * @param {Object[]} placements — solver placement array
 * @param {Object[]} wallSections — solver wallSections array
 * @param {Object} truck — truck dimensions { interiorWidth, interiorLength, interiorHeight }
 * @param {Object} deptColors — { dept: { label, color } } from buildDeptColors
 * @returns {string} LISP file content
 */
export function generateLISP(placements, wallSections, truck, deptColors) {
  const W = truck.interiorWidth;
  const L = truck.interiorLength;
  const H = truck.interiorHeight;
  const lines = [];

  lines.push('; ── Truck Load Planner — AutoCAD LISP Export ──');
  lines.push('; Generated: ' + new Date().toISOString());
  lines.push(`; Truck: ${W}" × ${L}" × ${H}"`);
  lines.push(`; Cases: ${placements.length}, Walls: ${wallSections.length}`);
  lines.push('');
  lines.push('(defun C:TRUCKLOAD (/ oldlayer oldcmd)');
  lines.push('  (setq oldlayer (getvar "CLAYER"))');
  lines.push('  (setq oldcmd (getvar "CMDECHO"))');
  lines.push('  (setvar "CMDECHO" 0)');
  lines.push('  (command "_.UNDO" "_Begin")');
  lines.push('');

  // Collect all unique departments
  const depts = new Set(placements.map(p => p.dept || 'GENERAL'));

  // Create layers
  lines.push('  ; ── Create layers ──');
  lines.push(`  (command "_.LAYER" "_Make" "TRUCK" "_Color" "7" "TRUCK" "")`);
  let fallbackIdx = 0;
  for (const dept of depts) {
    const aci = ACAD_DEPT_COLORS[dept] || FALLBACK_ACAD[fallbackIdx++ % FALLBACK_ACAD.length];
    const safeDept = lispSafeStr(dept);
    lines.push(`  (command "_.LAYER" "_Make" "${safeDept}" "_Color" "${aci}" "${safeDept}" "")`);
  }
  lines.push('');

  // Draw truck wireframe
  lines.push('  ; ── Truck wireframe ──');
  lines.push(`  (command "_.LAYER" "_Set" "TRUCK" "")`);
  // Bottom rectangle
  lines.push(`  (command "_.LINE"`);
  lines.push(`    (strcat "${lispNum(0)},${lispNum(0)},${lispNum(0)}")`);
  lines.push(`    (strcat "${lispNum(W)},${lispNum(0)},${lispNum(0)}")`);
  lines.push(`    (strcat "${lispNum(W)},${lispNum(L)},${lispNum(0)}")`);
  lines.push(`    (strcat "${lispNum(0)},${lispNum(L)},${lispNum(0)}")`);
  lines.push(`    "_Close"`);
  lines.push(`  )`);
  // Top rectangle
  lines.push(`  (command "_.LINE"`);
  lines.push(`    (strcat "${lispNum(0)},${lispNum(0)},${lispNum(H)}")`);
  lines.push(`    (strcat "${lispNum(W)},${lispNum(0)},${lispNum(H)}")`);
  lines.push(`    (strcat "${lispNum(W)},${lispNum(L)},${lispNum(H)}")`);
  lines.push(`    (strcat "${lispNum(0)},${lispNum(L)},${lispNum(H)}")`);
  lines.push(`    "_Close"`);
  lines.push(`  )`);
  // Vertical edges
  for (const [cx, cy] of [[0, 0], [W, 0], [W, L], [0, L]]) {
    lines.push(`  (command "_.LINE" (strcat "${lispNum(cx)},${lispNum(cy)},${lispNum(0)}") (strcat "${lispNum(cx)},${lispNum(cy)},${lispNum(H)}") "")`);
  }
  lines.push('');

  // Draw cases grouped by wall
  const wallMap = {};
  for (const p of placements) {
    const wid = p._wallId || 'ungrouped';
    if (!wallMap[wid]) wallMap[wid] = [];
    wallMap[wid].push(p);
  }

  lines.push('  ; ── Cases ──');
  for (const [wallId, wallPlacements] of Object.entries(wallMap)) {
    const section = wallSections.find(ws => ws.id === wallId);
    const label = section ? section.label : wallId;
    lines.push(`  ; Wall: ${lispSafeStr(label)} (${wallPlacements.length} cases)`);

    for (const p of wallPlacements) {
      const dept = p.dept || 'GENERAL';
      const safeDept = lispSafeStr(dept);
      const safeName = lispSafeStr(p.name || 'Case');
      const x = p.x, y = p.y, z = p.z;
      const w = p.width, d = p.depth, h = p.height;
      const rot = p.rotation || 0;

      lines.push(`  (command "_.LAYER" "_Set" "${safeDept}" "")`);

      if (rot === 0) {
        // No rotation — draw box directly
        lines.push(`  (command "_.BOX"`);
        lines.push(`    (strcat "${lispNum(x)},${lispNum(y)},${lispNum(z)}")`);
        lines.push(`    (strcat "${lispNum(x + w)},${lispNum(y + d)},${lispNum(z)}")`);
        lines.push(`    "${lispNum(h)}"`);
        lines.push(`  )`);
      } else {
        // Rotation: draw at origin then move+rotate
        lines.push(`  (command "_.BOX"`);
        lines.push(`    (strcat "${lispNum(0)},${lispNum(0)},${lispNum(0)}")`);
        lines.push(`    (strcat "${lispNum(w)},${lispNum(d)},${lispNum(0)}")`);
        lines.push(`    "${lispNum(h)}"`);
        lines.push(`  )`);
        // Rotate around origin in XY plane
        lines.push(`  (command "_.ROTATE" (entlast) "" (strcat "${lispNum(0)},${lispNum(0)},${lispNum(0)}") "${lispNum(rot)}")`);
        // Move to final position
        lines.push(`  (command "_.MOVE" (entlast) "" (strcat "${lispNum(0)},${lispNum(0)},${lispNum(0)}") (strcat "${lispNum(x)},${lispNum(y)},${lispNum(z)}"))`);
      }

      // Text label on top
      const labelX = x + w / 2;
      const labelY = y + d / 2;
      const labelZ = z + h + 0.5;
      const textH = Math.min(w, d) * 0.2;
      const clampedTextH = Math.max(1, Math.min(textH, 4));
      lines.push(`  (command "_.TEXT" "_Justify" "_Middle"`);
      lines.push(`    (strcat "${lispNum(labelX)},${lispNum(labelY)},${lispNum(labelZ)}")`);
      lines.push(`    "${lispNum(clampedTextH)}" "0"`);
      lines.push(`    "${safeName}"`);
      lines.push(`  )`);
    }
    lines.push('');
  }

  // Cleanup
  lines.push('  (setvar "CLAYER" oldlayer)');
  lines.push('  (setvar "CMDECHO" oldcmd)');
  lines.push('  (command "_.UNDO" "_End")');
  lines.push('  (command "_.ZOOM" "_Extents")');
  lines.push('  (princ "\\nTruck load drawn successfully.")');
  lines.push('  (princ)');
  lines.push(')');
  lines.push('');
  lines.push('(princ "\\nType TRUCKLOAD to draw the truck load.\\n")');
  lines.push('(princ)');

  return lines.join('\n');
}


// ─────────────────────────────────────────────────────────
// SketchUp Ruby Export
// ─────────────────────────────────────────────────────────

/**
 * Convert hex color string to [r, g, b] array (0–255).
 */
function hexToRgb(hex) {
  const h = hex.replace('#', '');
  return [
    parseInt(h.substring(0, 2), 16),
    parseInt(h.substring(2, 4), 16),
    parseInt(h.substring(4, 6), 16),
  ];
}

/**
 * Generate a SketchUp Ruby (.rb) file from placements + truck config.
 *
 * @param {Object[]} placements — solver placement array
 * @param {Object[]} wallSections — solver wallSections array
 * @param {Object} truck — truck dimensions { interiorWidth, interiorLength, interiorHeight }
 * @param {Object} deptColors — { dept: { label, color } } from buildDeptColors
 * @returns {string} Ruby file content
 */
export function generateSketchUp(placements, wallSections, truck, deptColors) {
  const W = truck.interiorWidth;
  const L = truck.interiorLength;
  const H = truck.interiorHeight;
  const lines = [];

  lines.push('# ── Truck Load Planner — SketchUp Ruby Export ──');
  lines.push('# Generated: ' + new Date().toISOString());
  lines.push(`# Truck: ${W}" x ${L}" x ${H}"`);
  lines.push(`# Cases: ${placements.length}, Walls: ${wallSections.length}`);
  lines.push('');
  lines.push('model = Sketchup.active_model');
  lines.push('model.start_operation("Import Truck Load", true)');
  lines.push('entities = model.active_entities');
  lines.push('');

  // Build dept→RGB map from deptColors (hex) or fallback
  lines.push('# Department colors');
  lines.push('dept_colors = {');
  const allDepts = new Set(placements.map(p => p.dept || 'GENERAL'));
  let fbIdx = 0;
  for (const dept of allDepts) {
    let rgb;
    if (deptColors && deptColors[dept] && deptColors[dept].color) {
      rgb = hexToRgb(deptColors[dept].color);
    } else if (SKETCHUP_DEPT_COLORS[dept]) {
      rgb = SKETCHUP_DEPT_COLORS[dept];
    } else {
      rgb = FALLBACK_PALETTE_RGB[fbIdx++ % FALLBACK_PALETTE_RGB.length];
    }
    lines.push(`  "${rubyEscape(dept)}" => Sketchup::Color.new(${rgb[0]}, ${rgb[1]}, ${rgb[2]}),`);
  }
  lines.push('}');
  lines.push('');

  // Top-level group
  lines.push('# Top-level group');
  lines.push('truck_load_group = entities.add_group');
  lines.push('truck_load_group.name = "Truck Load"');
  lines.push('tl_ents = truck_load_group.entities');
  lines.push('');

  // Truck wireframe
  lines.push('# Truck wireframe');
  lines.push('truck_group = tl_ents.add_group');
  lines.push('truck_group.name = "Truck"');
  lines.push('te = truck_group.entities');
  // Bottom
  lines.push(`pt0 = [0, 0, 0]`);
  lines.push(`pt1 = [${W}, 0, 0]`);
  lines.push(`pt2 = [${W}, ${L}, 0]`);
  lines.push(`pt3 = [0, ${L}, 0]`);
  lines.push(`pt4 = [0, 0, ${H}]`);
  lines.push(`pt5 = [${W}, 0, ${H}]`);
  lines.push(`pt6 = [${W}, ${L}, ${H}]`);
  lines.push(`pt7 = [0, ${L}, ${H}]`);
  lines.push('# Bottom edges');
  lines.push('te.add_edges(pt0, pt1, pt2, pt3, pt0)');
  lines.push('# Top edges');
  lines.push('te.add_edges(pt4, pt5, pt6, pt7, pt4)');
  lines.push('# Vertical edges');
  lines.push('te.add_edges(pt0, pt4)');
  lines.push('te.add_edges(pt1, pt5)');
  lines.push('te.add_edges(pt2, pt6)');
  lines.push('te.add_edges(pt3, pt7)');
  lines.push('');

  // Cases grouped by wall
  const wallMap = {};
  for (const p of placements) {
    const wid = p._wallId || 'ungrouped';
    if (!wallMap[wid]) wallMap[wid] = [];
    wallMap[wid].push(p);
  }

  for (const [wallId, wallPlacements] of Object.entries(wallMap)) {
    const section = wallSections.find(ws => ws.id === wallId);
    const label = section ? section.label : wallId;
    const safeLabel = rubyEscape(label);

    lines.push(`# Wall: ${safeLabel}`);
    lines.push(`wall_group = tl_ents.add_group`);
    lines.push(`wall_group.name = "${safeLabel}"`);
    lines.push(`we = wall_group.entities`);
    lines.push('');

    for (const p of wallPlacements) {
      const dept = p.dept || 'GENERAL';
      const name = rubyEscape(p.name || 'Case');
      const x = p.x, y = p.y, z = p.z;
      const w = p.width, d = p.depth, h = p.height;
      const rot = p.rotation || 0;

      lines.push(`# ${name}`);
      lines.push(`cg = we.add_group`);
      lines.push(`cg.name = "${name}"`);
      lines.push(`ce = cg.entities`);

      // Draw box face at local origin, pushpull to height
      lines.push(`face = ce.add_face([0,0,0], [${w},0,0], [${w},${d},0], [0,${d},0])`);
      lines.push(`face.pushpull(${h})`);

      // Build transformation: rotation (if any) + translation
      if (rot !== 0) {
        lines.push(`rot_t = Geom::Transformation.rotation([0,0,0], [0,0,1], ${rot}.degrees)`);
        lines.push(`move_t = Geom::Transformation.translation([${x}, ${y}, ${z}])`);
        lines.push(`cg.transform!(move_t * rot_t)`);
      } else {
        lines.push(`cg.transform!(Geom::Transformation.translation([${x}, ${y}, ${z}]))`);
      }

      // Apply material color
      lines.push(`mat = model.materials.add("${rubyEscape(dept)}_${name}")`);
      lines.push(`mat.color = dept_colors["${rubyEscape(dept)}"] || Sketchup::Color.new(180, 180, 180)`);
      lines.push(`cg.material = mat`);
      lines.push('');
    }
  }

  lines.push('model.commit_operation');
  lines.push('puts "Truck load imported: ' + placements.length + ' cases"');

  return lines.join('\n');
}

/**
 * Escape a string for Ruby string literals.
 */
function rubyEscape(s) {
  return String(s).replace(/\\/g, '\\\\').replace(/"/g, '\\"').replace(/#\{/g, '\\#{');
}


// ─────────────────────────────────────────────────────────
// Download helpers
// ─────────────────────────────────────────────────────────

/**
 * Trigger a browser download of a text file.
 */
function downloadFile(content, filename, mimeType) {
  const blob = new Blob([content], { type: mimeType || 'text/plain' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}

/**
 * Export placements as AutoCAD LISP file and trigger download.
 */
export function exportLISP(placements, wallSections, truck, deptColors) {
  const content = generateLISP(placements, wallSections, truck, deptColors);
  const timestamp = new Date().toISOString().slice(0, 10);
  downloadFile(content, `truck-load-${timestamp}.lsp`, 'application/x-lisp');
}

/**
 * Export placements as SketchUp Ruby file and trigger download.
 */
export function exportSketchUp(placements, wallSections, truck, deptColors) {
  const content = generateSketchUp(placements, wallSections, truck, deptColors);
  const timestamp = new Date().toISOString().slice(0, 10);
  downloadFile(content, `truck-load-${timestamp}.rb`, 'application/x-ruby');
}
