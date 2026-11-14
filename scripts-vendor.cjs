// Copia pdf.js y la tipografía dentro de la extensión (MV3 no permite cargar código remoto).
const fs = require("fs");
const path = require("path");

const modules = path.join(__dirname, "node_modules");
const vendor = path.join(__dirname, "extension", "vendor");

function fresh(dir) {
  fs.rmSync(dir, { recursive: true, force: true });
  fs.mkdirSync(dir, { recursive: true });
  return dir;
}

// pdf.js
const pdfSrc = path.join(modules, "pdfjs-dist");
const pdfDest = fresh(path.join(vendor, "pdfjs"));
for (const file of ["pdf.min.mjs", "pdf.worker.min.mjs"]) {
  fs.copyFileSync(path.join(pdfSrc, "build", file), path.join(pdfDest, file));
}
for (const dir of ["cmaps", "standard_fonts"]) {
  fs.cpSync(path.join(pdfSrc, dir), path.join(pdfDest, dir), { recursive: true });
}

// Tipografía serif de la interfaz (Lora, OFL).
const fontSrc = path.join(modules, "@fontsource", "lora", "files");
const fontDest = fresh(path.join(vendor, "fonts"));
for (const file of ["lora-latin-400-normal.woff2", "lora-latin-ext-400-normal.woff2", "lora-latin-600-normal.woff2"]) {
  fs.copyFileSync(path.join(fontSrc, file), path.join(fontDest, file));
}

console.log("pdf.js y la tipografía copiados a", vendor);
