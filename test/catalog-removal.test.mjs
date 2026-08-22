import assert from 'node:assert/strict';
import test from 'node:test';
import {
  beginCatalogRemoval,
  finishCatalogRemoval,
  rollbackCatalogRemoval,
} from '../dist/host/application/catalog-removal.js';

const createState = () => ({
  installedPetNames: new Set(['hoops']),
  removablePetNames: new Set(['hoops']),
  pendingRemovalNames: new Set(),
});

test('画廊删除立即乐观移除已安装状态', () => {
  const state = createState();
  assert.equal(beginCatalogRemoval(state, 'hoops'), true);
  assert.equal(state.installedPetNames.has('hoops'), false);
  assert.equal(state.removablePetNames.has('hoops'), false);
  assert.equal(state.pendingRemovalNames.has('hoops'), true);
  finishCatalogRemoval(state, 'hoops');
  assert.equal(state.pendingRemovalNames.has('hoops'), false);
});

test('画廊删除期间拒绝同一宠物重复删除', () => {
  const state = createState();
  assert.equal(beginCatalogRemoval(state, 'hoops'), true);
  assert.equal(beginCatalogRemoval(state, 'hoops'), false);
});

test('画廊删除失败恢复已安装与可删除状态', () => {
  const state = createState();
  beginCatalogRemoval(state, 'hoops');
  rollbackCatalogRemoval(state, 'hoops');
  assert.equal(state.installedPetNames.has('hoops'), true);
  assert.equal(state.removablePetNames.has('hoops'), true);
  assert.equal(state.pendingRemovalNames.has('hoops'), false);
});
