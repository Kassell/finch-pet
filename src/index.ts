import type * as finch from 'finch';
import { registerPetExtension } from './host/platform/finch/pet-extension.js';

export function activate(ctx: finch.MiniToolContext) {
  registerPetExtension(ctx);
}

export function deactivate() {}
