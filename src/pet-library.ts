/**
 * 宠物库:目录列举、去重校验、选中解析、PetRecord 组装、宠物包加载。
 *
 * Storage model:
 * - Bundled pets, when present: <extension>/pets/<name>/ (managed by the extension package)
 * - User pets: <ctx.storagePath>/pets/<safe-name>/
 */
import { mkdir, readdir, readFile } from 'node:fs/promises';
import { basename, join } from 'node:path';
import type * as finch from 'finch';
import type { PetFolder, PetHealth, PetKind, PetRecord, PetRegistry, PetRegistryEntry } from './types.js';
import { displayNameOf, safePetName } from './utils.js';
import { findSpritesheet, makeIdlePreviewSvgData, mimeFromPath, readPetJson } from './pet-package.js';
import type { PetRegistryStore } from './registry.js';
import { DuplicatePetIdError, NoAvailablePetError } from './errors.js';

export interface PetLibraryDeps {
  ctx: finch.ExtensionContext;
  builtinPetsRoot: string;
  customPetsRoot: string;
  registry: PetRegistryStore;
}

export type PetLibrary = ReturnType<typeof createPetLibrary>;

export function createPetLibrary({ ctx, builtinPetsRoot, customPetsRoot, registry }: PetLibraryDeps) {
  const ensureCustomPetsRoot = async () => { await mkdir(customPetsRoot, { recursive: true }); };

  const listPetFolders = async (root: string, kind: PetKind): Promise<PetFolder[]> => {
    const entries = await readdir(root, { withFileTypes: true }).catch(() => []);
    return entries
      .filter((entry) => entry.isDirectory())
      .map((entry) => ({ name: safePetName(entry.name), kind, dir: join(root, entry.name) }))
      .filter((pet) => pet.name.length > 0)
      .sort((a, b) => a.name.localeCompare(b.name));
  };

  const listBuiltinPetFolders = async () => listPetFolders(builtinPetsRoot, 'builtin');

  const listAllPetFolders = async (): Promise<PetFolder[]> => {
    await ensureCustomPetsRoot();
    return [
      ...await listBuiltinPetFolders(),
      ...await listPetFolders(customPetsRoot, 'custom'),
    ];
  };

  // 当前版本可能不随包携带默认宠物；这里保持可选 fallback，等默认资源重做后可直接放回 pets/。
  const getDefaultPetFolder = async () => (await listBuiltinPetFolders())[0];

  const groupPetFoldersById = (folders: PetFolder[]) => {
    const groups = new Map<string, PetFolder[]>();
    for (const folder of folders) groups.set(folder.name, [...groups.get(folder.name) ?? [], folder]);
    return groups;
  };

  const listAvailablePetFolders = async () => {
    const defaultPet = await getDefaultPetFolder();
    const groups = groupPetFoldersById(await listAllPetFolders());
    const available: PetFolder[] = [];
    for (const [id, folders] of groups) {
      if (folders.length > 1) {
        ctx.logger.warn('pet id duplicated', id, folders.map((folder) => `${folder.kind}:${folder.dir}`).join(', '));
        if (defaultPet && id === defaultPet.name) {
          available.push(defaultPet);
        }
        continue;
      }
      available.push(folders[0]);
    }
    return available.sort((a, b) => a.kind === b.kind ? a.name.localeCompare(b.name) : a.kind === 'builtin' ? -1 : 1);
  };

  const getPetFoldersById = async (id: string) => groupPetFoldersById(await listAllPetFolders()).get(safePetName(id)) ?? [];

  const describePetFolders = (folders: PetFolder[]) => folders
    .map((folder) => `- ${folder.name} — ${folder.kind === 'builtin' ? '内置' : '自定义'} — ${folder.dir}`)
    .join('\n');

  const duplicatePetMessage = (id: string, folders: PetFolder[]) => `检测到重复的 pet id：${id}。\n${describePetFolders(folders)}\n如果想使用这个 id 的宠物，请先移除其中一个重复目录，然后再选择。`;

  const getFallbackPetFolder = async () => {
    const available = await listAvailablePetFolders();
    const defaultPet = await getDefaultPetFolder();
    if (defaultPet) return available.find((pet) => pet.kind === 'builtin' && pet.name === defaultPet.name);
    return available.find((pet) => pet.kind === 'custom');
  };
  const getFallbackPetName = async () => (await getFallbackPetFolder())?.name;
  const getSelectedPetName = async () => safePetName(await ctx.storage.get<string>('selectedPet'), await getFallbackPetName() ?? 'pet');

  const resolvePetDir = async (name?: string): Promise<{ name: string; kind: PetKind; dir: string } | undefined> => {
    const available = await listAvailablePetFolders();
    const fallback = await getFallbackPetFolder();
    if (!fallback) return undefined;
    const selected = safePetName(name ?? await getSelectedPetName(), fallback.name);
    const matched = available.find((pet) => pet.name === selected);
    if (matched) return matched;
    await ctx.storage.set('selectedPet', fallback.name);
    return fallback;
  };

  const registryEntryForFolder = (snapshot: PetRegistry | undefined, folder: PetFolder) => {
    if (!snapshot) return undefined;
    return snapshot.pets[folder.name] ?? Object.values(snapshot.pets).find((entry) => entry.folderName === folder.name);
  };

  const makePetRecord = async (folder: PetFolder, selected?: string, snapshot?: PetRegistry): Promise<PetRecord> => {
    const registered = registryEntryForFolder(snapshot, folder);
    const pet = await readPetJson(folder.dir, folder.name).catch(() => ({ id: folder.name, displayName: folder.name }));
    const displayName = displayNameOf(pet, registered?.displayName ?? folder.name);
    let preview: PetRecord['preview'];
    let health: PetHealth = folder.kind === 'custom' && !registered ? 'external' : 'ok';
    let warning: string | undefined = folder.kind === 'custom' && !registered ? '用户手动添加，registry.json 无记录' : undefined;
    try {
      const spritePath = await findSpritesheet(folder.dir, pet);
      const sprite = await readFile(spritePath);
      preview = {
        data: makeIdlePreviewSvgData(sprite, mimeFromPath(spritePath), displayName),
        mimeType: 'image/svg+xml',
      };
      if (registered && basename(spritePath) !== registered.spritesheetPath) {
        health = 'invalid';
        warning = `registry 记录的图片是 ${registered.spritesheetPath}，实际使用 ${basename(spritePath)}`;
      }
    } catch (err) {
      health = 'invalid';
      warning = '宠物图片缺失或结构异常';
      ctx.logger.warn('failed to create pet preview', folder.name, err);
    }
    return {
      name: folder.name,
      displayName,
      kind: folder.kind,
      removable: folder.kind === 'custom',
      selected: selected === folder.name,
      sourceType: folder.kind === 'builtin' ? 'builtin' : registered?.sourceType ?? 'external',
      health,
      warning,
      preview,
    };
  };

  const makeMissingRegistryRecord = (entry: PetRegistryEntry, selected?: string): PetRecord => ({
    name: entry.id,
    displayName: entry.displayName,
    kind: 'custom',
    removable: true,
    selected: selected === entry.id,
    sourceType: entry.sourceType,
    health: 'missing',
    warning: `registry.json 有记录，但目录缺失：${entry.folderName}`,
  });

  const listPets = async (): Promise<PetRecord[]> => {
    const selected = (await resolvePetDir())?.name;
    const registrySnapshot = await registry.read();
    const folders = await listAvailablePetFolders();
    const records = await Promise.all(folders.map((pet) => makePetRecord(pet, selected, registrySnapshot)));
    const folderNames = new Set(folders.filter((folder) => folder.kind === 'custom').map((folder) => folder.name));
    for (const entry of Object.values(registrySnapshot.pets)) {
      if (!folderNames.has(entry.folderName) && !folderNames.has(entry.id)) records.push(makeMissingRegistryRecord(entry, selected));
    }
    return records.sort((a, b) => a.kind === b.kind ? a.name.localeCompare(b.name) : a.kind === 'builtin' ? -1 : 1);
  };

  const findInstalledPetById = async (id: string): Promise<{ name: string; kind: PetKind; dir: string; displayName: string } | undefined> => {
    const safeId = safePetName(id);
    const folders = await getPetFoldersById(safeId);
    if (folders.length > 1) throw new DuplicatePetIdError(safeId, folders);
    return folders[0] ? { ...folders[0], displayName: folders[0].name } : undefined;
  };

  const loadPetPackage = async () => {
    const resolved = await resolvePetDir();
    if (!resolved) throw new NoAvailablePetError();
    const pet = await readPetJson(resolved.dir, resolved.name);
    const spritePath = await findSpritesheet(resolved.dir, pet);
    const sprite = await readFile(spritePath);
    const spriteDataUrl = `data:${mimeFromPath(spritePath)};base64,${sprite.toString('base64')}`;
    return { ...resolved, pet, spriteDataUrl };
  };

  return {
    ensureCustomPetsRoot,
    listAvailablePetFolders,
    getPetFoldersById,
    duplicatePetMessage,
    getFallbackPetName,
    getSelectedPetName,
    resolvePetDir,
    listPets,
    findInstalledPetById,
    loadPetPackage,
  };
}
