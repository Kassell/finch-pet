export function safePetName(value: unknown, fallback = 'pet'): string {
  const raw = typeof value === 'string' && value.trim() ? value.trim() : fallback;
  const safe = raw
    .toLowerCase()
    .replace(/\s+/g, '-')
    .replace(/[^a-z0-9_-]/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '');
  return safe || fallback;
}

export function displayNameOf(pet: Record<string, unknown>, fallback: string): string {
  return typeof pet.displayName === 'string' ? pet.displayName : typeof pet.name === 'string' ? pet.name : fallback;
}

export function petIdOf(pet: Record<string, unknown>, fallback: string): string {
  return safePetName(typeof pet.id === 'string' ? pet.id : fallback, fallback);
}

export function isHttpUrl(value: string): boolean {
  try {
    const url = new URL(value);
    return url.protocol === 'https:' || url.protocol === 'http:';
  } catch {
    return false;
  }
}

export function isRemoteSpritesheetUrl(value: string): boolean {
  try {
    const url = new URL(value);
    if (url.protocol !== 'https:' && url.protocol !== 'http:') return false;
    return /\.(webp|png)$/i.test(url.pathname);
  } catch {
    return false;
  }
}

export function petdexSlugFromUrl(value: string): string | undefined {
  try {
    const url = new URL(value);
    if (url.hostname !== 'petdex.dev' && url.hostname !== 'www.petdex.dev') return undefined;
    const match = url.pathname.match(/^\/pets\/([^/?#]+)/);
    return match ? safePetName(decodeURIComponent(match[1])) : undefined;
  } catch {
    return undefined;
  }
}

export function firstMatch(text: string, patterns: RegExp[]): string | undefined {
  for (const pattern of patterns) {
    const match = text.match(pattern);
    if (match?.[1]) return match[1].replace(/\\\//g, '/').replace(/&amp;/g, '&');
  }
  return undefined;
}

export function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
