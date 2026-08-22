export interface CatalogWebviewStrings {
  title: string;
  subtitle: string;
  loading: string;
  installing: string;
  install: string;
  installed: string;
  remove: string;
  noResults: string;
}

export interface CatalogWebviewPet {
  slug: string;
  displayName: string;
  description: string;
  installed: boolean;
  removable: boolean;
}

export type HostToCatalogWebviewMessage =
  | {
      type: 'catalogData';
      strings: CatalogWebviewStrings;
      pets: CatalogWebviewPet[];
    }
  | {
      type: 'catalogStatus';
      status: 'loading' | 'idle' | 'installing' | 'error';
      message?: string;
      slug?: string;
    }
  | {
      type: 'catalogPreview';
      slug: string;
      dataUrl: string;
    };

export type CatalogWebviewToHostMessage =
  | { type: 'catalogReady' }
  | { type: 'catalogSelect'; slug: string }
  | { type: 'catalogRemove'; slug: string };

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

export function isCatalogWebviewToHostMessage(value: unknown): value is CatalogWebviewToHostMessage {
  if (!isRecord(value)) return false;
  if (value.type === 'catalogReady') return true;
  return (value.type === 'catalogSelect' || value.type === 'catalogRemove')
    && typeof value.slug === 'string'
    && value.slug.length > 0
    && value.slug.length <= 80;
}

export function isHostToCatalogWebviewMessage(value: unknown): value is HostToCatalogWebviewMessage {
  if (!isRecord(value)) return false;
  if (value.type === 'catalogStatus') {
    const validSlug = typeof value.slug === 'string' && value.slug.length > 0 && value.slug.length <= 80;
    return (value.status === 'loading' || value.status === 'idle' || value.status === 'installing' || value.status === 'error')
      && (value.message === undefined || typeof value.message === 'string')
      && (value.status === 'installing' ? validSlug : value.slug === undefined || validSlug);
  }
  if (value.type === 'catalogPreview') {
    return typeof value.slug === 'string'
      && value.slug.length > 0
      && value.slug.length <= 80
      && typeof value.dataUrl === 'string'
      && value.dataUrl.startsWith('data:image/webp;base64,')
      && value.dataUrl.length <= 3 * 1024 * 1024;
  }
  if (value.type !== 'catalogData' || !isRecord(value.strings) || !Array.isArray(value.pets)) return false;
  return Object.values(value.strings).every((item) => typeof item === 'string')
    && value.pets.every((item) => isRecord(item)
      && typeof item.slug === 'string'
      && typeof item.displayName === 'string'
      && typeof item.description === 'string'
      && typeof item.installed === 'boolean'
      && typeof item.removable === 'boolean');
}
