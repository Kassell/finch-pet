import type { PetFolder } from './types.js';

export class NoAvailablePetError extends Error {
  constructor() { super('no pets available'); }
}

export class DuplicatePetIdError extends Error {
  constructor(readonly id: string, readonly folders: PetFolder[]) {
    super(`检测到重复的 pet id：${id}。请先移除其中一个目录，才能选择或导入这个宠物。`);
  }
}
