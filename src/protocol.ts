/**
 * finch-pet Host ↔ Canvas 消息协议的唯一类型来源。
 *
 * Host、Canvas 以及运行时状态模块必须直接依赖本文件，避免分别维护字符串约定。
 * 两端进程边界使用下方类型守卫过滤未知消息；协议变更应只在这里完成。
 */

export const PET_STATES = [
  'idle',
  'running-right',
  'running-left',
  'waving',
  'jumping',
  'failed',
  'waiting',
  'running',
  'review',
] as const;

export type PetState = typeof PET_STATES[number];
export type PlayMode = 'loop' | 'once' | 'freeze';

export interface BubbleAction {
  id: 'open-session';
  label: string;
  sessionId: string;
}

/** Host 解析 ctx.i18n 后传给隔离 Canvas 的全部界面文案。 */
export interface CanvasStrings {
  menuPlayGame: string;
  menuClosePet: string;
  gameHeader: string;
  gameTitle: string;
  gameStartHint: string;
  gameBest: string;
  gameOver: string;
  gameResult: string;
  gameRestartHint: string;
  gameSoundOn: string;
  gameSoundOff: string;
  loadingPet: string;
  spriteLoadFailed: string;
}

/** Host → Canvas。 */
export type HostToCanvasMessage =
  | {
      type: 'setState';
      state: PetState;
      transientMs?: number;
      playMode?: PlayMode;
      message?: string;
      persistent?: boolean;
      action?: BubbleAction;
      sessionId?: string;
      clearBubble?: boolean;
    }
  | {
      type: 'say';
      message: string;
      transientMs?: number;
      persistent?: boolean;
      action?: BubbleAction;
      sessionId?: string;
    }
  | { type: 'clearBubble' }
  | { type: 'config'; scale?: number }
  | {
      type: 'gameMode';
      active: boolean;
      soundUrls?: Partial<Record<'die' | 'hit' | 'point' | 'swoosh' | 'wing', string>>;
    }
  | { type: 'prepareGame' }
  | { type: 'locale'; strings: CanvasStrings }
  | {
      type: 'visualTransition';
      fromOpacity: number;
      toOpacity: number;
      fromScale: number;
      toScale: number;
      durationMs: number;
    };

/** Canvas → Host。 */
export type CanvasToHostMessage =
  | { type: 'poke'; state: PetState }
  | { type: 'hitTest'; clickThrough: boolean }
  | { type: 'bubbleAction'; action: BubbleAction['id']; sessionId: string }
  | { type: 'openBubbleSession'; sessionId: string }
  | {
      type: 'enterGame';
      originalX: number;
      originalY: number;
      centeredX: number;
      centeredY: number;
    }
  | { type: 'exitGame'; x: number; y: number }
  | { type: 'exitPet' };

const PET_STATE_SET = new Set<string>(PET_STATES);

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

const isOptionalString = (value: unknown) => value === undefined || typeof value === 'string';
const isOptionalNumber = (value: unknown) => value === undefined || typeof value === 'number';
const isOptionalBoolean = (value: unknown) => value === undefined || typeof value === 'boolean';
const isOptionalStringRecord = (value: unknown) => value === undefined
  || (isRecord(value) && Object.values(value).every((item) => typeof item === 'string'));
const isPlayMode = (value: unknown): value is PlayMode => value === 'loop' || value === 'once' || value === 'freeze';

export function isPetState(value: unknown): value is PetState {
  return typeof value === 'string' && PET_STATE_SET.has(value);
}

export function parsePetState(value: unknown): PetState | undefined {
  if (typeof value !== 'string') return undefined;
  const state = value.trim().toLowerCase();
  return isPetState(state) ? state : undefined;
}

export function isBubbleAction(value: unknown): value is BubbleAction {
  return isRecord(value)
    && value.id === 'open-session'
    && typeof value.label === 'string'
    && typeof value.sessionId === 'string';
}

export function isHostToCanvasMessage(value: unknown): value is HostToCanvasMessage {
  if (!isRecord(value)) return false;
  switch (value.type) {
    case 'setState':
      return isPetState(value.state)
        && isOptionalNumber(value.transientMs)
        && (value.playMode === undefined || isPlayMode(value.playMode))
        && isOptionalString(value.message)
        && isOptionalBoolean(value.persistent)
        && (value.action === undefined || isBubbleAction(value.action))
        && isOptionalString(value.sessionId)
        && isOptionalBoolean(value.clearBubble);
    case 'say':
      return typeof value.message === 'string'
        && isOptionalNumber(value.transientMs)
        && isOptionalBoolean(value.persistent)
        && (value.action === undefined || isBubbleAction(value.action))
        && isOptionalString(value.sessionId);
    case 'clearBubble':
      return true;
    case 'config':
      return isOptionalNumber(value.scale);
    case 'gameMode':
      return typeof value.active === 'boolean' && isOptionalStringRecord(value.soundUrls);
    case 'prepareGame':
      return true;
    case 'locale':
      return isRecord(value.strings)
        && Object.values(value.strings).every((text) => typeof text === 'string');
    case 'visualTransition':
      return typeof value.fromOpacity === 'number'
        && typeof value.toOpacity === 'number'
        && typeof value.fromScale === 'number'
        && typeof value.toScale === 'number'
        && typeof value.durationMs === 'number';
    default:
      return false;
  }
}

export function isCanvasToHostMessage(value: unknown): value is CanvasToHostMessage {
  if (!isRecord(value)) return false;
  switch (value.type) {
    case 'poke':
      return isPetState(value.state);
    case 'hitTest':
      return typeof value.clickThrough === 'boolean';
    case 'bubbleAction':
      return value.action === 'open-session' && typeof value.sessionId === 'string';
    case 'openBubbleSession':
      return typeof value.sessionId === 'string';
    case 'enterGame':
      return typeof value.originalX === 'number'
        && typeof value.originalY === 'number'
        && typeof value.centeredX === 'number'
        && typeof value.centeredY === 'number';
    case 'exitGame':
      return typeof value.x === 'number' && typeof value.y === 'number';
    case 'exitPet':
      return true;
    default:
      return false;
  }
}
