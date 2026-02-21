// sheet-loader.js — Google Sheet fetch + parsing (universal + legacy)
// Uses Google Visualization API with JSONP to bypass CORS (works from file:// too)

/**
 * Extract a Google Sheet ID from a URL or return it as-is if already an ID.
 * Supports formats:
 *   - Full URL: https://docs.google.com/spreadsheets/d/SHEET_ID/edit...
 *   - Just the ID: 1-feaauGEbsWfZzvd7xX2vJzyINqZqeRcGP86O_gxbKI
 * @param {string} input — URL or sheet ID
 * @returns {string} — Sheet ID
 */
export function extractSheetId(input) {
  if (!input) return '';
  input = input.trim();
  const match = input.match(/\/spreadsheets\/d\/([a-zA-Z0-9_-]+)/);
  if (match) return match[1];
  if (!input.includes('/') && input.length > 10) return input;
  return input;
}

/**
 * Fetch sheet data via JSONP (Google Visualization API).
 * @param {string} sheetId — Google Sheet ID
 * @param {string} [sheetName='Inventaire'] — Tab name
 * @param {number} [timeoutMs=15000] — Timeout in ms
 * @returns {Promise<Object>} — Google Visualization API response
 */
export function fetchSheetViaJsonp(sheetId, sheetName = 'Inventaire', timeoutMs = 15000) {
  return new Promise((resolve, reject) => {
    const cbName = '_sheetCb_' + Date.now();
    console.log('[Sheet] Starting JSONP fetch, callback:', cbName);

    const timeout = setTimeout(() => {
      console.error('[Sheet] Timeout after', timeoutMs, 'ms');
      delete window[cbName];
      script.remove();
      reject(new Error(
        'Timeout: le Sheet n\'a pas répondu en ' + (timeoutMs / 1000) + ' secondes.\n\n'
        + 'Vérifiez que le Sheet est partagé "Toute personne ayant le lien peut voir".'
      ));
    }, timeoutMs);

    window[cbName] = function(response) {
      console.log('[Sheet] Callback received! Status:', response.status, 'Rows:', response.table?.rows?.length);
      clearTimeout(timeout);
      delete window[cbName];
      script.remove();

      if (response.status === 'error') {
        const msg = response.errors?.[0]?.detailed_message || response.errors?.[0]?.message || 'unknown error';
        reject(new Error('Google Sheets: ' + msg));
        return;
      }
      resolve(response);
    };

    const url = `https://docs.google.com/spreadsheets/d/${sheetId}/gviz/tq`
      + `?tqx=responseHandler:${cbName}`
      + `&sheet=${encodeURIComponent(sheetName)}`;

    console.log('[Sheet] Injecting script:', url.substring(0, 120) + '...');

    const script = document.createElement('script');
    script.src = url;
    script.onerror = () => {
      console.error('[Sheet] Script load error');
      clearTimeout(timeout);
      delete window[cbName];
      reject(new Error('Impossible de charger le script Google Sheets.\nVérifiez votre connexion internet.'));
    };
    document.head.appendChild(script);
  });
}

// ── Column alias maps (case-insensitive) ──
const COLUMN_ALIASES = {
  nom:       ['NOM', 'NAME', 'CASE_NAME', 'DESCRIPTION'],
  largeur:   ['LARGEUR', 'WIDTH', 'W', 'LARG', 'L (PO)'],
  profondeur:['PROFONDEUR', 'DEPTH', 'D', 'PROF', 'W (PO)'],
  hauteur:   ['HAUTEUR', 'HEIGHT', 'H', 'HAUT', 'H (PO)'],
  dept:      ['DEPT', 'DEPARTMENT', 'DEPARTEMENT', 'DEP'],
  qty:       ['QTY', 'QUANTITY', 'QUANTITE', 'QUANTITÉ', 'QTE'],
  stackable: ['STACKABLE', 'EMPILABLE'],
  max_stack: ['MAX_STACK', 'MAXSTACK', 'MAX_EMPILABLE'],
  is_floor:  ['IS_FLOOR', 'PLANCHER', 'FLOOR'],
  allow_rotation: ['ALLOW_ROTATION', 'ROTATION'],
  group:     ['GROUP', 'GROUPE', 'SUBGROUP', 'SOUS_GROUPE', 'SOUS-GROUPE', 'SOUS GROUPE'],
  camion:    ['CAMION', 'TRUCK'],
  selection: ['SÉLECTION', 'SELECTION', 'SEL', 'SELECTED'],
  // Legacy GB columns
  index:     ['#', 'INDEX'],
  detail:    ['DETAIL', 'DÉTAIL'],
  num_caisse:['NUM_CAISSE', 'CASE_ID'],
  block_name:['BLOCK_NAME'],
  rangement: ['RANGEMENT'],
  inclus:    ['INCLUS', 'INCLUDED'],
};

function matchColumn(header, aliases) {
  const h = header.trim().toUpperCase();
  for (const [field, names] of Object.entries(aliases)) {
    if (names.includes(h) || names.some(n => h.includes(n) && n.length > 3)) {
      return field;
    }
  }
  return null;
}

// ── Cell helpers ──
function getVal(row, idx) {
  if (idx === undefined || !row.c || !row.c[idx]) return '';
  const cell = row.c[idx];
  if (cell.v === null || cell.v === undefined) return '';
  return String(cell.f || cell.v).trim();
}

function getNum(row, idx) {
  if (idx === undefined || !row.c || !row.c[idx]) return 0;
  const cell = row.c[idx];
  if (cell.v === null || cell.v === undefined) return 0;
  const n = typeof cell.v === 'number' ? cell.v : parseFloat(String(cell.v).replace(',', '.'));
  return isNaN(n) ? 0 : n;
}

function getBool(row, idx) {
  if (idx === undefined || !row.c || !row.c[idx]) return false;
  const cell = row.c[idx];
  if (cell.v === true) return true;
  if (cell.v === false) return false;
  const s = String(cell.v || cell.f || '').toUpperCase().trim();
  return s === 'TRUE' || s === 'VRAI' || s === 'OUI' || s === 'YES' || s === '1';
}

/**
 * Parse Google Visualization API response into universal case objects.
 *
 * Universal mode: dimensions come from sheet columns (largeur/profondeur/hauteur).
 * Legacy mode: if blockConfig has blocks/subgroupBlock/subgroupDept, use those as fallbacks.
 *
 * @param {Object} gvizResponse — response from fetchSheetViaJsonp
 * @param {Object} [blockConfig] — optional legacy block config { blocks, subgroupBlock, subgroupDept }
 * @returns {Object[]} — Array of case objects ready for solver
 */
export function parseSheetData(gvizResponse, blockConfig) {
  const table = gvizResponse.table;
  if (!table || !table.rows) return [];

  // Legacy fallbacks
  const subgroupBlock = blockConfig?.subgroupBlock || {};
  const subgroupDept = blockConfig?.subgroupDept || {};
  const blocks = blockConfig?.blocks || {};
  const isLegacy = Object.keys(blocks).length > 0;

  // Build column index map from headers using aliases
  const cols = table.cols.map(c => (c.label || '').trim().toUpperCase());
  const colIdx = {};
  cols.forEach((h, i) => {
    const field = matchColumn(h, COLUMN_ALIASES);
    if (field && colIdx[field] === undefined) {
      colIdx[field] = i;
    }
  });

  console.log('[Sheet] Detected columns:', Object.keys(colIdx).join(', '));
  console.log('[Sheet] Mode:', isLegacy ? 'legacy (block config fallback)' : 'universal (dimensions from sheet)');

  const cases = [];
  let skipped = 0;

  for (const row of table.rows) {
    // Legacy: INCLUS filter
    if (colIdx.inclus !== undefined && !getBool(row, colIdx.inclus)) continue;

    // Selection filter: if 'sélection' column exists, only include rows where it's TRUE
    if (colIdx.selection !== undefined && !getBool(row, colIdx.selection)) continue;

    // Get name — required in universal mode
    const nom = getVal(row, colIdx.nom);

    // Get group/subgroup — key field for solver grouping
    const group = getVal(row, colIdx.group);

    // In legacy mode, subgroup is required (it's the key to everything)
    // In universal mode, nom is required
    if (!nom && !group) {
      skipped++;
      continue;
    }

    // Resolve block_name (legacy path)
    const sheetBlock = getVal(row, colIdx.block_name);
    const blockName = sheetBlock || subgroupBlock[group] || '';

    // Resolve dept: sheet value → legacy mapping → 'GENERAL'
    const sheetDept = getVal(row, colIdx.dept);
    const dept = sheetDept || (isLegacy ? (subgroupDept[group] || 'AUTRE') : 'GENERAL');

    // Resolve dimensions: sheet columns → block config fallback → 0
    const blockDef = blocks[blockName] || {};
    const width = getNum(row, colIdx.largeur) || blockDef.w || 0;
    const depth = getNum(row, colIdx.profondeur) || blockDef.d || 0;
    const height = getNum(row, colIdx.hauteur) || blockDef.h || 0;

    // Skip rows with no dimensions (can't place a 0x0x0 case)
    if (width === 0 || depth === 0 || height === 0) {
      if (!isLegacy) {
        console.warn(`[Sheet] Skipping "${nom || group}" — missing dimensions (${width}x${depth}x${height})`);
      }
      // In legacy mode, 0 dimensions are expected for some rows (the block config provides them)
      // But if block config also has 0, skip
      if (width === 0 && depth === 0 && height === 0) {
        skipped++;
        continue;
      }
    }

    // Resolve stacking
    const stackable = colIdx.stackable !== undefined
      ? getBool(row, colIdx.stackable)
      : (blockDef.stackable || false);
    const maxStack = colIdx.max_stack !== undefined
      ? (getNum(row, colIdx.max_stack) || 1)
      : (blockDef.maxStack || 1);

    // Floor panel flag
    const isFloor = colIdx.is_floor !== undefined
      ? getBool(row, colIdx.is_floor)
      : false;

    // Rotation allowed
    const allowRotation = colIdx.allow_rotation !== undefined
      ? getBool(row, colIdx.allow_rotation)
      : (blockDef.allowRotation !== false);

    // Quantity expansion
    const qty = colIdx.qty !== undefined ? (getNum(row, colIdx.qty) || 1) : 1;

    // Truck assignment
    const truckVal = getVal(row, colIdx.camion);
    const truck = (!truckVal || truckVal === '—' || truckVal === '-') ? '' : truckVal;

    // Create case objects (expand qty)
    for (let q = 0; q < qty; q++) {
      const caseName = qty > 1 ? `${nom || group} #${q + 1}` : (nom || group);
      cases.push({
        index: cases.length + 1,
        dept,
        subgroup: group || nom,  // solver uses subgroup as grouping key
        group: group || nom,     // universal grouping key
        nom: caseName,
        name: caseName,
        detail: getVal(row, colIdx.detail),
        num_caisse: getVal(row, colIdx.num_caisse),
        block_name: blockName,
        width,
        depth,
        height,
        rotation: blockDef.rot || 0,
        rangement: getVal(row, colIdx.rangement),
        truck,
        stackable,
        maxStack,
        isFloor,
        allowRotation,
      });
    }
  }

  if (skipped > 0) {
    console.warn(`[Sheet] Skipped ${skipped} rows (missing name/group or dimensions)`);
  }
  console.log(`[Sheet] Parsed ${cases.length} cases from ${table.rows.length} rows`);
  return cases;
}

/**
 * High-level: fetch and parse a Google Sheet into cases.
 * @param {string} input — URL or Sheet ID
 * @param {Object} [blockConfig] — optional legacy block configuration
 * @param {string} [sheetName='Inventaire'] — tab name
 * @returns {Promise<Object[]>} — parsed cases
 */
export async function fetchAndParseCases(input, blockConfig, sheetName = 'Inventaire') {
  const sheetId = extractSheetId(input);
  if (!sheetId) throw new Error('Invalid Sheet URL or ID');
  const response = await fetchSheetViaJsonp(sheetId, sheetName);
  return parseSheetData(response, blockConfig);
}
