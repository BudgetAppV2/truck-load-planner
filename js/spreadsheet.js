// spreadsheet.js — Integrated spreadsheet editor using jspreadsheet-ce v4
// Wraps jspreadsheet-ce (loaded as global via CDN) with truck load planner logic.

const STORAGE_KEY = 'tlp-spreadsheet-data';

// Column index constants
const COL = {
  NOM: 0, LARGEUR: 1, PROFONDEUR: 2, HAUTEUR: 3, DEPT: 4, QTY: 5,
  STACKABLE: 6, MAX_STACK: 7, IS_FLOOR: 8, ALLOW_ROTATION: 9,
  GROUP: 10, SELECTION: 11,
};

const DEFAULT_DEPT_SOURCE = ['LX', 'SON', 'CARP', 'VID', 'SCENO', 'GENERAL'];

const TEMPLATE_DATA = [
  ['Coffre éclairage A', 31, 29, 36, 'LX', 3, 'true', 2, 'false', 'true', 'Coffre éclairage', true],
  ['Rack son', 38, 20, 48, 'SON', 1, 'false', 1, 'false', 'true', 'Rack son', true],
  ['Console', 44, 30, 18, 'LX', 2, 'true', 2, 'false', 'true', 'Console', true],
  ['Plancher', 45, 100, 60, 'CARP', 6, 'false', 1, 'true', 'false', 'Plancher', true],
  ['Câblage', 44, 30, 36, 'LX', 2, 'false', 1, 'false', 'true', 'Câblage', true],
  ['Moniteur', 31, 24, 32, 'SON', 4, 'true', 2, 'false', 'true', 'Moniteur', true],
];

// Department color mapping — dark muted tones for dark theme
const DEPT_COLORS = {
  LX:      '#3d3520',
  SON:     '#1e2a3d',
  CARP:    '#1e3320',
  VID:     '#3d1e2a',
  SCENO:   '#2d1e3d',
  GENERAL: '#252525',
};

// Deselected row styling
const DESELECTED_BG = '#111820';
const DESELECTED_TEXT = '#555';

// CSV import column alias mapping (mirrors sheet-loader.js COLUMN_ALIASES)
const CSV_ALIASES = {
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
  group:     ['GROUP', 'GROUPE', 'SUBGROUP', 'SOUS_GROUPE', 'SOUS-GROUPE'],
  selection: ['SÉLECTION', 'SELECTION', 'SEL', 'SELECTED'],
};

/**
 * SpreadsheetEditor — integrated spreadsheet for case data editing.
 */
export class SpreadsheetEditor {
  constructor(containerId) {
    this.containerId = containerId;
    this.jss = null; // jspreadsheet instance
    this.deptSource = [...DEFAULT_DEPT_SOURCE];
    this.onDataChange = null; // callback: () => {}

    this._init();
  }

  _init() {
    const container = document.getElementById(this.containerId);
    if (!container) {
      console.error('[Spreadsheet] Container not found:', this.containerId);
      return;
    }

    const data = this._loadFromLocalStorage() || this._cloneTemplate();

    // Ensure minimum empty rows for easy editing
    while (data.length < 20) {
      data.push(['', '', '', '', '', 1, 'false', 1, 'false', 'true', '', true]);
    }

    this.jss = window.jspreadsheet(container, {
      data,
      columns: this._getColumns(),
      minDimensions: [12, 20],
      tableOverflow: true,
      tableWidth: '100%',
      tableHeight: '100%',
      defaultColWidth: 80,
      allowInsertRow: true,
      allowDeleteRow: true,
      allowInsertColumn: false,
      allowDeleteColumn: false,
      columnSorting: false,
      contextMenu: (obj, x, y, e, items) => this._contextMenu(obj, x, y, e, items),
      onchange: (instance, cell, x, y, value) => this._onChange(instance, cell, x, y, value),
      onafterchanges: () => this._afterChanges(),
      oninsertrow: () => this._afterChanges(),
      ondeleterow: () => this._afterChanges(),
      onpaste: () => { setTimeout(() => this._afterChanges(), 50); },
    });

    // Apply initial row colors
    this._applyAllRowStyles();

    console.log('[Spreadsheet] Initialized with', data.length, 'rows');
  }

  _getColumns() {
    return [
      { type: 'text', title: 'nom', width: 180 },
      { type: 'numeric', title: 'largeur', width: 75 },
      { type: 'numeric', title: 'profondeur', width: 85 },
      { type: 'numeric', title: 'hauteur', width: 75 },
      { type: 'dropdown', title: 'dept', width: 90, source: this.deptSource, autocomplete: true, allowEmpty: true },
      { type: 'numeric', title: 'qty', width: 50 },
      { type: 'dropdown', title: 'stackable', width: 85, source: ['true', 'false'] },
      { type: 'numeric', title: 'max_stack', width: 80 },
      { type: 'dropdown', title: 'is_floor', width: 75, source: ['true', 'false'] },
      { type: 'dropdown', title: 'allow_rot', width: 85, source: ['true', 'false'] },
      { type: 'text', title: 'group', width: 130 },
      { type: 'checkbox', title: 'sélection', width: 75 },
    ];
  }

  _cloneTemplate() {
    return TEMPLATE_DATA.map(row => [...row]);
  }

  // ── Public: convert spreadsheet data to case objects for solver ──
  convertToCaseObjects() {
    const data = this.jss.getData();
    const cases = [];
    let skipped = 0;

    for (const row of data) {
      const nom = String(row[COL.NOM] || '').trim();
      const largeur = parseFloat(row[COL.LARGEUR]) || 0;
      const profondeur = parseFloat(row[COL.PROFONDEUR]) || 0;
      const hauteur = parseFloat(row[COL.HAUTEUR]) || 0;
      const dept = String(row[COL.DEPT] || 'GENERAL').trim();
      const qty = parseInt(row[COL.QTY]) || 1;
      const stackable = row[COL.STACKABLE] === 'true' || row[COL.STACKABLE] === true;
      const maxStack = parseInt(row[COL.MAX_STACK]) || 1;
      const isFloor = row[COL.IS_FLOOR] === 'true' || row[COL.IS_FLOOR] === true;
      const allowRotation = row[COL.ALLOW_ROTATION] !== 'false' && row[COL.ALLOW_ROTATION] !== false;
      const group = String(row[COL.GROUP] || '').trim();
      const selection = row[COL.SELECTION] === true || row[COL.SELECTION] === 'true';

      // Skip unselected
      if (!selection) continue;

      // Skip empty rows
      if (!nom) continue;

      // Skip rows with missing dimensions
      if (largeur === 0 || profondeur === 0 || hauteur === 0) {
        console.warn(`[Spreadsheet] Skipping "${nom}" — missing dimensions (${largeur}x${profondeur}x${hauteur})`);
        skipped++;
        continue;
      }

      // Expand qty
      for (let q = 0; q < qty; q++) {
        const caseName = qty > 1 ? `${nom} #${q + 1}` : nom;
        cases.push({
          index: cases.length + 1,
          nom: caseName,
          name: caseName,
          width: largeur,
          depth: profondeur,
          height: hauteur,
          dept: dept || 'GENERAL',
          subgroup: group || nom,
          group: group || nom,
          stackable,
          maxStack,
          isFloor,
          allowRotation,
          rotation: 0,
          truck: '',
          detail: '',
          num_caisse: '',
          block_name: '',
          rangement: '',
        });
      }
    }

    if (skipped > 0) {
      console.warn(`[Spreadsheet] Skipped ${skipped} rows (missing dimensions)`);
    }
    console.log(`[Spreadsheet] Converted ${cases.length} case objects from spreadsheet`);
    return cases;
  }

  // ── Public: load case objects into spreadsheet (reverse of convertToCaseObjects) ──
  loadFromCaseObjects(cases) {
    // Group by base name (strip #N suffix) to collapse qty
    const rowMap = new Map();

    for (const c of cases) {
      const baseName = c.nom ? c.nom.replace(/ #\d+$/, '') : (c.name || '').replace(/ #\d+$/, '');

      if (!rowMap.has(baseName)) {
        rowMap.set(baseName, {
          nom: baseName,
          largeur: c.width,
          profondeur: c.depth,
          hauteur: c.height,
          dept: c.dept || 'GENERAL',
          qty: 1,
          stackable: c.stackable ? 'true' : 'false',
          maxStack: c.maxStack || 1,
          isFloor: c.isFloor ? 'true' : 'false',
          allowRotation: c.allowRotation !== false ? 'true' : 'false',
          group: c.group || c.subgroup || '',
          selection: true,
        });
      } else {
        rowMap.get(baseName).qty++;
      }
    }

    const data = Array.from(rowMap.values()).map(r => [
      r.nom, r.largeur, r.profondeur, r.hauteur, r.dept, r.qty,
      r.stackable, r.maxStack, r.isFloor, r.allowRotation, r.group, r.selection,
    ]);

    // Pad with empty rows
    while (data.length < 20) {
      data.push(['', '', '', '', '', 1, 'false', 1, 'false', 'true', '', true]);
    }

    this.jss.setData(data);
    this._applyAllRowStyles();
    this._saveToLocalStorage();

    // Update dept dropdown if new depts found
    const newDepts = [...new Set(cases.map(c => c.dept).filter(Boolean))];
    this._mergeDeptSource(newDepts);

    console.log(`[Spreadsheet] Loaded ${rowMap.size} rows from ${cases.length} case objects`);
  }

  // ── Public: import CSV text ──
  importCSV(csvText) {
    const parsed = this._parseCSV(csvText);
    if (parsed.length === 0) throw new Error('Empty CSV file');

    // Check if first row is a header
    const firstRow = parsed[0];
    const isHeader = this._matchCSVHeader(firstRow);
    const colMap = isHeader ? this._buildCSVColumnMap(firstRow) : null;
    const dataRows = isHeader ? parsed.slice(1) : parsed;

    const data = [];
    for (const row of dataRows) {
      if (row.every(cell => !cell.trim())) continue; // skip empty rows

      if (colMap) {
        // Map by detected column positions
        data.push([
          row[colMap.nom] || '',
          parseFloat(row[colMap.largeur]) || '',
          parseFloat(row[colMap.profondeur]) || '',
          parseFloat(row[colMap.hauteur]) || '',
          row[colMap.dept] || '',
          parseInt(row[colMap.qty]) || 1,
          this._normBool(row[colMap.stackable]),
          parseInt(row[colMap.max_stack]) || 1,
          this._normBool(row[colMap.is_floor]),
          this._normBool(row[colMap.allow_rotation], 'true'),
          row[colMap.group] || '',
          this._normBool(row[colMap.selection], 'true') === 'true',
        ]);
      } else {
        // Assume columns are in our order: nom, largeur, profondeur, hauteur, ...
        const padded = [...row];
        while (padded.length < 12) padded.push('');
        data.push([
          padded[0],
          parseFloat(padded[1]) || '',
          parseFloat(padded[2]) || '',
          parseFloat(padded[3]) || '',
          padded[4] || '',
          parseInt(padded[5]) || 1,
          this._normBool(padded[6]),
          parseInt(padded[7]) || 1,
          this._normBool(padded[8]),
          this._normBool(padded[9], 'true'),
          padded[10] || '',
          true,
        ]);
      }
    }

    // Pad with empty rows
    while (data.length < 20) {
      data.push(['', '', '', '', '', 1, 'false', 1, 'false', 'true', '', true]);
    }

    this.jss.setData(data);
    this._applyAllRowStyles();
    this._saveToLocalStorage();
    console.log(`[Spreadsheet] Imported ${data.length} rows from CSV`);
  }

  // ── Public: export as CSV download ──
  exportCSV() {
    const data = this.jss.getData();
    const headers = ['nom', 'largeur', 'profondeur', 'hauteur', 'dept', 'qty',
      'stackable', 'max_stack', 'is_floor', 'allow_rotation', 'group', 'sélection'];

    // Filter out completely empty rows
    const nonEmpty = data.filter(row =>
      String(row[COL.NOM] || '').trim() !== ''
    );

    const csvRows = [headers.join(',')];
    for (const row of nonEmpty) {
      csvRows.push(row.map(cell => {
        const s = String(cell == null ? '' : cell);
        return s.includes(',') || s.includes('"') || s.includes('\n')
          ? '"' + s.replace(/"/g, '""') + '"'
          : s;
      }).join(','));
    }

    const blob = new Blob([csvRows.join('\n')], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'truck-load-planner.csv';
    a.click();
    URL.revokeObjectURL(url);
    console.log(`[Spreadsheet] Exported ${nonEmpty.length} rows as CSV`);
  }

  // ── Public: reset to template ──
  resetToTemplate() {
    const data = this._cloneTemplate();
    while (data.length < 20) {
      data.push(['', '', '', '', '', 1, 'false', 1, 'false', 'true', '', true]);
    }
    this.jss.setData(data);
    this._applyAllRowStyles();
    this._saveToLocalStorage();
    console.log('[Spreadsheet] Reset to template data');
  }

  // ── Public: collapse/expand panel ──
  collapse(collapsed) {
    const panel = document.getElementById('spreadsheet-panel');
    if (panel) panel.classList.toggle('collapsed', collapsed);
  }

  // ── Public: get row count (non-empty) ──
  getRowCount() {
    const data = this.jss.getData();
    return data.filter(row => String(row[COL.NOM] || '').trim() !== '').length;
  }

  // ════════════════════════════════════════════════════
  // PRIVATE: Cell change handlers
  // ════════════════════════════════════════════════════

  _onChange(instance, cell, x, y, value) {
    const col = parseInt(x);
    const row = parseInt(y);
    // Re-style row when dept or sélection changes
    if (col === COL.DEPT || col === COL.SELECTION) {
      this._applyRowStyle(row);
    }
  }

  _afterChanges() {
    this._saveToLocalStorage();
    if (this.onDataChange) this.onDataChange();
  }

  // ════════════════════════════════════════════════════
  // PRIVATE: Row coloring by department
  // ════════════════════════════════════════════════════

  _applyRowStyle(rowIndex) {
    const data = this.jss.getData();
    if (rowIndex >= data.length) return;
    const row = data[rowIndex];
    const dept = String(row[COL.DEPT] || '').trim();
    const selected = row[COL.SELECTION] === true || row[COL.SELECTION] === 'true';
    const numCols = 12;

    if (!selected) {
      // Deselected: dark + dimmed text
      for (let col = 0; col < numCols; col++) {
        const ref = this._cellRef(col, rowIndex);
        this.jss.setStyle(ref, 'background-color', DESELECTED_BG);
        this.jss.setStyle(ref, 'color', DESELECTED_TEXT);
      }
    } else {
      // Selected: dept color or default, normal text
      const bg = DEPT_COLORS[dept] || '';
      for (let col = 0; col < numCols; col++) {
        const ref = this._cellRef(col, rowIndex);
        this.jss.setStyle(ref, 'background-color', bg);
        this.jss.setStyle(ref, 'color', '');
      }
    }
  }

  _applyAllRowStyles() {
    const data = this.jss.getData();
    for (let i = 0; i < data.length; i++) {
      this._applyRowStyle(i);
    }
  }

  _cellRef(col, row) {
    // Convert col index to letter (A-Z, then AA-AZ, etc.)
    let letter = '';
    let c = col;
    while (c >= 0) {
      letter = String.fromCharCode(65 + (c % 26)) + letter;
      c = Math.floor(c / 26) - 1;
    }
    return letter + (row + 1);
  }

  // ════════════════════════════════════════════════════
  // PRIVATE: localStorage
  // ════════════════════════════════════════════════════

  _saveToLocalStorage() {
    try {
      const data = this.jss.getData();
      localStorage.setItem(STORAGE_KEY, JSON.stringify(data));
    } catch (e) {
      console.warn('[Spreadsheet] localStorage save failed:', e.message);
    }
  }

  _loadFromLocalStorage() {
    try {
      const saved = localStorage.getItem(STORAGE_KEY);
      if (!saved) return null;
      const data = JSON.parse(saved);
      if (!Array.isArray(data) || data.length === 0) return null;
      return data;
    } catch (e) {
      console.warn('[Spreadsheet] localStorage load failed:', e.message);
      return null;
    }
  }

  // ════════════════════════════════════════════════════
  // PRIVATE: CSV parsing
  // ════════════════════════════════════════════════════

  _parseCSV(text) {
    const rows = [];
    const lines = text.split(/\r?\n/);

    for (const line of lines) {
      if (!line.trim()) continue;
      const row = [];
      let current = '';
      let inQuotes = false;

      for (let i = 0; i < line.length; i++) {
        const char = line[i];
        if (char === '"') {
          if (inQuotes && line[i + 1] === '"') {
            current += '"';
            i++;
          } else {
            inQuotes = !inQuotes;
          }
        } else if ((char === ',' || char === '\t') && !inQuotes) {
          row.push(current.trim());
          current = '';
        } else {
          current += char;
        }
      }
      row.push(current.trim());
      rows.push(row);
    }
    return rows;
  }

  _matchCSVHeader(row) {
    // Check if this row looks like a header (contains known column names)
    const upper = row.map(s => String(s).trim().toUpperCase());
    let matches = 0;
    for (const aliases of Object.values(CSV_ALIASES)) {
      if (upper.some(h => aliases.includes(h))) matches++;
    }
    return matches >= 3; // at least 3 known columns
  }

  _buildCSVColumnMap(headerRow) {
    const upper = headerRow.map(s => String(s).trim().toUpperCase());
    const map = {};

    for (const [field, aliases] of Object.entries(CSV_ALIASES)) {
      for (let i = 0; i < upper.length; i++) {
        if (aliases.includes(upper[i])) {
          map[field] = i;
          break;
        }
      }
    }

    // Default positions for missing columns
    const FIELDS = ['nom', 'largeur', 'profondeur', 'hauteur', 'dept', 'qty',
      'stackable', 'max_stack', 'is_floor', 'allow_rotation', 'group', 'selection'];
    for (let i = 0; i < FIELDS.length; i++) {
      if (map[FIELDS[i]] === undefined) map[FIELDS[i]] = -1;
    }
    return map;
  }

  _normBool(val, defaultVal = 'false') {
    if (val === undefined || val === null || val === '') return defaultVal;
    const s = String(val).trim().toUpperCase();
    if (s === 'TRUE' || s === 'VRAI' || s === 'OUI' || s === 'YES' || s === '1') return 'true';
    if (s === 'FALSE' || s === 'FAUX' || s === 'NON' || s === 'NO' || s === '0') return 'false';
    return defaultVal;
  }

  // ════════════════════════════════════════════════════
  // PRIVATE: Dept source management
  // ════════════════════════════════════════════════════

  _mergeDeptSource(newDepts) {
    let changed = false;
    for (const d of newDepts) {
      if (d && !this.deptSource.includes(d)) {
        this.deptSource.push(d);
        changed = true;
      }
    }
    if (changed) {
      console.log('[Spreadsheet] Updated dept source:', this.deptSource);
    }
  }

  // ════════════════════════════════════════════════════
  // PRIVATE: Context menu customization
  // ════════════════════════════════════════════════════

  _contextMenu(obj, x, y, e, items) {
    // Keep standard insert/delete row items, remove column operations
    return items.filter(item => {
      if (!item.title) return true;
      const t = item.title.toLowerCase();
      return !t.includes('column') && !t.includes('colonne');
    });
  }
}
