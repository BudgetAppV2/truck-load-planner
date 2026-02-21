// config-loader.js — Load truck and block configuration from JSON files

/**
 * Load trucks.json and return the parsed config.
 * @returns {Promise<{trucks: Object, default: string}>}
 */
export async function loadTruckConfig() {
  const resp = await fetch('config/trucks.json');
  if (!resp.ok) throw new Error(`Failed to load trucks.json: ${resp.status}`);
  return resp.json();
}

/**
 * Load a block configuration JSON file (e.g. blocks-gb.json).
 * @param {string} filename — JSON filename inside config/ folder
 * @returns {Promise<Object>} — { name, blocks, subgroupBlock, subgroupDept, departments, ... }
 */
export async function loadBlockConfig(filename) {
  const resp = await fetch(`config/${filename}`);
  if (!resp.ok) throw new Error(`Failed to load ${filename}: ${resp.status}`);
  return resp.json();
}

/**
 * Scan config/ folder for available block config files.
 * Since we can't list directory contents via fetch, we maintain a manifest.
 * For now, returns a hardcoded list that can be extended.
 * @returns {string[]} — Array of filenames
 */
export function getBlockConfigFiles() {
  return ['blocks-gb.json'];
}
