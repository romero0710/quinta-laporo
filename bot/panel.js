// API del panel de conversaciones (solo con sesión de admin): ver las charlas del bot,
// contestar a mano y pausar o reactivar el bot en una charla.
//   GET  /api/admin/conversaciones              → lista, la más reciente primero
//   GET  /api/admin/conversaciones/:id          → mensajes de una charla
//   POST /api/admin/conversaciones/:id/responder { texto } → manda el mensaje y pausa el bot 12 h
//   POST /api/admin/conversaciones/:id/pausar    { horas } → el bot no contesta en esa charla
//   POST /api/admin/conversaciones/:id/reanudar  → el bot vuelve a contestar
//   GET  /api/admin/avisos                       → últimos avisos del bot para Lauti
//   GET  /api/admin/copia                        → descarga una copia de seguridad de todo data/
const express = require("express");
const agente = require("./agente");
const bot = require("./index");
const { armarCopia, diaArgentina } = require("../lib/copias");

const ID_RE = /^(ig_|fb_)?\d{5,30}$/;
const MAX_TEXTO = 2000;
const MAX_HORAS_PAUSA = 24 * 30;
const CANAL_NOMBRE = { whatsapp: "WhatsApp", instagram: "Instagram", messenger: "Messenger" };

function crearPanelRouter(requiereSesion) {
  const router = express.Router();
  router.use("/api/admin", requiereSesion, (req, res, next) => {
    res.set("Cache-Control", "no-store");
    next();
  });

  // Solo se puede actuar sobre charlas que ya existen: nunca escribirle a un número cualquiera.
  function conversacion(req, res) {
    const id = req.params.id;
    if (!ID_RE.test(id)) {
      res.status(400).json({ ok: false, error: "Conversación inválida" });
      return null;
    }
    const conv = agente.leerConversacion(id);
    if (!conv.turnos.length) {
      res.status(404).json({ ok: false, error: "No existe esa conversación" });
      return null;
    }
    return conv;
  }

  function estado(id) {
    return { canal: CANAL_NOMBRE[bot.canalDe(id).canal], pausado_hasta: bot.pausadoHasta(id) };
  }

  router.get("/api/admin/conversaciones", (req, res) => {
    const lista = agente.listarConversaciones().map((c) => ({ ...c, ...estado(c.id) }));
    res.json({ ok: true, conversaciones: lista });
  });

  router.get("/api/admin/conversaciones/:id", (req, res) => {
    const conv = conversacion(req, res);
    if (!conv) return;
    const turnos = conv.turnos.map((t) => ({
      de: t.de || (t.role === "user" ? "cliente" : "bot"),
      texto: t.text,
      ts: t.ts || null,
      no_enviado: Boolean(t.noEnviado),
      acciones: t.acciones || [],
    }));
    const silenciado = listarSilencio(conv);
    res.json({ ok: true, id: conv.waId, nombre: conv.nombre || null, silenciado, ...estado(conv.waId), turnos });
  });

  router.post("/api/admin/conversaciones/:id/responder", async (req, res) => {
    const conv = conversacion(req, res);
    if (!conv) return;
    const texto = typeof req.body?.texto === "string" ? req.body.texto.trim() : "";
    if (!texto || texto.length > MAX_TEXTO) {
      return res.status(400).json({ ok: false, error: `Escribí un mensaje de hasta ${MAX_TEXTO} caracteres` });
    }
    try {
      await bot.enviarManual(conv.waId, texto);
      res.json({ ok: true, ...estado(conv.waId) });
    } catch (e) {
      console.warn("[panel] no se pudo enviar:", e.message);
      // Meta no deja mandar texto libre si pasaron más de 24 h desde el último mensaje del cliente.
      res.status(502).json({ ok: false, error: "Meta no aceptó el mensaje. Si pasaron más de 24 h desde el último mensaje del cliente, respondé desde la app." });
    }
  });

  router.post("/api/admin/conversaciones/:id/pausar", (req, res) => {
    const conv = conversacion(req, res);
    if (!conv) return;
    const horas = Number(req.body?.horas);
    if (!Number.isFinite(horas) || horas <= 0 || horas > MAX_HORAS_PAUSA) {
      return res.status(400).json({ ok: false, error: `horas tiene que ser entre 1 y ${MAX_HORAS_PAUSA}` });
    }
    bot.pausar(conv.waId, horas * 3600000);
    res.json({ ok: true, ...estado(conv.waId) });
  });

  router.post("/api/admin/conversaciones/:id/reanudar", (req, res) => {
    const conv = conversacion(req, res);
    if (!conv) return;
    bot.reanudar(conv.waId);
    res.json({ ok: true, ...estado(conv.waId) });
  });

  router.get("/api/admin/avisos", (req, res) => {
    res.json({ ok: true, avisos: agente.leerAvisos().slice(-50).reverse() });
  });

  router.get("/api/admin/copia", (req, res) => {
    res.set("Content-Disposition", `attachment; filename="quinta-copia-${diaArgentina()}.json"`);
    res.type("application/json").send(JSON.stringify(armarCopia(), null, 1));
  });

  return router;
}

// Motivo por el que el bot se calló hoy en esa charla (spam o fuera de tema), o null.
function listarSilencio(conv) {
  const hoy = new Intl.DateTimeFormat("en-CA", { timeZone: "America/Argentina/Buenos_Aires" }).format(new Date());
  return conv.limite?.dia === hoy ? conv.limite.silenciado || null : null;
}

module.exports = { crearPanelRouter };
