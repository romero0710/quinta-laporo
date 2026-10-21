// Webhooks de Meta: cada mensaje que llega a la quinta por WhatsApp, Instagram o Messenger.
//   GET  /webhook/whatsapp, /webhook/meta → verificación que hace Meta al configurar el webhook
//   POST /webhook/whatsapp                → mensajes de WhatsApp
//   POST /webhook/meta                    → mensajes de Instagram y Messenger
// Todos vienen firmados con el App Secret de la misma app.
const fs = require("fs");
const path = require("path");
const express = require("express");
const wa = require("./whatsapp");
const meta = require("./meta");
const agente = require("./agente");

const ESPERA_MS = Number(process.env.BOT_ESPERA_MS || 15000); // junta mensajes seguidos en una sola respuesta (la gente manda 2 o 3 mensajes cortos)
const MAX_BURBUJAS = 3;
const PAUSA_BURBUJA_MS = Number(process.env.BOT_PAUSA_BURBUJA_MS || 1200); // pausa entre burbujas, para que se lea natural
const PAUSA_HUMANO_MS = Number(process.env.BOT_PAUSA_HORAS || 12) * 3600000;
const vistos = new Set(); // ids ya procesados (Meta puede reenviar el mismo aviso)
const enviadosPorBot = new Set(); // ids de mensajes que mandó el bot (para distinguirlos de los de Lauti)
// conversación → hasta cuándo el bot no contesta porque escribió Lauti. Se guarda en disco para que un redeploy no la borre.
const PAUSAS_FILE = path.join(__dirname, "..", "data", "bot", "pausas.json");
const pausados = new Map(Object.entries(leerPausas()));
const pendientes = new Map(); // conversación → { canal, destino, textos, nombre, ultimoId, timer }
const enCurso = new Map(); // conversación → promesa de la respuesta actual (una a la vez por persona)
// Si la IA falla (sin crédito en Anthropic, clave mala, caída): /api/salud da error para que el monitor avise.
const salud = { ultimoOk: null, ultimoError: null };
const AVISO_FALLA_MS = 3600000; // a Lauti, como mucho un aviso por hora
const DISCULPA_MS = 6 * 3600000; // al cliente, como mucho una disculpa cada 6 h por charla
const DISCULPA = "¡Hola! En este momento no puedo responderte, pero ya le avisé a Lauti y te escribe en un rato.";
const disculpados = new Map(); // conversación → cuándo se le mandó la disculpa
let ultimoAvisoFalla = 0;

const CANALES = {
  whatsapp: {
    nombre: "WhatsApp",
    enviar: (destino, texto) => wa.enviarTexto(destino, texto),
    marcarLeido: (destino, ultimoId) => wa.marcarLeido(ultimoId),
    contacto: (destino) => `+${destino} · https://wa.me/${destino}`,
  },
  instagram: {
    nombre: "Instagram",
    enviar: (destino, texto) => meta.enviarTexto(destino, texto),
    marcarLeido: (destino) => meta.marcarLeido(destino),
    contacto: () => "respondele desde los mensajes de Instagram de la quinta",
  },
  messenger: {
    nombre: "Messenger",
    enviar: (destino, texto) => meta.enviarTexto(destino, texto),
    marcarLeido: (destino) => meta.marcarLeido(destino),
    contacto: () => "respondele desde Messenger (bandeja de la página de la quinta)",
  },
};

function base() {
  return Boolean(process.env.WHATSAPP_APP_SECRET && process.env.WHATSAPP_VERIFY_TOKEN && process.env.ANTHROPIC_API_KEY) &&
    process.env.BOT_ACTIVO !== "no";
}
function botActivo() {
  return base() && wa.configurado();
}
function metaActivo() {
  return base() && meta.configurado();
}

async function notificarLauti(aviso) {
  const destino = process.env.LAUTI_WHATSAPP;
  console.log(`[bot] AVISO para Lauti (${aviso.motivo}) de ${aviso.nombre || ""} por ${aviso.canal}: ${aviso.resumen}`);
  if (!destino || !wa.configurado()) return;
  const texto =
    `🔔 *${aviso.motivo.toUpperCase()}* — ${aviso.nombre || "Sin nombre"} por ${aviso.canal}\n` +
    `${aviso.resumen}\n\n${aviso.contacto}`;
  try {
    await wa.enviarTexto(destino, texto);
  } catch (e) {
    // Fuera de la ventana de 24 h Meta no deja mandar texto libre: el aviso queda en data/bot/avisos.json.
    console.warn("[bot] no se pudo avisar a Lauti por WhatsApp:", e.message);
  }
}

function textoDeMensaje(msg) {
  if (msg.type === "text") return msg.text?.body || "";
  if (msg.type === "button") return msg.button?.text || "";
  if (msg.type === "interactive") {
    return msg.interactive?.button_reply?.title || msg.interactive?.list_reply?.title || "";
  }
  return null; // audio, imagen, sticker, etc.
}

// La respuesta viene con las burbujas separadas por una línea en blanco; cada una va como mensaje aparte.
function separarBurbujas(texto) {
  const partes = texto.split(/\n\s*\n/).map((t) => t.trim()).filter(Boolean);
  if (partes.length <= MAX_BURBUJAS) return partes;
  return [...partes.slice(0, MAX_BURBUJAS - 1), partes.slice(MAX_BURBUJAS - 1).join("\n\n")];
}

function yaVisto(id) {
  if (!id) return false;
  if (vistos.has(id)) return true;
  vistos.add(id);
  if (vistos.size > 5000) vistos.delete(vistos.values().next().value);
  return false;
}

function leerPausas() {
  try {
    return JSON.parse(fs.readFileSync(PAUSAS_FILE, "utf8"));
  } catch (e) {
    return {};
  }
}

function guardarPausas() {
  for (const [id, hasta] of pausados) if (hasta <= Date.now()) pausados.delete(id);
  fs.mkdirSync(path.dirname(PAUSAS_FILE), { recursive: true });
  fs.writeFileSync(PAUSAS_FILE, JSON.stringify(Object.fromEntries(pausados), null, 2));
}

function estaPausado(convId) {
  const hasta = pausados.get(convId);
  if (!hasta) return false;
  if (Date.now() < hasta) return true;
  pausados.delete(convId);
  return false;
}

// Los mensajes que llegan con el bot pausado no se contestan, pero quedan en la charla para que Lauti los vea en el panel.
function guardarSinResponder(convId, p) {
  if (!p?.textos?.length) return;
  clearTimeout(p.timer);
  const ts = new Date().toISOString();
  agente.agregarTurnos(convId, p.textos.map((text) => ({ role: "user", text, ts })), { nombre: p.nombre });
}

// Nunca acorta una pausa más larga (por ejemplo, si Lauti la dejó pausada hasta reactivarla).
function pausar(convId, ms) {
  pausados.set(convId, Math.max(pausados.get(convId) || 0, Date.now() + ms));
  guardarPausas();
  guardarSinResponder(convId, pendientes.get(convId));
  pendientes.delete(convId);
}

function reanudar(convId) {
  pausados.delete(convId);
  guardarPausas();
  agente.quitarSilencio(convId);
}

function pausadoHasta(convId) {
  return estaPausado(convId) ? pausados.get(convId) : null;
}

// Canal y destinatario a partir del id de la conversación: ig_… Instagram, fb_… Messenger, si no WhatsApp.
function canalDe(convId) {
  if (convId.startsWith("ig_")) return { canal: "instagram", destino: convId.slice(3) };
  if (convId.startsWith("fb_")) return { canal: "messenger", destino: convId.slice(3) };
  return { canal: "whatsapp", destino: convId };
}

// Lauti responde desde el panel: se manda por el canal de la charla, queda guardado y el bot se pausa ahí.
async function enviarManual(convId, texto) {
  const { canal, destino } = canalDe(convId);
  const ids = await CANALES[canal].enviar(destino, texto);
  for (const id of ids || []) enviadosPorBot.add(id); // el eco de Meta no tiene que contarse dos veces
  agente.agregarTurnos(convId, [{ role: "assistant", de: "lauti", text: texto, ts: new Date().toISOString() }]);
  pausar(convId, PAUSA_HUMANO_MS);
}

async function procesar(convId) {
  const p = pendientes.get(convId);
  pendientes.delete(convId);
  if (!p) return;
  if (estaPausado(convId)) return guardarSinResponder(convId, p);
  const canal = CANALES[p.canal];
  const anterior = enCurso.get(convId) || Promise.resolve();
  const actual = anterior.then(async () => {
    try {
      // Instagram y Messenger no mandan el nombre con el mensaje: se pide una vez y queda en la charla.
      if (!p.nombre && p.canal !== "whatsapp" && !agente.leerConversacion(convId).nombre) {
        p.nombre = await meta.obtenerNombre(p.destino, p.canal);
      }
      await canal.marcarLeido(p.destino, p.ultimoId);
      let respuesta;
      try {
        respuesta = await agente.responder(p.textos, {
          waId: convId,
          canal: canal.nombre,
          contacto: canal.contacto(p.destino),
          nombre: p.nombre,
          leerOcupadas: procesar.leerOcupadas,
          notificarLauti,
        });
      } catch (e) {
        await fallaIA(convId, p, canal, e);
        return;
      }
      salud.ultimoOk = Date.now();
      if (respuesta === null) return; // hoy ya no le contesta (spam o fuera de tema)
      if (estaPausado(convId)) return agente.marcarUltimaNoEnviada(convId); // Lauti tomó la charla mientras el bot pensaba
      const burbujas = separarBurbujas(respuesta);
      for (let i = 0; i < burbujas.length; i++) {
        if (i > 0) await new Promise((r) => setTimeout(r, PAUSA_BURBUJA_MS));
        if (estaPausado(convId)) return;
        const ids = await canal.enviar(p.destino, burbujas[i]);
        for (const id of ids || []) enviadosPorBot.add(id);
      }
      if (enviadosPorBot.size > 5000) enviadosPorBot.delete(enviadosPorBot.values().next().value);
    } catch (e) {
      console.error("[bot] error respondiendo a", convId, e);
    }
  });
  enCurso.set(convId, actual);
  await actual;
  if (enCurso.get(convId) === actual) enCurso.delete(convId);
}

// La IA no pudo responder: el mensaje del cliente queda guardado, se le pide disculpas y se le avisa a Lauti.
async function fallaIA(convId, p, canal, e) {
  console.error("[bot] la IA no pudo responder a", convId, e?.status || "", e?.message || e);
  salud.ultimoError = { ts: Date.now(), detalle: String(e?.message || e).slice(0, 300) };
  guardarSinResponder(convId, p);
  if (Date.now() - (disculpados.get(convId) || 0) > DISCULPA_MS) {
    disculpados.set(convId, Date.now());
    try {
      const ids = await canal.enviar(p.destino, DISCULPA);
      for (const id of ids || []) enviadosPorBot.add(id);
      agente.agregarTurnos(convId, [{ role: "assistant", text: DISCULPA, ts: new Date().toISOString() }]);
    } catch (err) {
      console.warn("[bot] tampoco se pudo mandar la disculpa:", err.message);
    }
  }
  if (Date.now() - ultimoAvisoFalla > AVISO_FALLA_MS) {
    ultimoAvisoFalla = Date.now();
    const sinCredito = /credit balance|billing/i.test(String(e?.message));
    await agente.avisar({ waId: convId, canal: canal.nombre, contacto: canal.contacto(p.destino), nombre: p.nombre, notificarLauti },
      "bot sin responder",
      (sinCredito ? "Se terminó el crédito de Anthropic: cargá saldo en platform.claude.com (Billing). " : `La IA dio error (${salud.ultimoError.detalle}). `) +
      "El bot no está contestando; esta persona recibió una disculpa y espera tu respuesta.");
  }
}

// Para el monitor externo: 200 si el servidor anda y la IA respondió bien la última vez, 503 si la última vez falló.
function estadoSalud() {
  const fallando = Boolean(salud.ultimoError && salud.ultimoError.ts > (salud.ultimoOk || 0));
  return { ok: !fallando, ia: fallando ? "fallando" : salud.ultimoOk ? "ok" : "sin mensajes desde el arranque" };
}

function encolar({ convId, canal, destino, nombre, texto, messageId }) {
  const p = pendientes.get(convId) || { canal, destino, textos: [], nombre, ultimoId: messageId, timer: null };
  p.textos.push(texto);
  p.ultimoId = messageId;
  if (nombre) p.nombre = nombre;
  clearTimeout(p.timer);
  p.timer = setTimeout(() => procesar(convId), ESPERA_MS);
  pendientes.set(convId, p);
}

function verificar(req, res) {
  const { verifyToken } = wa.config();
  if (verifyToken && req.query["hub.mode"] === "subscribe" && req.query["hub.verify_token"] === verifyToken) {
    return res.status(200).send(String(req.query["hub.challenge"] || ""));
  }
  return res.sendStatus(403);
}

function firmaOk(req, res) {
  if (wa.firmaValida(req.rawBody, req.get("X-Hub-Signature-256"))) return true;
  console.warn("[bot] aviso de Meta rechazado: la firma no coincide (revisar WHATSAPP_APP_SECRET)");
  res.sendStatus(401);
  return false;
}

function crearRouter({ leerOcupadas }) {
  procesar.leerOcupadas = leerOcupadas;
  const router = express.Router();

  router.get("/webhook/whatsapp", verificar);
  router.get("/webhook/meta", verificar);

  router.post("/webhook/whatsapp", (req, res) => {
    if (!firmaOk(req, res)) return;
    // Responder enseguida: si Meta no recibe 200 rápido, reintenta.
    res.sendStatus(200);
    const cantidad = (req.body?.entry || []).reduce(
      (n, e) => n + (e.changes || []).reduce((m, c) => m + (c.value?.messages?.length || 0), 0), 0);
    if (cantidad) console.log(`[bot] llegaron ${cantidad} mensaje(s) de WhatsApp`);
    if (!botActivo()) {
      if (cantidad) console.warn("[bot] inactivo: falta alguna variable (WHATSAPP_*, ANTHROPIC_API_KEY) o BOT_ACTIVO=no");
      return;
    }

    for (const entry of req.body?.entry || []) {
      for (const change of entry.changes || []) {
        const value = change.value || {};
        if (change.field !== "messages" || !Array.isArray(value.messages)) continue;
        const nombres = Object.fromEntries((value.contacts || []).map((c) => [c.wa_id, c.profile?.name]));
        for (const msg of value.messages) {
          if (!msg.id || yaVisto(msg.id)) continue;
          const texto = textoDeMensaje(msg);
          if (texto === null) {
            wa.enviarTexto(msg.from, "¡Hola! Por ahora solo puedo leer mensajes de texto. ¿Me lo escribís?")
              .catch((e) => console.warn("[bot]", e.message));
            continue;
          }
          if (texto.trim()) {
            encolar({ convId: msg.from, canal: "whatsapp", destino: msg.from, nombre: nombres[msg.from], texto: texto.trim(), messageId: msg.id });
          }
        }
      }
    }
  });

  router.post("/webhook/meta", (req, res) => {
    if (!firmaOk(req, res)) return;
    res.sendStatus(200);
    const objeto = req.body?.object; // "instagram" o "page" (Messenger)
    const canal = objeto === "instagram" ? "instagram" : objeto === "page" ? "messenger" : null;
    if (!canal) return;
    const prefijo = canal === "instagram" ? "ig_" : "fb_";
    const eventos = (req.body.entry || []).flatMap((e) => (e.messaging || []).map((m) => ({ ...m, cuenta: e.id })));
    if (eventos.length) console.log(`[bot] llegaron ${eventos.length} evento(s) de ${CANALES[canal].nombre}`);
    if (!metaActivo()) {
      if (eventos.length) console.warn("[bot] Instagram/Messenger inactivo: falta META_PAGE_TOKEN u otra variable");
      return;
    }

    for (const ev of eventos) {
      const msg = ev.message;
      if (!msg || !msg.mid || yaVisto(msg.mid)) continue;
      if (msg.is_echo) {
        // Mensaje enviado desde la cuenta de la quinta. Si no lo mandó el bot, lo escribió Lauti a mano:
        // el bot se calla en esa charla por un rato para no pisarlo.
        const deNuestraApp = process.env.META_APP_ID && String(msg.app_id || "") === process.env.META_APP_ID;
        if (!enviadosPorBot.has(msg.mid) && !deNuestraApp) {
          const convId = prefijo + ev.recipient?.id;
          pausar(convId, PAUSA_HUMANO_MS);
          if (msg.text) agente.agregarTurnos(convId, [{ role: "assistant", de: "lauti", text: msg.text, ts: new Date().toISOString() }]);
          console.log(`[bot] Lauti respondió a mano en ${convId}: el bot se pausa en esa charla`);
        }
        continue;
      }
      const remitente = ev.sender?.id;
      if (!remitente || remitente === ev.cuenta) continue;
      const convId = prefijo + remitente;
      if (msg.text && msg.text.trim()) {
        encolar({ convId, canal, destino: remitente, nombre: null, texto: msg.text.trim(), messageId: msg.mid });
      } else if (msg.attachments && !estaPausado(convId)) {
        meta.enviarTexto(remitente, "¡Hola! Por ahora solo puedo leer mensajes de texto. ¿Me lo escribís?")
          .catch((e) => console.warn("[bot]", e.message));
      }
    }
  });

  return router;
}

module.exports = { crearRouter, estadoSalud, botActivo, metaActivo, pausar, reanudar, pausadoHasta, canalDe, enviarManual, PAUSA_HUMANO_MS };
