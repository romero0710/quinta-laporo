// Panel admin — conversaciones del bot y avisos.
// Todo lo que escribe la gente se muestra con textContent, nunca como HTML.
(function () {
  const $ = (id) => document.getElementById(id);
  const chatsEl = $("chats");
  const listEl = $("chatList");
  const emptyEl = $("chatEmpty");
  const viewEl = $("chatView");
  const nameEl = $("chatName");
  const estadoEl = $("chatEstado");
  const msgsEl = $("chatMessages");
  const inputEl = $("chatInput");
  const sendBtn = $("chatSend");
  const pauseBtn = $("chatPause");
  const resumeBtn = $("chatResume");
  const chatMsg = $("chatMsg");
  const avisoListEl = $("avisoList");

  const QUIEN = { cliente: "Cliente", bot: "Bot", lauti: "Vos", anuncio: "Saludo del anuncio", auto: "Bot (pidió que escriba)" };
  const PAUSA_HORAS = 24 * 30; // "Pausar bot" deja la charla en tus manos hasta que la reactives (máx. 30 días)

  let abierta = null; // id de la conversación abierta
  let timer = null;
  let onUnauthorized = () => {};

  function el(tag, cls, texto) {
    const e = document.createElement(tag);
    if (cls) e.className = cls;
    if (texto !== undefined && texto !== null) e.textContent = texto;
    return e;
  }

  function fecha(ts) {
    if (!ts) return "";
    const d = new Date(ts);
    const hoy = new Date();
    const mismoDia = d.toDateString() === hoy.toDateString();
    return mismoDia
      ? d.toLocaleTimeString("es-AR", { hour: "2-digit", minute: "2-digit" })
      : d.toLocaleDateString("es-AR", { day: "numeric", month: "short" }) + " " + d.toLocaleTimeString("es-AR", { hour: "2-digit", minute: "2-digit" });
  }

  async function api(url, opciones = {}) {
    const res = await fetch(url, {
      cache: "no-store",
      ...opciones,
      headers: opciones.body ? { "Content-Type": "application/json" } : undefined,
    });
    if (res.status === 401) {
      onUnauthorized();
      throw new Error("Sesión vencida, volvé a entrar.");
    }
    const data = await res.json().catch(() => ({}));
    if (!res.ok || data.ok === false) throw new Error(data.error || "Algo falló. Reintentá.");
    return data;
  }

  function mostrarError(e) {
    chatMsg.textContent = "❌ " + e.message;
    chatMsg.className = "msg msg--error";
  }

  function nombreDe(c) {
    return c.nombre || (c.canal === "WhatsApp" ? "+" + c.id : `Cliente de ${c.canal}`);
  }

  async function cargarLista() {
    let data;
    try {
      data = await api("/api/admin/conversaciones");
    } catch (e) {
      listEl.replaceChildren(el("p", "vacio", e.message));
      return;
    }
    const items = data.conversaciones.map((c) => {
      const b = el("button", "chat-item");
      b.type = "button";
      if (c.id === abierta) b.setAttribute("aria-current", "true");
      const top = el("div", "chat-item__top");
      top.append(el("span", null, nombreDe(c)), el("time", null, fecha(c.ultimo.ts)));
      const tags = el("div");
      tags.append(el("span", "tag", c.canal));
      if (c.pausado_hasta) tags.append(el("span", "tag tag--pausa", "Bot pausado"));
      if (c.silenciado) tags.append(el("span", "tag tag--pausa", "Bot callado hoy"));
      const quien = QUIEN[c.ultimo.de === "user" ? "cliente" : c.ultimo.de === "assistant" ? "bot" : c.ultimo.de] || "";
      b.append(top, tags, el("div", "chat-item__text", (quien ? quien + ": " : "") + c.ultimo.texto));
      b.addEventListener("click", () => abrir(c.id));
      return b;
    });
    listEl.replaceChildren(...(items.length ? items : [el("p", "vacio", "Todavía no hay conversaciones.")]));
  }

  function pintarEstado(c) {
    const partes = [c.canal];
    if (c.pausado_hasta) {
      const hasta = new Date(c.pausado_hasta);
      partes.push(hasta - Date.now() > 7 * 86400000 ? "bot pausado hasta que lo reactives" : "bot pausado hasta " + fecha(hasta.toISOString()));
    } else if (c.silenciado) {
      partes.push(`bot callado hoy (${c.silenciado})`);
    } else {
      partes.push("bot activo");
    }
    estadoEl.textContent = partes.join(" · ");
    const pausado = Boolean(c.pausado_hasta || c.silenciado);
    pauseBtn.hidden = pausado;
    resumeBtn.hidden = !pausado;
  }

  async function cargarConversacion(id, { scroll } = {}) {
    const c = await api("/api/admin/conversaciones/" + encodeURIComponent(id));
    if (abierta !== id) return; // cambió de charla mientras cargaba
    nameEl.textContent = nombreDe(c);
    pintarEstado(c);
    const abajo = msgsEl.scrollHeight - msgsEl.scrollTop - msgsEl.clientHeight < 60;
    msgsEl.replaceChildren(...c.turnos.map((t) => {
      const b = el("div", `burbuja burbuja--${t.de}` + (t.no_enviado ? " burbuja--no-enviado" : ""), t.texto);
      let meta = `${QUIEN[t.de] || t.de} · ${fecha(t.ts)}`;
      if (t.no_enviado) meta += " · no se mandó (tomaste la charla)";
      if (t.acciones.length) meta += " · " + t.acciones.join("; ");
      b.append(el("span", "burbuja__meta", meta));
      return b;
    }));
    if (scroll || abajo) msgsEl.scrollTop = msgsEl.scrollHeight;
  }

  async function abrir(id) {
    abierta = id;
    chatMsg.textContent = "";
    emptyEl.hidden = true;
    viewEl.hidden = false;
    chatsEl.classList.add("chats--abierta");
    msgsEl.replaceChildren(el("p", "vacio", "Cargando…"));
    try {
      await cargarConversacion(id, { scroll: true });
    } catch (e) {
      mostrarError(e);
    }
    cargarLista();
  }

  async function accion(ruta, cuerpo, okTexto) {
    if (!abierta) return;
    chatMsg.textContent = "…";
    chatMsg.className = "msg";
    try {
      await api(`/api/admin/conversaciones/${encodeURIComponent(abierta)}/${ruta}`, { method: "POST", body: JSON.stringify(cuerpo || {}) });
      chatMsg.textContent = okTexto;
      chatMsg.className = "msg msg--ok";
      await cargarConversacion(abierta, { scroll: true });
      cargarLista();
      return true;
    } catch (e) {
      mostrarError(e);
      return false;
    }
  }

  sendBtn.addEventListener("click", async () => {
    const texto = inputEl.value.trim();
    if (!texto) return;
    sendBtn.disabled = true;
    if (await accion("responder", { texto }, "✅ Enviado. El bot queda pausado 12 h en esta charla.")) inputEl.value = "";
    sendBtn.disabled = false;
  });
  inputEl.addEventListener("keydown", (e) => {
    if (e.key === "Enter" && (e.ctrlKey || e.metaKey)) sendBtn.click();
  });
  pauseBtn.addEventListener("click", () => accion("pausar", { horas: PAUSA_HORAS }, "⏸ El bot no contesta en esta charla hasta que lo reactives."));
  resumeBtn.addEventListener("click", () => accion("reanudar", null, "▶ El bot vuelve a contestar en esta charla."));
  $("chatBack").addEventListener("click", () => {
    abierta = null;
    chatsEl.classList.remove("chats--abierta");
    viewEl.hidden = true;
    emptyEl.hidden = false;
    cargarLista();
  });

  async function cargarAvisos() {
    let data;
    try {
      data = await api("/api/admin/avisos");
    } catch (e) {
      avisoListEl.replaceChildren(el("p", "vacio", e.message));
      return;
    }
    const items = data.avisos.map((a) => {
      const card = el("div", "aviso");
      const top = el("div", "aviso__top");
      top.append(el("span", null, `${a.motivo} · ${a.nombre || "Sin nombre"} por ${a.canal}`), el("time", null, fecha(a.fecha)));
      card.append(top, el("p", null, a.resumen));
      if (a.waId) {
        const ver = el("button", "btn btn--ghost btn--sm", "Ver conversación");
        ver.type = "button";
        ver.style.marginTop = "0.6rem";
        ver.addEventListener("click", () => {
          window.QLPChats.mostrarTab("conversaciones");
          abrir(a.waId);
        });
        card.append(ver);
      }
      return card;
    });
    avisoListEl.replaceChildren(...(items.length ? items : [el("p", "vacio", "No hay avisos todavía.")]));
  }

  // Refresca lo que se está mirando mientras la pestaña está visible.
  function refrescar(tab) {
    clearInterval(timer);
    const tick = () => {
      if (document.hidden) return;
      if (tab === "conversaciones") {
        cargarLista();
        if (abierta) cargarConversacion(abierta).catch(() => {});
      } else if (tab === "avisos") {
        cargarAvisos();
      }
    };
    if (tab === "conversaciones" || tab === "avisos") {
      tick();
      timer = setInterval(tick, 15000);
    }
  }

  window.QLPChats = {
    iniciar(opciones) {
      onUnauthorized = opciones.onUnauthorized;
      this.mostrarTab = opciones.mostrarTab;
    },
    refrescar,
    detener() {
      clearInterval(timer);
      abierta = null;
    },
  };
})();
