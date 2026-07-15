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
  | { type: 'config'; scale?: number };

/** Canvas → Host。 */
export type CanvasToHostMessage =
  | { type: 'poke'; state: PetState }
  | { type: 'hitTest'; clickThrough: boolean }
  | { type: 'bubbleAction'; action: BubbleAction['id']; sessionId: string }
  | { type: 'openBubbleSession'; sessionId: string }
  | { type: 'exitPet' };

const PET_STATE_SET = new Set<string>(PET_STATES);

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

const isOptionalString = (value: unknown) => value === undefined || typeof value === 'string';
const isOptionalNumber = (value: unknown) => value === undefined || typeof value === 'number';
const isOptionalBoolean = (value: unknown) => value === undefined || typeof value === 'boolean';
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
    case 'exitPet':
      return true;
    default:
      return false;
  }
}
