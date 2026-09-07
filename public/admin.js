// Panel admin — Quinta La Poro
(function () {
  const MONTHS = ["Enero","Febrero","Marzo","Abril","Mayo","Junio","Julio","Agosto","Septiembre","Octubre","Noviembre","Diciembre"];
  const DOW = ["Lun","Mar","Mié","Jue","Vie","Sáb","Dom"];
  const KEY = "quinta_admin_pass";

  const loginSec = document.getElementById("login");
  const panelSec = document.getElementById("panel");
  const passInput = document.getElementById("password");
  const loginBtn = document.getElementById("loginBtn");
  const loginMsg = document.getElementById("loginMsg");
  const calEl = document.getElementById("calendar");
  const saveBtn = document.getElementById("saveBtn");
  const logoutBtn = document.getElementById("logoutBtn");
  const saveMsg = document.getElementById("saveMsg");
  const counter = document.getElementById("counter");

  let password = sessionStorage.getItem(KEY) || "";
  let occupied = new Set();
  const now = new Date();
  let viewYear = now.getFullYear();
  let viewMonth = now.getMonth();

  const ymd = (y, m, d) => `${y}-${String(m + 1).padStart(2, "0")}-${String(d).padStart(2, "0")}`;
  const todayStr = () => ymd(now.getFullYear(), now.getMonth(), now.getDate());

  async function doLogin(pass) {
    const res = await fetch("/api/login", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ password: pass }),
    });
    return res.ok;
  }

  async function loadOccupied() {
    try {
      const res = await fetch("/api/occupied", { cache: "no-store" });
      const data = await res.json();
      occupied = new Set(data.occupied || []);
    } catch (e) { occupied = new Set(); }
  }

  async function save() {
    saveMsg.textContent = "Guardando…";
    saveMsg.className = "msg";
    try {
      const res = await fetch("/api/occupied", {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: "Bearer " + password },
        body: JSON.stringify({ occupied: [...occupied] }),
      });
      if (res.status === 401) { saveMsg.textContent = "Sesión vencida, volvé a entrar."; saveMsg.className = "msg msg--error"; return; }
      if (!res.ok) throw new Error();
      saveMsg.textContent = "✅ Guardado con éxito.";
      saveMsg.className = "msg msg--ok";
      setTimeout(() => { saveMsg.textContent = ""; }, 2500);
    } catch (e) {
      saveMsg.textContent = "❌ Error al guardar. Reintentá.";
      saveMsg.className = "msg msg--error";
    }
  }

  function updateCounter() {
    const n = occupied.size;
    counter.textContent = `${n} día${n === 1 ? "" : "s"} ocupado${n === 1 ? "" : "s"}`;
  }

  function render() {
    const first = new Date(viewYear, viewMonth, 1);
    const startDow = (first.getDay() + 6) % 7;
    const daysInMonth = new Date(viewYear, viewMonth + 1, 0).getDate();
    const today = todayStr();

    let html = `<div class="cal"><div class="cal__nav">
      <button type="button" data-dir="-1" aria-label="Mes anterior">‹</button>
      <span class="cal__title">${MONTHS[viewMonth]} ${viewYear}</span>
      <button type="button" data-dir="1" aria-label="Mes siguiente">›</button>
    </div><div class="cal__grid">`;
    for (const d of DOW) html += `<div class="cal__dow">${d}</div>`;
    for (let i = 0; i < startDow; i++) html += `<div class="cal__day cal__day--empty"></div>`;
    for (let d = 1; d <= daysInMonth; d++) {
      const key = ymd(viewYear, viewMonth, d);
      const cls = ["cal__day"];
      if (occupied.has(key)) cls.push("cal__day--busy");
      if (key < today) cls.push("cal__day--past");
      if (key === today) cls.push("cal__day--today");
      html += `<div class="${cls.join(" ")}" data-key="${key}">${d}</div>`;
    }
    html += `</div></div>`;
    calEl.innerHTML = html;

    calEl.querySelectorAll("[data-dir]").forEach((b) => b.addEventListener("click", () => {
      viewMonth += parseInt(b.dataset.dir, 10);
      if (viewMonth < 0) { viewMonth = 11; viewYear--; }
      if (viewMonth > 11) { viewMonth = 0; viewYear++; }
      render();
    }));
    calEl.querySelectorAll("[data-key]").forEach((cell) => cell.addEventListener("click", () => {
      const k = cell.dataset.key;
      if (occupied.has(k)) occupied.delete(k); else occupied.add(k);
      render();
      updateCounter();
    }));
    updateCounter();
  }

  async function enterPanel() {
    loginSec.classList.add("hidden");
    panelSec.classList.remove("hidden");
    await loadOccupied();
    render();
  }

  loginBtn.addEventListener("click", async () => {
    const pass = passInput.value.trim();
    if (!pass) return;
    loginMsg.textContent = "Verificando…";
    loginMsg.className = "msg";
    const ok = await doLogin(pass);
    if (ok) {
      password = pass;
      sessionStorage.setItem(KEY, pass);
      loginMsg.textContent = "";
      enterPanel();
    } else {
      loginMsg.textContent = "Contraseña incorrecta.";
      loginMsg.className = "msg msg--error";
    }
  });
  passInput.addEventListener("keydown", (e) => { if (e.key === "Enter") loginBtn.click(); });

  saveBtn.addEventListener("click", save);
  logoutBtn.addEventListener("click", () => {
    sessionStorage.removeItem(KEY);
    password = "";
    panelSec.classList.add("hidden");
    loginSec.classList.remove("hidden");
    passInput.value = "";
  });

  // Auto-login si ya hay contraseña guardada en la sesión
  if (password) {
    doLogin(password).then((ok) => { if (ok) enterPanel(); else sessionStorage.removeItem(KEY); });
  }
})();
