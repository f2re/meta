(() => {
  "use strict";

  const dialog = document.getElementById("keyDialog");
  if (!dialog) return;

  if (typeof dialog.showModal === "function" && typeof dialog.close === "function") return;

  dialog.classList.add("dialog-fallback");

  const isOpen = () => dialog.hasAttribute("open");
  const lockBody = (locked) => {
    if (!document.body || !document.body.classList) return;
    if (locked) document.body.classList.add("dialog-fallback-active");
    else document.body.classList.remove("dialog-fallback-active");
  };

  dialog.showModal = () => {
    if (isOpen()) return;
    dialog.setAttribute("open", "");
    dialog.setAttribute("aria-modal", "true");
    lockBody(true);
  };

  dialog.close = (returnValue = "") => {
    if (!isOpen()) return;
    dialog.returnValue = returnValue == null ? "" : String(returnValue);
    dialog.removeAttribute("open");
    dialog.removeAttribute("aria-modal");
    lockBody(false);
  };

  dialog.addEventListener("click", (event) => {
    if (event.target === dialog) dialog.close();
  });

  document.addEventListener("keydown", (event) => {
    if (event.key !== "Escape" || !isOpen()) return;
    event.preventDefault();
    dialog.close();
  });
})();
