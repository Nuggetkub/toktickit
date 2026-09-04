/**
 * Hands a downloaded blob to the browser as a saved file.
 *
 * The attachment endpoint needs the `X-Dev-Requester-Id` header, which a plain
 * link cannot carry, so the bytes arrive through fetch and this is what turns
 * them back into a download. The object URL is revoked immediately afterwards:
 * it holds the whole file in memory until it is, and a detail screen visited
 * repeatedly would otherwise accumulate them.
 */
export function saveBlob(blob: Blob, filename: string): void {
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  link.remove();
  URL.revokeObjectURL(url);
}
