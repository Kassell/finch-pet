const FRAME_WIDTH = 192;
const FRAME_HEIGHT = 208;
const ATLAS_COLUMNS = 8;
const FRAME_ASPECT_RATIO = FRAME_WIDTH / FRAME_HEIGHT;

export interface CatalogFirstFrameLayout {
  clipLeft: number;
  clipTop: number;
  clipWidth: number;
  clipHeight: number;
  imageWidth: number;
  imageHeight: number;
  frameCount: number;
  frameStep: number;
}

/**
 * 按 Petdex 官方的 192×208 帧格裁切第一帧。
 * preview.webp 是单行帧条；缺失时也兼容固定 8 列的完整 atlas。
 */
export function catalogFirstFrameLayout(input: {
  naturalWidth: number;
  naturalHeight: number;
  previewWidth: number;
  previewHeight: number;
  fillRatio?: number;
}): CatalogFirstFrameLayout | undefined {
  const { naturalWidth, naturalHeight, previewWidth, previewHeight } = input;
  if (naturalWidth <= 0 || naturalHeight <= 0 || previewWidth <= 0 || previewHeight <= 0) return undefined;

  const isPreviewRow = naturalWidth / naturalHeight > 2;
  const sourceFrameWidth = isPreviewRow
    ? naturalHeight * FRAME_ASPECT_RATIO
    : naturalWidth / ATLAS_COLUMNS;
  const sourceFrameHeight = sourceFrameWidth / FRAME_ASPECT_RATIO;
  const fillRatio = input.fillRatio ?? 0.72;
  const scale = Math.min(
    (previewWidth * fillRatio) / sourceFrameWidth,
    (previewHeight * fillRatio) / sourceFrameHeight,
  );
  const clipWidth = sourceFrameWidth * scale;
  const clipHeight = sourceFrameHeight * scale;
  const frameCount = Math.max(1, Math.min(12, Math.round(naturalWidth / sourceFrameWidth)));

  return {
    clipLeft: (previewWidth - clipWidth) / 2,
    clipTop: (previewHeight - clipHeight) / 2,
    clipWidth,
    clipHeight,
    imageWidth: naturalWidth * scale,
    imageHeight: naturalHeight * scale,
    frameCount,
    frameStep: clipWidth,
  };
}
