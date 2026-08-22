const PETDEX_HOME_URL = 'https://petdex.dev/';
const PETDEX_CATALOG_API_URL = 'https://petdex.dev/api/pets/search';
const PETDEX_ASSET_HOST = 'assets.petdex.dev';
/** 限制目录响应体，避免远端页面异常时占用过多内存。 */
const MAX_CATALOG_HTML_BYTES = 3 * 1024 * 1024;
/** 目录与预览请求都应快速失败，不能阻塞小程序菜单或 MCP 调用。 */
const PETDEX_REQUEST_TIMEOUT_MS = 12_000;

export interface PetdexCatalogItem {
  slug: string;
  displayName: string;
  description: string;
  pageUrl: string;
  previewUrl: string;
  spritesheetUrl: string;
}

const decodeJsonString = (value: string): string => {
  try { return JSON.parse(`"${value}"`) as string; } catch { return value; }
};

const safeAssetUrl = (value: string): string | undefined => {
  try {
    const url = new URL(value);
    return url.protocol === 'https:' && url.hostname === PETDEX_ASSET_HOST ? url.toString() : undefined;
  } catch {
    return undefined;
  }
};

/**
 * Petdex 的 Next 页面把首批画廊数据作为转义 JSON 注入 HTML。
 * 这里只读取稳定的公开字段，不执行页面脚本，也不信任任意资源主机。
 */
export function parsePetdexCatalog(html: string, limit = 12): PetdexCatalogItem[] {
  const decoded = html.replace(/\\"/g, '"');
  const galleryStart = decoded.indexOf('"initial":{"pets":[');
  const catalogSource = galleryStart >= 0 ? decoded.slice(galleryStart) : decoded;
  const itemPattern = /"slug":"([^"\\]+)","displayName":"((?:\\.|[^"\\])*)","description":"((?:\\.|[^"\\])*)","spritesheetPath":"(https:\/\/[^"\\]+)"/g;
  const items = new Map<string, PetdexCatalogItem>();
  let match: RegExpExecArray | null;
  while ((match = itemPattern.exec(catalogSource)) && items.size < Math.max(1, Math.min(30, limit))) {
    const slug = match[1].trim();
    const spritesheetUrl = safeAssetUrl(match[4]);
    if (!/^[a-z0-9][a-z0-9-]{0,79}$/.test(slug) || !spritesheetUrl || items.has(slug)) continue;
    items.set(slug, {
      slug,
      displayName: decodeJsonString(match[2]).trim().slice(0, 80) || slug,
      description: decodeJsonString(match[3]).trim().replace(/\s+/g, ' ').slice(0, 240),
      pageUrl: `https://petdex.dev/pets/${encodeURIComponent(slug)}`,
      previewUrl: `https://${PETDEX_ASSET_HOST}/pets/${encodeURIComponent(slug)}/preview.webp`,
      spritesheetUrl,
    });
  }
  return [...items.values()];
}

export async function fetchPetdexCatalog(limit = 12): Promise<PetdexCatalogItem[]> {
  const requestedLimit = Math.max(1, Math.min(30, Math.round(limit)));
  const url = new URL(PETDEX_CATALOG_API_URL);
  url.searchParams.set('sort', 'installed');
  url.searchParams.set('cursor', '0');
  url.searchParams.set('limit', String(requestedLimit));
  const response = await fetch(url, { signal: AbortSignal.timeout(PETDEX_REQUEST_TIMEOUT_MS) });
  if (!response.ok) throw new Error(`Petdex catalog request failed: ${response.status}`);
  const declaredLength = Number(response.headers.get('content-length') || 0);
  if (declaredLength > MAX_CATALOG_HTML_BYTES) throw new Error('Petdex catalog response is too large.');
  const text = await response.text();
  if (Buffer.byteLength(text, 'utf8') > MAX_CATALOG_HTML_BYTES) throw new Error('Petdex catalog response is too large.');
  let payload: unknown;
  try { payload = JSON.parse(text); } catch { throw new Error('Petdex catalog returned invalid JSON.'); }
  const rawPets = typeof payload === 'object' && payload !== null && Array.isArray((payload as { pets?: unknown }).pets)
    ? (payload as { pets: unknown[] }).pets
    : [];
  const items = new Map<string, PetdexCatalogItem>();
  for (const raw of rawPets) {
    if (typeof raw !== 'object' || raw === null) continue;
    const pet = raw as Record<string, unknown>;
    const slug = typeof pet.slug === 'string' ? pet.slug.trim() : '';
    const spritesheetUrl = typeof pet.spritesheetPath === 'string' ? safeAssetUrl(pet.spritesheetPath) : undefined;
    if (!/^[a-z0-9][a-z0-9-]{0,79}$/.test(slug) || !spritesheetUrl || items.has(slug)) continue;
    items.set(slug, {
      slug,
      displayName: typeof pet.displayName === 'string' ? pet.displayName.trim().slice(0, 80) || slug : slug,
      description: typeof pet.description === 'string' ? pet.description.trim().replace(/\s+/g, ' ').slice(0, 240) : '',
      pageUrl: `${PETDEX_HOME_URL}pets/${encodeURIComponent(slug)}`,
      previewUrl: `https://${PETDEX_ASSET_HOST}/pets/${encodeURIComponent(slug)}/preview.webp`,
      spritesheetUrl,
    });
    if (items.size >= requestedLimit) break;
  }
  if (!items.size) throw new Error('Petdex catalog did not contain any compatible pets.');
  return [...items.values()];
}

export async function fetchPetdexPreview(item: PetdexCatalogItem): Promise<{ data: string; mimeType: 'image/webp' } | undefined> {
  try {
    const response = await fetch(item.previewUrl, { signal: AbortSignal.timeout(PETDEX_REQUEST_TIMEOUT_MS) });
    if (!response.ok) return undefined;
    const bytes = Buffer.from(await response.arrayBuffer());
    if (!bytes.length || bytes.length > 2 * 1024 * 1024) return undefined;
    return { data: bytes.toString('base64'), mimeType: 'image/webp' };
  } catch {
    return undefined;
  }
}
