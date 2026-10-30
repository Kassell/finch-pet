import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { createPetSettingsMenu } from '../dist/host/platform/finch/settings-menu.js';

const zh = JSON.parse(readFileSync(new URL('../i18n/zh-CN.json', import.meta.url), 'utf8'));
const runtimeFeedbackItem = { id: 'runtime-feedback', label: '运行反馈', children: [] };
const menuFor = (petAvailable, visible = false) => createPetSettingsMenu({
  petAvailable,
  visible,
  t: (key) => key.split('.').reduce((value, part) => value[part], zh),
  runtimeFeedbackItem,
});

test('首次安装时顶部提供选择第一只宠物，不再展示不可用的显示入口', () => {
  const menu = menuFor(false);
  assert.equal(menu[0].label, '选择第一只宠物');
  assert.equal(menu[0].id, 'install:catalog');
  assert.equal(menu[0].disabled, undefined);
  assert.ok(menu[0].iconName);
  assert.deepEqual(menu.map((item) => item.id), [
    'install:catalog', 'separator:runtime', 'runtime-feedback',
  ]);
  assert.equal(menu.at(-1), runtimeFeedbackItem);
});

test('已有宠物但隐藏时，依次提供添加、显示和运行反馈', () => {
  const menu = menuFor(true);
  assert.equal(menu[0].label, '添加宠物');
  assert.equal(menu[1].label, '显示桌宠');
  assert.deepEqual(menu.map((item) => item.id), [
    'install:catalog', 'visibility:show', 'separator:runtime', 'runtime-feedback',
  ]);
});

test('宠物已显示时显示入口切换为隐藏，添加入口保持在顶部', () => {
  const menu = menuFor(true, true);
  assert.equal(menu[0].id, 'install:catalog');
  assert.equal(menu[1].id, 'visibility:hide');
  assert.equal(menu[1].label, '隐藏桌宠');
  assert.equal(menu[1].iconName, 'ext:finch-pet/eye-off');
  assert.equal(menu.at(-1), runtimeFeedbackItem);
});
