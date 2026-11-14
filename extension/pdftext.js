// Reconstruye párrafos a partir de los pedacitos posicionados que devuelve
// pdf.js: agrupa por línea (misma altura) y corta párrafo cuando el salto
// vertical es más grande que una línea normal.

export async function extractParagraphs(pdf) {
  const pages = [];
  for (let n = 1; n <= pdf.numPages; n++) {
    const page = await pdf.getPage(n);
    const content = await page.getTextContent();
    pages.push(toParagraphs(content.items));
  }
  return pages;
}

function toLines(items) {
  const lines = [];
  let line = null;

  for (const item of items) {
    if (!("str" in item)) continue;
    const [, , c, d, x, y] = item.transform;
    const h = item.height || Math.hypot(c, d) || 10;

    const sameLine = line && Math.abs(y - line.y) <= Math.max(h, line.h) * 0.5;
    if (!sameLine) {
      if (!item.str.trim()) {
        line = null;
        continue;
      }
      line = { y, h, text: "", end: x };
      lines.push(line);
    } else if (x - line.end > h * 0.15 && !line.text.endsWith(" ") && !item.str.startsWith(" ")) {
      line.text += " ";
    }

    line.text += item.str;
    line.end = x + (item.width || 0);
    line.h = Math.max(line.h, h);
    if (item.hasEOL) line = null;
  }

  return lines
    .map((l) => ({ ...l, text: l.text.replace(/\s+/g, " ").trim() }))
    .filter((l) => l.text);
}

function toParagraphs(items) {
  const paragraphs = [];
  let prev = null;

  for (const line of toLines(items)) {
    const gap = prev ? prev.y - line.y : 0;
    const newParagraph = !prev || gap < 0 || gap > prev.h * 1.75;

    if (newParagraph) {
      paragraphs.push(line.text);
    } else {
      const last = paragraphs.length - 1;
      const text = paragraphs[last];
      // Palabras cortadas con guion al final de línea: "docu-" + "mento".
      if (/[a-záéíóúñü]-$/i.test(text) && /^[a-záéíóúñü]/.test(line.text)) {
        paragraphs[last] = text.slice(0, -1) + line.text;
      } else {
        paragraphs[last] = `${text} ${line.text}`;
      }
    }
    prev = line;
  }
  return paragraphs;
}
