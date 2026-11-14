// Servidor estático mínimo para probar el visor en modo demo.
const http = require("http");
const fs = require("fs");
const path = require("path");

const root = path.join(__dirname, "..");
const types = { ".html": "text/html", ".css": "text/css", ".js": "text/javascript", ".mjs": "text/javascript", ".pdf": "application/pdf", ".svg": "image/svg+xml", ".png": "image/png", ".jpg": "image/jpeg", ".bcmap": "application/octet-stream", ".pfb": "application/octet-stream" };

http
  .createServer((req, res) => {
    const file = path.join(root, decodeURIComponent(new URL(req.url, "http://x").pathname));
    if (!file.startsWith(root) || !fs.existsSync(file) || fs.statSync(file).isDirectory()) {
      res.writeHead(404).end();
      return;
    }
    res.writeHead(200, { "Content-Type": types[path.extname(file)] || "application/octet-stream" });
    fs.createReadStream(file).pipe(res);
  })
  .listen(5173, () => console.log("http://localhost:5173/extension/viewer.html?demo=../test/carta.pdf&shot=../test/fondo.svg"));
