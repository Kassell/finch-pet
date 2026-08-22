import assert from 'node:assert/strict';
import test from 'node:test';
import { applyCatalogInstallStatus } from '../dist/shared/catalog-install-state.js';

test('多个宠物可同时保持独立的排队安装状态', () => {
  const installing = new Set();
  applyCatalogInstallStatus(installing, 'installing', 'shinchan');
  applyCatalogInstallStatus(installing, 'installing', 'tiko');
  assert.deepEqual([...installing], ['shinchan', 'tiko']);

  applyCatalogInstallStatus(installing, 'idle', 'shinchan');
  assert.deepEqual([...installing], ['tiko']);
});

test('全局 idle 不会误清除仍在排队的卡片', () => {
  const installing = new Set(['shinchan']);
  applyCatalogInstallStatus(installing, 'idle');
  assert.deepEqual([...installing], ['shinchan']);
});
