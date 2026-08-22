import assert from 'node:assert/strict';
import test from 'node:test';
import { createPetRuntimeStatus } from '../dist/host/application/runtime-status.js';

const snapshot = (overrides = {}) => ({
  status: 'idle',
  runningCount: 0,
  waitingCount: 0,
  unreadCount: 0,
  ...overrides,
});

const createRuntime = (preferences) => {
  const messages = [];
  const current = snapshot();
  const ctx = {
    session: { id: 'session-1', title: 'Test session' },
    i18n: { t: (key) => key },
    status: { get: async () => current },
    logger: { warn: () => undefined },
  };
  const runtime = createPetRuntimeStatus(ctx, {
    hasWindow: () => true,
    post: async (message) => { messages.push(message); },
  }, {
    showThinking: () => true,
    notifyResult: () => true,
    notifyWaiting: () => true,
    ...preferences,
  });
  return { runtime, messages };
};

test('关闭等待提示时 waiting 状态回到 idle 且不显示气泡', async () => {
  const { runtime, messages } = createRuntime({ showThinking: () => true, notifyWaiting: () => false });
  await runtime.applyRuntimeStatus(snapshot({ status: 'waiting', waitingCount: 1, runningCount: 1 }));
  assert.deepEqual(messages, [{
    type: 'setState',
    state: 'idle',
    transientMs: 0,
    message: undefined,
    persistent: false,
    action: undefined,
    sessionId: undefined,
    clearBubble: false,
  }]);
});

test('关闭工作进度时 running 状态回到 idle 且不显示气泡', async () => {
  const { runtime, messages } = createRuntime({ showThinking: () => false, notifyWaiting: () => true });
  await runtime.applyRuntimeStatus(snapshot({ status: 'running', runningCount: 1 }));
  assert.equal(messages.length, 1);
  assert.equal(messages[0].state, 'idle');
  assert.equal(messages[0].message, undefined);
});

test('关闭工作进度时 tool_use 不直接发送动画或气泡', async () => {
  const { runtime, messages } = createRuntime({ showThinking: () => false, notifyWaiting: () => true });
  await runtime.handleAgentEvent({ kind: 'tool_use', id: 'event-1', sessionId: 'session-1', toolName: 'demo' });
  assert.deepEqual(messages, []);
});

test('运行中关闭工作进度会立即清除 persistent 气泡窗口', async () => {
  let showThinking = true;
  const { runtime, messages } = createRuntime({ showThinking: () => showThinking, notifyWaiting: () => true });
  await runtime.handleAgentEvent({ kind: 'assistant_text', id: 'event-1', sessionId: 'session-1' });
  assert.equal(messages.at(-1)?.persistent, true);

  showThinking = false;
  await runtime.refreshRuntimePreferences();

  assert.deepEqual(messages.slice(-2), [
    { type: 'clearBubble' },
    {
      type: 'setState',
      state: 'idle',
      transientMs: 0,
      message: undefined,
      persistent: false,
      action: undefined,
      sessionId: undefined,
      clearBubble: false,
    },
  ]);
});

test('运行中关闭工作进度会立即清除 transient 气泡窗口', async () => {
  let showThinking = true;
  const { runtime, messages } = createRuntime({ showThinking: () => showThinking, notifyWaiting: () => true });
  await runtime.handleAgentEvent({ kind: 'user', id: 'event-1', sessionId: 'session-1' });
  assert.equal(messages.at(-1)?.persistent, false);

  showThinking = false;
  await runtime.refreshRuntimePreferences();

  assert.equal(messages.at(-2)?.type, 'clearBubble');
  assert.equal(messages.at(-1)?.type, 'setState');
  assert.equal(messages.at(-1)?.state, 'idle');
});

test('关闭执行进度后不显示开始、思考、回答和工具事件', async () => {
  const { runtime, messages } = createRuntime({ showThinking: () => false });
  await runtime.handleAgentEvent({ kind: 'user', id: 'user-1', sessionId: 'session-1' });
  await runtime.handleAgentEvent({ kind: 'thinking', id: 'thinking-1', sessionId: 'session-1' });
  await runtime.handleAgentEvent({ kind: 'assistant_text', id: 'answer-1', sessionId: 'session-1' });
  await runtime.handleAgentEvent({ kind: 'tool_use', id: 'tool-1', sessionId: 'session-1', toolName: 'demo' });
  await runtime.handleAgentEvent({ kind: 'tool_result', id: 'tool-result-1', sessionId: 'session-1', toolName: 'demo' });
  assert.deepEqual(messages, []);
});

test('关闭执行结果后完成、失败和中断只收起现有反馈', async () => {
  for (const event of [
    { kind: 'result', id: 'result-1', sessionId: 'session-1' },
    { kind: 'error', id: 'error-1', sessionId: 'session-1', isRetryable: false },
    { kind: 'interrupted', id: 'interrupted-1', sessionId: 'session-1' },
  ]) {
    const { runtime, messages } = createRuntime({ notifyResult: () => false });
    await runtime.handleAgentEvent(event);
    assert.deepEqual(messages, [{ type: 'setState', state: 'idle', transientMs: 0, clearBubble: true }]);
  }
});

test('关闭执行结果后不显示后台完成、错误和未读提醒', async () => {
  const { runtime, messages } = createRuntime({ notifyResult: () => false });
  await runtime.handleNotification({ kind: 'background-done', id: 'done-1', sessionId: 'session-2' });
  await runtime.handleNotification({ kind: 'error', id: 'error-1', sessionId: 'session-2' });
  await runtime.applyRuntimeStatus(snapshot({ status: 'unread', unreadCount: 1, latestUnreadSessionId: 'session-2' }));
  assert.equal(messages.length, 1);
  assert.equal(messages[0].state, 'idle');
  assert.equal(messages[0].message, undefined);
});
