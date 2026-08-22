export function applyCatalogInstallStatus(
  installingSlugs: Set<string>,
  status: 'loading' | 'idle' | 'installing' | 'error',
  slug?: string,
): void {
  if (!slug) return;
  if (status === 'installing') installingSlugs.add(slug);
  else if (status === 'idle') installingSlugs.delete(slug);
}
