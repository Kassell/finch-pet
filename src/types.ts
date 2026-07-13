export { PET_STATES, parsePetState } from './protocol.js';
export type { PetState } from './protocol.js';
export type PetKind = 'builtin' | 'custom';
export type PetSourceType = 'builtin' | 'petdex-url' | 'remote-image' | 'local-image' | 'local-folder' | 'local-zip' | 'external';
export type PetHealth = 'ok' | 'external' | 'missing' | 'invalid';

export interface WindowPosition { x: number; y: number }
export interface PetRecord { name: string; displayName: string; kind: PetKind; removable: boolean; selected: boolean; sourceType: PetSourceType; health: PetHealth; warning?: string; preview?: { data: string; mimeType: string } }
export interface ZipEntry { path: string; data: Buffer }
export interface PetRegistryEntry { id: string; displayName: string; sourceType: Exclude<PetSourceType, 'builtin' | 'external'>; sourceUrl?: string; sourcePath?: string; folderName: string; spritesheetPath: string; installedAt: string; updatedAt: string }
export interface PetRegistry { version: 1; pets: Record<string, PetRegistryEntry> }
export interface PetFolder { name: string; kind: PetKind; dir: string }
