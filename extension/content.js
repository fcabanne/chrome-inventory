// Se inyecta en la pestaña activa: monta el visor en un iframe a pantalla
// completa encima de la página y lo saca cuando el visor avisa que cerró.

if (!window.__inventoryOpen) {
  let frame = null;

  const close = () => {
    frame?.remove();
    frame = null;
  };

  window.addEventListener("message", (event) => {
    if (frame && event.source === frame.contentWindow && event.data?.type === "inventory:close") {
      close();
    }
  });

  window.__inventoryOpen = (url) => {
    close();
    frame = document.createElement("iframe");
    frame.src = url;
    frame.allow = "autoplay";
    frame.setAttribute(
      "style",
      [
        "all: initial",
        "position: fixed",
        "inset: 0",
        "width: 100vw",
        "height: 100vh",
        "border: 0",
        "margin: 0",
        "z-index: 2147483647",
        "background: transparent",
        "color-scheme: normal",
      ].map((rule) => `${rule} !important`).join(";")
    );
    frame.addEventListener("load", () => frame?.focus());
    document.documentElement.appendChild(frame);
  };
}
