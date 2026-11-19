/**
 * Saves text as a file from memory. The browser writes it straight to the user's
 * downloads; no request is made and nothing is kept by the app afterwards.
 */
const live = new Set<string>();

export function downloadText(filename: string, content: string, type = "text/csv;charset=utf-8"): void {
  const url = URL.createObjectURL(new Blob([content], { type }));
  live.add(url);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = filename;
  anchor.rel = "noopener";
  anchor.style.display = "none";
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
  // The browser needs the reference for a moment to start the save; then it is released.
  window.setTimeout(() => release(url), 60_000);
}

function release(url: string): void {
  if (!live.delete(url)) return;
  URL.revokeObjectURL(url);
}

/** Releases every download reference this tab still holds. Files already saved are not affected. */
export function revokeDownloads(): void {
  for (const url of [...live]) release(url);
}

export function liveDownloadCount(): number {
  return live.size;
}
