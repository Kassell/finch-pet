/**
 * pet — desktop pet extension host(组合根)。
 *
 * 职责:canvas 窗口生命周期与位置持久化、composer action、工具注册、事件接线。
 * 领域逻辑分布在:
 * - pet-library.ts  宠物目录列举/解析/PetRecord 组装/宠物包加载
 * - importers.ts    五种导入渠道 + 原子安装
 * - runtime-status.ts 会话运行时状态机(Agent 事件 → 宠物状态/气泡)
 * - canvas/         Canvas 段源码(构建产物为根目录 pet-canvas.js)
 */
import { spawn } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { rm } from 'node:fs/promises';
import { join } from 'node:path';
import type * as finch from 'finch';
import { isCanvasToHostMessage, PET_STATES, parsePetState, type HostToCanvasMessage } from './protocol.js';
import type { WindowPosition } from './types.js';
import { safePetName } from './utils.js';
import { exists } from './pet-package.js';
import { PetRegistryStore } from './registry.js';
import { DuplicatePetIdError, NoAvailablePetError } from './errors.js';
import { createPetLibrary } from './pet-library.js';
import { createPetImporters, type ImportPetResult } from './importers.js';
import { createPetRuntimeStatus } from './runtime-status.js';
import { createPetManagementIpcServer, type PetManagementHandlers, type PetManagementResult } from './management-ipc.js';

interface McpClientCapability {
  registerServer(input: {
    name: string;
    command: string;
    args: string[];
    cwd: string;
    description?: string;
    ownerExtensionId?: string;
    ownerExtensionName?: string;
  }): Promise<{ ok: boolean; error?: string }>;
  unregisterServer(name: string): Promise<{ ok: boolean }>;
}

function readIconSvg(name: string): string {
  return readFileSync(new URL(`../icons/${name}.svg`, import.meta.url), 'utf-8');
}

export function registerPetExtension(ctx: finch.ExtensionContext) {
  ctx.subscriptions.push(
    ctx.icons.register('finch-pet', {
      action: { svg: readIconSvg('action'), description: 'Desktop pet action' },
    }),
  );

  const canvasWidth = 480;
  const compactCanvasHeight = 184;
  const expandedCanvasHeight = 260;
  const rightAlignedPetCenterX = 240;
  const legacyCanvasWidth = 240;
  let petWindow: finch.CanvasWindow | undefined;
  // 窗口尺寸固定为展开画布，气泡布局切换全部在画布内完成，避免透明窗口
  // setBounds 与重画不同步导致的闪帧。持久化位置仍按 compact 基准存储以兼容旧数据。
  let canvasHeight = expandedCanvasHeight;
  let petCenterX = rightAlignedPetCenterX;
  let windowPosition: WindowPosition | undefined;
  let positionSaveTimer: ReturnType<typeof setTimeout> | undefined;

  const openSession = async (sessionId: string) => {
    const uri = `finch://open?id=${encodeURIComponent(sessionId)}`;
    const command = process.platform === 'darwin' ? '/usr/bin/open' : process.platform === 'win32' ? 'cmd.exe' : 'xdg-open';
    const args = process.platform === 'darwin' ? [uri] : process.platform === 'win32' ? ['/d', '/s', '/c', 'start', '', uri] : [uri];
    await new Promise<void>((resolve, reject) => {
      const child = spawn(command, args, { detached: true, stdio: 'ignore', windowsHide: true });
      child.once('error', reject);
      child.once('spawn', () => { child.unref(); resolve(); });
    });
  };

  const customPetsRoot = join(ctx.storagePath, 'pets');
  const builtinPetsRoot = join(ctx.extension.extensionPath, 'pets');
  const registry = new PetRegistryStore(ctx.storagePath);

  const library = createPetLibrary({ ctx, builtinPetsRoot, customPetsRoot, registry });

  const isVisibleOnStartup = async () => await ctx.storage.get<boolean>('window.visible') !== false;
  const setVisiblePreference = async (visible: boolean) => { await ctx.storage.set('window.visible', visible); };

  const runtime = createPetRuntimeStatus(ctx, {
    hasWindow: () => !!petWindow,
    post: async (message) => { if (petWindow) await petWindow.postMessage(message); },
  });

  const clearPositionSaveTimer = () => {
    if (!positionSaveTimer) return;
    clearTimeout(positionSaveTimer);
    positionSaveTimer = undefined;
  };

  const schedulePositionSave = () => {
    clearPositionSaveTimer();
    positionSaveTimer = setTimeout(() => {
      positionSaveTimer = undefined;
      if (!windowPosition) return;
      void ctx.storage.set('window.position', {
        x: windowPosition.x + petCenterX - rightAlignedPetCenterX,
        y: windowPosition.y + canvasHeight - compactCanvasHeight,
      });
    }, 50);
  };

  const close = () => {
    runtime.resetForClose();
    clearPositionSaveTimer();
    petWindow?.dispose();
    petWindow = undefined;
  };

  const open = async () => {
    if (petWindow) { petWindow.show(); return petWindow; }
    const saved = await ctx.storage.get<WindowPosition>('window.position');
    const savedCanvasWidth = await ctx.storage.get<number>('window.canvasWidth');
    const previousCanvasWidth = typeof savedCanvasWidth === 'number' ? savedCanvasWidth : legacyCanvasWidth;
    const previousPetCenterX = previousCanvasWidth <= legacyCanvasWidth ? previousCanvasWidth - 120 : rightAlignedPetCenterX;
    const migratedX = typeof saved?.x === 'number' ? saved.x + previousPetCenterX - rightAlignedPetCenterX : undefined;
    const { name, kind, pet, spriteDataUrl } = await library.loadPetPackage();

    canvasHeight = expandedCanvasHeight;
    petCenterX = rightAlignedPetCenterX;
    const migratedY = typeof saved?.y === 'number' ? saved.y - (expandedCanvasHeight - compactCanvasHeight) : undefined;
    windowPosition = typeof migratedX === 'number' && typeof migratedY === 'number'
      ? { x: migratedX, y: migratedY }
      : undefined;
    petWindow = ctx.ui.createCanvasWindow({
      entry: 'pet-canvas.js',
      width: canvasWidth,
      height: expandedCanvasHeight,
      x: migratedX,
      y: migratedY,
      alwaysOnTop: true,
      transparent: true,
      clickThrough: true,
      // 头顶气泡预留区是透明的，需要允许窗口顶越过菜单栏，宠物本体才能贴到屏幕顶。
      allowOffscreen: true,
      // 桌宠是覆盖层而非普通窗口：不进 Mission Control，切换 Space 时跟随。
      hiddenInMissionControl: true,
      visibleOnAllWorkspaces: true,
      initialData: {
        petName: name,
        petKind: kind,
        pet,
        spriteDataUrl,
        defaultState: 'idle',
        initialClickThrough: true,
        message: '',
        layout: { expandedHeight: expandedCanvasHeight, petCenterX: rightAlignedPetCenterX },
      },
    });
    petWindow.onDidReceiveMessage((msg) => {
      if (!isCanvasToHostMessage(msg)) return;
      const event = msg;
      if ((event?.type === 'bubbleAction' || event?.type === 'openBubbleSession') && event.sessionId) {
        runtime.dismissSessionBubble(event.sessionId);
      }
      if ((event?.type === 'openBubbleSession' || (event?.type === 'bubbleAction' && event.action === 'open-session')) && event.sessionId) {
        void openSession(event.sessionId).catch((err: unknown) => ctx.logger.warn('open pet session failed', err instanceof Error ? err.message : String(err)));
      }
      if (event?.type === 'poke') ctx.logger.info('pet was poked', event.state ?? 'unknown');
      if (event?.type === 'hitTest') ctx.logger.info('pet hit test', event.clickThrough === true ? 'passthrough' : 'interactive');
      if (event?.type === 'debugDomPointer') ctx.logger.info('pet dom pointer', event.event ?? 'unknown');
      if (event?.type === 'exitPet') {
        void setVisiblePreference(false);
        close();
      }
    });
    await ctx.storage.set('window.canvasWidth', canvasWidth);
    petWindow.onDidMove((pos) => {
      windowPosition = pos;
      schedulePositionSave();
    });
    petWindow.onDidResize((size) => {
      canvasHeight = size.height;
      schedulePositionSave();
    });
    petWindow.onDidDispose(() => {
      clearPositionSaveTimer();
      petWindow = undefined;
      windowPosition = undefined;
      canvasHeight = expandedCanvasHeight;
      petCenterX = rightAlignedPetCenterX;
      runtime.resetForWindowDisposed();
    });
    runtime.prepareForWindowOpen();
    void ctx.status.get().then(runtime.applyRuntimeStatus).catch((err: unknown) => ctx.logger.warn('sync pet runtime status failed', err instanceof Error ? err.message : String(err)));
    return petWindow;
  };

  const reopenIfVisible = async () => { if (petWindow) { close(); await open(); } };
  const showPet = async () => { await setVisiblePreference(true); return open(); };
  const postToPet = async (message: HostToCanvasMessage) => { const win = await showPet(); await win.postMessage(message); };

  const selectInstalledPet = async (pet: { name: string; displayName: string }): Promise<ImportPetResult> => {
    await ctx.storage.set('selectedPet', pet.name);
    await reopenIfVisible();
    return { name: pet.name, displayName: pet.displayName, duplicate: true };
  };

  const importers = createPetImporters({
    customPetsRoot,
    registry,
    ensureCustomPetsRoot: library.ensureCustomPetsRoot,
    findInstalledPetById: library.findInstalledPetById,
    selectInstalledPet,
    activateInstalledPet: async (name) => {
      await ctx.storage.set('selectedPet', name);
      await reopenIfVisible();
    },
  });

  const noAvailablePetMessage = () => ctx.i18n.t('pet.noAvailable');

  const managementHandlers: PetManagementHandlers = {
    async pet_list() {
      const pets = await library.listPets();
      if (!pets.length) return { isError: true, content: [{ type: 'text', text: noAvailablePetMessage() }] };
      const text = pets.map((pet) => {
        const kind = pet.kind === 'builtin' ? '内置' : '自定义';
        const status = pet.health === 'ok' ? '' : `，${pet.health}`;
        const source = `，来源:${pet.sourceType}`;
        const warning = pet.warning ? `，${pet.warning}` : '';
        return `- ${pet.name} (${pet.displayName}) — ${kind}${source}${status}${pet.selected ? '，当前' : ''}${warning}`;
      }).join('\n');
      const content: PetManagementResult['content'] = [{ type: 'text', text }];
      for (const pet of pets) {
        if (!pet.preview) continue;
        content.push(
          { type: 'text', text: `${pet.selected ? '当前：' : ''}${pet.displayName} (${pet.name}) 的 idle 首帧预览` },
          { type: 'image', data: pet.preview.data, mimeType: pet.preview.mimeType },
        );
      }
      return { content };
    },
    async pet_select(params) {
      const fallbackPet = await library.getFallbackPetName();
      const name = safePetName(params.name, fallbackPet ?? 'pet');
      const folders = await library.getPetFoldersById(name);
      const available = await library.listAvailablePetFolders();
      const availableMatch = available.find((pet) => pet.name === name);
      if (folders.length > 1 && !availableMatch) {
        if (fallbackPet) { await ctx.storage.set('selectedPet', fallbackPet); await reopenIfVisible(); }
        return { isError: true, content: [{ type: 'text', text: library.duplicatePetMessage(name, folders) }] };
      }
      if (!availableMatch) return { isError: true, content: [{ type: 'text', text: `not found: ${name}` }] };
      await ctx.storage.set('selectedPet', name);
      await reopenIfVisible();
      return { content: [{ type: 'text', text: `selected: ${name}` }] };
    },
    async pet_add(params) {
      const source = typeof params.source === 'string' ? params.source : typeof params.imagePath === 'string' ? params.imagePath : '';
      if (!source.trim()) return { isError: true, content: [{ type: 'text', text: 'source required' }] };
      let imported: ImportPetResult;
      try {
        imported = await importers.importPetSource(source, typeof params.name === 'string' ? params.name : undefined);
      } catch (err) {
        if (err instanceof DuplicatePetIdError) return { isError: true, content: [{ type: 'text', text: library.duplicatePetMessage(err.id, err.folders) }] };
        throw err;
      }
      const text = imported.duplicate === true
        ? `selected existing: ${imported.name} (${imported.displayName})`
        : `added: ${imported.name} (${imported.displayName})`;
      return { content: [{ type: 'text', text }] };
    },
    async pet_remove(params) {
      const fallbackPet = await library.getFallbackPetName();
      const name = safePetName(params.name, fallbackPet ?? 'pet');
      const pet = (await library.listPets()).find((item) => item.name === name);
      if (pet?.kind === 'builtin') return { isError: true, content: [{ type: 'text', text: `builtin pet cannot be removed: ${name}` }] };
      const dir = join(customPetsRoot, name);
      if (!await exists(dir)) return { isError: true, content: [{ type: 'text', text: `not found: ${name}` }] };
      const wasSelected = await library.getSelectedPetName() === name;
      await rm(dir, { recursive: true, force: true });
      await registry.remove(name);
      if (wasSelected) {
        const nextPet = await library.getFallbackPetName();
        await ctx.storage.set('selectedPet', nextPet ?? '');
        if (nextPet) await reopenIfVisible();
        else { await setVisiblePreference(false); close(); }
      }
      return { content: [{ type: 'text', text: `removed: ${name}` }] };
    },
  };

  const managementIpc = createPetManagementIpcServer(managementHandlers, ctx.logger);
  void managementIpc.start().catch((err: unknown) => {
    ctx.logger.warn('start pet management IPC failed', err instanceof Error ? err.message : String(err));
  });

  if (ctx.capabilities.has('mcp.client')) {
    const mcp = ctx.capabilities.get<McpClientCapability>('mcp.client');
    const serverName = 'finch-pet';
    void mcp.registerServer({
      name: serverName,
      command: process.execPath,
      args: [join(ctx.extension.extensionPath, 'dist', 'mcp-server.js')],
      cwd: ctx.extension.extensionPath,
      description: 'Manage the local Finch Pet library. Tools are discovered lazily through MCP.',
      ownerExtensionId: ctx.extension.id,
      ownerExtensionName: ctx.extension.displayName,
    }).then((result) => {
      if (!result.ok) ctx.logger.warn('register pet MCP server failed', result.error ?? 'unknown error');
    }).catch((err: unknown) => {
      ctx.logger.warn('register pet MCP server failed', err instanceof Error ? err.message : String(err));
    });
    ctx.subscriptions.push({
      dispose: () => { void mcp.unregisterServer(serverName); },
    });
  }

  const petToggleAction = ctx.composerActions.register('pet-toggle', {
    async onClick() {
      if (petWindow) {
        await setVisiblePreference(false);
        close();
        return;
      }
      await showPet();
    },
  });

  ctx.subscriptions.push(
    petToggleAction,
    managementIpc,
    ctx.tools.register({
      name: 'pet_control', title: 'Control desktop pet',
      description: 'Control the active desktop pet. Show or hide it, play an animation state, or display a short speech bubble.',
      inputSchema: {
        type: 'object',
        properties: {
          action: { type: 'string', enum: ['show', 'hide', 'set_state', 'say'], description: 'Pet action to perform.' },
          state: { type: 'string', enum: PET_STATES, description: `Required for set_state. One of: ${PET_STATES.join(', ')}.` },
          playMode: { type: 'string', enum: ['once', 'loop'], description: 'Animation playback mode for set_state.' },
          message: { type: 'string', description: 'Speech bubble text for say, or optional text for set_state.' },
        },
        required: ['action'],
      },
      risk: 'low',
      async execute(input) {
        const args = input as { action?: unknown; state?: unknown; playMode?: unknown; message?: unknown };
        if (args.action === 'hide') {
          await setVisiblePreference(false);
          close();
          return { content: [{ type: 'text', text: 'hidden' }] };
        }
        if (args.action === 'say') {
          const message = typeof args.message === 'string' ? args.message.trim() : '';
          if (!message) return { isError: true, content: [{ type: 'text', text: 'message required for say' }] };
          await postToPet({ type: 'say', message, transientMs: 2600 });
          return { content: [{ type: 'text', text: 'message sent' }] };
        }
        if (args.action === 'set_state') {
          const state = parsePetState(args.state);
          if (!state) return { isError: true, content: [{ type: 'text', text: `invalid state: ${PET_STATES.join(', ')}` }] };
          const playMode = args.playMode === 'loop' ? 'loop' : 'once';
          await postToPet({ type: 'setState', state, playMode, message: typeof args.message === 'string' ? args.message : undefined, transientMs: state === 'idle' || playMode === 'once' ? 0 : 2400 });
          return { content: [{ type: 'text', text: `state: ${state}` }] };
        }
        if (args.action !== 'show') return { isError: true, content: [{ type: 'text', text: 'invalid action' }] };
        try {
          await showPet();
          return { content: [{ type: 'text', text: `shown: ${await library.getSelectedPetName()}` }] };
        } catch (err) {
          if (err instanceof NoAvailablePetError) return { isError: true, content: [{ type: 'text', text: noAvailablePetMessage() }] };
          throw err;
        }
      },
    }),
    ctx.events.onAgentEvent((event) => {
      void runtime.handleAgentEvent(event).catch((err: unknown) => ctx.logger.warn('handle pet agent event failed', err instanceof Error ? err.message : String(err)));
    }),
    ctx.status.onDidChange((status) => {
      void runtime.applyRuntimeStatus(status).catch((err: unknown) => ctx.logger.warn('apply pet runtime status failed', err instanceof Error ? err.message : String(err)));
    }),
    ctx.notifications.onDidPost((event) => {
      void runtime.handleNotification(event).catch((err: unknown) => ctx.logger.warn('handle pet notification failed', err instanceof Error ? err.message : String(err)));
    }),
    ctx.i18n.onDidChangeLocale((locale) => {
      void runtime.refreshRuntimeLocale(locale).catch((err: unknown) => ctx.logger.warn('refresh pet locale failed', err instanceof Error ? err.message : String(err)));
    }),
    { dispose: close },
  );

  void isVisibleOnStartup().then((visible) => {
    if (visible) void open();
  }).catch((err) => {
    ctx.logger.warn('auto show pet failed', err instanceof Error ? err.message : String(err));
  });
}
