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
import { readFile, rm } from 'node:fs/promises';
import { join } from 'node:path';
import type * as finch from 'finch';
import { isCanvasToHostMessage, PET_STATES, parsePetState, type CanvasStrings, type HostToCanvasMessage } from './protocol.js';
import type { WindowPosition } from './types.js';
import { safePetName } from './utils.js';
import { exists } from './pet-package.js';
import { PetRegistryStore } from './registry.js';
import { DuplicatePetIdError, NoAvailablePetError } from './errors.js';
import { createPetLibrary } from './pet-library.js';
import { createPetImporters, type ImportPetResult } from './importers.js';
import { createPetRuntimeStatus } from './runtime-status.js';
import { createPetManagementIpcServer, type PetManagementHandlers } from './management-ipc.js';

interface McpClientCapability {
  registerServer(input: {
    name: string;
    command: string;
    args: string[];
    cwd: string;
    description?: string;
    env?: Record<string, string>;
    ownerExtensionId?: string;
    ownerExtensionName?: string;
  }): Promise<{ ok: boolean; error?: string }>;
  unregisterServer(name: string): Promise<{ ok: boolean }>;
}

function readIconSvg(name: string): string {
  return readFileSync(new URL(`../icons/${name}.svg`, import.meta.url), 'utf-8');
}

function isVersionAtLeast(version: string, minimum: readonly [number, number, number]): boolean {
  const matched = /^(\d+)\.(\d+)\.(\d+)/.exec(version.trim());
  if (!matched) return false;
  const current = matched.slice(1, 4).map(Number);
  for (let index = 0; index < minimum.length; index += 1) {
    if (current[index] > minimum[index]) return true;
    if (current[index] < minimum[index]) return false;
  }
  return true;
}

export function registerPetExtension(ctx: finch.MiniToolContext) {
  const canvasStrings = (): CanvasStrings => ({
    menuPlayGame: ctx.i18n.t('canvas.menu.playGame'),
    menuClosePet: ctx.i18n.t('canvas.menu.closePet'),
    gameHeader: ctx.i18n.t('canvas.game.header'),
    gameTitle: ctx.i18n.t('canvas.game.title'),
    gameStartHint: ctx.i18n.t('canvas.game.startHint'),
    gameBest: ctx.i18n.t('canvas.game.best'),
    gameOver: ctx.i18n.t('canvas.game.over'),
    gameResult: ctx.i18n.t('canvas.game.result'),
    gameRestartHint: ctx.i18n.t('canvas.game.restartHint'),
    gameSoundOn: ctx.i18n.t('canvas.game.soundOn'),
    gameSoundOff: ctx.i18n.t('canvas.game.soundOff'),
    loadingPet: ctx.i18n.t('canvas.pet.loading'),
    spriteLoadFailed: ctx.i18n.t('canvas.pet.spriteLoadFailed'),
  });
  ctx.subscriptions.push(
    ctx.icons.register('finch-pet', {
      action: { svg: readIconSvg('action'), description: 'Desktop pet action' },
    }),
  );

  const canvasWidth = 480;
  const compactCanvasHeight = 184;
  const expandedCanvasHeight = 260;
  const gameCanvasWidth = 360;
  /** 56px 独立状态栏 + 360×640 的 9:16 游戏内容区。 */
  const gameCanvasHeight = 696;
  const rightAlignedPetCenterX = 240;
  const legacyCanvasWidth = 240;
  let petWindow: finch.CanvasWindow | undefined;
  let petToggleAction: (finch.Disposable & { notifyUpdate(): void }) | undefined;
  let settingsMenu: (finch.Disposable & { notifyUpdate(): void }) | undefined;
  let gameActive = false;
  let gameTransitioning = false;
  let transitionGeneration = 0;
  let preGamePosition: WindowPosition | undefined;
  let gameWindowPosition: WindowPosition | undefined;
  // 窗口尺寸固定为展开画布，气泡布局切换全部在画布内完成，避免透明窗口
  // setBounds 与重画不同步导致的闪帧。持久化位置仍按 compact 基准存储以兼容旧数据。
  let canvasHeight = expandedCanvasHeight;
  let petCenterX = rightAlignedPetCenterX;
  let windowPosition: WindowPosition | undefined;
  let positionSaveTimer: ReturnType<typeof setTimeout> | undefined;
  const supportsDesktopSpaces = typeof ctx.app?.getInfo === 'function'
    ? ctx.app.getInfo()
        .then((info) => isVersionAtLeast(info.version, [1, 5, 1]))
        .catch((err: unknown) => {
          ctx.logger.warn('read Finch version failed; desktop Space integration disabled', err instanceof Error ? err.message : String(err));
          return false;
        })
    : Promise.resolve(false);

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
  const originalSoundNames = ['die', 'hit', 'point', 'swoosh', 'wing'] as const;
  let originalSoundUrls: Partial<Record<typeof originalSoundNames[number], string>> | undefined;
  const loadOriginalSoundUrls = async () => {
    if (originalSoundUrls) return originalSoundUrls;
    originalSoundUrls = {};
    await Promise.all(originalSoundNames.map(async (name) => {
      const bytes = await readFile(join(ctx.minitool.extensionPath, 'public', 'assets', 'flappy-bird', 'audio', `${name}.ogg`));
      originalSoundUrls![name] = `data:audio/ogg;base64,${bytes.toString('base64')}`;
    }));
    return originalSoundUrls;
  };
  const builtinPetsRoot = join(ctx.minitool.extensionPath, 'pets');
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
    transitionGeneration += 1;
    gameTransitioning = false;
    gameActive = false;
    preGamePosition = undefined;
    gameWindowPosition = undefined;
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
    const [{ name, kind, pet, spriteDataUrl }, enableDesktopSpaces] = await Promise.all([
      library.loadPetPackage(),
      supportsDesktopSpaces,
    ]);

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
      alwaysOnTopLevel: 'floating',
      transparent: true,
      clickThrough: true,
      // 头顶气泡预留区是透明的，需要允许窗口顶越过菜单栏，宠物本体才能贴到屏幕顶。
      allowOffscreen: true,
      // Finch 1.5.1 起支持桌宠不进入 Mission Control，并跟随所有桌面 Space。
      // 旧版不传这两个字段，避免依赖尚未实现的 CanvasWindow API。
      ...(enableDesktopSpaces ? {
        hiddenInMissionControl: true,
        visibleOnAllWorkspaces: true,
      } : {}),
      initialData: {
        petName: name,
        petKind: kind,
        pet,
        spriteDataUrl,
        defaultState: 'idle',
        initialClickThrough: true,
        message: '',
        strings: canvasStrings(),
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
        void openSession(event.sessionId)
          .then(() => setTimeout(() => {
            void ctx.status.get().then(runtime.applyRuntimeStatus).catch((err: unknown) => ctx.logger.warn('sync pet runtime status after opening session failed', err instanceof Error ? err.message : String(err)));
          }, 300))
          .catch((err: unknown) => ctx.logger.warn('open pet session failed', err instanceof Error ? err.message : String(err)));
      }
      if (event?.type === 'enterGame') {
        void enterGame(
          { x: event.originalX, y: event.originalY },
          { x: event.centeredX, y: event.centeredY },
        );
      } else if (event?.type === 'exitGame') {
        void exitGame({ x: event.x, y: event.y });
      } else if (event?.type === 'exitPet') {
        void setVisiblePreference(false);
        close();
      }
    });
    await ctx.storage.set('window.canvasWidth', canvasWidth);
    petWindow.onDidMove((pos) => {
      if (gameActive || gameTransitioning) {
        gameWindowPosition = pos;
        return;
      }
      windowPosition = pos;
      schedulePositionSave();
    });
    petWindow.onDidResize((size) => {
      if (gameActive || gameTransitioning) return;
      canvasHeight = size.height;
      schedulePositionSave();
    });
    petWindow.onDidDispose(() => {
      clearPositionSaveTimer();
      petWindow = undefined;
      transitionGeneration += 1;
      gameTransitioning = false;
      gameActive = false;
      preGamePosition = undefined;
      gameWindowPosition = undefined;
      windowPosition = undefined;
      canvasHeight = expandedCanvasHeight;
      petCenterX = rightAlignedPetCenterX;
      runtime.resetForWindowDisposed();
    });
    runtime.prepareForWindowOpen();
    void ctx.status.get().then(runtime.applyRuntimeStatus).catch((err: unknown) => ctx.logger.warn('sync pet runtime status failed', err instanceof Error ? err.message : String(err)));
    return petWindow;
  };

  const waitForTransition = async (durationMs: number) => {
    const win = petWindow;
    if (!win) return false;
    const generation = ++transitionGeneration;
    await new Promise<void>((resolve) => setTimeout(resolve, durationMs));
    return !!petWindow && petWindow === win && generation === transitionGeneration;
  };

  const runVisualTransition = async (input: {
    fromOpacity: number;
    toOpacity: number;
    fromScale: number;
    toScale: number;
    durationMs: number;
  }) => {
    if (!petWindow) return false;
    await petWindow.postMessage({ type: 'visualTransition', ...input });
    return waitForTransition(input.durationMs);
  };

  const enterGame = async (originalPosition: WindowPosition, centeredPosition: WindowPosition) => {
    if (!petWindow || gameActive || gameTransitioning) return;
    preGamePosition = { ...originalPosition };
    gameWindowPosition = { ...originalPosition };
    gameTransitioning = true;
    petWindow.setClickThrough(false);
    const petHidden = await runVisualTransition({
      fromOpacity: 1,
      toOpacity: 0,
      fromScale: 1,
      toScale: 1,
      durationMs: 150,
    });
    if (!petHidden || !petWindow) {
      gameTransitioning = false;
      return;
    }
    gameActive = true;
    // 同一个 CanvasWindow 在游戏态降低到 macOS normal 层级。
    petWindow.setAlwaysOnTop(true, 'normal');
    petWindow.setSize(gameCanvasWidth, gameCanvasHeight);
    petWindow.setPosition(centeredPosition.x, centeredPosition.y);
    let soundUrls: Awaited<ReturnType<typeof loadOriginalSoundUrls>> = {};
    try {
      soundUrls = await loadOriginalSoundUrls();
    } catch (err) {
      ctx.logger.warn('load bundled Flappy Bird audio failed', err instanceof Error ? err.message : String(err));
    }
    await petWindow.postMessage({ type: 'gameMode', active: true, soundUrls });
    const completed = await runVisualTransition({
      fromOpacity: 0,
      toOpacity: 1,
      fromScale: 0.88,
      toScale: 1,
      durationMs: 210,
    });
    if (completed) gameWindowPosition = { ...centeredPosition };
    gameTransitioning = false;
    petToggleAction?.notifyUpdate();
    settingsMenu?.notifyUpdate();
  };

  const exitGame = async (currentPosition?: WindowPosition) => {
    if (!petWindow || !gameActive || gameTransitioning || !preGamePosition) return;
    gameTransitioning = true;
    gameWindowPosition = currentPosition || gameWindowPosition;
    const destination = preGamePosition;
    const gameHidden = await runVisualTransition({
      fromOpacity: 1,
      toOpacity: 0,
      fromScale: 1,
      toScale: 0.82,
      durationMs: 160,
    });
    if (!gameHidden || !petWindow) {
      gameTransitioning = false;
      return;
    }
    petWindow.setSize(canvasWidth, expandedCanvasHeight);
    petWindow.setPosition(destination.x, destination.y);
    // 回到桌宠态时恢复 macOS floating 层级。
    petWindow.setAlwaysOnTop(true, 'floating');
    gameActive = false;
    windowPosition = { ...destination };
    preGamePosition = undefined;
    gameWindowPosition = undefined;
    canvasHeight = expandedCanvasHeight;
    await petWindow.postMessage({ type: 'gameMode', active: false });
    await runVisualTransition({
      fromOpacity: 0,
      toOpacity: 1,
      fromScale: 1,
      toScale: 1,
      durationMs: 190,
    });
    gameTransitioning = false;
    petToggleAction?.notifyUpdate();
    settingsMenu?.notifyUpdate();
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
      // MCP 图片内容只接受 JPEG / PNG / GIF / WebP。当前预览是裁切 spritesheet 的
      // SVG data URL，直接返回会让部分模型拒绝整个工具结果，因此宠物列表只返回文字。
      return { content: [{ type: 'text' as const, text }] };
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

  const serverName = 'finch-pet';
  let mcpRegistrationTimer: ReturnType<typeof setTimeout> | undefined;
  let registeredMcp: McpClientCapability | undefined;
  let mcpRegistrationDisposed = false;

  const registerMcpWhenAvailable = async () => {
    if (mcpRegistrationDisposed || registeredMcp) return;
    if (!ctx.capabilities.has('mcp.client')) {
      mcpRegistrationTimer = setTimeout(() => { void registerMcpWhenAvailable(); }, 250);
      return;
    }
    const mcp = ctx.capabilities.get<McpClientCapability>('mcp.client');
    try {
      const result = await mcp.registerServer({
        name: serverName,
        command: process.execPath,
        args: [join(ctx.minitool.extensionPath, 'dist', 'mcp-server.js')],
        cwd: ctx.minitool.extensionPath,
        description: 'Manage the local Finch Pet library. Tools are discovered lazily through MCP.',
        env: { ELECTRON_RUN_AS_NODE: '1' },
        ownerExtensionId: ctx.minitool.id,
        ownerExtensionName: ctx.minitool.displayName,
      });
      if (!result.ok) {
        ctx.logger.warn('register pet MCP server failed', result.error ?? 'unknown error');
        mcpRegistrationTimer = setTimeout(() => { void registerMcpWhenAvailable(); }, 1000);
        return;
      }
      registeredMcp = mcp;
    } catch (err) {
      ctx.logger.warn('register pet MCP server failed', err instanceof Error ? err.message : String(err));
      mcpRegistrationTimer = setTimeout(() => { void registerMcpWhenAvailable(); }, 1000);
    }
  };

  void registerMcpWhenAvailable();
  ctx.subscriptions.push({
    dispose: () => {
      mcpRegistrationDisposed = true;
      if (mcpRegistrationTimer) clearTimeout(mcpRegistrationTimer);
      if (registeredMcp) void registeredMcp.unregisterServer(serverName);
    },
  });

  const showNoPetToast = async (actions: finch.ComposerActionActions) => {
    const result = await ctx.ui.showToast({
      title: ctx.i18n.t('composerActions.pet-toggle.noPetTitle'),
      description: ctx.i18n.t('composerActions.pet-toggle.noPetDescription'),
      variant: 'warning',
      action: { label: ctx.i18n.t('composerActions.pet-toggle.install') },
    });
    if (result.action === 'action') await actions.composer.fill(ctx.i18n.t('composerActions.pet-toggle.installPrompt'));
  };

  petToggleAction = ctx.composerActions.register('pet-toggle', {
    async getBadge() {
      return { text: 'Finch Pet', active: !!petWindow };
    },
    async getMenu() {
      const pets = await library.listPets();
      const selectablePets = pets.filter((pet) => pet.health !== 'missing' && pet.health !== 'invalid');
      const petChildren: finch.ComposerActionMenuItem[] = selectablePets.length
        ? selectablePets.map((pet) => ({
            id: `select:${pet.name}`,
            label: pet.displayName,
            description: ctx.i18n.t(`composerActions.pet-toggle.${pet.kind}`),
            current: pet.selected,
            disabled: pet.health !== 'ok' && pet.health !== 'external',
          }))
        : [{ id: 'select:none', label: ctx.i18n.t('composerActions.pet-toggle.noPets'), disabled: true }];

      return [
        {
          id: petWindow ? 'visibility:hide' : 'visibility:show',
          label: ctx.i18n.t(`composerActions.pet-toggle.${petWindow ? 'hidePet' : 'showPet'}`),
          iconName: petWindow ? 'toggle-right' : 'toggle-left',
        },
        {
          id: 'select-pet',
          label: ctx.i18n.t('composerActions.pet-toggle.selectPet'),
          iconName: 'list',
          children: petChildren,
        },
        {
          id: 'interact',
          label: ctx.i18n.t('composerActions.pet-toggle.interact'),
          iconName: 'sparkles',
          children: [
            { id: 'interact:waving', label: ctx.i18n.t('composerActions.pet-toggle.wave') },
            { id: 'interact:jumping', label: ctx.i18n.t('composerActions.pet-toggle.jump') },
          ],
        },
        {
          id: 'install',
          label: ctx.i18n.t('composerActions.pet-toggle.addPet'),
          iconName: 'plus',
          separator: true,
        },
      ];
    },
    async execute(_context, itemId, actions) {
      if (itemId === 'visibility:hide') {
        await setVisiblePreference(false);
        close();
      } else if (itemId === 'visibility:show') {
        try {
          await showPet();
        } catch (err) {
          if (!(err instanceof NoAvailablePetError)) throw err;
          await showNoPetToast(actions);
        }
      } else if (itemId.startsWith('select:') && itemId !== 'select:none') {
        const name = itemId.slice('select:'.length);
        const pet = (await library.listPets()).find((item) => item.name === name && item.health !== 'missing' && item.health !== 'invalid');
        if (!pet) throw new Error(`pet is unavailable: ${name}`);
        await selectInstalledPet(pet);
      } else if (itemId === 'interact:waving' || itemId === 'interact:jumping') {
        const state = itemId === 'interact:waving' ? 'waving' : 'jumping';
        await postToPet({ type: 'setState', state, playMode: 'once', transientMs: 0 });
      } else if (itemId === 'install') {
        await actions.composer.fill(ctx.i18n.t('composerActions.pet-toggle.installPrompt'));
      }
      petToggleAction?.notifyUpdate();
    },
  });

  settingsMenu = ctx.settingsMenu.register({
    async getMenu() {
      return [
        {
          id: gameActive ? 'game:exit' : 'game:play',
          label: ctx.i18n.t(`settingsMenu.${gameActive ? 'exitGame' : 'playGame'}`),
          iconName: 'gamepad-2',
          description: gameActive ? ctx.i18n.t('settingsMenu.playing') : undefined,
        },
        {
          id: petWindow ? 'pet:hide' : 'pet:show',
          label: ctx.i18n.t(`settingsMenu.${petWindow ? 'hidePet' : 'showPet'}`),
          iconName: petWindow ? 'toggle-right' : 'toggle-left',
        },
      ];
    },
    async execute(_context, itemId) {
      if (itemId === 'game:play') {
        const win = await showPet();
        await win.postMessage({ type: 'prepareGame' });
      } else if (itemId === 'game:exit') {
        await exitGame();
      } else if (itemId === 'pet:show') {
        await showPet();
      } else if (itemId === 'pet:hide') {
        await setVisiblePreference(false);
        close();
      }
      petToggleAction?.notifyUpdate();
      settingsMenu?.notifyUpdate();
    },
  });

  ctx.subscriptions.push(
    petToggleAction,
    settingsMenu,
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
      if (petWindow) void petWindow.postMessage({ type: 'locale', strings: canvasStrings() });
      petToggleAction?.notifyUpdate();
      settingsMenu?.notifyUpdate();
    }),
    { dispose: close },
  );

  void isVisibleOnStartup().then((visible) => {
    if (visible) void open();
  }).catch((err) => {
    ctx.logger.warn('auto show pet failed', err instanceof Error ? err.message : String(err));
  });
}
