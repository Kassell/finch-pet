import assert from 'node:assert/strict';
import test from 'node:test';
import { isHostToCatalogWebviewMessage } from '../dist/shared/catalog-webview-protocol.js';

test('安装状态携带目标宠物 slug 供卡片级 Loading 使用', () => {
  assert.equal(isHostToCatalogWebviewMessage({
    type: 'catalogStatus',
    status: 'installing',
    slug: 'boba',
  }), true);
});

test('安装状态拒绝缺失或非法的目标宠物 slug', () => {
  assert.equal(isHostToCatalogWebviewMessage({
    type: 'catalogStatus',
    status: 'installing',
  }), false);
  assert.equal(isHostToCatalogWebviewMessage({
    type: 'catalogStatus',
    status: 'installing',
    slug: '',
  }), false);
  assert.equal(isHostToCatalogWebviewMessage({
    type: 'catalogStatus',
    status: 'installing',
    slug: 42,
  }), false);
});
