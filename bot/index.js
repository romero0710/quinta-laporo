// Webhooks de Meta: cada mensaje que llega a la quinta por WhatsApp, Instagram o Messenger.
//   GET  /webhook/whatsapp, /webhook/meta → verificación que hace Meta al configurar el webhook
//   POST /webhook/whatsapp                → mensajes de WhatsApp
//   POST /webhook/meta                    → mensajes de Instagram y Messenger
// Todos vienen firmados con el App Secret de la misma app.
const express = require("express");
const wa = require("./whatsapp");
const meta = require("./meta");
const agente = require("./agente");

const ESPERA_MS = Number(process.env.BOT_ESPERA_MS || 2500); // junta mensajes seguidos en una sola respuesta
const MAX_BURBUJAS = 3;
const PAUSA_BURBUJA_MS = Number(process.env.BOT_PAUSA_BURBUJA_MS || 1200); // pausa entre burbujas, para que se lea natural
const PAUSA_HUMANO_MS = Number(process.env.BOT_PAUSA_HORAS || 12) * 3600000;
const vistos = new Set(); // ids ya procesados (Meta puede reenviar el mismo aviso)
const enviadosPorBot = new Set(); // ids de mensajes que mandó el bot (para distinguirlos de los de Lauti)
const pausados = new Map(); // conversación → hasta cuándo el bot no contesta porque escribió Lauti
const pendientes = new Map(); // conversación → { canal, destino, textos, nombre, ultimoId, timer }
const enCurso = new Map(); // conversación → promesa de la respuesta actual (una a la vez por persona)

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

function estaPausado(convId) {
  const hasta = pausados.get(convId);
  if (!hasta) return false;
  if (Date.now() < hasta) return true;
  pausados.delete(convId);
  return false;
}

async function procesar(convId) {
  const p = pendientes.get(convId);
  pendientes.delete(convId);
  if (!p || estaPausado(convId)) return;
  const canal = CANALES[p.canal];
  const anterior = enCurso.get(convId) || Promise.resolve();
  const actual = anterior.then(async () => {
    try {
      await canal.marcarLeido(p.destino, p.ultimoId);
      const respuesta = await agente.responder(p.textos, {
        waId: convId,
        canal: canal.nombre,
        contacto: canal.contacto(p.destino),
        nombre: p.nombre,
        leerOcupadas: procesar.leerOcupadas,
        notificarLauti,
      });
      if (estaPausado(convId)) return; // Lauti tomó la charla mientras el bot pensaba
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
          pausados.set(convId, Date.now() + PAUSA_HUMANO_MS);
          pendientes.delete(convId);
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

module.exports = { crearRouter, botActivo, metaActivo };
