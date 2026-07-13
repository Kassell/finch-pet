/**
 * 宠物导入渠道:本地目录 / .zip 包 / 本地图片 / 远程 spritesheet URL / petdex.dev 页面。
 * 全部汇入 commitPetInstall 做原子安装(临时目录写入 → 替换 → registry 登记 → 选中)。
 */
import { cp, mkdir, readFile, rm, stat, writeFile } from 'node:fs/promises';
import { basename, extname, join } from 'node:path';
import type { PetRegistryEntry } from './types.js';
import { displayNameOf, firstMatch, isHttpUrl, isRecord, isRemoteSpritesheetUrl, petdexSlugFromUrl, petIdOf, safePetName } from './utils.js';
import { findSpritesheet, readPetJson } from './pet-package.js';
import type { PetRegistryStore } from './registry.js';
import { findZipSpritesheet, readZipEntries, zipDirname } from './lib/zip.js';

export interface PetImportersDeps {
  customPetsRoot: string;
  registry: PetRegistryStore;
  ensureCustomPetsRoot(): Promise<void>;
  /** 按 id 查已安装宠物;重复 id 时抛 DuplicatePetIdError。 */
  findInstalledPetById(id: string): Promise<{ name: string; displayName: string } | undefined>;
  /** 目标 id 已存在时:选中已有宠物并返回 duplicate 结果。 */
  selectInstalledPet(pet: { name: string; displayName: string }): Promise<ImportPetResult>;
  /** 安装完成后:写入 selectedPet 并在可见时重开窗口。 */
  activateInstalledPet(name: string): Promise<void>;
}

export interface ImportPetResult {
  name: string;
  displayName: string;
  duplicate?: boolean;
}

export type PetImporters = ReturnType<typeof createPetImporters>;

export function createPetImporters(deps: PetImportersDeps) {
  const { customPetsRoot, registry } = deps;

  const rememberInstalledPet = async (args: {
    id: string;
    displayName: string;
    sourceType: PetRegistryEntry['sourceType'];
    sourceUrl?: string;
    sourcePath?: string;
    spritesheetPath: string;
  }) => registry.upsert({
    id: args.id,
    displayName: args.displayName,
    sourceType: args.sourceType,
    sourceUrl: args.sourceUrl,
    sourcePath: args.sourcePath,
    folderName: args.id,
    spritesheetPath: args.spritesheetPath,
  });

  const commitPetInstall = async (args: {
    id: string;
    displayName: string;
    pet: Record<string, unknown>;
    sprite: Buffer;
    spriteExt: string;
    sourceType: PetRegistryEntry['sourceType'];
    sourceUrl?: string;
    sourcePath?: string;
  }): Promise<ImportPetResult> => {
    const name = safePetName(args.id);
    const ext = args.spriteExt.toLowerCase() || '.webp';
    if (!['.webp', '.png', '.jpg', '.jpeg'].includes(ext)) throw new Error('Pet spritesheet must be a .webp/.png/.jpg image.');
    const duplicate = await deps.findInstalledPetById(name);
    if (duplicate) return deps.selectInstalledPet(duplicate);

    await deps.ensureCustomPetsRoot();
    const destDir = join(customPetsRoot, name);
    const tmpDir = join(customPetsRoot, `.${name}.tmp-${Date.now()}`);
    const spriteName = `spritesheet${ext}`;
    await rm(tmpDir, { recursive: true, force: true });
    await mkdir(tmpDir, { recursive: true });
    try {
      await writeFile(join(tmpDir, spriteName), args.sprite);
      await writeFile(join(tmpDir, 'pet.json'), JSON.stringify({ ...args.pet, id: name, displayName: args.displayName, spritesheetPath: spriteName }, null, 2), 'utf8');
      await rm(destDir, { recursive: true, force: true });
      await cp(tmpDir, destDir, { recursive: true });
      await rm(tmpDir, { recursive: true, force: true });
      await rememberInstalledPet({ id: name, displayName: args.displayName, sourceType: args.sourceType, sourceUrl: args.sourceUrl, sourcePath: args.sourcePath, spritesheetPath: spriteName });
      await deps.activateInstalledPet(name);
      return { name, displayName: args.displayName };
    } catch (err) {
      await rm(tmpDir, { recursive: true, force: true }).catch(() => undefined);
      throw err;
    }
  };

  const importPetImage = async (imagePath: string, requestedName?: string) => {
    const srcStat = await stat(imagePath);
    if (!srcStat.isFile()) throw new Error('imagePath must be a Petdex-compatible 8×9 spritesheet image file.');
    const ext = extname(imagePath).toLowerCase() || '.webp';
    if (!['.webp', '.png', '.jpg', '.jpeg'].includes(ext)) throw new Error('imagePath must be a .webp/.png/.jpg image.');
    const name = safePetName(requestedName ?? basename(imagePath, ext));
    const sprite = await readFile(imagePath);
    return commitPetInstall({ id: name, displayName: requestedName ?? name, pet: { id: name, displayName: requestedName ?? name }, sprite, spriteExt: ext, sourceType: 'local-image', sourcePath: imagePath });
  };

  const importPetZip = async (zipPath: string, requestedName?: string) => {
    const srcStat = await stat(zipPath);
    if (!srcStat.isFile()) throw new Error('zipPath must be a local .zip file.');

    const entries = readZipEntries(zipPath);
    const fallbackName = safePetName(requestedName ?? basename(zipPath, extname(zipPath)));
    const petEntry = entries.find((entry) => /(^|\/)pet\.json$/i.test(entry.path));
    const pet = petEntry
      ? JSON.parse(petEntry.data.toString('utf8')) as unknown
      : { id: fallbackName, displayName: fallbackName };
    if (!isRecord(pet)) throw new Error('pet.json inside zip must contain an object.');

    const baseDir = petEntry ? zipDirname(petEntry.path) : '';
    const spriteEntry = findZipSpritesheet(entries, pet, baseDir);
    if (!spriteEntry) throw new Error('Pet image is missing in zip. Expected spritesheet.webp/png or sprite.webp/png.');
    const ext = extname(spriteEntry.path).toLowerCase() || '.webp';
    if (!['.webp', '.png', '.jpg', '.jpeg'].includes(ext)) throw new Error('Zip spritesheet must be a .webp/.png/.jpg image.');

    const name = petIdOf(pet, safePetName(requestedName ?? pet.slug ?? pet.displayName ?? pet.name ?? fallbackName));
    const displayName = displayNameOf(pet, name);
    return commitPetInstall({ id: name, displayName, pet, sprite: spriteEntry.data, spriteExt: ext, sourceType: 'local-zip', sourcePath: zipPath });
  };

  const importPetFolder = async (sourceDir: string, requestedName?: string): Promise<ImportPetResult> => {
    const srcStat = await stat(sourceDir);
    if (!srcStat.isDirectory()) {
      if (extname(sourceDir).toLowerCase() === '.zip') return importPetZip(sourceDir, requestedName);
      return importPetImage(sourceDir, requestedName);
    }
    const pet = await readPetJson(sourceDir, safePetName(requestedName ?? basename(sourceDir)));
    const spritePath = await findSpritesheet(sourceDir, pet);
    const ext = extname(spritePath).toLowerCase() || '.webp';
    const name = petIdOf(pet, safePetName(requestedName ?? pet.slug ?? pet.displayName ?? pet.name ?? basename(sourceDir)));
    const displayName = displayNameOf(pet, name);
    const sprite = await readFile(spritePath);
    return commitPetInstall({ id: name, displayName, pet, sprite, spriteExt: ext, sourceType: 'local-folder', sourcePath: sourceDir });
  };

  const importPetdexUrl = async (sourceUrl: string, requestedName?: string) => {
    const slug = petdexSlugFromUrl(sourceUrl);
    if (!slug) throw new Error('Petdex URL must look like https://petdex.dev/pets/<slug>.');

    const pageRes = await fetch(sourceUrl);
    if (!pageRes.ok) throw new Error(`Petdex page request failed: ${pageRes.status}`);
    const html = await pageRes.text();

    const spriteUrl = firstMatch(html, [
      /"image"\s*:\s*"(https:\/\/assets\.petdex\.dev\/[^"]+?(?:sprite|spritesheet)\.(?:webp|png))"/,
      /"src"\s*:\s*"(https:\/\/assets\.petdex\.dev\/[^"]+?(?:sprite|spritesheet)\.(?:webp|png))"/,
      /(https:\/\/assets\.petdex\.dev\/[^"]+?(?:sprite|spritesheet)\.(?:webp|png))/,
    ]);
    if (!spriteUrl) throw new Error('Could not find Petdex sprite image URL on the page.');

    const petJsonUrl = new URL('pet.json', spriteUrl.endsWith('/') ? spriteUrl : spriteUrl.replace(/[^/]+$/, '')).toString();
    const petJsonRes = await fetch(petJsonUrl).catch(() => undefined);
    const remotePet = petJsonRes?.ok ? await petJsonRes.json().catch(() => undefined) : undefined;
    const remotePetRecord = isRecord(remotePet) ? remotePet : {};

    const remoteDisplayName = displayNameOf(remotePetRecord, '');
    const displayName = requestedName
      ?? (remoteDisplayName || undefined)
      ?? firstMatch(html, [/"name"\s*:\s*"([^"]+)"/, /<h1[^>]*>([^<]+)<\/h1>/])
      ?? slug;
    const description = typeof remotePetRecord.description === 'string'
      ? remotePetRecord.description
      : firstMatch(html, [/"description"\s*:\s*"([^"]+)"/]);
    const name = petIdOf(remotePetRecord, slug);
    const spriteRes = await fetch(spriteUrl);
    if (!spriteRes.ok) throw new Error(`Petdex spritesheet request failed: ${spriteRes.status}`);
    const sprite = Buffer.from(await spriteRes.arrayBuffer());
    const ext = extname(new URL(spriteUrl).pathname).toLowerCase() || '.webp';
    if (!['.webp', '.png'].includes(ext)) throw new Error('Petdex spritesheet must be .webp or .png.');
    const pet = { ...remotePetRecord, id: name, slug, displayName, description, sourceUrl };
    return commitPetInstall({ id: name, displayName, pet, sprite, spriteExt: ext, sourceType: 'petdex-url', sourceUrl });
  };

  const importRemotePetImage = async (imageUrl: string, requestedName?: string) => {
    const url = new URL(imageUrl);
    const ext = extname(url.pathname).toLowerCase() || '.webp';
    if (!['.webp', '.png'].includes(ext)) throw new Error('Remote Petdex spritesheet must be .webp or .png.');

    const fallbackName = safePetName(basename(url.pathname, ext));
    const name = safePetName(requestedName ?? fallbackName);
    const displayName = requestedName ?? name;
    const spriteRes = await fetch(imageUrl);
    if (!spriteRes.ok) throw new Error(`Remote spritesheet request failed: ${spriteRes.status}`);
    const sprite = Buffer.from(await spriteRes.arrayBuffer());
    return commitPetInstall({ id: name, displayName, pet: { id: name, displayName, sourceUrl: imageUrl }, sprite, spriteExt: ext, sourceType: 'remote-image', sourceUrl: imageUrl });
  };

  const importPetSource = async (source: string, requestedName?: string): Promise<ImportPetResult> => {
    const trimmed = source.trim();
    if (!trimmed) throw new Error('source is required.');
    if (isRemoteSpritesheetUrl(trimmed)) return importRemotePetImage(trimmed, requestedName);
    if (isHttpUrl(trimmed)) return importPetdexUrl(trimmed, requestedName);
    return importPetFolder(trimmed, requestedName);
  };

  return { importPetSource };
}
