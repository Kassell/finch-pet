import { constants as fsConstants } from 'node:fs';
import { access, readFile } from 'node:fs/promises';
import { extname, join } from 'node:path';
import { isRecord } from './utils.js';

export async function exists(path: string): Promise<boolean> {
  try { await access(path, fsConstants.F_OK); return true; } catch { return false; }
}

export function mimeFromPath(file: string): string {
  switch (extname(file).toLowerCase()) {
    case '.webp': return 'image/webp';
    case '.png': return 'image/png';
    case '.jpg':
    case '.jpeg': return 'image/jpeg';
    default: return 'image/webp';
  }
}

function escapeXml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}

export function makeIdlePreviewSvgData(sprite: Buffer, mimeType: string, label: string): string {
  const spriteDataUrl = `data:${mimeType};base64,${sprite.toString('base64')}`;
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="192" height="208" viewBox="0 0 192 208" role="img" aria-label="${escapeXml(label)} idle preview"><rect width="192" height="208" fill="transparent"/><image href="${spriteDataUrl}" x="0" y="0" width="1536" height="1872"/></svg>`;
  return Buffer.from(svg, 'utf8').toString('base64');
}

export async function readPetJson(dir: string, fallbackName: string): Promise<Record<string, unknown>> {
  const file = join(dir, 'pet.json');
  if (!await exists(file)) return { id: fallbackName, displayName: fallbackName, spritesheetPath: 'spritesheet.webp' };
  const pet = JSON.parse(await readFile(file, 'utf8')) as unknown;
  if (!isRecord(pet)) throw new Error('pet.json must contain an object.');
  return pet;
}

export async function findSpritesheet(dir: string, pet: Record<string, unknown>): Promise<string> {
  const declared = typeof pet.spritesheetPath === 'string'
    ? pet.spritesheetPath
    : typeof pet.spritesheet === 'string'
      ? pet.spritesheet
      : undefined;
  const candidates = declared ? [declared] : ['spritesheet.webp', 'spritesheet.png', 'sprite.webp', 'sprite.png'];
  for (const name of candidates) {
    const file = join(dir, name);
    if (await exists(file)) return file;
  }
  throw new Error('Pet image is missing. Expected spritesheet.webp/png by convention.');
}
