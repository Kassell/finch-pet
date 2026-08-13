import assert from 'node:assert/strict';
import test from 'node:test';
import { AppRegistry } from '../dist/game/core/app-registry.js';
import { PetAnimationSystem } from '../dist/game/pet/systems/pet-animation-system.js';
import { PetBubbleSystem } from '../dist/game/pet/systems/pet-bubble-system.js';

test('AppRegistry 不允许把 pet 注册为 App', () => {
  const apps = new AppRegistry();
  assert.throws(() => apps.register({ id: 'pet', create: () => ({}) }), /not an app/);
});

test('AppRegistry 校验直接启动的 appId', () => {
  const apps = new AppRegistry().register({ id: 'flappy-bird', create: () => ({}) });
  assert.equal(apps.require('flappy-bird'), 'flappy-bird');
  assert.throws(() => apps.require('home'), /not registered/);
});

test('PetAnimationSystem 推进 once 动画后回到 idle', () => {
  const animation = new PetAnimationSystem(10, () => 2, () => {});
  animation.play('waving', { source: 'mouse', playMode: 'once' }, 0);
  animation.update(100, 100);
  assert.equal(animation.snapshot.state, 'waving');
  animation.update(100, 200);
  assert.equal(animation.snapshot.state, 'idle');
  assert.equal(animation.snapshot.frameIndex, 0);
});

test('Agent 动画会阻止鼠标动画抢占', () => {
  const animation = new PetAnimationSystem(10, () => 2, () => {});
  animation.play('running', { source: 'agent' }, 0);
  assert.equal(animation.play('waving', { source: 'mouse' }, 1), false);
  assert.equal(animation.snapshot.state, 'running');
});

test('PetBubbleSystem 管理动作会话与过期', () => {
  const bubble = new PetBubbleSystem();
  bubble.say(' hello ', 100, false, { id: 'open-session', label: 'Open', sessionId: 's1' }, undefined, 0);
  assert.equal(bubble.snapshot.text, 'hello');
  assert.equal(bubble.snapshot.sessionId, 's1');
  assert.equal(bubble.update(4999), false);
  assert.equal(bubble.update(5001), true);
  assert.equal(bubble.snapshot.text, '');
});
