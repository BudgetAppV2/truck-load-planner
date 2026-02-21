// sheet-loader.js — Google Sheet fetch + parsing
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
  // Match /d/SHEET_ID/ pattern in Google Sheets URLs
  const match = input.match(/\/spreadsheets\/d\/([a-zA-Z0-9_-]+)/);
  if (match) return match[1];
  // If it looks like an ID already (no slashes, reasonable length)
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

/**
 * Parse Google Visualization API response into case objects.
 * Resolves block_name, dept, and dimensions from blockConfig fallbacks.
 *
 * @param {Object} gvizResponse — response from fetchSheetViaJsonp
 * @param {Object} blockConfig — { blocks, subgroupBlock, subgroupDept, departments }
 * @returns {Object[]} — Array of case objects
 */
export function parseSheetData(gvizResponse, blockConfig) {
  const table = gvizResponse.table;
  if (!table || !table.rows) return [];

  const subgroupBlock = blockConfig.subgroupBlock || {};
  const subgroupDept = blockConfig.subgroupDept || {};
  const blocks = blockConfig.blocks || {};

  // Build column index map from headers (case-insensitive)
  const cols = table.cols.map(c => (c.label || '').trim().toUpperCase());
  const colIdx = {};
  cols.forEach((h, i) => {
    if (h === '#') colIdx.index = i;
    else if (h === 'DEPT') colIdx.dept = i;
    else if (h.includes('SOUS-GROUPE') || h.includes('SOUS GROUPE') || h === 'SUBGROUP') colIdx.subgroup = i;
    else if (h === 'NOM') colIdx.nom = i;
    else if (h.includes('DÉTAIL') || h.includes('DETAIL')) colIdx.detail = i;
    else if (h === 'NUM_CAISSE') colIdx.num_caisse = i;
    else if (h === 'BLOCK_NAME') colIdx.block_name = i;
    else if (h === 'L (PO)' || h === 'WIDTH') colIdx.width = i;
    else if (h === 'W (PO)' || h === 'DEPTH') colIdx.depth = i;
    else if (h === 'H (PO)' || h === 'HEIGHT') colIdx.height = i;
    else if (h === 'RANGEMENT') colIdx.rangement = i;
    else if (h === 'INCLUS') colIdx.inclus = i;
    else if (h === 'CAMION') colIdx.camion = i;
  });

  const getVal = (row, idx) => {
    if (idx === undefined || !row.c || !row.c[idx]) return '';
    const cell = row.c[idx];
    if (cell.v === null || cell.v === undefined) return '';
    return String(cell.f || cell.v).trim();
  };

  const getNum = (row, idx) => {
    if (idx === undefined || !row.c || !row.c[idx]) return 0;
    const cell = row.c[idx];
    if (cell.v === null || cell.v === undefined) return 0;
    const n = typeof cell.v === 'number' ? cell.v : parseFloat(String(cell.v).replace(',', '.'));
    return isNaN(n) ? 0 : n;
  };

  const getBool = (row, idx) => {
    if (idx === undefined || !row.c || !row.c[idx]) return false;
    const cell = row.c[idx];
    if (cell.v === true) return true;
    if (cell.v === false) return false;
    const s = String(cell.v || cell.f || '').toUpperCase().trim();
    return s === 'TRUE' || s === 'VRAI';
  };

  const cases = [];
  for (const row of table.rows) {
    // Only include rows where INCLUS is true (if the column exists)
    if (colIdx.inclus !== undefined && !getBool(row, colIdx.inclus)) continue;

    const subgroup = getVal(row, colIdx.subgroup);
    if (!subgroup) continue;

    // Resolve block_name: sheet value → subgroupBlock mapping → empty
    const sheetBlock = getVal(row, colIdx.block_name);
    const blockName = sheetBlock || subgroupBlock[subgroup] || '';

    // Resolve dept: sheet value → subgroupDept mapping → 'AUTRE'
    const sheetDept = getVal(row, colIdx.dept);
    const dept = sheetDept || subgroupDept[subgroup] || 'AUTRE';

    // Resolve dimensions: sheet values → block config → 0
    const blockDef = blocks[blockName] || {};
    const width = getNum(row, colIdx.width) || blockDef.w || 0;
    const depth = getNum(row, colIdx.depth) || blockDef.d || 0;
    const height = getNum(row, colIdx.height) || blockDef.h || 0;

    const truckVal = getVal(row, colIdx.camion);
    const truck = (!truckVal || truckVal === '—' || truckVal === '-') ? '' : truckVal;

    cases.push({
      index: getNum(row, colIdx.index) || cases.length + 1,
      dept,
      subgroup,
      nom: getVal(row, colIdx.nom),
      name: getVal(row, colIdx.nom), // alias for display
      detail: getVal(row, colIdx.detail),
      num_caisse: getVal(row, colIdx.num_caisse),
      block_name: blockName,
      width,
      depth,
      height,
      rotation: blockDef.rot || 0,
      rangement: getVal(row, colIdx.rangement),
      truck,
    });
  }

  console.log(`[Sheet] Parsed ${cases.length} cases from ${table.rows.length} rows`);
  return cases;
}

/**
 * High-level: fetch and parse a Google Sheet into cases.
 * @param {string} input — URL or Sheet ID
 * @param {Object} blockConfig — block configuration
 * @param {string} [sheetName='Inventaire'] — tab name
 * @returns {Promise<Object[]>} — parsed cases
 */
export async function fetchAndParseCases(input, blockConfig, sheetName = 'Inventaire') {
  const sheetId = extractSheetId(input);
  if (!sheetId) throw new Error('Invalid Sheet URL or ID');
  const response = await fetchSheetViaJsonp(sheetId, sheetName);
  return parseSheetData(response, blockConfig);
}
