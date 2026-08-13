import assert from 'node:assert/strict';
import test from 'node:test';
import { Game } from '../dist/game/core/game.js';

const makeScene = (id, events) => ({
  id,
  enter(previous) { events.push(`${id}:enter:${previous ?? ''}`); },
  exit(next) { events.push(`${id}:exit:${next ?? ''}`); },
  resize(width, height) { events.push(`${id}:resize:${width}x${height}`); },
  update(dt) { events.push(`${id}:update:${dt}`); },
  render() { events.push(`${id}:render`); },
  pointer(event) { events.push(`${id}:pointer:${event.type}`); },
  contextMenu(x, y) { events.push(`${id}:menu:${x},${y}`); return true; },
  message(message) { events.push(`${id}:message:${message.type}`); },
  keyDown(key) { events.push(`${id}:key:${key}`); return key === 'Escape'; },
  blur() { events.push(`${id}:blur`); },
  dispose() { events.push(`${id}:dispose`); },
});

const initArgs = {
  canvas: {},
  ctx2d: {},
  width: 480,
  height: 260,
  dpr: 1,
  initialData: {},
};

test('Game 将生命周期只路由给当前场景', () => {
  const events = [];
  const game = new Game({ updatesPerSecond: 60 })
    .register('pet', () => makeScene('pet', events))
    .register('flappy-bird', () => makeScene('flappy-bird', events));
  game.init(initArgs, 'pet');
  events.length = 0;
  game.frame(17);
  game.pointer({ type: 'move', x: 1, y: 2 });
  assert.equal(game.contextMenu(3, 4), true);
  game.message({ type: 'clearBubble' });
  assert.deepEqual(events, [
    `pet:update:${1000 / 60}`,
    'pet:render',
    'pet:pointer:move',
    'pet:menu:3,4',
    'pet:message:clearBubble',
  ]);
});

test('固定步长更新与渲染相互独立', () => {
  const events = [];
  const game = new Game({ updatesPerSecond: 10 })
    .register('pet', () => makeScene('pet', events));
  game.init(initArgs, 'pet');
  events.length = 0;
  game.frame(40);
  game.frame(70);
  assert.deepEqual(events, ['pet:render', 'pet:update:100', 'pet:render']);
});

test('切换场景遵循 exit → resize → enter → render 且输入不串场', () => {
  const events = [];
  const game = new Game()
    .register('pet', () => makeScene('pet', events))
    .register('flappy-bird', () => makeScene('flappy-bird', events));
  game.init(initArgs, 'pet');
  events.length = 0;
  game.switchScene('flappy-bird');
  game.pointer({ type: 'down', x: 1, y: 2 });
  assert.equal(game.keyDown('Escape'), true);
  game.blur();
  assert.deepEqual(events, [
    'pet:exit:flappy-bird',
    'flappy-bird:resize:480x260',
    'flappy-bird:enter:pet',
    'flappy-bird:render',
    'flappy-bird:pointer:down',
    'flappy-bird:key:Escape',
    'flappy-bird:blur',
  ]);
});

test('拒绝重复注册和场景 ID 不匹配', () => {
  const game = new Game().register('pet', () => makeScene('wrong', []));
  assert.throws(() => game.register('pet', () => makeScene('pet', [])), /already registered/);
  assert.throws(() => game.init(initArgs, 'pet'), /scene id mismatch/);
});

test('销毁会释放所有已创建场景', () => {
  const events = [];
  const game = new Game()
    .register('pet', () => makeScene('pet', events))
    .register('flappy-bird', () => makeScene('flappy-bird', events));
  game.init(initArgs, 'pet');
  game.switchScene('flappy-bird');
  events.length = 0;
  game.dispose();
  assert.deepEqual(events, ['pet:dispose', 'flappy-bird:dispose']);
});
