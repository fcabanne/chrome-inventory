import * as pdfjs from "./vendor/pdfjs/pdf.min.mjs";
import { extractParagraphs } from "./pdftext.js";
import { sounds } from "./sound.js";

pdfjs.GlobalWorkerOptions.workerSrc = new URL("vendor/pdfjs/pdf.worker.min.mjs", location.href).href;

const $ = (sel) => document.querySelector(sel);
const params = new URLSearchParams(location.search);
const hasChrome = typeof chrome !== "undefined" && !!chrome.runtime?.id;

const els = {
  shot: $("#shot"),
  stage: $("#stage"),
  zoom: $("#zoom"),
  item: $("#item"),
  front: $(".face.front"),
  back: $(".face.back"),
  message: $("#message"),
  reader: $("#reader"),
  readerScroll: $("#reader-scroll"),
  readerBody: $("#reader-body"),
  pager: $("#pager"),
  pagerCount: $("#pager .count"),
  pagerPrev: $("#pager .prev"),
  pagerNext: $("#pager .next"),
  title: $("#title span"),
  hints: $("#hints"),
};

const state = {
  mode: "loading", // loading | inspect | read | error | closing
  kind: null, // pdf | image
  info: null,
  pdf: null,
  page: 1,
  pages: 1,
  aspect: 1 / Math.SQRT2, // ancho / alto
  frontCanvas: null,
  image: null,
  paragraphs: null,
  flow: null, // texto de Leer, paginado por pantalla
  readPage: 0,
  readPages: 1,
  rx: 0,
  ry: 0,
  zoom: 1,
};

// ---------- Datos de la descarga ----------

async function loadInfo() {
  // Modo demo para probar el visor fuera de la extensión: viewer.html?demo=archivo.pdf&shot=fondo.png
  if (params.has("demo")) {
    const url = params.get("demo");
    return {
      kind: /.pdf$/i.test(url) ? "pdf" : "image",
      filename: url,
      url,
      shot: params.get("shot"),
    };
  }
  const key = params.get("key");
  const data = (await chrome.storage.session.get(key))[key];
  chrome.storage.session.remove(key);
  return data;
}

function toFileUrl(path) {
  const parts = path.split(/[\\/]/).map((part, i) => (i === 0 && /^[a-z]:$/i.test(part) ? part : encodeURIComponent(part)));
  const joined = parts.join("/");
  return joined.startsWith("/") ? `file://${joined}` : `file:///${joined}`;
}

function readFileUrl(url) {
  // fetch() no soporta file://, XHR sí (si el usuario habilitó el acceso a archivos).
  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.open("GET", url);
    xhr.responseType = "arraybuffer";
    xhr.onload = () => (xhr.response?.byteLength ? resolve(xhr.response) : reject(new Error("vacío")));
    xhr.onerror = () => reject(new Error("xhr"));
    xhr.send();
  });
}

async function loadBytes(info) {
  if (hasChrome && info.filename && (await chrome.extension.isAllowedFileSchemeAccess())) {
    try {
      return await readFileUrl(toFileUrl(info.filename));
    } catch {
      // Sigue con la URL original.
    }
  }
  if (info.url && !info.url.startsWith("blob:")) {
    const res = await fetch(info.url, { credentials: "include" });
    if (res.ok) return res.arrayBuffer();
  }
  throw new Error("no-bytes");
}

// ---------- Render del ítem ----------

function fitItem() {
  const maxW = window.innerWidth * 0.44;
  const maxH = window.innerHeight * 0.5;
  let w = maxH * state.aspect;
  let h = maxH;
  if (w > maxW) {
    w = maxW;
    h = maxW / state.aspect;
  }
  els.item.style.width = `${Math.round(w)}px`;
  els.item.style.height = `${Math.round(h)}px`;
  return { w, h };
}

async function renderPdfPage(n) {
  const page = await state.pdf.getPage(n);
  const base = page.getViewport({ scale: 1 });
  state.aspect = base.width / base.height;
  const { w } = fitItem();

  // Resolución pensada para aguantar el zoom máximo sin verse borroso.
  const target = Math.min(Math.max(w * devicePixelRatio * 2.2, 1400), 4096);
  const viewport = page.getViewport({ scale: target / base.width });
  const canvas = document.createElement("canvas");
  canvas.width = Math.round(viewport.width);
  canvas.height = Math.round(viewport.height);
  await page.render({ canvasContext: canvas.getContext("2d"), viewport }).promise;

  state.frontCanvas = canvas;
  els.front.querySelector(".content").replaceChildren(canvas);

  // El reverso deja ver la tinta del frente, espejada y apenas visible.
  const bleed = document.createElement("canvas");
  bleed.width = Math.round(canvas.width / 4);
  bleed.height = Math.round(canvas.height / 4);
  bleed.getContext("2d").drawImage(canvas, 0, 0, bleed.width, bleed.height);
  els.back.querySelector(".content").replaceChildren(bleed);

  if (state.mode === "inspect") renderHints();
}

async function showImage(bytes, info) {
  const type = info.mime || (/\.svg$/i.test(info.filename) ? "image/svg+xml" : "");
  const img = new Image();
  img.src = URL.createObjectURL(new Blob([bytes], type ? { type } : {}));
  img.draggable = false;
  await img.decode();
  state.image = img;
  state.aspect = (img.naturalWidth || 1) / (img.naturalHeight || 1);
  fitItem();
  els.front.classList.add("photo");
  els.back.classList.add("photo");
  els.front.querySelector(".content").replaceChildren(img);
}

// ---------- Rotación, luz y zoom ----------

const LIGHT = (() => {
  const v = [-0.45, -0.55, 0.7]; // arriba a la izquierda, hacia el espectador
  const len = Math.hypot(...v);
  return v.map((c) => c / len);
})();

function applyTransform() {
  els.item.style.transform = `rotateX(${state.rx}deg) rotateY(${state.ry}deg)`;
  els.zoom.style.transform = `scale(${state.zoom})`;

  // Rota la normal de cada cara (mismo orden que el transform de CSS) y la
  // oscurece según cuánto mire hacia la luz. Al frente en reposo no la toca.
  const rx = (state.rx * Math.PI) / 180;
  const ry = (state.ry * Math.PI) / 180;
  const rest = LIGHT[2];
  for (const face of els.item.querySelectorAll("[data-normal]")) {
    const [x, y, z] = face.dataset.normal.split(",").map(Number);
    const x1 = x * Math.cos(ry) + z * Math.sin(ry);
    const z1 = -x * Math.sin(ry) + z * Math.cos(ry);
    const y2 = y * Math.cos(rx) - z1 * Math.sin(rx);
    const z2 = y * Math.sin(rx) + z1 * Math.cos(rx);
    const facing = x1 * LIGHT[0] + y2 * LIGHT[1] + z2 * LIGHT[2];
    const dim = Math.min(0.85, Math.max(0, (rest - Math.max(facing, 0)) / rest) * 0.85);
    face.style.setProperty("--dim", dim.toFixed(3));
  }
}

let drag = null;

// Sin esto Chrome arranca su propio arrastre de la imagen y se come el giro.
window.addEventListener("dragstart", (e) => e.preventDefault());

els.stage.addEventListener("pointerdown", (e) => {
  if (state.mode !== "inspect" || e.button !== 0) return;
  e.preventDefault();
  drag = { x: e.clientX, y: e.clientY, rx: state.rx, ry: state.ry };
  els.stage.setPointerCapture(e.pointerId);
  els.stage.classList.add("dragging");
});

els.stage.addEventListener("pointermove", (e) => {
  if (!drag) return;
  state.ry = drag.ry + (e.clientX - drag.x) * 0.4;
  state.rx = Math.max(-75, Math.min(75, drag.rx - (e.clientY - drag.y) * 0.4));
  applyTransform();
});

const endDrag = () => {
  drag = null;
  els.stage.classList.remove("dragging");
};
els.stage.addEventListener("pointerup", endDrag);
els.stage.addEventListener("pointercancel", endDrag);

// Rueda: con el click apretado hace zoom; suelta, pasa de página (del PDF al
// inspeccionar, de pantalla al leer).
let wheelTotal = 0;
let wheelLockUntil = 0;

window.addEventListener(
  "wheel",
  (e) => {
    const reading = state.mode === "read" && state.flow;
    if (state.mode !== "inspect" && !reading) return;
    e.preventDefault();
    if (drag) {
      state.zoom = Math.max(0.6, Math.min(2.4, state.zoom * Math.exp(-e.deltaY * 0.0015)));
      applyTransform();
      return;
    }
    if (!reading && state.kind !== "pdf") return;
    // Un trackpad manda muchos deltas chicos: se acumulan y se pasa una página por gesto.
    if (performance.now() < wheelLockUntil) {
      wheelTotal = 0;
      return;
    }
    wheelTotal += e.deltaY;
    if (Math.abs(wheelTotal) < 60) return;
    reading ? turnReadPage(Math.sign(wheelTotal)) : changePage(Math.sign(wheelTotal));
    wheelTotal = 0;
    wheelLockUntil = performance.now() + 350;
  },
  { passive: false }
);

// ---------- Modo lectura ----------

async function openReader() {
  if (state.kind === "pdf" && !state.paragraphs) {
    state.paragraphs = await extractParagraphs(state.pdf);
  }
  const chars = state.paragraphs?.flat().join("").length ?? 0;
  const body = els.readerBody;
  let anchor = null;
  state.flow = null;

  if (chars > 20) {
    // Todo el texto seguido: las pantallas de lectura no respetan las páginas del PDF.
    const flow = document.createElement("div");
    flow.className = "flow";
    state.paragraphs.forEach((paragraphs, i) => {
      paragraphs.forEach((text, j) => {
        const p = document.createElement("p");
        p.textContent = text;
        if (j === 0 && i + 1 === state.page) anchor = p;
        flow.append(p);
      });
    });
    body.className = "paged";
    body.replaceChildren(flow);
    state.flow = flow;
  } else {
    // Sin texto (foto o escaneo): la página plana y nítida.
    body.className = "flat";
    body.replaceChildren(state.kind === "pdf" ? cloneCanvas(state.frontCanvas) : state.image.cloneNode());
  }

  state.mode = "read";
  sounds.read();
  els.reader.hidden = false;
  els.pager.hidden = !state.flow;
  els.readerScroll.scrollTop = 0;
  if (state.flow) {
    // Arranca en la pantalla donde empieza la página del PDF que se estaba mirando.
    state.readPage = 0;
    layoutRead();
    if (anchor) {
      const offset = anchor.getBoundingClientRect().left - state.flow.getBoundingClientRect().left;
      state.readPage = Math.min(state.readPages - 1, Math.round(offset / readStep()));
    }
    showReadPage();
  }
  requestAnimationFrame(() => els.reader.classList.add("visible"));
  els.readerScroll.focus();
  renderHints();
}

// Ancho de una pantalla de lectura más la separación entre columnas.
function readStep() {
  return els.readerBody.clientWidth + parseFloat(getComputedStyle(state.flow).columnGap);
}

function layoutRead() {
  const gap = parseFloat(getComputedStyle(state.flow).columnGap);
  state.readPages = Math.max(1, Math.round((state.flow.scrollWidth + gap) / readStep()));
  state.readPage = Math.min(state.readPage, state.readPages - 1);
}

function showReadPage() {
  state.flow.style.setProperty("--page", state.readPage);
  els.pagerCount.textContent = `Página ${state.readPage + 1} / ${state.readPages}`;
  els.pagerPrev.disabled = state.readPage === 0;
  els.pagerNext.disabled = state.readPage === state.readPages - 1;
}

function turnReadPage(delta) {
  const next = state.readPage + delta;
  if (!state.flow || next < 0 || next >= state.readPages) return;
  state.readPage = next;
  sounds.turn();
  const flow = state.flow;
  flow.classList.add("turning");
  setTimeout(() => {
    if (state.flow === flow) showReadPage();
    flow.classList.remove("turning");
  }, 130);
}

els.pagerPrev.addEventListener("click", () => turnReadPage(-1));
els.pagerNext.addEventListener("click", () => turnReadPage(1));
// Que el click no les deje el foco: si no, Espacio volvería a apretar el botón.
for (const button of [els.pagerPrev, els.pagerNext]) {
  button.addEventListener("mousedown", (e) => e.preventDefault());
}

function closeReader() {
  state.mode = "inspect";
  els.reader.classList.remove("visible");
  setTimeout(() => {
    if (state.mode === "inspect") els.reader.hidden = true;
  }, 230);
  renderHints();
}

function cloneCanvas(source, scale = 1) {
  const canvas = document.createElement("canvas");
  canvas.width = Math.round(source.width * scale);
  canvas.height = Math.round(source.height * scale);
  canvas.getContext("2d").drawImage(source, 0, 0, canvas.width, canvas.height);
  return canvas;
}

// ---------- Barra de atajos ----------

const MOUSE_WHEEL = `<svg class="mouse" viewBox="0 0 18 26"><rect class="body" x="1" y="1" width="16" height="24" rx="8"/><line class="wheel" x1="9" y1="6" x2="9" y2="10"/></svg>`;
const key = (label) => `<kbd>${label}</kbd>`;

function renderHints() {
  const items = [];
  if (state.mode === "inspect") {
    if (state.pages > 1) items.push([key("↑") + key("↓") + MOUSE_WHEEL, `Página ${state.page}/${state.pages}`]);
    items.push([key("F"), state.kind === "pdf" ? "Leer" : "Ver"], [key("Esc"), "Cerrar"]);
  } else if (state.mode === "read") {
    // Con texto, las páginas las muestra el paginador; "Ver" se desplaza con la rueda.
    if (!state.flow) items.push([MOUSE_WHEEL, "Desplazar"]);
    items.push([key("Esc"), "Atrás"]);
  } else {
    items.push([key("Esc"), "Cerrar"]);
  }
  els.hints.innerHTML = items
    .map(([keys, label]) => `<div class="hint"><span class="keys">${keys}</span><span>${label}</span></div>`)
    .join("");
}

// ---------- Abrir y cerrar ----------

let pageBusy = false;

async function changePage(delta) {
  const next = state.page + delta;
  if (pageBusy || next < 1 || next > state.pages) return;
  pageBusy = true;
  state.page = next;
  sounds.turn();
  try {
    await renderPdfPage(next);
  } finally {
    pageBusy = false;
  }
}

function close() {
  if (state.mode === "closing") return;
  state.mode = "closing";
  sounds.close();
  els.reader.classList.remove("visible");
  document.body.classList.remove("open", "frozen");
  document.body.classList.add("leaving");
  setTimeout(async () => {
    if (params.has("standalone") && hasChrome) {
      const tab = await chrome.tabs.getCurrent();
      if (tab) chrome.tabs.remove(tab.id);
    } else if (window.parent !== window) {
      window.parent.postMessage({ type: "inventory:close" }, "*");
    } else if (params.has("demo")) {
      location.reload();
    }
  }, 420);
}

window.addEventListener("keydown", (e) => {
  if (state.mode === "closing") return;
  switch (e.code) {
    case "Escape":
      e.preventDefault();
      state.mode === "read" ? closeReader() : close();
      break;
    case "KeyF":
    case "Space":
      // F y Espacio abren y cierran Leer/Ver/Escuchar. Espacio nunca desplaza la lectura.
      e.preventDefault();
      if (e.repeat) break;
      if (state.mode === "read") {
        closeReader();
      } else if (state.mode === "inspect") {
        openReader();
      }
      break;
    case "ArrowUp":
    case "ArrowDown":
      if (state.mode === "inspect" && state.kind === "pdf") {
        e.preventDefault();
        changePage(e.code === "ArrowDown" ? 1 : -1);
      } else if (state.mode === "read" && state.flow) {
        e.preventDefault();
        turnReadPage(e.code === "ArrowDown" ? 1 : -1);
      }
      break;
    case "ArrowLeft":
    case "ArrowRight":
      if (state.mode === "read" && state.flow) turnReadPage(e.code === "ArrowRight" ? 1 : -1);
      break;
  }
});

window.addEventListener("resize", () => {
  if (state.kind) fitItem();
  if (state.mode === "read" && state.flow) {
    layoutRead();
    showReadPage();
  }
});

// Nombre del ítem para el título: el archivo sin extensión ni separadores.
function itemName(filename) {
  const base = filename.split(/[\\/]/).pop();
  return base.replace(/\.[a-z0-9]{1,5}$/i, "").replace(/[_\-.]+/g, " ").trim() || base;
}

// Posiciones del desgaste del papel a partir del nombre: el mismo archivo
// siempre tiene los mismos dobleces y manchas.
function setWear(filename) {
  let seed = 2166136261;
  for (const ch of filename) seed = Math.imul(seed ^ ch.charCodeAt(0), 16777619) >>> 0;
  const rand = (min, max) => {
    seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0;
    return min + (seed / 2 ** 32) * (max - min);
  };
  const pct = (min, max) => `${rand(min, max).toFixed(1)}%`;
  els.item.style.setProperty("--fx", pct(47, 53));
  els.item.style.setProperty("--fy", pct(46, 54));
  els.item.style.setProperty("--s1", `${pct(5, 40)} ${pct(60, 95)}`);
  els.item.style.setProperty("--s2", `${pct(60, 95)} ${pct(5, 40)}`);
}

function showError() {
  state.mode = "error";
  els.stage.hidden = true;
  els.message.hidden = false;
  els.message.innerHTML = `
    <div>
      <p class="title">No pude abrir este archivo</p>
      <p class="detail">Para leerlo desde tu disco, activá “Permitir acceso a URLs de archivo”
      en los detalles de la extensión (chrome://extensions).</p>
    </div>`;
  renderHints();
}

async function start() {
  if (params.has("standalone")) document.body.classList.add("standalone");
  const info = await loadInfo();
  if (!info) return close();

  if (info.shot) {
    els.shot.src = info.shot;
    await els.shot.decode().catch(() => {});
    document.body.classList.add("has-shot");
  } else {
    els.shot.remove();
  }

  els.title.textContent = itemName(info.filename);
  setWear(info.filename);
  // Con la tipografía ya cargada, para que el título no salte ni el texto se repagine.
  await document.fonts.load('400 16px "Lora"').catch(() => {});

  // Primero se congela y oscurece el mundo, mientras se carga el archivo.
  requestAnimationFrame(() => requestAnimationFrame(() => document.body.classList.add("frozen")));

  try {
    state.kind = info.kind;
    if (info.kind === "pdf") {
      const bytes = await loadBytes(info);
      state.pdf = await pdfjs.getDocument({
        data: new Uint8Array(bytes),
        cMapUrl: "vendor/pdfjs/cmaps/",
        cMapPacked: true,
        standardFontDataUrl: "vendor/pdfjs/standard_fonts/",
        isEvalSupported: false,
      }).promise;
      state.pages = state.pdf.numPages;
      await renderPdfPage(1);
    } else {
      await showImage(await loadBytes(info), info);
    }
  } catch (err) {
    console.error(err);
    return showError();
  }

  applyTransform();
  // El ítem sube desde abajo recién cuando ya está renderizado.
  requestAnimationFrame(() => requestAnimationFrame(() => document.body.classList.add("open")));
  sounds.pickup();
  state.mode = "inspect";
  renderHints();
  window.focus();
}

start();
