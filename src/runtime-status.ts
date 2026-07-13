/**
 * 会话运行时状态机:跟踪各会话 phase,把 Agent 事件/通知/全局状态快照
 * 翻译成宠物动画状态 + persistent/transient 气泡,并做去重与优先级仲裁
 * (waiting > transient > phase 更新)。
 *
 * 对窗口只依赖 RuntimeStatusHost 接口,不感知窗口实现。
 */
import type * as finch from 'finch';
import type { BubbleAction, HostToCanvasMessage, PetState, PlayMode } from './protocol.js';

type SessionPhase = 'idle' | 'thinking' | 'answering' | 'tool' | 'waiting' | 'done' | 'error';
type PhraseKind = 'start' | 'thinking' | 'answering' | 'working' | 'done' | 'error' | 'interrupted';

interface SessionRuntime {
  phase: SessionPhase;
  title?: string;
  toolName?: string;
  bubble?: string;
  updatedAt: number;
}

interface RuntimeBubble {
  message: string;
  key: string;
  sessionId?: string;
  action?: BubbleAction;
}

export interface RuntimeStatusHost {
  hasWindow(): boolean;
  post(message: HostToCanvasMessage): Promise<void>;
}

export type PetRuntimeStatus = ReturnType<typeof createPetRuntimeStatus>;

export function createPetRuntimeStatus(ctx: finch.MiniToolContext, host: RuntimeStatusHost) {
  const sessionRuntimes = new Map<string, SessionRuntime>();
  const dismissedSessionBubbles = new Set<string>();
  let lastRuntimeState: PetState | undefined;
  let transientRuntimeUntil = 0;
  let transientRuntimeTimer: ReturnType<typeof setTimeout> | undefined;
  let lastBubbleKey = '';
  let lastBubbleAt = 0;
  let lastPersistentBubbleKey = '';

  const clearTransientRuntimeTimer = () => {
    if (!transientRuntimeTimer) return;
    clearTimeout(transientRuntimeTimer);
    transientRuntimeTimer = undefined;
  };

  const rememberSession = (event: finch.AgentEvent, phase: SessionPhase, toolName?: string, bubble?: string) => {
    if (!event.sessionId) return;
    const existing = sessionRuntimes.get(event.sessionId);
    if (existing?.phase !== phase) dismissedSessionBubbles.delete(event.sessionId);
    const activeTitle = event.sessionId === ctx.session.id ? ctx.session.title : undefined;
    sessionRuntimes.set(event.sessionId, {
      phase,
      title: activeTitle ?? existing?.title,
      toolName,
      bubble: existing?.phase === phase ? existing.bubble ?? bubble : bubble,
      updatedAt: Date.now(),
    });
    if (sessionRuntimes.size > 40) {
      const oldest = [...sessionRuntimes.entries()].sort((a, b) => a[1].updatedAt - b[1].updatedAt)[0];
      if (oldest) sessionRuntimes.delete(oldest[0]);
    }
  };

  const sessionIsWaiting = (sessionId?: string) => !!sessionId && sessionRuntimes.get(sessionId)?.phase === 'waiting';
  const hasWaitingSession = () => [...sessionRuntimes.values()].some((runtime) => runtime.phase === 'waiting');

  const rememberPhase = (event: finch.AgentEvent, phase: SessionPhase, kind: PhraseKind, toolName?: string) => {
    const candidate = randomPhrase(kind);
    rememberSession(event, phase, toolName, candidate);
    return event.sessionId ? sessionRuntimes.get(event.sessionId)?.bubble ?? candidate : candidate;
  };

  const sessionTitle = (sessionId?: string) => {
    if (!sessionId) return undefined;
    const title = sessionId === ctx.session.id ? ctx.session.title : sessionRuntimes.get(sessionId)?.title;
    return title?.trim() || undefined;
  };

  const phraseCount: Record<PhraseKind, number> = {
    start: 4,
    thinking: 5,
    answering: 4,
    working: 5,
    done: 6,
    error: 4,
    interrupted: 3,
  };

  const randomPhrase = (kind: PhraseKind) => {
    const index = Math.floor(Math.random() * phraseCount[kind]) + 1;
    return ctx.i18n.t(`runtime.phrases.${kind}${index}`);
  };

  const waitingMessage = (sessionId?: string) => {
    const title = sessionTitle(sessionId);
    return title
      ? ctx.i18n.t('runtime.waitingWithTitle', { title })
      : ctx.i18n.t('runtime.waiting');
  };

  const sessionAction = (sessionId?: string): BubbleAction | undefined => sessionId ? {
    id: 'open-session',
    label: ctx.i18n.t('runtime.openSession'),
    sessionId,
  } : undefined;

  const nextWaitingSessionId = () => [...sessionRuntimes.entries()]
    .filter(([sessionId, runtime]) => runtime.phase === 'waiting' && !dismissedSessionBubbles.has(sessionId))
    .sort((a, b) => a[1].updatedAt - b[1].updatedAt)[0]?.[0];

  const mostRecentActiveRuntime = () => [...sessionRuntimes.entries()]
    .filter(([, runtime]) => runtime.phase === 'thinking' || runtime.phase === 'answering' || runtime.phase === 'tool')
    .sort((a, b) => b[1].updatedAt - a[1].updatedAt)[0];

  const bubbleMessage = (message: string, key = message) => {
    const now = Date.now();
    if (key === lastBubbleKey && now - lastBubbleAt < 1200) return undefined;
    lastBubbleKey = key;
    lastBubbleAt = now;
    return message;
  };

  const stateForRuntimeStatus = (snapshot: finch.FinchStatusSnapshot): PetState => {
    if (snapshot.waitingCount > 0 || snapshot.status === 'waiting') return 'waving';
    if (snapshot.runningCount > 0 || snapshot.status === 'running') {
      const foreground = sessionRuntimes.get(ctx.session.id);
      return foreground?.phase === 'thinking' ? 'waiting' : 'running';
    }
    if (snapshot.unreadCount > 0 || snapshot.status === 'unread') return 'waving';
    return 'idle';
  };

  const persistentRuntimeBubble = (snapshot: finch.FinchStatusSnapshot): RuntimeBubble | undefined => {
    const foreground = sessionRuntimes.get(ctx.session.id);
    if (snapshot.waitingCount > 0 || snapshot.status === 'waiting') {
      const waitingSessionId = nextWaitingSessionId()
        ?? (!dismissedSessionBubbles.has(ctx.session.id) ? ctx.session.id : undefined);
      if (!waitingSessionId) return undefined;
      return {
        message: waitingMessage(waitingSessionId),
        key: `waiting:${waitingSessionId}:${sessionTitle(waitingSessionId) ?? 'untitled'}`,
        sessionId: waitingSessionId,
        action: sessionAction(waitingSessionId),
      };
    }
    if (snapshot.runningCount > 0 || snapshot.status === 'running') {
      if (snapshot.runningCount > 1) {
        const active = mostRecentActiveRuntime();
        if (active?.[1].bubble) {
          return { message: active[1].bubble, key: `${active[1].phase}:${active[0]}:${active[1].bubble}`, sessionId: active[0] };
        }
        return { message: ctx.i18n.t('runtime.runningMany'), key: `running-many:${snapshot.runningCount}` };
      }
      if (foreground?.bubble && (foreground.phase === 'thinking' || foreground.phase === 'answering' || foreground.phase === 'tool')) {
        return { message: foreground.bubble, key: `${foreground.phase}:${ctx.session.id}:${foreground.bubble}`, sessionId: ctx.session.id };
      }
      const background = mostRecentActiveRuntime();
      if (background?.[1].bubble) {
        return { message: background[1].bubble, key: `${background[1].phase}:${background[0]}:${background[1].bubble}`, sessionId: background[0] };
      }
      return { message: ctx.i18n.t('runtime.workingFallback'), key: 'working-fallback' };
    }
    if (snapshot.unreadCount > 0 || snapshot.status === 'unread') {
      return { message: ctx.i18n.t('runtime.unread'), key: `unread:${snapshot.unreadCount || 1}` };
    }
    return undefined;
  };

  const syncRuntimeStatusLater = (delayMs: number) => {
    clearTransientRuntimeTimer();
    transientRuntimeTimer = setTimeout(() => {
      transientRuntimeTimer = undefined;
      void ctx.status.get().then(applyRuntimeStatus).catch((err: unknown) => ctx.logger.warn('sync pet runtime status after transient state failed', err instanceof Error ? err.message : String(err)));
    }, Math.max(0, delayMs));
  };

  const applyRuntimeStatus = async (snapshot: finch.FinchStatusSnapshot) => {
    const now = Date.now();
    const isWaiting = snapshot.waitingCount > 0 || snapshot.status === 'waiting';
    if (isWaiting) {
      transientRuntimeUntil = 0;
      clearTransientRuntimeTimer();
    } else if (transientRuntimeUntil > now) {
      syncRuntimeStatusLater(transientRuntimeUntil - now);
      return;
    }
    transientRuntimeUntil = 0;
    const state = stateForRuntimeStatus(snapshot);
    const persistentBubble = persistentRuntimeBubble(snapshot);
    if (!host.hasWindow()) {
      lastRuntimeState = state;
      return;
    }
    if (state !== lastRuntimeState) {
      const shouldClearPersistentBubble = !persistentBubble && !!lastPersistentBubbleKey;
      lastRuntimeState = state;
      lastPersistentBubbleKey = persistentBubble?.key ?? '';
      await host.post({
        type: 'setState', state, transientMs: 0,
        message: persistentBubble?.message,
        persistent: !!persistentBubble,
        action: persistentBubble?.action,
        sessionId: persistentBubble?.sessionId,
        clearBubble: shouldClearPersistentBubble,
      });
      return;
    }
    if (persistentBubble && persistentBubble.key !== lastPersistentBubbleKey) {
      lastPersistentBubbleKey = persistentBubble.key;
      await host.post({ type: 'say', message: persistentBubble.message, persistent: true, action: persistentBubble.action, sessionId: persistentBubble.sessionId });
    } else if (!persistentBubble && lastPersistentBubbleKey) {
      lastPersistentBubbleKey = '';
      await host.post({ type: 'clearBubble' });
    }
  };

  const playTransientRuntimeState = async (state: PetState, durationMs: number, message?: string, bubbleKey?: string, action?: BubbleAction, sessionId?: string, playMode?: PlayMode) => {
    if (hasWaitingSession()) {
      const snapshot = await ctx.status.get();
      await applyRuntimeStatus({ ...snapshot, status: 'waiting', waitingCount: Math.max(1, snapshot.waitingCount) });
      return;
    }
    transientRuntimeUntil = Date.now() + durationMs;
    clearTransientRuntimeTimer();
    lastRuntimeState = state;
    lastPersistentBubbleKey = '';
    const visibleMessage = message ? bubbleMessage(message, bubbleKey ?? message) : undefined;
    if (host.hasWindow()) await host.post({ type: 'setState', state, transientMs: durationMs, playMode: playMode ?? 'loop', message: visibleMessage, persistent: false, action, sessionId: sessionId ?? action?.sessionId });
    syncRuntimeStatusLater(durationMs);
  };

  const clearTransientRuntimeState = () => {
    transientRuntimeUntil = 0;
    clearTransientRuntimeTimer();
  };

  const setRuntimePhaseState = async (state: PetState, message?: string, bubbleKey?: string, action?: BubbleAction, sessionId?: string) => {
    if (state !== 'waving' && hasWaitingSession()) {
      const snapshot = await ctx.status.get();
      await applyRuntimeStatus({ ...snapshot, status: 'waiting', waitingCount: Math.max(1, snapshot.waitingCount) });
      return;
    }
    const persistentKey = bubbleKey ?? message ?? state;
    if (!host.hasWindow()) return;
    if (transientRuntimeUntil > Date.now()) {
      if (message && persistentKey !== lastPersistentBubbleKey) {
        lastPersistentBubbleKey = persistentKey;
        await host.post({ type: 'say', message, persistent: true, action, sessionId: sessionId ?? action?.sessionId });
      }
      return;
    }
    if (state === lastRuntimeState) {
      if (message && persistentKey !== lastPersistentBubbleKey) {
        lastPersistentBubbleKey = persistentKey;
        await host.post({ type: 'say', message, persistent: true, action, sessionId: sessionId ?? action?.sessionId });
      }
      return;
    }
    lastRuntimeState = state;
    lastPersistentBubbleKey = message ? persistentKey : '';
    await host.post({ type: 'setState', state, transientMs: 0, message, persistent: !!message, action, sessionId: sessionId ?? action?.sessionId, clearBubble: !message });
  };

  const handleAgentEvent = async (event: finch.AgentEvent) => {
    switch (event.kind) {
      case 'session_init':
        rememberSession(event, 'idle');
        break;
      case 'user': {
        rememberPhase(event, 'thinking', 'thinking');
        await playTransientRuntimeState('jumping', 900, randomPhrase('start'), `start:${event.sessionId ?? 'current'}:${event.id}`, undefined, event.sessionId, 'freeze');
        break;
      }
      case 'thinking': {
        if (sessionIsWaiting(event.sessionId)) break;
        const message = rememberPhase(event, 'thinking', 'thinking');
        await setRuntimePhaseState(event.sessionId === ctx.session.id ? 'waiting' : 'running', message, `thinking:${event.sessionId ?? 'current'}:${message}`, undefined, event.sessionId);
        break;
      }
      case 'assistant_text': {
        if (sessionIsWaiting(event.sessionId)) break;
        const message = rememberPhase(event, 'answering', 'answering');
        await setRuntimePhaseState('running', message, `answering:${event.sessionId ?? 'current'}:${message}`, undefined, event.sessionId);
        break;
      }
      case 'tool_use': {
        if (sessionIsWaiting(event.sessionId)) break;
        const message = rememberPhase(event, 'tool', 'working', event.toolName);
        await setRuntimePhaseState('running', message, `working:${event.sessionId ?? 'current'}:${message}`, undefined, event.sessionId);
        break;
      }
      case 'tool_result': {
        if (sessionIsWaiting(event.sessionId)) break;
        const message = rememberPhase(event, 'thinking', 'thinking', event.toolName);
        await setRuntimePhaseState(event.sessionId === ctx.session.id ? 'waiting' : 'running', message, `thinking:${event.sessionId ?? 'current'}:${message}`, undefined, event.sessionId);
        break;
      }
      case 'permission_request': {
        if (event.sessionId) dismissedSessionBubbles.delete(event.sessionId);
        ctx.logger.info('pet permission request', event.sessionId ?? 'unknown');
        rememberSession(event, 'waiting', event.toolName);
        clearTransientRuntimeState();
        lastRuntimeState = undefined;
        lastPersistentBubbleKey = '';
        lastBubbleKey = '';
        const snapshot = await ctx.status.get();
        await applyRuntimeStatus({ ...snapshot, status: 'waiting', waitingCount: Math.max(1, snapshot.waitingCount) });
        break;
      }
      case 'result':
        rememberSession(event, 'done');
        await playTransientRuntimeState('review', 5000, randomPhrase('done'), `done:${event.sessionId ?? event.id}`, sessionAction(event.sessionId), event.sessionId);
        break;
      case 'error':
        rememberSession(event, 'error');
        await playTransientRuntimeState(event.isRetryable ? 'waiting' : 'failed', 5000, randomPhrase('error'), `error:${event.sessionId ?? event.id}`, undefined, event.sessionId, event.isRetryable ? undefined : 'freeze');
        break;
      case 'interrupted':
        rememberSession(event, 'idle');
        await playTransientRuntimeState('idle', 5000, randomPhrase('interrupted'), `interrupted:${event.sessionId ?? event.id}`, undefined, event.sessionId);
        break;
      case 'session_status': {
        const runStatus = event.runStatus?.toLowerCase();
        if (runStatus === 'waiting') rememberSession(event, 'waiting');
        else if (runStatus === 'running') {
          const phase = sessionRuntimes.get(event.sessionId ?? '')?.phase;
          if (!phase || phase === 'idle' || phase === 'waiting') rememberPhase(event, 'answering', 'answering');
        }
        else if (runStatus === 'idle' || runStatus === 'completed' || runStatus === 'stopped') rememberSession(event, 'idle');
        break;
      }
      default:
        break;
    }
  };

  const handleNotification = async (event: finch.FinchNotificationEvent) => {
    const key = `notification:${event.id}`;
    if (event.kind === 'error') {
      await playTransientRuntimeState('failed', 5000, randomPhrase('error'), key, undefined, event.sessionId, 'freeze');
    } else if (event.kind === 'waiting') {
      if (event.sessionId) dismissedSessionBubbles.delete(event.sessionId);
      clearTransientRuntimeState();
      const snapshot = await ctx.status.get();
      await applyRuntimeStatus({ ...snapshot, status: 'waiting', waitingCount: Math.max(1, snapshot.waitingCount) });
    } else if (event.kind === 'background-done') {
      await playTransientRuntimeState('review', 5000, randomPhrase('done'), key, sessionAction(event.sessionId), event.sessionId);
    } else {
      await playTransientRuntimeState('review', 5000, ctx.i18n.t('runtime.unread'), key, sessionAction(event.sessionId), event.sessionId);
    }
  };

  const refreshRuntimeLocale = async (locale: finch.AppLocale) => {
    for (const [sessionId, runtime] of sessionRuntimes) {
      const kind = runtime.phase === 'thinking'
        ? 'thinking'
        : runtime.phase === 'answering'
          ? 'answering'
          : runtime.phase === 'tool'
            ? 'working'
            : undefined;
      sessionRuntimes.set(sessionId, { ...runtime, bubble: kind ? randomPhrase(kind) : undefined });
    }
    clearTransientRuntimeState();
    lastBubbleKey = '';
    lastPersistentBubbleKey = '';
    lastRuntimeState = undefined;
    ctx.logger.info('pet locale changed', locale);
    await applyRuntimeStatus(await ctx.status.get());
  };

  /** 关闭窗口时(close):停掉 transient 并清空全部差量基准。 */
  const resetForClose = () => {
    clearTransientRuntimeTimer();
    lastRuntimeState = undefined;
    transientRuntimeUntil = 0;
    lastPersistentBubbleKey = '';
  };

  /** 窗口被外部销毁时(onDidDispose):停掉 transient,保留气泡 key(与原实现一致)。 */
  const resetForWindowDisposed = () => {
    lastRuntimeState = undefined;
    transientRuntimeUntil = 0;
    clearTransientRuntimeTimer();
  };

  /** 新窗口打开前:强制下一次 applyRuntimeStatus 全量下发状态。 */
  const prepareForWindowOpen = () => {
    lastRuntimeState = undefined;
  };

  const dismissSessionBubble = (sessionId: string) => {
    dismissedSessionBubbles.add(sessionId);
  };

  return {
    applyRuntimeStatus,
    handleAgentEvent,
    handleNotification,
    refreshRuntimeLocale,
    dismissSessionBubble,
    resetForClose,
    resetForWindowDisposed,
    prepareForWindowOpen,
  };
}
