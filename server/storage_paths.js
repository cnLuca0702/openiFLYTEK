import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

export const APP_DATA_DIR = path.join(os.homedir(), 'Library', 'Application Support', 'VIAIM Studio');
export const NOTEBOOK_STORE_DIR = path.join(APP_DATA_DIR, 'notebook-store');
export const NOTEBOOK_DB_PATH = path.join(NOTEBOOK_STORE_DIR, 'notebook.db');
export const NOTEBOOK_CACHE_DIR = path.join(NOTEBOOK_STORE_DIR, 'cache');
export const NOTEBOOK_RECORDING_DIR = path.join(NOTEBOOK_STORE_DIR, 'recordings');
export const NOTEBOOK_BACKUP_DIR = path.join(NOTEBOOK_STORE_DIR, 'backups');

export function ensureNotebookStorage() {
  for (const dir of [NOTEBOOK_STORE_DIR, NOTEBOOK_CACHE_DIR, NOTEBOOK_RECORDING_DIR, NOTEBOOK_BACKUP_DIR]) {
    fs.mkdirSync(dir, { recursive: true });
  }
}

export function safePathSegment(value, label = '路径片段') {
  const segment = String(value || '').trim();
  if (!segment || segment === '.' || segment === '..' || /[\\/\0]/.test(segment)) {
    throw new Error(`无效${label}`);
  }
  return segment;
}

export function getNotebookResourceDir(userId, noteId) {
  const dir = path.join(
    NOTEBOOK_CACHE_DIR,
    safePathSegment(userId, '用户标识'),
    safePathSegment(noteId, '笔记标识'),
    'res'
  );
  fs.mkdirSync(dir, { recursive: true });
  return dir;
}

export function getSafeResourcePath(userId, noteId, objectName) {
  const fileName = safePathSegment(path.basename(String(objectName || '')), '附件文件名');
  const resourceDir = getNotebookResourceDir(userId, noteId);
  const target = path.resolve(resourceDir, fileName);
  if (!target.startsWith(`${path.resolve(resourceDir)}${path.sep}`)) {
    throw new Error('附件路径超出项目缓存目录');
  }
  return target;
}

export function getRelativeNotebookPath(absolutePath) {
  const relative = path.relative(NOTEBOOK_STORE_DIR, absolutePath);
  if (!relative || relative.startsWith('..') || path.isAbsolute(relative)) {
    throw new Error('文件路径不属于项目存储目录');
  }
  return relative;
}

export function resolveNotebookPath(relativePath) {
  const target = path.resolve(NOTEBOOK_STORE_DIR, String(relativePath || ''));
  if (!target.startsWith(`${path.resolve(NOTEBOOK_STORE_DIR)}${path.sep}`)) {
    throw new Error('缓存相对路径无效');
  }
  return target;
}
