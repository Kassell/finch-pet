import type * as finch from 'finch';
import {
  isHostToCatalogWebviewMessage,
  type CatalogWebviewPet,
  type CatalogWebviewStrings,
} from '../shared/catalog-webview-protocol.js';
import { catalogFirstFrameLayout } from '../shared/catalog-preview-layout.js';
import { applyCatalogInstallStatus } from '../shared/catalog-install-state.js';

declare global {
  interface Window { finch: finch.WebviewBridgeApi; }
}

const title = document.querySelector<HTMLHeadingElement>('#title')!;
const subtitle = document.querySelector<HTMLParagraphElement>('#subtitle')!;
const grid = document.querySelector<HTMLDivElement>('#grid')!;
const empty = document.querySelector<HTMLDivElement>('#empty')!;
const overlay = document.querySelector<HTMLDivElement>('#overlay')!;
const statusMessage = document.querySelector<HTMLParagraphElement>('#status-message')!;

let strings: CatalogWebviewStrings = {
  title: 'Pet Gallery',
  subtitle: '',
  loading: 'Loading pets…',
  installing: 'Installing your pet…',
  install: 'Install',
  installed: 'Installed',
  remove: 'Remove',
  noResults: 'No pets found',
};
let pets: CatalogWebviewPet[] = [];
const previewDataUrls = new Map<string, string>();
let busy = true;
const installingSlugs = new Set<string>();
const activePreviewStops = new Set<() => void>();
const prefersReducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)');

function render(): void {
  for (const stop of [...activePreviewStops]) stop();
  title.textContent = strings.title;
  subtitle.textContent = strings.subtitle;
  empty.textContent = strings.noResults;
  empty.hidden = pets.length > 0;
  grid.replaceChildren(...pets.map(createPetCard));
}

function layoutFirstFrame(preview: HTMLElement, frame: HTMLElement, image: HTMLImageElement): void {
  const layout = catalogFirstFrameLayout({
    naturalWidth: image.naturalWidth,
    naturalHeight: image.naturalHeight,
    previewWidth: preview.clientWidth,
    previewHeight: preview.clientHeight,
  });
  if (!layout) return;
  frame.style.width = `${layout.clipWidth}px`;
  frame.style.height = `${layout.clipHeight}px`;
  frame.style.left = `${layout.clipLeft}px`;
  frame.style.top = `${layout.clipTop}px`;
  image.style.width = `${layout.imageWidth}px`;
  image.style.height = `${layout.imageHeight}px`;
  image.style.transform = 'translateX(0)';
  image.dataset.frameCount = String(layout.frameCount);
  image.dataset.frameStep = String(layout.frameStep);
}

function createPetCard(pet: CatalogWebviewPet): HTMLDivElement {
  const card = document.createElement('div');
  const installing = installingSlugs.has(pet.slug);
  const interactionLocked = busy || installing;
  card.className = `pet-card ${pet.installed ? 'installed' : 'installable'}${pet.removable ? ' removable' : ''}${installing ? ' installing' : ''}${interactionLocked ? ' busy' : ''}`;
  card.dataset.slug = pet.slug;
  card.setAttribute('aria-label', pet.installed ? `${pet.displayName} · ${strings.installed}` : pet.displayName);

  const preview = document.createElement('div');
  preview.className = 'pet-preview';
  const frame = document.createElement('div');
  frame.className = 'pet-first-frame';
  const image = document.createElement('img');
  image.alt = '';
  image.decoding = 'async';
  let animationTimer: ReturnType<typeof setInterval> | undefined;
  let frameIndex = 0;
  const stopPreview = () => {
    if (animationTimer) clearInterval(animationTimer);
    animationTimer = undefined;
    frameIndex = 0;
    image.style.transform = 'translateX(0)';
    activePreviewStops.delete(stopPreview);
  };
  const startPreview = () => {
    if (installing || prefersReducedMotion.matches || animationTimer) return;
    const frameCount = Number(image.dataset.frameCount || 1);
    const frameStep = Number(image.dataset.frameStep || 0);
    if (frameCount <= 1 || frameStep <= 0) return;
    activePreviewStops.add(stopPreview);
    animationTimer = setInterval(() => {
      frameIndex = (frameIndex + 1) % frameCount;
      image.style.transform = `translateX(${-frameIndex * frameStep}px)`;
    }, 150);
  };
  image.addEventListener('load', () => {
    layoutFirstFrame(preview, frame, image);
    preview.classList.add('loaded');
    if (card.matches(':hover, :focus-within')) startPreview();
  });
  card.addEventListener('mouseenter', startPreview);
  card.addEventListener('mouseleave', stopPreview);
  card.addEventListener('focusin', startPreview);
  card.addEventListener('focusout', (event) => {
    if (event.relatedTarget instanceof Node && card.contains(event.relatedTarget)) return;
    stopPreview();
  });
  const previewDataUrl = previewDataUrls.get(pet.slug);
  if (previewDataUrl) image.src = previewDataUrl;
  frame.append(image);
  preview.append(frame);
  if (installing) {
    const installingOverlay = document.createElement('div');
    installingOverlay.className = 'installing-overlay';
    const spinner = document.createElement('div');
    spinner.className = 'spinner card-spinner';
    spinner.setAttribute('aria-hidden', 'true');
    const label = document.createElement('span');
    label.textContent = strings.installing;
    installingOverlay.append(spinner, label);
    preview.append(installingOverlay);
  }

  const copy = document.createElement('div');
  copy.className = 'pet-copy';
  const name = document.createElement('div');
  name.className = 'pet-name';
  name.textContent = pet.displayName;
  const description = document.createElement('div');
  description.className = 'pet-description';
  description.textContent = pet.description;
  copy.append(name, description);
  card.append(preview, copy);

  if (pet.installed) {
    const installedBadge = document.createElement('span');
    installedBadge.className = 'installed-badge';
    installedBadge.textContent = strings.installed;
    preview.append(installedBadge);
    if (pet.removable) {
      const removeButton = document.createElement('button');
      removeButton.type = 'button';
      removeButton.className = 'remove-pet';
      removeButton.textContent = strings.remove;
      removeButton.disabled = interactionLocked;
      removeButton.addEventListener('click', (event) => {
        event.preventDefault();
        event.stopPropagation();
        if (interactionLocked) return;
        window.finch.postMessage({ type: 'catalogRemove', slug: pet.slug });
      });
      preview.append(removeButton);
    }
  } else if (!installing) {
    const installButton = document.createElement('button');
    installButton.type = 'button';
    installButton.className = 'install-pet';
    installButton.textContent = strings.install;
    installButton.addEventListener('click', (event) => {
      event.preventDefault();
      event.stopPropagation();
      window.finch.postMessage({ type: 'catalogSelect', slug: pet.slug });
    });
    preview.append(installButton);
  }
  return card;
}

function setPreview(slug: string, dataUrl: string): void {
  previewDataUrls.set(slug, dataUrl);
  const card = [...grid.querySelectorAll<HTMLDivElement>('.pet-card')]
    .find((item) => item.dataset.slug === slug);
  const preview = card?.querySelector<HTMLSpanElement>('.pet-preview');
  const image = preview?.querySelector<HTMLImageElement>('img');
  if (!preview || !image) return;
  preview.classList.remove('loaded');
  image.src = dataUrl;
}

function setStatus(status: 'loading' | 'idle' | 'installing' | 'error', message?: string, slug?: string): void {
  busy = status === 'loading';
  applyCatalogInstallStatus(installingSlugs, status, slug);
  overlay.hidden = status === 'idle' || status === 'installing';
  overlay.classList.toggle('error', status === 'error');
  statusMessage.textContent = message || (status === 'loading' ? strings.loading : '');
  render();
}

window.addEventListener('resize', () => {
  for (const preview of grid.querySelectorAll<HTMLElement>('.pet-preview')) {
    const frame = preview.querySelector<HTMLElement>('.pet-first-frame');
    const image = frame?.querySelector<HTMLImageElement>('img');
    if (frame && image?.complete) layoutFirstFrame(preview, frame, image);
  }
});

window.finch.onMessage((raw) => {
  if (!isHostToCatalogWebviewMessage(raw)) return;
  if (raw.type === 'catalogData') {
    strings = raw.strings;
    pets = raw.pets;
    render();
    return;
  }
  if (raw.type === 'catalogPreview') {
    setPreview(raw.slug, raw.dataUrl);
    return;
  }
  setStatus(raw.status, raw.message, raw.slug);
});

window.finch.postMessage({ type: 'catalogReady' });
