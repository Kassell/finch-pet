/**
 * pet — desktop pet extension host(组合根)。
 *
 * 职责:canvas 窗口生命周期与位置持久化、composer action、工具注册、事件接线。
 * 领域逻辑分布在:
 * - pet-library.ts  宠物目录列举/解析/PetRecord 组装/宠物包加载
 * - importers.ts    五种导入渠道 + 原子安装
 * - runtime-status.ts 会话运行时状态机(Agent 事件 → 宠物状态/气泡)
 * - src/game/       纯 ctx2d 游戏运行时(构建产物为根目录 pet-canvas.js)
 */
import { spawn } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { readFile, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { release } from 'node:os';
import type * as finch from 'finch';
import { isCanvasToHostMessage, PET_STATES, parsePetState, type CanvasStrings, type HostToCanvasMessage } from '../../../shared/protocol.js';
import {
  isCatalogWebviewToHostMessage,
  type CatalogWebviewStrings,
  type HostToCatalogWebviewMessage,
} from '../../../shared/catalog-webview-protocol.js';
import type { WindowPosition } from '../../domain/types.js';
import { safePetName } from '../../domain/utils.js';
import { exists } from '../../infrastructure/pet-package.js';
import { PetRegistryStore } from '../../infrastructure/persistence/pet-registry.js';
import { DuplicatePetIdError, NoAvailablePetError } from '../../domain/errors.js';
import { createPetLibrary } from '../../application/pet-library.js';
import { createPetImporters, type ImportPetResult } from '../../application/importers.js';
import { createPetRuntimeStatus } from '../../application/runtime-status.js';
import { beginCatalogRemoval, finishCatalogRemoval, rollbackCatalogRemoval } from '../../application/catalog-removal.js';
import { createPetManagementIpcServer, type PetManagementHandlers, type PetManagementContent } from '../../infrastructure/ipc/management-ipc.js';
import { fetchPetdexCatalog, fetchPetdexPreview, type PetdexCatalogItem } from '../../infrastructure/petdex-catalog.js';
import { PetVisibilityController } from '../../application/visibility-controller.js';
import { CanvasWindowCoordinator } from '../../application/window-coordinator.js';
import { createPetSettingsMenu } from './settings-menu.js';

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
  // 编译产物位于 dist/host/platform/finch，图标则随包发布在根目录 icons。
  return readFileSync(new URL(`../../../../icons/${name}.svg`, import.meta.url), 'utf-8');
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
  // 数值状态与阶段日志便于远程排查；不输出 initialData、精灵数据或聊天内容。
  const diagnostic = (stage: string, details: Record<string, unknown> = {}, warning = false) => {
    const text = `[pet-display] ${stage} ${JSON.stringify(details)}`;
    if (warning) ctx.logger.warn(text);
    else ctx.logger.info(text);
  };
  const diagnosticCleanups = new Set<() => void>();
  ctx.subscriptions.push({ dispose: () => {
    for (const cleanup of diagnosticCleanups) cleanup();
    diagnosticCleanups.clear();
  } });
  diagnostic('activate', { platform: process.platform, osRelease: release(), arch: process.arch, petVersion: ctx.minitool.version });
  void ctx.app.getInfo().then((info) => diagnostic('app-info', { version: info.version }))
    .catch(() => diagnostic('app-info-unavailable', {}, true));
  const canvasStrings = (): CanvasStrings => ({
    menuPlayGame: ctx.i18n.t('canvas.menu.playGame'),
    menuWave: ctx.i18n.t('canvas.menu.wave'),
    menuJump: ctx.i18n.t('canvas.menu.jump'),
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
      add: { svg: readIconSvg('add'), description: 'Add pet' },
      eye: { svg: readIconSvg('eye'), description: 'Show pet' },
      'eye-off': { svg: readIconSvg('eye-off'), description: 'Hide pet' },
      trash: { svg: readIconSvg('trash'), description: 'Delete custom pet' },
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
  const windows = new CanvasWindowCoordinator();
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
  const supportsCatalogPanel = typeof ctx.ui.createPanel === 'function'
    && typeof ctx.ui.onDidOpenPanel === 'function';
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

  const scheduleSessionOpen = (
    sessionId: string,
    navigate?: (id: string) => Promise<void>,
  ): void => {
    setTimeout(() => {
      if (navigate) {
        void navigate(sessionId).catch((error: unknown) => {
          ctx.logger.warn('open session with internal navigation failed', error instanceof Error ? error.message : String(error));
        });
        setTimeout(() => {
          void openSession(sessionId).catch((error: unknown) => {
            ctx.logger.warn('open session deep-link fallback failed', error instanceof Error ? error.message : String(error));
          });
        }, 200);
        return;
      }
      void openSession(sessionId).catch((error: unknown) => {
        ctx.logger.warn('open session deep link failed', error instanceof Error ? error.message : String(error));
      });
    }, 120);
  };

  const startPetSelectionSession = async (navigate?: (id: string) => Promise<void>): Promise<void> => {
    const session = await ctx.sessions.create({
      title: ctx.i18n.t('composerActions.pet-toggle.chooseSessionTitle'),
      activity: 'interactive',
      permissionMode: 'ask',
      initialMessage: {
        text: ctx.i18n.t('composerActions.pet-toggle.installPrompt'),
        idempotencyKey: `choose-pet-${randomUUID()}`,
      },
    });
    scheduleSessionOpen(session.sessionId, navigate);
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

  const notifyControlState = () => {
    petToggleAction?.notifyUpdate();
    settingsMenu?.notifyUpdate();
  };

  const visibility = new PetVisibilityController(ctx.storage, notifyControlState);
  const runtimeFeedback = { showThinking: true, notifyResult: true, notifyWaiting: true };
  const runtimeFeedbackReady = Promise.all([
    ctx.storage.get<boolean>('runtime.showThinking'),
    ctx.storage.get<boolean>('runtime.notifyResult'),
    ctx.storage.get<boolean>('runtime.notifyWaiting'),
  ]).then(([showThinking, notifyResult, notifyWaiting]) => {
    runtimeFeedback.showThinking = showThinking !== false;
    // 旧版只有“显示工作进度”：若用户曾关闭它，新拆出的结果提醒也保持关闭。
    runtimeFeedback.notifyResult = notifyResult ?? runtimeFeedback.showThinking;
    runtimeFeedback.notifyWaiting = notifyWaiting !== false;
  }).catch((error: unknown) => {
    ctx.logger.warn('restore pet runtime feedback settings failed', error instanceof Error ? error.message : String(error));
  });

  const runtime = createPetRuntimeStatus(ctx, {
    hasWindow: () => !!windows.current,
    post: async (message) => { if (windows.current) await windows.current.postMessage(message); },
  }, {
    showThinking: () => runtimeFeedback.showThinking,
    notifyResult: () => runtimeFeedback.notifyResult,
    notifyWaiting: () => runtimeFeedback.notifyWaiting,
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
    windows.disposeCurrent();
    notifyControlState();
  };

  const createWindow = async () => {
    const startedAt = Date.now();
    diagnostic('create-start');
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
    if (!visibility.snapshot.desired) throw new Error('pet window opening was cancelled');

    diagnostic('create-options', {
      savedX: saved?.x, savedY: saved?.y, savedCanvasWidth,
      x: migratedX, y: migratedY, width: canvasWidth, height: expandedCanvasHeight,
      transparent: true, clickThrough: true, allowOffscreen: true, enableDesktopSpaces,
      spriteDataLength: spriteDataUrl.length, petKind: kind,
    });
    const createdWindow = ctx.ui.createCanvasWindow({
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
    diagnostic('window-created', { windowId: createdWindow.id, state: createdWindow.state });
    let lastCanvasStage = 'none';
    let firstFrameReceived = false;
    let readyTimer: ReturnType<typeof setTimeout> | undefined;
    let frameTimer: ReturnType<typeof setTimeout> | undefined;
    const clearDiagnosticTimers = () => {
      clearTimeout(readyTimer);
      clearTimeout(frameTimer);
      diagnosticCleanups.delete(clearDiagnosticTimers);
    };
    diagnosticCleanups.add(clearDiagnosticTimers);
    // 只提示慢/卡住，不改变既有生命周期或强制销毁用户窗口。
    readyTimer = setTimeout(() => diagnostic('ready-pending', {
      windowId: createdWindow.id, elapsedMs: Date.now() - startedAt,
      state: createdWindow.state, lastCanvasStage,
    }, true), 10_000);
    createdWindow.onDidReceiveMessage((msg) => {
      if (!isCanvasToHostMessage(msg)) return;
      const event = msg;
      if (event.type === 'petDiagnostic') {
        lastCanvasStage = event.stage;
        if (event.stage === 'first-frame') {
          firstFrameReceived = true;
          clearTimeout(frameTimer);
        }
        diagnostic(event.stage, { windowId: createdWindow.id, ...event.metrics }, event.stage === 'sprite-error');
        return;
      }
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
          event.appId,
        );
      } else if (event?.type === 'exitGame') {
        void exitGame({ x: event.x, y: event.y });
      } else if (event?.type === 'exitPet') {
        void hidePet().catch((err: unknown) => ctx.logger.warn('hide pet from context menu failed', err instanceof Error ? err.message : String(err)));
      }
    });
    createdWindow.onDidMove((pos) => {
      if (gameActive || gameTransitioning) {
        gameWindowPosition = pos;
        return;
      }
      windowPosition = pos;
      schedulePositionSave();
    });
    createdWindow.onDidResize((size) => {
      if (gameActive || gameTransitioning) return;
      canvasHeight = size.height;
      schedulePositionSave();
    });
    createdWindow.onDidDispose(() => {
      clearDiagnosticTimers();
      diagnostic('window-disposed', { windowId: createdWindow.id, lastCanvasStage, firstFrameReceived });
      // close/reopen 期间旧窗口的 dispose 事件可能晚到，只允许当前窗口改状态。
      if (!windows.release(createdWindow)) return;
      clearPositionSaveTimer();
      void visibility.set(false);
      transitionGeneration += 1;
      gameTransitioning = false;
      gameActive = false;
      preGamePosition = undefined;
      gameWindowPosition = undefined;
      windowPosition = undefined;
      canvasHeight = expandedCanvasHeight;
      petCenterX = rightAlignedPetCenterX;
      runtime.resetForWindowDisposed();
      notifyControlState();
    });
    // Canvas 脚本完成 shell 加载、define 注册和 init 后才允许状态同步或返回调用方，
    // 避免首条气泡/动画消息在初始化期间丢失。
    try {
      await createdWindow.ready;
      clearTimeout(readyTimer);
      diagnostic('window-ready', { windowId: createdWindow.id, elapsedMs: Date.now() - startedAt });
      if (!firstFrameReceived) {
        frameTimer = setTimeout(() => diagnostic('first-frame-pending', {
          windowId: createdWindow.id, state: createdWindow.state,
          elapsedMs: Date.now() - startedAt, lastCanvasStage,
        }, true), 15_000);
      }
    } catch (error) {
      clearDiagnosticTimers();
      diagnostic('ready-failed', { windowId: createdWindow.id, error: conciseError(error) }, true);
      createdWindow.dispose();
      throw error;
    }
    await ctx.storage.set('window.canvasWidth', canvasWidth);
    runtime.prepareForWindowOpen();
    void ctx.status.get().then(runtime.applyRuntimeStatus).catch((err: unknown) => ctx.logger.warn('sync pet runtime status failed', err instanceof Error ? err.message : String(err)));
    return createdWindow;
  };

  const open = async () => {
    if (!visibility.snapshot.desired) throw new Error('pet window opening was cancelled');
    if (windows.current) {
      windows.current.show();
      diagnostic('show-existing', { windowId: windows.current.id, state: windows.current.state, visible: windows.current.visible });
      notifyControlState();
      return windows.current;
    }
    const created = await windows.ensure(createWindow);
    created.show();
    diagnostic('show-issued', { windowId: created.id, state: created.state, visible: created.visible });
    notifyControlState();
    return created;
  };

  const waitForTransition = async (durationMs: number) => {
    const win = windows.current;
    if (!win) return false;
    const generation = ++transitionGeneration;
    await new Promise<void>((resolve) => setTimeout(resolve, durationMs));
    return !!windows.current && windows.current === win && generation === transitionGeneration;
  };

  const runVisualTransition = async (input: {
    fromOpacity: number;
    toOpacity: number;
    fromScale: number;
    toScale: number;
    durationMs: number;
  }) => {
    if (!windows.current) return false;
    await windows.current.postMessage({ type: 'visualTransition', ...input });
    return waitForTransition(input.durationMs);
  };

  const enterGame = async (originalPosition: WindowPosition, centeredPosition: WindowPosition, appId = 'flappy-bird') => {
    if (!windows.current || gameActive || gameTransitioning) return;
    preGamePosition = { ...originalPosition };
    gameWindowPosition = { ...originalPosition };
    gameTransitioning = true;
    windows.current.setClickThrough(false);
    const petHidden = await runVisualTransition({
      fromOpacity: 1,
      toOpacity: 0,
      fromScale: 1,
      toScale: 1,
      durationMs: 150,
    });
    if (!petHidden || !windows.current) {
      gameTransitioning = false;
      return;
    }
    gameActive = true;
    // 同一个 CanvasWindow 在游戏态降低到 macOS normal 层级。
    windows.current.setAlwaysOnTop(true, 'normal');
    windows.current.setSize(gameCanvasWidth, gameCanvasHeight);
    windows.current.setPosition(centeredPosition.x, centeredPosition.y);
    let soundUrls: Awaited<ReturnType<typeof loadOriginalSoundUrls>> = {};
    if (appId === 'flappy-bird') {
      try {
        soundUrls = await loadOriginalSoundUrls();
      } catch (err) {
        ctx.logger.warn('load bundled Flappy Bird audio failed', err instanceof Error ? err.message : String(err));
      }
    }
    await windows.current.postMessage({ type: 'gameMode', active: true, appId, soundUrls });
    await windows.current.postMessage({ type: 'focusWindow' });
    const completed = await runVisualTransition({
      fromOpacity: 0,
      toOpacity: 1,
      fromScale: 0.88,
      toScale: 1,
      durationMs: 210,
    });
    if (completed) gameWindowPosition = { ...centeredPosition };
    gameTransitioning = false;
    notifyControlState();
  };

  const exitGame = async (currentPosition?: WindowPosition) => {
    if (!windows.current || !gameActive || gameTransitioning || !preGamePosition) return;
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
    if (!gameHidden || !windows.current) {
      gameTransitioning = false;
      return;
    }
    windows.current.setSize(canvasWidth, expandedCanvasHeight);
    windows.current.setPosition(destination.x, destination.y);
    // 回到桌宠态时恢复 macOS floating 层级。
    windows.current.setAlwaysOnTop(true, 'floating');
    gameActive = false;
    windowPosition = { ...destination };
    preGamePosition = undefined;
    gameWindowPosition = undefined;
    canvasHeight = expandedCanvasHeight;
    await windows.current.postMessage({ type: 'gameMode', active: false });
    await runVisualTransition({
      fromOpacity: 0,
      toOpacity: 1,
      fromScale: 1,
      toScale: 1,
      durationMs: 190,
    });
    gameTransitioning = false;
    notifyControlState();
  };

  const reopenIfVisible = async () => { if (windows.current) { close(); await open(); } };
  const showPet = async () => {
    diagnostic('show-request', { ...visibility.snapshot, hasWindow: !!windows.current });
    const persistence = visibility.set(true);
    const requestedRevision = visibility.snapshot.revision;
    try {
      const win = await open();
      await persistence;
      return win;
    } catch (err) {
      diagnostic('show-failed', { error: conciseError(err), revision: requestedRevision }, true);
      // 仅回滚本次显示请求，不能覆盖期间发生的更新操作。
      if (visibility.isCurrent(requestedRevision)) {
        await visibility.set(false);
        close();
      }
      throw err;
    }
  };
  const hidePet = async () => {
    diagnostic('hide-request', { hasWindow: !!windows.current });
    const persistence = visibility.set(false);
    close();
    await persistence;
  };
  const postToPet = async (message: HostToCanvasMessage) => { const win = await showPet(); await win.postMessage(message); };

  const selectInstalledPet = async (pet: { name: string; displayName: string }): Promise<ImportPetResult> => {
    await ctx.storage.set('selectedPet', pet.name);
    notifyControlState();
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
      notifyControlState();
      await reopenIfVisible();
    },
  });

  const conciseError = (error: unknown): string => {
    const message = error instanceof Error ? error.message : String(error);
    return message.replace(/https?:\/\/\S+/g, '[URL]').replace(/\s+/g, ' ').trim().slice(0, 180);
  };

  const waitForWindowDispose = async (window: finch.CanvasWindow | undefined): Promise<void> => {
    if (!window || window.state === 'disposed') return;
    await new Promise<void>((resolve) => {
      let done = false;
      let timer: ReturnType<typeof setTimeout>;
      let subscription: finch.Disposable | undefined;
      const complete = () => {
        if (done) return;
        done = true;
        clearTimeout(timer);
        subscription?.dispose();
        resolve();
      };
      subscription = window.onDidDispose(complete);
      timer = setTimeout(complete, 800);
    });
  };

  const readWindowPosition = async (window: finch.CanvasWindow | undefined): Promise<WindowPosition | undefined> => {
    if (!window || window.state === 'disposed') return undefined;
    const requestId = randomUUID();
    return new Promise<WindowPosition | undefined>((resolve) => {
      let done = false;
      let timer: ReturnType<typeof setTimeout>;
      let subscription: finch.Disposable | undefined;
      const complete = (position?: WindowPosition) => {
        if (done) return;
        done = true;
        clearTimeout(timer);
        subscription?.dispose();
        resolve(position);
      };
      subscription = window.onDidReceiveMessage((message) => {
        if (!isCanvasToHostMessage(message) || message.type !== 'windowPositionSnapshot' || message.requestId !== requestId) return;
        complete({ x: message.x, y: message.y });
      });
      timer = setTimeout(() => complete(undefined), 250);
      void window.postMessage({ type: 'requestWindowPosition', requestId }).catch(() => complete(undefined));
    });
  };

  const catalogWebviewStrings = (): CatalogWebviewStrings => ({
    title: ctx.i18n.t('canvas.catalog.title'),
    subtitle: ctx.i18n.t('canvas.catalog.subtitle'),
    loading: ctx.i18n.t('webview.catalog.loading'),
    installing: ctx.i18n.t('webview.catalog.installing'),
    install: ctx.i18n.t('webview.catalog.install'),
    installed: ctx.i18n.t('webview.catalog.installed'),
    remove: ctx.i18n.t('webview.catalog.remove'),
    noResults: ctx.i18n.t('canvas.catalog.noResults'),
  });

  interface CatalogPanelState {
    panel: finch.AppPanel;
    catalog: PetdexCatalogItem[];
    installedPetNames: Set<string>;
    removablePetNames: Set<string>;
    pendingRemovalNames: Set<string>;
    pendingInstallNames: Set<string>;
    installQueue: Promise<void>;
    previewDataUrls: Map<string, string>;
    status: 'loading' | 'idle' | 'error';
    message?: string;
  }

  const catalogPanels = new Map<string, CatalogPanelState>();
  const attachedCatalogPanels = new Set<string>();

  const postCatalogData = async (state: CatalogPanelState): Promise<void> => {
    const message: HostToCatalogWebviewMessage = {
      type: 'catalogData',
      strings: catalogWebviewStrings(),
      pets: state.catalog.map((pet) => ({
        slug: pet.slug,
        displayName: pet.displayName,
        description: pet.description,
        installed: state.installedPetNames.has(pet.slug),
        removable: state.removablePetNames.has(pet.slug),
      })),
    };
    await state.panel.postMessage(message);
  };

  const postCatalogStatus = async (state: CatalogPanelState): Promise<void> => {
    const message: HostToCatalogWebviewMessage = {
      type: 'catalogStatus',
      status: state.status,
      message: state.message,
    };
    await state.panel.postMessage(message);
  };

  const postCatalogInstallStatus = async (state: CatalogPanelState, status: 'installing' | 'idle', slug: string): Promise<void> => {
    const message: HostToCatalogWebviewMessage = { type: 'catalogStatus', status, slug };
    await state.panel.postMessage(message);
  };

  const postPendingCatalogInstalls = async (state: CatalogPanelState): Promise<void> => {
    for (const slug of state.pendingInstallNames) await postCatalogInstallStatus(state, 'installing', slug);
  };

  const postCatalogPreview = async (state: CatalogPanelState, slug: string, dataUrl: string): Promise<void> => {
    const message: HostToCatalogWebviewMessage = { type: 'catalogPreview', slug, dataUrl };
    await state.panel.postMessage(message);
  };

  const postCachedCatalogPreviews = async (state: CatalogPanelState): Promise<void> => {
    for (const [slug, dataUrl] of state.previewDataUrls) await postCatalogPreview(state, slug, dataUrl);
  };

  const loadCatalogPreviews = async (state: CatalogPanelState): Promise<void> => {
    const queue = state.catalog.filter((pet) => !state.previewDataUrls.has(pet.slug));
    const worker = async () => {
      while (queue.length && catalogPanels.get(state.panel.id) === state) {
        const pet = queue.shift();
        if (!pet) return;
        const preview = await fetchPetdexPreview(pet);
        if (!preview || catalogPanels.get(state.panel.id) !== state) continue;
        const dataUrl = `data:${preview.mimeType};base64,${preview.data}`;
        state.previewDataUrls.set(pet.slug, dataUrl);
        await postCatalogPreview(state, pet.slug, dataUrl);
      }
    };
    await Promise.all(Array.from({ length: Math.min(4, queue.length) }, worker));
  };

  const installCatalogPet = async (state: CatalogPanelState, slug: string): Promise<void> => {
    if (state.status !== 'idle' || state.installedPetNames.has(slug) || state.pendingInstallNames.has(slug) || state.pendingRemovalNames.has(slug)) return;
    const selected = state.catalog.find((pet) => pet.slug === slug);
    if (!selected) {
      void ctx.ui.showToast({
        title: ctx.i18n.t('petCatalog.installFailed'),
        description: ctx.i18n.t('petCatalog.invalidSelection'),
        variant: 'error',
      }).catch((error: unknown) => ctx.logger.warn('show invalid pet selection toast failed', conciseError(error)));
      return;
    }
    state.pendingInstallNames.add(slug);
    await postCatalogInstallStatus(state, 'installing', slug);
    state.installQueue = state.installQueue.then(async () => {
      try {
        const installed = await importers.importPetSource(selected.pageUrl);
        state.installedPetNames.add(selected.slug);
        state.removablePetNames.add(selected.slug);
        diagnostic('catalog-install-complete', { duplicate: installed.duplicate === true });
        await visibility.set(true);
        await open();
        notifyControlState();
        await postCatalogData(state);
        void ctx.ui.showToast({
          title: ctx.i18n.t('petCatalog.installed', { name: installed.displayName }),
          variant: 'success',
        }).catch((error: unknown) => {
          ctx.logger.warn('show installed pet toast failed', conciseError(error));
        });
      } catch (error) {
        diagnostic('catalog-install-or-show-failed', { error: conciseError(error) }, true);
        void ctx.ui.showToast({
          title: ctx.i18n.t('petCatalog.installFailed'),
          description: conciseError(error),
          variant: 'error',
        }).catch((toastError: unknown) => {
          ctx.logger.warn('show install pet error toast failed', conciseError(toastError));
        });
      } finally {
        state.pendingInstallNames.delete(slug);
        await postCatalogInstallStatus(state, 'idle', slug).catch(() => undefined);
      }
    });
  };

  const removeCatalogPet = async (state: CatalogPanelState, slug: string): Promise<void> => {
    if (state.status !== 'idle' || !beginCatalogRemoval(state, slug)) return;
    await postCatalogData(state);
    try {
      await removePetFromMenu(slug);
      finishCatalogRemoval(state, slug);
    } catch (error) {
      rollbackCatalogRemoval(state, slug);
      await postCatalogData(state);
      void ctx.ui.showToast({
        title: ctx.i18n.t('webview.catalog.removeFailed'),
        description: conciseError(error),
        variant: 'error',
      }).catch((toastError: unknown) => {
        ctx.logger.warn('show remove pet error toast failed', conciseError(toastError));
      });
    }
  };

  const attachCatalogPanel = (panel: finch.AppPanel): void => {
    if (attachedCatalogPanels.has(panel.id)) return;
    attachedCatalogPanels.add(panel.id);
    ctx.subscriptions.push(panel);
    ctx.subscriptions.push(panel.onDidReceiveMessage((message) => {
      if (!isCatalogWebviewToHostMessage(message)) return;
      const state = catalogPanels.get(panel.id);
      if (!state) return;
      if (message.type === 'catalogReady') {
        void postCatalogData(state)
          .then(() => postCatalogStatus(state))
          .then(() => postPendingCatalogInstalls(state))
          .then(() => postCachedCatalogPreviews(state))
          .catch((error: unknown) => ctx.logger.warn('initialize pet gallery failed', conciseError(error)));
        return;
      }
      if (message.type === 'catalogRemove') {
        void removeCatalogPet(state, message.slug)
          .catch((error: unknown) => ctx.logger.warn('remove gallery pet failed', conciseError(error)));
        return;
      }
      void installCatalogPet(state, message.slug)
        .catch((error: unknown) => ctx.logger.warn('install gallery pet failed', conciseError(error)));
    }));
    ctx.subscriptions.push(panel.onDidDispose(() => {
      attachedCatalogPanels.delete(panel.id);
      catalogPanels.delete(panel.id);
    }));
  };

  if (supportsCatalogPanel) {
    ctx.subscriptions.push(ctx.ui.onDidOpenPanel((panel) => {
      if (panel.view !== 'appView') attachCatalogPanel(panel);
    }));
  }

  const installPetFromCatalog = async (): Promise<void> => {
    if (!supportsCatalogPanel) {
      await startPetSelectionSession();
      return;
    }
    let panel: finch.AppPanel;
    try {
      panel = ctx.ui.createPanel({ instanceMode: 'single' });
      attachCatalogPanel(panel);
      const existing = catalogPanels.get(panel.id);
      if (existing?.pendingInstallNames.size) {
        await panel.reveal();
        return;
      }
      const state: CatalogPanelState = {
        panel,
        catalog: [],
        installedPetNames: new Set<string>(),
        removablePetNames: new Set<string>(),
        pendingRemovalNames: new Set<string>(),
        pendingInstallNames: new Set<string>(),
        installQueue: Promise.resolve(),
        previewDataUrls: new Map<string, string>(),
        status: 'loading',
      };
      catalogPanels.set(panel.id, state);
      await panel.reveal();
      await postCatalogData(state);
      await postCatalogStatus(state);

      const [catalog, installedPets] = await Promise.all([
        fetchPetdexCatalog(30),
        library.listPets(),
      ]);
      state.catalog = catalog;
      state.installedPetNames = new Set(installedPets
        .filter((pet) => pet.health === 'ok' || pet.health === 'external')
        .map((pet) => pet.name));
      state.removablePetNames = new Set(installedPets
        .filter((pet) => (pet.health === 'ok' || pet.health === 'external') && pet.removable)
        .map((pet) => pet.name));
      state.status = 'idle';
      state.message = undefined;
      await postCatalogData(state);
      await postCatalogStatus(state);
      void loadCatalogPreviews(state)
        .catch((error: unknown) => ctx.logger.warn('load pet gallery previews failed', conciseError(error)));
    } catch (error) {
      const state = panel! ? catalogPanels.get(panel.id) : undefined;
      if (state) {
        state.status = 'error';
        state.message = conciseError(error);
        await postCatalogStatus(state).catch(() => undefined);
      }
      await ctx.ui.showToast({
        title: ctx.i18n.t('petCatalog.loadFailed'),
        description: conciseError(error),
        variant: 'error',
      });
    }
  };

  const usablePets = async () => (await library.listPets())
    .filter((pet) => pet.health === 'ok' || pet.health === 'external');
  const hasUsablePet = async () => (await usablePets()).length > 0;
  const noAvailablePetMessage = () => ctx.i18n.t('pet.noAvailable');

  const managementHandlers: PetManagementHandlers = {
    async pet_catalog(params) {
      const requestedLimit = typeof params.limit === 'number' && Number.isFinite(params.limit) ? Math.round(params.limit) : 6;
      const catalog = await fetchPetdexCatalog(Math.max(3, Math.min(8, requestedLimit)));
      let renderer = windows.current;
      let temporaryRenderer: finch.CanvasWindow | undefined;
      if (!renderer) {
        temporaryRenderer = ctx.ui.createCanvasWindow({
          entry: 'pet-canvas.js',
          width: 1,
          height: 1,
          x: -10_000,
          y: -10_000,
          transparent: true,
          clickThrough: true,
          allowOffscreen: true,
          frameRate: 15,
          initialData: {
            initialAppId: 'thumbnail-renderer',
            strings: canvasStrings(),
          },
        });
        temporaryRenderer.hide();
        await temporaryRenderer.ready;
        renderer = temporaryRenderer;
      }
      const renderThumbnail = async (preview: Awaited<ReturnType<typeof fetchPetdexPreview>>) => {
        if (!preview || !renderer) return undefined;
        const requestId = randomUUID();
        return new Promise<{ data: string; mimeType: 'image/png' } | undefined>((resolve) => {
          let settled = false;
          let timer: ReturnType<typeof setTimeout>;
          let subscription: finch.Disposable | undefined;
          const finish = (value?: { data: string; mimeType: 'image/png' }) => {
            if (settled) return;
            settled = true;
            clearTimeout(timer);
            subscription?.dispose();
            resolve(value);
          };
          subscription = renderer!.onDidReceiveMessage((message) => {
            if (!isCanvasToHostMessage(message) || message.type !== 'catalogThumbnailRendered' || message.requestId !== requestId) return;
            finish(message.data ? { data: message.data, mimeType: 'image/png' } : undefined);
          });
          timer = setTimeout(() => finish(), 5_000);
          void renderer!.postMessage({
            type: 'renderCatalogThumbnail',
            requestId,
            dataUrl: `data:${preview.mimeType};base64,${preview.data}`,
          }).catch(() => finish());
        });
      };
      try {
        const previews = await Promise.all(catalog.map(fetchPetdexPreview));
        const thumbnails = await Promise.all(previews.map(renderThumbnail));
        const content: PetManagementContent[] = [{
          type: 'text',
          text: '请把下面这些 Petdex 候选展示给用户，并让用户按名称或序号选择。用户确认前不要安装，也不要要求用户复制链接。',
        }];
        catalog.forEach((pet, index) => {
          content.push({
            type: 'text',
            text: `${index + 1}. ${pet.displayName}\nslug: ${pet.slug}\n${pet.description}\n安装源: ${pet.pageUrl}`,
          });
          const thumbnail = thumbnails[index];
          if (thumbnail) content.push({ type: 'image', ...thumbnail });
        });
        return { content };
      } finally {
        temporaryRenderer?.dispose();
      }
    },
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
      diagnostic('tool-install-complete', { duplicate: imported.duplicate === true, desired: visibility.snapshot.desired, hasWindow: !!windows.current });
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
        else await hidePet();
      }
      return { content: [{ type: 'text', text: `removed: ${name}` }] };
    },
  };

  const removePetFromMenu = async (name: string): Promise<void> => {
    const pet = (await library.listPets()).find((item) => item.name === name && item.kind !== 'builtin');
    if (!pet) throw new Error(`custom pet is unavailable: ${name}`);
    const result = await managementHandlers.pet_remove({ name });
    if (result.isError) {
      const message = result.content.find((item) => item.type === 'text');
      throw new Error(message?.type === 'text' ? message.text : `failed to remove pet: ${name}`);
    }
    await ctx.ui.showToast({
      title: ctx.i18n.t('composerActions.pet-toggle.removedPet', { name: pet.displayName }),
      variant: 'success',
    });
    notifyControlState();
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
        args: [join(ctx.minitool.extensionPath, 'dist', 'host', 'infrastructure', 'ipc', 'mcp-server.js')],
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

  const runtimeFeedbackMenuItem = (): finch.ComposerActionMenuItem => ({
    id: 'runtime-feedback',
    label: ctx.i18n.t('settingsMenu.runtimeFeedback'),
    iconName: 'sliders-horizontal',
    children: [
      {
        id: 'runtime:thinking',
        label: ctx.i18n.t('settingsMenu.showProgress'),
        current: runtimeFeedback.showThinking,
      },
      {
        id: 'runtime:result',
        label: ctx.i18n.t('settingsMenu.notifyResult'),
        current: runtimeFeedback.notifyResult,
      },
      {
        id: 'runtime:waiting',
        label: ctx.i18n.t('settingsMenu.notifyWaiting'),
        current: runtimeFeedback.notifyWaiting,
      },
    ],
  });

  petToggleAction = ctx.composerActions.register('pet-toggle', {
    async getBadge() {
      return { text: 'Finch Pet', active: visibility.snapshot.desired };
    },
    async getMenu() {
      await runtimeFeedbackReady;
      const pets = await library.listPets();
      const selectablePets = pets.filter((pet) => pet.health === 'ok' || pet.health === 'external');
      if (!selectablePets.length) {
        return [
          ...(supportsCatalogPanel ? [{
            id: 'install:catalog',
            label: ctx.i18n.t('composerActions.pet-toggle.chooseFromPetdex'),
            iconName: 'list',
          }] : []),
          {
            id: 'install:chat',
            label: ctx.i18n.t('composerActions.pet-toggle.chooseWithFinch'),
            iconName: 'message-circle',
          },
          { id: 'separator:runtime', label: '', separator: true },
          runtimeFeedbackMenuItem(),
        ];
      }
      const petItems: finch.ComposerActionMenuItem[] = selectablePets.map((pet) => ({
        id: `select:${pet.name}`,
        label: pet.displayName,
        current: pet.selected,
        ...(pet.kind !== 'builtin' ? {
          trailingButton: {
            id: `remove:${pet.name}`,
            iconName: 'ext:finch-pet/trash',
            tooltip: ctx.i18n.t('composerActions.pet-toggle.removePet'),
          },
        } : {}),
      }));

      return [
        ...petItems,
        { id: 'separator:actions', label: '', separator: true },
        {
          id: 'add-pet',
          label: ctx.i18n.t('composerActions.pet-toggle.addPet'),
          iconName: 'ext:finch-pet/add',
          children: [
            ...(supportsCatalogPanel ? [{
              id: 'install:catalog',
              label: ctx.i18n.t('composerActions.pet-toggle.chooseFromPetdex'),
              iconName: 'list',
            }] : []),
            {
              id: 'install:chat',
              label: ctx.i18n.t('composerActions.pet-toggle.chooseWithFinch'),
              iconName: 'message-circle',
            },
          ],
        },
        {
          id: 'interact',
          label: ctx.i18n.t('composerActions.pet-toggle.interact'),
          iconName: 'sparkles',
          children: [
            { id: 'interact:waving', label: ctx.i18n.t('composerActions.pet-toggle.wave'), iconName: 'sparkles' },
            { id: 'interact:jumping', label: ctx.i18n.t('composerActions.pet-toggle.jump'), iconName: 'zap' },
            {
              id: gameActive ? 'interact:flappy-exit' : 'interact:flappy',
              label: ctx.i18n.t(`settingsMenu.${gameActive ? 'exitGame' : 'playGame'}`),
              iconName: 'gamepad-2',
            },
          ],
        },
        runtimeFeedbackMenuItem(),
        { id: 'separator:visibility', label: '', separator: true },
        {
          id: visibility.snapshot.desired ? 'visibility:hide' : 'visibility:show',
          label: ctx.i18n.t(`composerActions.pet-toggle.${visibility.snapshot.desired ? 'hidePet' : 'showPet'}`),
          iconName: visibility.snapshot.desired ? 'ext:finch-pet/eye-off' : 'ext:finch-pet/eye',
        },
      ];
    },
    async execute(_context, itemId, actions) {
      if (itemId.startsWith('__trailing__:remove:')) {
        await removePetFromMenu(itemId.slice('__trailing__:remove:'.length));
      } else if (itemId === 'visibility:hide') {
        await hidePet();
      } else if (itemId === 'visibility:show') {
        try {
          await showPet();
        } catch (err) {
          if (!(err instanceof NoAvailablePetError)) throw err;
          await installPetFromCatalog();
        }
      } else if (itemId.startsWith('select:') && itemId !== 'select:none') {
        const name = itemId.slice('select:'.length);
        const pet = (await library.listPets()).find((item) => item.name === name && item.health !== 'missing' && item.health !== 'invalid');
        if (!pet) throw new Error(`pet is unavailable: ${name}`);
        await selectInstalledPet(pet);
      } else if (itemId === 'runtime:thinking') {
        await runtimeFeedbackReady;
        runtimeFeedback.showThinking = !runtimeFeedback.showThinking;
        await ctx.storage.set('runtime.showThinking', runtimeFeedback.showThinking);
        await runtime.refreshRuntimePreferences();
      } else if (itemId === 'runtime:result') {
        await runtimeFeedbackReady;
        runtimeFeedback.notifyResult = !runtimeFeedback.notifyResult;
        await ctx.storage.set('runtime.notifyResult', runtimeFeedback.notifyResult);
        await runtime.refreshRuntimePreferences();
      } else if (itemId === 'runtime:waiting') {
        await runtimeFeedbackReady;
        runtimeFeedback.notifyWaiting = !runtimeFeedback.notifyWaiting;
        await ctx.storage.set('runtime.notifyWaiting', runtimeFeedback.notifyWaiting);
        await runtime.refreshRuntimePreferences();
      } else if (itemId === 'interact:waving' || itemId === 'interact:jumping') {
        const state = itemId === 'interact:waving' ? 'waving' : 'jumping';
        await postToPet({ type: 'setState', state, playMode: 'once', transientMs: 0 });
      } else if (itemId === 'interact:flappy') {
        const win = await showPet();
        await win.postMessage({ type: 'prepareGame' });
      } else if (itemId === 'interact:flappy-exit') {
        await exitGame();
      } else if (itemId === 'install:catalog') {
        await installPetFromCatalog();
      } else if (itemId === 'install:chat') {
        await startPetSelectionSession((id) => actions.navigation.openSession(id));
      }
      notifyControlState();
    },
  });

  settingsMenu = ctx.settingsMenu.register({
    async getMenu() {
      const [, petAvailable] = await Promise.all([runtimeFeedbackReady, hasUsablePet()]);
      return createPetSettingsMenu({
        petAvailable,
        visible: visibility.snapshot.desired,
        t: (key) => ctx.i18n.t(key),
        runtimeFeedbackItem: runtimeFeedbackMenuItem(),
      });
    },
    async execute(_context, itemId) {
      if (itemId === 'install:catalog') {
        await installPetFromCatalog();
      } else if (itemId === 'visibility:show') {
        await showPet();
      } else if (itemId === 'visibility:hide') {
        await hidePet();
      } else if (itemId === 'runtime:thinking') {
        await runtimeFeedbackReady;
        runtimeFeedback.showThinking = !runtimeFeedback.showThinking;
        await ctx.storage.set('runtime.showThinking', runtimeFeedback.showThinking);
        await runtime.refreshRuntimePreferences();
      } else if (itemId === 'runtime:result') {
        await runtimeFeedbackReady;
        runtimeFeedback.notifyResult = !runtimeFeedback.notifyResult;
        await ctx.storage.set('runtime.notifyResult', runtimeFeedback.notifyResult);
        await runtime.refreshRuntimePreferences();
      } else if (itemId === 'runtime:waiting') {
        await runtimeFeedbackReady;
        runtimeFeedback.notifyWaiting = !runtimeFeedback.notifyWaiting;
        await ctx.storage.set('runtime.notifyWaiting', runtimeFeedback.notifyWaiting);
        await runtime.refreshRuntimePreferences();
      }
      notifyControlState();
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
          await hidePet();
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
      if (windows.current) void windows.current.postMessage({ type: 'locale', strings: canvasStrings() });
      petToggleAction?.notifyUpdate();
      settingsMenu?.notifyUpdate();
    }),
    { dispose: close },
  );

  void (async () => {
    const petReady = await hasUsablePet();
    const visible = await visibility.restore(petReady);
    diagnostic('visibility-restored', { petReady, desired: visible });
    if (visible) await open();
  })().catch((err) => {
    void visibility.set(false);
    diagnostic('initialize-failed', { error: conciseError(err) }, true);
    ctx.logger.warn('initialize pet failed', err instanceof Error ? err.message : String(err));
  });
}
