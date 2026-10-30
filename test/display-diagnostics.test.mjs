import assert from 'node:assert/strict';
import test from 'node:test';
import { PET_DIAGNOSTIC_STAGES, isCanvasToHostMessage } from '../dist/shared/protocol.js';

const message = (metrics, stage = 'first-frame') => ({ type: 'petDiagnostic', stage, metrics });

test('显示诊断接受所有已知阶段和有限数值信息', () => {
  for (const stage of PET_DIAGNOSTIC_STAGES) {
    assert.equal(isCanvasToHostMessage(message({ x: -1920, y: 100, dpr: 1.25, elapsedMs: 20 }, stage)), true);
  }
});

test('显示诊断拒绝未知阶段和非数值数据，避免传入图片或聊天内容', () => {
  assert.equal(isCanvasToHostMessage(message({}, 'unknown')), false);
  for (const metrics of [null, [], { data: 'data:image/png;base64,secret' }, { text: 'chat' }, { x: NaN }, { x: Infinity }, { x: {} }]) {
    assert.equal(isCanvasToHostMessage(message(metrics)), false);
  }
});

test('显示诊断限制键名和字段数量', () => {
  assert.equal(isCanvasToHostMessage(message({ 'invalid key': 1 })), false);
  assert.equal(isCanvasToHostMessage(message({ ['a'.repeat(41)]: 1 })), false);
  assert.equal(isCanvasToHostMessage(message(Object.fromEntries(Array.from({ length: 81 }, (_, index) => [`v${index}`, index])))), false);
});
