export interface CatalogRemovalState {
  installedPetNames: Set<string>;
  removablePetNames: Set<string>;
  pendingRemovalNames: Set<string>;
}

/** 乐观移除画廊状态；同一宠物删除期间拒绝重复操作。 */
export function beginCatalogRemoval(state: CatalogRemovalState, slug: string): boolean {
  if (!state.removablePetNames.has(slug) || state.pendingRemovalNames.has(slug)) return false;
  state.pendingRemovalNames.add(slug);
  state.installedPetNames.delete(slug);
  state.removablePetNames.delete(slug);
  return true;
}

export function finishCatalogRemoval(state: CatalogRemovalState, slug: string): void {
  state.pendingRemovalNames.delete(slug);
}

export function rollbackCatalogRemoval(state: CatalogRemovalState, slug: string): void {
  state.installedPetNames.add(slug);
  state.removablePetNames.add(slug);
  state.pendingRemovalNames.delete(slug);
}
