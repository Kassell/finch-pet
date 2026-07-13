import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import type { PetRegistry, PetRegistryEntry } from './types.js';
import { isRecord, safePetName } from './utils.js';

export class PetRegistryStore {
  readonly path: string;

  constructor(private readonly storagePath: string) {
    this.path = join(storagePath, 'registry.json');
  }

  private empty(): PetRegistry {
    return { version: 1, pets: {} };
  }

  async read(): Promise<PetRegistry> {
    try {
      const raw = JSON.parse(await readFile(this.path, 'utf8')) as unknown;
      if (!isRecord(raw) || raw.version !== 1 || !isRecord(raw.pets)) return this.empty();
      const pets: PetRegistry['pets'] = {};
      for (const [id, value] of Object.entries(raw.pets)) {
        if (!isRecord(value)) continue;
        const entryId = safePetName(value.id, id);
        const sourceType = value.sourceType;
        if (!['petdex-url', 'remote-image', 'local-image', 'local-folder', 'local-zip'].includes(String(sourceType))) continue;
        pets[entryId] = {
          id: entryId,
          displayName: typeof value.displayName === 'string' ? value.displayName : entryId,
          sourceType: sourceType as PetRegistryEntry['sourceType'],
          sourceUrl: typeof value.sourceUrl === 'string' ? value.sourceUrl : undefined,
          sourcePath: typeof value.sourcePath === 'string' ? value.sourcePath : undefined,
          folderName: safePetName(value.folderName, entryId),
          spritesheetPath: typeof value.spritesheetPath === 'string' ? value.spritesheetPath : 'spritesheet.webp',
          installedAt: typeof value.installedAt === 'string' ? value.installedAt : new Date().toISOString(),
          updatedAt: typeof value.updatedAt === 'string' ? value.updatedAt : new Date().toISOString(),
        };
      }
      return { version: 1, pets };
    } catch {
      return this.empty();
    }
  }

  async write(registry: PetRegistry) {
    await mkdir(this.storagePath, { recursive: true });
    await writeFile(this.path, JSON.stringify(registry, null, 2), 'utf8');
  }

  async upsert(entry: Omit<PetRegistryEntry, 'installedAt' | 'updatedAt'>) {
    const registry = await this.read();
    const now = new Date().toISOString();
    const existing = registry.pets[entry.id];
    registry.pets[entry.id] = { ...entry, installedAt: existing?.installedAt ?? now, updatedAt: now };
    await this.write(registry);
  }

  async remove(id: string) {
    const registry = await this.read();
    delete registry.pets[safePetName(id)];
    await this.write(registry);
  }
}
