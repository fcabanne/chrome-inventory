// Genera test/carta.pdf (2 páginas con texto) para probar el visor sin depender de descargas.
const fs = require("fs");
const path = require("path");

const pages = [
  [
    "Querida Marta,",
    "",
    "Si estas leyendo esto, encontraste la caja debajo del escritorio. No le",
    "cuentes a nadie del sotano. Las luces se apagan a las once y los ruidos",
    "empiezan poco despues. No son las cañerias, aunque eso diga el portero.",
    "",
    "Deje la llave del archivo dentro del libro azul, el tercero desde la",
    "izquierda. Si la puerta no abre, golpea dos veces y espera.",
    "",
    "No confies en la radio. Repite cosas que todavia no pasaron.",
  ],
  [
    "Posdata:",
    "",
    "El codigo de la caja fuerte es el año en que nos mudamos, al reves.",
    "Llevate las fotos. Dejame la factura del gas, que alguien la tiene",
    "que pagar aunque el mundo se termine.",
    "",
    "                                                    - R.",
  ],
];

const esc = (s) => s.replace(/[\()]/g, (c) => "\\" + c);
const objects = [];
const add = (body) => objects.push(body) && objects.length;

const font = add("<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica /Encoding /WinAnsiEncoding >>");
const pagesId = objects.length + 1 + pages.length * 2;
const kids = [];
for (const lines of pages) {
  const ops = ["BT", "/F1 13 Tf", "18 TL", "72 760 Td"];
  for (const line of lines) ops.push(`(${esc(line)}) Tj T*`);
  ops.push("ET");
  const stream = Buffer.from(ops.join("\n"), "latin1");
  const content = add(`<< /Length ${stream.length} >>\nstream\n${stream.toString("latin1")}\nendstream`);
  kids.push(add(`<< /Type /Page /Parent ${pagesId} 0 R /MediaBox [0 0 595 842] /Resources << /Font << /F1 ${font} 0 R >> >> /Contents ${content} 0 R >>`));
}
add(`<< /Type /Pages /Kids [${kids.map((k) => `${k} 0 R`).join(" ")}] /Count ${kids.length} >>`);
const catalog = add(`<< /Type /Catalog /Pages ${pagesId} 0 R >>`);

let out = "%PDF-1.4\n";
const offsets = [];
objects.forEach((body, i) => {
  offsets.push(Buffer.byteLength(out, "latin1"));
  out += `${i + 1} 0 obj\n${body}\nendobj\n`;
});
const xref = Buffer.byteLength(out, "latin1");
out += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`;
for (const o of offsets) out += `${String(o).padStart(10, "0")} 00000 n \n`;
out += `trailer\n<< /Size ${objects.length + 1} /Root ${catalog} 0 R >>\nstartxref\n${xref}\n%%EOF\n`;
fs.writeFileSync(path.join(__dirname, "carta.pdf"), Buffer.from(out, "latin1"));
console.log("ok");
