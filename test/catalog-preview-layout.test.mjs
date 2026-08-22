import assert from 'node:assert/strict';
import test from 'node:test';
import { catalogFirstFrameLayout } from '../dist/shared/catalog-preview-layout.js';

const closeTo = (actual, expected) => assert.ok(Math.abs(actual - expected) < 0.001, `${actual} ≠ ${expected}`);

const assertCenteredFirstFrame = (layout, previewWidth, previewHeight) => {
  assert.ok(layout);
  closeTo(layout.clipLeft * 2 + layout.clipWidth, previewWidth);
  closeTo(layout.clipTop * 2 + layout.clipHeight, previewHeight);
  assert.ok(layout.imageWidth > layout.clipWidth);
  assert.ok(layout.imageHeight >= layout.clipHeight);
};

test('Petdex preview.webp 单行帧条只暴露第一格', () => {
  const layout = catalogFirstFrameLayout({
    naturalWidth: 192 * 6,
    naturalHeight: 208,
    previewWidth: 200,
    previewHeight: 140,
  });
  assertCenteredFirstFrame(layout, 200, 140);
  closeTo(layout.imageWidth / layout.clipWidth, 6);
  closeTo(layout.imageHeight, layout.clipHeight);
  assert.equal(layout.frameCount, 6);
  closeTo(layout.frameStep, layout.clipWidth);
});

test('Petdex v1 8×9 atlas 按 192×208 首格裁切', () => {
  const layout = catalogFirstFrameLayout({
    naturalWidth: 192 * 8,
    naturalHeight: 208 * 9,
    previewWidth: 200,
    previewHeight: 140,
  });
  assertCenteredFirstFrame(layout, 200, 140);
  closeTo(layout.imageWidth / layout.clipWidth, 8);
  closeTo(layout.imageHeight / layout.clipHeight, 9);
  assert.equal(layout.frameCount, 8);
});

test('Petdex v2 8×11 与高清 atlas 保持相同首帧窗口', () => {
  const classic = catalogFirstFrameLayout({
    naturalWidth: 192 * 8,
    naturalHeight: 208 * 11,
    previewWidth: 176,
    previewHeight: 120,
  });
  const retina = catalogFirstFrameLayout({
    naturalWidth: 192 * 8 * 2,
    naturalHeight: 208 * 11 * 2,
    previewWidth: 176,
    previewHeight: 120,
  });
  assertCenteredFirstFrame(classic, 176, 120);
  assertCenteredFirstFrame(retina, 176, 120);
  closeTo(classic.clipWidth, retina.clipWidth);
  closeTo(classic.clipHeight, retina.clipHeight);
});
