// Calendario de disponibilidad — Quinta La Poro
(function () {
  const MONTHS = [
    "Enero", "Febrero", "Marzo", "Abril", "Mayo", "Junio",
    "Julio", "Agosto", "Septiembre", "Octubre", "Noviembre", "Diciembre"
  ];
  const DOW = ["Lun", "Mar", "Mié", "Jue", "Vie", "Sáb", "Dom"];

  const container = document.getElementById("calendar");
  if (!container) return;

  let occupied = new Set();
  const now = new Date();
  let viewYear = now.getFullYear();
  let viewMonth = now.getMonth();

  function ymd(y, m, d) {
    return `${y}-${String(m + 1).padStart(2, "0")}-${String(d).padStart(2, "0")}`;
  }

  function todayStr() {
    return ymd(now.getFullYear(), now.getMonth(), now.getDate());
  }

  async function loadOccupied() {
    // Intenta la API (cuando el backend esté activo); si no, cae al JSON estático.
    const sources = ["/api/occupied", "data/occupied.json", "../data/occupied.json"];
    for (const url of sources) {
      try {
        const res = await fetch(url, { cache: "no-store" });
        if (!res.ok) continue;
        const data = await res.json();
        const list = Array.isArray(data) ? data : data.occupied || [];
        occupied = new Set(list);
        return;
      } catch (e) { /* probamos la siguiente fuente */ }
    }
    occupied = new Set();
  }

  function render() {
    const first = new Date(viewYear, viewMonth, 1);
    // getDay(): 0=Dom..6=Sáb -> lo pasamos a Lun=0
    let startDow = (first.getDay() + 6) % 7;
    const daysInMonth = new Date(viewYear, viewMonth + 1, 0).getDate();
    const today = todayStr();

    let html = `
      <div class="cal">
        <div class="cal__nav">
          <button type="button" data-dir="-1" aria-label="Mes anterior">‹</button>
          <span class="cal__title">${MONTHS[viewMonth]} ${viewYear}</span>
          <button type="button" data-dir="1" aria-label="Mes siguiente">›</button>
        </div>
        <div class="cal__grid">
    `;

    for (const d of DOW) html += `<div class="cal__dow">${d}</div>`;
    for (let i = 0; i < startDow; i++) html += `<div class="cal__day cal__day--empty"></div>`;

    for (let d = 1; d <= daysInMonth; d++) {
      const key = ymd(viewYear, viewMonth, d);
      const classes = ["cal__day"];
      if (occupied.has(key)) classes.push("cal__day--busy");
      if (key < today) classes.push("cal__day--past");
      if (key === today) classes.push("cal__day--today");
      const label = occupied.has(key) ? `${d} — ocupado` : `${d} — disponible`;
      html += `<div class="${classes.join(" ")}" title="${label}">${d}</div>`;
    }

    html += `</div></div>`;
    container.innerHTML = html;

    container.querySelectorAll("[data-dir]").forEach((btn) => {
      btn.addEventListener("click", () => {
        viewMonth += parseInt(btn.dataset.dir, 10);
        if (viewMonth < 0) { viewMonth = 11; viewYear--; }
        if (viewMonth > 11) { viewMonth = 0; viewYear++; }
        render();
      });
    });
  }

  loadOccupied().then(render);
})();

// Lightbox de la galería — click para ver la foto en grande
(function () {
  const lb = document.getElementById("lightbox");
  if (!lb) return;
  const lbImg = lb.querySelector(".lightbox__img");
  const closeBtn = lb.querySelector(".lightbox__close");

  function open(src, alt) {
    lbImg.src = src;
    lbImg.alt = alt || "";
    lb.classList.add("is-open");
    lb.setAttribute("aria-hidden", "false");
    document.body.style.overflow = "hidden";
  }
  function close() {
    lb.classList.remove("is-open");
    lb.setAttribute("aria-hidden", "true");
    lbImg.src = "";
    document.body.style.overflow = "";
  }

  document.querySelectorAll(".gallery img").forEach((img) => {
    img.addEventListener("click", () => open(img.src, img.alt));
  });
  closeBtn.addEventListener("click", close);
  lb.addEventListener("click", (e) => { if (e.target === lb) close(); });
  document.addEventListener("keydown", (e) => { if (e.key === "Escape") close(); });
})();
