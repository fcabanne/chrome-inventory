// Genera test/descargas.html con los archivos de prueba embebidos como data: URLs.
// Chrome ignora el atributo download en páginas file://, pero sí descarga data: URLs,
// así que la página funciona con doble click, sin servidor.
const fs = require("fs");
const path = require("path");

const files = [
  { icon: "📄", file: "carta.pdf", type: "application/pdf" },
  { icon: "🖼️", file: "fondo.svg", name: "foto.svg", type: "image/svg+xml" },
];

const links = files
  .map(({ icon, file, name = file, type }) => {
    const data = fs.readFileSync(path.join(__dirname, file)).toString("base64");
    return `  <a href="data:${type};base64,${data}" download="${name}">${icon} ${name}</a>`;
  })
  .join("\n");

const html = `<!doctype html>
<html lang="es">
<head>
  <meta charset="utf-8">
  <title>Descargas de prueba</title>
  <style>
    body { font-family: "Segoe UI", system-ui, sans-serif; max-width: 640px; margin: 64px auto; padding: 0 16px; color: #222; background: #f6f7f9; }
    a { display: block; margin: 12px 0; padding: 16px 20px; background: #fff; border: 1px solid #d5dae3; border-radius: 8px; color: #1f6feb; text-decoration: none; font-size: 18px; }
    a:hover { border-color: #1f6feb; }
    .note { font-size: 14px; color: #5b6475; }
  </style>
</head>
<body>
  <h1>Descargas de prueba</h1>
  <p>Tocá cualquiera: se descarga y la extensión la levanta como ítem.</p>
  <p class="note">Abrí este archivo directo con doble click, no hace falta servidor. Para que la extensión
  se monte sobre páginas <code>file://</code>, activá “Permitir acceso a URLs de archivo” en los detalles
  de la extensión. (Generado por <code>node test/make-page.cjs</code>.)</p>
${links}
</body>
</html>
`;

fs.writeFileSync(path.join(__dirname, "descargas.html"), html);
console.log(`ok (${Math.round(html.length / 1024)} KB)`);
