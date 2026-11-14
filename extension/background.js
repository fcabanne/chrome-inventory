// Escucha descargas terminadas. Si es un PDF o una imagen, congela la pestaña
// activa (captura) y abre el visor encima. Si no se puede inyectar en esa
// pestaña (chrome://, Web Store, visor de PDF...), lo abre en una pestaña propia.

const IMAGE_EXT = /\.(png|jpe?g|gif|webp|bmp|svg|avif)$/i;

function kindOf(item) {
  const mime = item.mime || "";
  if (mime === "application/pdf" || /\.pdf$/i.test(item.filename)) return "pdf";
  if (mime.startsWith("image/") || IMAGE_EXT.test(item.filename)) return "image";
  return null;
}

chrome.downloads.onChanged.addListener(async (delta) => {
  if (delta.state?.current !== "complete") return;

  const [item] = await chrome.downloads.search({ id: delta.id });
  if (!item) return;
  const kind = kindOf(item);
  if (!kind) return;

  const [tab] = await chrome.tabs.query({ active: true, lastFocusedWindow: true });

  let shot = null;
  if (tab) {
    try {
      shot = await chrome.tabs.captureVisibleTab(tab.windowId, { format: "jpeg", quality: 80 });
    } catch {
      // Páginas que no se pueden capturar: el visor usa fondo negro.
    }
  }

  const key = `open:${item.id}:${Date.now()}`;
  await chrome.storage.session.set({
    [key]: {
      kind,
      filename: item.filename,
      url: item.finalUrl || item.url,
      mime: item.mime,
      shot,
    },
  });

  const viewerUrl = chrome.runtime.getURL(`viewer.html?key=${encodeURIComponent(key)}`);

  if (tab) {
    try {
      await chrome.scripting.executeScript({ target: { tabId: tab.id }, files: ["content.js"] });
      await chrome.scripting.executeScript({
        target: { tabId: tab.id },
        func: (url) => window.__inventoryOpen(url),
        args: [viewerUrl],
      });
      return;
    } catch {
      // Sigue al fallback.
    }
  }
  chrome.tabs.create({ url: `${viewerUrl}&standalone=1` });
});
