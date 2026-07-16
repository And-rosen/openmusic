import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.join(__dirname, '..');
const NOTES_PATH = path.join(ROOT, 'release-notes.json');

/**
 * @typedef {{ buildId: string, version: string, notes: string[], builtAt: string }} AppVersionMeta
 */

function pad(n) {
  return String(n).padStart(2, '0');
}

/** 形如 20260716.213045 */
export function createBuildId(date = new Date()) {
  return (
    `${date.getFullYear()}${pad(date.getMonth() + 1)}${pad(date.getDate())}`
    + `.${pad(date.getHours())}${pad(date.getMinutes())}${pad(date.getSeconds())}`
  );
}

export function readReleaseNotesFile() {
  try {
    const raw = JSON.parse(fs.readFileSync(NOTES_PATH, 'utf8'));
    const notes = Array.isArray(raw?.notes)
      ? raw.notes.map((item) => String(item || '').trim()).filter(Boolean)
      : [];
    return { notes, path: NOTES_PATH };
  } catch {
    return { notes: [], path: NOTES_PATH };
  }
}

export function writeReleaseNotesFile(notes) {
  const cleaned = (Array.isArray(notes) ? notes : [])
    .map((item) => String(item || '').trim())
    .filter(Boolean)
    .slice(0, 20);
  fs.writeFileSync(
    NOTES_PATH,
    `${JSON.stringify({ notes: cleaned }, null, 2)}\n`,
    'utf8',
  );
  return cleaned;
}

export function parseNotesFromEnv(raw) {
  return String(raw || '')
    .split(/\r?\n|;|｜/)
    .map((item) => item.trim())
    .filter(Boolean)
    .slice(0, 20);
}

/**
 * @param {{ notes?: string[] }} [options]
 * @returns {AppVersionMeta}
 */
export function buildAppVersionMeta(options = {}) {
  const fromFile = readReleaseNotesFile().notes;
  const notes = (options.notes && options.notes.length > 0)
    ? options.notes
    : fromFile;
  const builtAt = new Date().toISOString();
  const buildId = createBuildId(new Date(builtAt));
  return {
    buildId,
    version: buildId,
    notes: notes.length > 0 ? notes : ['功能与体验优化'],
    builtAt,
  };
}

export function writeVersionJson(outDir, meta) {
  fs.mkdirSync(outDir, { recursive: true });
  const filePath = path.join(outDir, 'version.json');
  fs.writeFileSync(filePath, `${JSON.stringify(meta, null, 2)}\n`, 'utf8');
  return filePath;
}

export { NOTES_PATH, ROOT };
