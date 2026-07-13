import type * as finch from 'finch';
import { registerPetExtension } from './pet-extension.js';

export function activate(ctx: finch.MiniToolContext) {
  registerPetExtension(ctx);
}

export function deactivate() {}
