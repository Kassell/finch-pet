import AdmZip from 'adm-zip';
import type { ZipEntry } from '../types.js';

export function normalizeZipPath(value: string): string | undefined {
  const normalized = value.replace(/\\/g, '/').replace(/^\.\//, '');
  if (!normalized || normalized.startsWith('/') || normalized.includes('../') || normalized === '..') return undefined;
  return normalized;
}

export function readZipEntries(zipPath: string): ZipEntry[] {
  const zip = new AdmZip(zipPath);
  return zip.getEntries()
    .filter((entry) => !entry.isDirectory)
    .map((entry) => {
      const path = normalizeZipPath(entry.entryName);
      if (!path) return undefined;
      return { path, data: entry.getData() } satisfies ZipEntry;
    })
    .filter((entry): entry is ZipEntry => Boolean(entry));
}

export function zipDirname(path: string): string {
  const index = path.lastIndexOf('/');
  return index >= 0 ? path.slice(0, index + 1) : '';
}

export function findZipSpritesheet(entries: ZipEntry[], pet: Record<string, unknown>, baseDir: string): ZipEntry | undefined {
  const declared = typeof pet.spritesheetPath === 'string'
    ? pet.spritesheetPath
    : typeof pet.spritesheet === 'string'
      ? pet.spritesheet
      : undefined;
  const candidates = declared ? [declared] : ['spritesheet.webp', 'spritesheet.png', 'sprite.webp', 'sprite.png'];
  const normalizedCandidates = candidates
    .map((candidate) => normalizeZipPath(candidate))
    .filter((candidate): candidate is string => Boolean(candidate));

  for (const candidate of normalizedCandidates) {
    const directPath = `${baseDir}${candidate}`;
    const found = entries.find((entry) => entry.path === directPath || entry.path === candidate);
    if (found) return found;
  }

  return entries.find((entry) => /(^|\/)(spritesheet|sprite)\.(webp|png)$/i.test(entry.path));
}
