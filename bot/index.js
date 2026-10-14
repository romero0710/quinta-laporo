// Webhook de WhatsApp: Meta avisa acá cada mensaje que llega al número de la quinta.
//   GET  /webhook/whatsapp  → verificación que hace Meta al configurar el webhook
//   POST /webhook/whatsapp  → mensajes entrantes (firmados con el App Secret)
const express = require("express");
const wa = require("./whatsapp");
const agente = require("./agente");

const ESPERA_MS = Number(process.env.BOT_ESPERA_MS || 2500); // junta mensajes seguidos en una sola respuesta
const vistos = new Set(); // ids ya procesados (Meta puede reenviar el mismo aviso)
const pendientes = new Map(); // waId → { textos, nombre, ultimoId, timer }
const enCurso = new Map(); // waId → promesa de la respuesta actual (una a la vez por persona)

function botActivo() {
  return wa.configurado() && Boolean(process.env.ANTHROPIC_API_KEY) && process.env.BOT_ACTIVO !== "no";
}

async function notificarLauti(aviso) {
  const destino = process.env.LAUTI_WHATSAPP;
  console.log(`[bot] AVISO para Lauti (${aviso.motivo}) de ${aviso.nombre || ""} +${aviso.waId}: ${aviso.resumen}`);
  if (!destino) return;
  const texto =
    `🔔 *${aviso.motivo.toUpperCase()}* — ${aviso.nombre || "Sin nombre"} (+${aviso.waId})\n` +
    `${aviso.resumen}\n\nEscribile: https://wa.me/${aviso.waId}`;
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

async function procesar(waId) {
  const p = pendientes.get(waId);
  pendientes.delete(waId);
  if (!p) return;
  const anterior = enCurso.get(waId) || Promise.resolve();
  const actual = anterior.then(async () => {
    try {
      await wa.marcarLeido(p.ultimoId);
      const respuesta = await agente.responder(p.textos, {
        waId,
        nombre: p.nombre,
        leerOcupadas: procesar.leerOcupadas,
        notificarLauti,
      });
      await wa.enviarTexto(waId, respuesta);
    } catch (e) {
      console.error("[bot] error respondiendo a", waId, e);
    }
  });
  enCurso.set(waId, actual);
  await actual;
  if (enCurso.get(waId) === actual) enCurso.delete(waId);
}

function encolar(waId, nombre, texto, messageId) {
  const p = pendientes.get(waId) || { textos: [], nombre, ultimoId: messageId, timer: null };
  p.textos.push(texto);
  p.ultimoId = messageId;
  if (nombre) p.nombre = nombre;
  clearTimeout(p.timer);
  p.timer = setTimeout(() => procesar(waId), ESPERA_MS);
  pendientes.set(waId, p);
}

function crearRouter({ leerOcupadas }) {
  procesar.leerOcupadas = leerOcupadas;
  const router = express.Router();

  router.get("/webhook/whatsapp", (req, res) => {
    const { verifyToken } = wa.config();
    if (verifyToken && req.query["hub.mode"] === "subscribe" && req.query["hub.verify_token"] === verifyToken) {
      return res.status(200).send(String(req.query["hub.challenge"] || ""));
    }
    return res.sendStatus(403);
  });

  router.post("/webhook/whatsapp", (req, res) => {
    if (!wa.firmaValida(req.rawBody, req.get("X-Hub-Signature-256"))) {
      return res.sendStatus(401);
    }
    // Responder enseguida: si Meta no recibe 200 rápido, reintenta.
    res.sendStatus(200);
    if (!botActivo()) return;

    for (const entry of req.body?.entry || []) {
      for (const change of entry.changes || []) {
        const value = change.value || {};
        if (change.field !== "messages" || !Array.isArray(value.messages)) continue;
        const nombres = Object.fromEntries((value.contacts || []).map((c) => [c.wa_id, c.profile?.name]));
        for (const msg of value.messages) {
          if (!msg.id || vistos.has(msg.id)) continue;
          vistos.add(msg.id);
          if (vistos.size > 5000) vistos.delete(vistos.values().next().value);

          const texto = textoDeMensaje(msg);
          if (texto === null) {
            wa.enviarTexto(msg.from, "¡Hola! Por ahora solo puedo leer mensajes de texto. ¿Me lo escribís?")
              .catch((e) => console.warn("[bot]", e.message));
            continue;
          }
          if (texto.trim()) encolar(msg.from, nombres[msg.from], texto.trim(), msg.id);
        }
      }
    }
  });

  return router;
}

module.exports = { crearRouter, botActivo };
