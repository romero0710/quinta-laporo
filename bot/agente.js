// Cerebro del bot: arma la conversación, llama a Claude y ejecuta sus herramientas.
const fs = require("fs");
const path = require("path");
const Anthropic = require("@anthropic-ai/sdk");
const SYSTEM_PROMPT = require("./prompt");
const { calcularDisponibilidad } = require("../lib/precios");

const MODEL = process.env.CLAUDE_MODEL || "claude-opus-5-5";
const EFFORT = process.env.CLAUDE_EFFORT || "low";
const MAX_TURNOS_GUARDADOS = 40; // turnos de texto que se recuerdan por persona
const MAX_VUELTAS_HERRAMIENTAS = 6;
const MAX_TOKENS = 1500; // alcanza para 3 burbujas cortas más las herramientas
// Freno contra spam o gente que juega con el bot: pasado el límite, el bot se calla en esa charla hasta el día siguiente.
const LIMITE_DIARIO = Number(process.env.BOT_LIMITE_DIARIO || 30); // mensajes por persona por día
const AVISO_LIMITE = "Te paso con Lauti, que te escribe en breve 🙌";

const DATA_DIR = path.join(__dirname, "..", "data");
const CONV_DIR = path.join(DATA_DIR, "bot", "conversaciones");
const AVISOS_FILE = path.join(DATA_DIR, "bot", "avisos.json");

let client = null;
function getClient() {
  if (!client) client = new (Anthropic.default || Anthropic)();
  return client;
}

// --- Memoria de cada conversación (solo texto; vive en el volumen persistente data/) ---
function archivoConversacion(waId) {
  return path.join(CONV_DIR, `${String(waId).replace(/[^a-z0-9_]/gi, "")}.json`);
}

function leerConversacion(waId) {
  try {
    return JSON.parse(fs.readFileSync(archivoConversacion(waId), "utf8"));
  } catch (e) {
    return { waId, nombre: null, turnos: [] };
  }
}

function guardarConversacion(conv) {
  fs.mkdirSync(CONV_DIR, { recursive: true });
  conv.turnos = conv.turnos.slice(-MAX_TURNOS_GUARDADOS);
  fs.writeFileSync(archivoConversacion(conv.waId), JSON.stringify(conv, null, 2));
}

// Suma turnos a una conversación leyéndola de nuevo del disco, para no pisar lo que se guardó
// mientras el bot pensaba (mensajes que llegaron con el bot pausado, respuestas de Lauti).
// `cambios` puede traer nombre o limite actualizados.
function agregarTurnos(waId, turnos, cambios = {}) {
  const conv = leerConversacion(waId);
  if (cambios.nombre) conv.nombre = cambios.nombre;
  if (cambios.limite) conv.limite = cambios.limite;
  conv.turnos.push(...turnos);
  guardarConversacion(conv);
  return conv;
}

// La última respuesta del bot quedó sin mandar (Lauti tomó la charla mientras pensaba).
function marcarUltimaNoEnviada(waId) {
  const conv = leerConversacion(waId);
  const ultima = [...conv.turnos].reverse().find((t) => t.role === "assistant" && !t.de);
  if (ultima) {
    ultima.noEnviado = true;
    guardarConversacion(conv);
  }
}

// Resumen de todas las conversaciones, la más reciente primero (para el panel).
function listarConversaciones() {
  let archivos = [];
  try {
    archivos = fs.readdirSync(CONV_DIR).filter((f) => f.endsWith(".json"));
  } catch (e) {
    return [];
  }
  return archivos
    .map((f) => {
      try {
        return JSON.parse(fs.readFileSync(path.join(CONV_DIR, f), "utf8"));
      } catch (e) {
        return null;
      }
    })
    .filter((c) => c && c.waId)
    .map((c) => {
      const ultimo = c.turnos.at(-1) || {};
      return {
        id: c.waId,
        nombre: c.nombre || null,
        ultimo: { de: ultimo.de || ultimo.role || null, texto: (ultimo.text || "").slice(0, 120), ts: ultimo.ts || null },
        silenciado: c.limite?.dia === diaArgentina() ? c.limite.silenciado || null : null,
      };
    })
    .sort((a, b) => String(b.ultimo.ts || "").localeCompare(String(a.ultimo.ts || "")));
}

// Vuelve a dejar que el bot conteste hoy en una charla que se calló por spam o fuera de tema.
function quitarSilencio(waId) {
  const conv = leerConversacion(waId);
  if (conv.limite?.silenciado) {
    conv.limite = { dia: diaArgentina(), mensajes: 0, silenciado: null };
    guardarConversacion(conv);
  }
}

function leerAvisos() {
  try {
    return JSON.parse(fs.readFileSync(AVISOS_FILE, "utf8"));
  } catch (e) {
    return []; // primera vez
  }
}

function registrarAviso(aviso) {
  const lista = leerAvisos();
  lista.push(aviso);
  fs.mkdirSync(path.dirname(AVISOS_FILE), { recursive: true });
  fs.writeFileSync(AVISOS_FILE, JSON.stringify(lista.slice(-500), null, 2));
}

// --- Herramientas que puede usar Claude ---
const TOOLS = [
  {
    name: "consultar_disponibilidad",
    description:
      "Consulta si la quinta está libre en una fecha o rango y calcula el precio exacto, incluido el adicional por personas extra. " +
      "Usala siempre antes de dar un precio o decir si una fecha está libre.",
    strict: true,
    input_schema: {
      type: "object",
      additionalProperties: false,
      required: ["desde", "hasta", "personas", "duermen", "menores3", "pernocte"],
      properties: {
        desde: { type: "string", description: "Primera fecha, formato AAAA-MM-DD" },
        hasta: { type: ["string", "null"], description: "Último día (AAAA-MM-DD), el día de salida. Para dormir es como mínimo el día siguiente a desde; null si es para pasar un solo día" },
        personas: { type: ["integer", "null"], description: "Cantidad total de personas, bebés incluidos; null si todavía no la dijo" },
        duermen: { type: ["integer", "null"], description: "Solo para Navidad y Año Nuevo: cuántos de ellos se quedan a dormir; null si duermen todos o no lo dijo" },
        menores3: { type: ["integer", "null"], description: "Cuántos son menores de 3 años (no pagan adicional); null si no hay o no lo dijo" },
        pernocte: { type: "boolean", description: "true si se quedan a dormir, false si es para pasar el día" },
      },
    },
  },
  {
    name: "avisar_a_lauti",
    description:
      "Le avisa a Lauti (el dueño) que tiene que intervenir: la persona quiere reservar o señar, quiere visitar la quinta, " +
      "pide descuento, pregunta algo que no sabés, o hay una queja.",
    strict: true,
    input_schema: {
      type: "object",
      additionalProperties: false,
      required: ["motivo", "resumen"],
      properties: {
        motivo: { type: "string", enum: ["reservar", "visitar", "descuento", "consulta", "queja"] },
        resumen: { type: "string", description: "Resumen breve: fechas, día o pernocte, personas, total cotizado y qué necesita." },
      },
    },
  },
  {
    name: "cortar_charla",
    description:
      "Corta la charla hasta mañana: el bot deja de responderle a esta persona por hoy y se le avisa a Lauti. " +
      "Usala solo cuando la persona lleva 3 mensajes seguidos que no tienen nada que ver con alquilar la quinta " +
      "(bromas, insultos, pruebas, pedidos de otras cosas). Una consulta normal, aunque sea rara, no cuenta.",
    strict: true,
    input_schema: {
      type: "object",
      additionalProperties: false,
      required: ["resumen"],
      properties: {
        resumen: { type: "string", description: "En una línea, qué estuvo escribiendo la persona." },
      },
    },
  },
];

function diaArgentina() {
  return new Intl.DateTimeFormat("en-CA", { timeZone: "America/Argentina/Buenos_Aires" }).format(new Date());
}

async function avisar(ctx, motivo, resumen) {
  const aviso = {
    fecha: new Date().toISOString(),
    waId: ctx.waId,
    canal: ctx.canal || "WhatsApp",
    contacto: ctx.contacto || "",
    nombre: ctx.nombre || ctx.conv?.nombre || null,
    motivo,
    resumen,
  };
  registrarAviso(aviso);
  await ctx.notificarLauti(aviso);
}

// Silencia la charla hasta que cambie el día (hora de Argentina).
function silenciar(conv, motivo) {
  conv.limite = { ...(conv.limite || {}), dia: diaArgentina(), silenciado: motivo };
}

// Nota corta de lo que hizo una herramienta. El historial guarda solo texto, así que sin esto
// en el mensaje siguiente Claude no ve que ya consultó o avisó, y cree que lo inventó.
function notaDeAccion(bloque, resultado) {
  const i = bloque.input || {};
  if (bloque.name === "consultar_disponibilidad") {
    const pedido = `${i.desde}${i.hasta ? " a " + i.hasta : ""}, ${i.pernocte ? "pernocte" : "día"}` +
      (i.personas ? `, ${i.personas} personas` : "");
    if (!resultado || resultado.ok === false) return `consultó disponibilidad (${pedido}): error ${resultado?.error || ""}`.trim();
    const ocupadas = (resultado.dias || []).filter((d) => !d.disponible).map((d) => d.fecha);
    return `consultó disponibilidad (${pedido}): ` +
      (ocupadas.length ? `ocupado ${ocupadas.join(", ")}` : "libre") +
      (resultado.total ? `, total $${resultado.total.toLocaleString("es-AR")}` : "") +
      ((resultado.paquetes || []).length ? `, paquete ${resultado.paquetes.map((p) => p.nombre).join(" y ")}` : "");
  }
  if (bloque.name === "avisar_a_lauti") return `le avisó a Lauti (motivo: ${i.motivo})`;
  if (bloque.name === "cortar_charla") return "cortó la charla hasta mañana y le avisó a Lauti";
  return bloque.name;
}

function fechaHoyArgentina() {
  return new Intl.DateTimeFormat("es-AR", {
    timeZone: "America/Argentina/Buenos_Aires",
    weekday: "long", year: "numeric", month: "long", day: "numeric",
  }).format(new Date());
}

// `ctx` trae: waId (id de la conversación), canal, contacto, nombre, leerOcupadas(), notificarLauti(aviso)
async function ejecutarHerramienta(bloque, ctx) {
  const input = bloque.input || {};
  if (bloque.name === "consultar_disponibilidad") {
    return calcularDisponibilidad({
      desde: input.desde,
      hasta: input.hasta || undefined,
      personas: input.personas ?? undefined,
      duermen: input.duermen ?? undefined,
      menores3: input.menores3 ?? undefined,
      pernocte: Boolean(input.pernocte),
      ocupadas: ctx.leerOcupadas(),
    });
  }
  if (bloque.name === "avisar_a_lauti") {
    await avisar(ctx, input.motivo, input.resumen);
    return { ok: true, mensaje: "Aviso enviado a Lauti." };
  }
  if (bloque.name === "cortar_charla") {
    silenciar(ctx.conv, "fuera de tema");
    await avisar(ctx, "fuera de tema", `El bot dejó de responderle por hoy. ${input.resumen}`);
    return { ok: true, mensaje: "Listo: después de esta respuesta no le contestás más por hoy. Despedite en una sola burbuja corta: decile que por acá solo respondés consultas sobre la quinta." };
  }
  return { ok: false, error: `Herramienta desconocida: ${bloque.name}` };
}

// A veces el modelo deja pegada una etiqueta interna (por ejemplo "antml:reasoning_effort>5</reasoning_effort>").
// Un cliente nunca tiene que verla: se borra cualquier renglón con etiquetas de ese estilo.
function limpiarTexto(texto) {
  return texto
    .split("\n")
    .filter((r) => !/<\/?[a-z_]+(:[a-z_]+)?[^<>]*>|\b[a-z]+:[a-z_]+>/i.test(r))
    .join("\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

// Recibe uno o más textos nuevos de la persona y devuelve la respuesta del bot,
// o null si hoy el bot ya no le contesta a esta persona.
async function responder(textosNuevos, ctx) {
  const conv = leerConversacion(ctx.waId);
  if (ctx.nombre) conv.nombre = ctx.nombre;
  const textoUsuario = textosNuevos.join("\n");
  ctx = { ...ctx, conv };

  const hoy = diaArgentina();
  if (!conv.limite || conv.limite.dia !== hoy) conv.limite = { dia: hoy, mensajes: 0, silenciado: null };
  if (conv.limite.silenciado) {
    agregarTurnos(ctx.waId, [{ role: "user", text: textoUsuario, ts: new Date().toISOString() }], { nombre: conv.nombre });
    return null;
  }
  conv.limite.mensajes = (conv.limite.mensajes || 0) + textosNuevos.length;
  if (conv.limite.mensajes > LIMITE_DIARIO) {
    silenciar(conv, "límite de mensajes");
    agregarTurnos(ctx.waId, [
      { role: "user", text: textoUsuario, ts: new Date().toISOString() },
      { role: "assistant", text: AVISO_LIMITE, ts: new Date().toISOString() },
    ], { nombre: conv.nombre, limite: conv.limite });
    console.log(`[bot] ${ctx.waId} pasó los ${LIMITE_DIARIO} mensajes de hoy: el bot se calla hasta mañana`);
    await avisar(ctx, "límite de mensajes", `Mandó más de ${LIMITE_DIARIO} mensajes hoy y el bot dejó de responderle hasta mañana. Último: "${textoUsuario.slice(0, 200)}"`);
    return AVISO_LIMITE;
  }

  // Historial previo solo como texto: no se reenvían bloques de razonamiento entre mensajes.
  // Lo que hicieron las herramientas va como nota de sistema justo antes de esa respuesta
  // (la API solo acepta mensajes de sistema después de uno del usuario).
  const messages = [];
  for (const t of conv.turnos) {
    if (t.noEnviado) continue; // respuesta que el bot armó pero no mandó porque Lauti tomó la charla
    if (!messages.length && t.role !== "user") continue; // la API pide que el primer mensaje sea del usuario
    if (t.role === "assistant" && t.acciones?.length && messages.at(-1)?.role === "user") {
      messages.push({ role: "system", content: `Para la respuesta que sigue el bot usó sus herramientas de verdad: ${t.acciones.join("; ")}. Ya está hecho: no lo repitas ni lo desmientas.` });
    }
    // Seguidos del mismo lado (mensajes que llegaron con el bot pausado, o Lauti que escribió varias veces)
    // van juntos en un solo mensaje.
    const texto = t.role === "assistant" ? limpiarTexto(t.text) : t.text; // respuestas viejas que salieron con etiquetas
    if (!texto) continue;
    const previo = messages.at(-1);
    if (previo?.role === t.role) previo.content += "\n\n" + texto;
    else messages.push({ role: t.role, content: texto });
  }
  if (messages.at(-1)?.role === "user") messages.at(-1).content += "\n\n" + textoUsuario;
  else messages.push({ role: "user", content: textoUsuario });
  const canal = ctx.canal || "WhatsApp";
  messages.push({ role: "system", content: `Hoy es ${fechaHoyArgentina()} (hora de Argentina). La persona escribe por ${canal}.` +
    (canal === "WhatsApp" ? "" : " Acá no se ve la negrita con asteriscos: escribí texto plano.") +
    (conv.nombre ? ` Figura como "${conv.nombre}".` : "") });

  let respuestaFinal = "";
  const acciones = [];
  for (let vuelta = 0; vuelta < MAX_VUELTAS_HERRAMIENTAS; vuelta++) {
    const response = await getClient().beta.messages.create({
      model: MODEL,
      max_tokens: MAX_TOKENS,
      betas: ["server-side-fallback-2026-07-01"],
      fallbacks: "default",
      output_config: { effort: EFFORT },
      system: [{ type: "text", text: SYSTEM_PROMPT, cache_control: { type: "ephemeral" } }],
      tools: TOOLS,
      messages,
    });

    if (response.stop_reason === "refusal") {
      respuestaFinal = "Disculpá, eso no lo puedo responder por acá. Si querés, le aviso a Lauti para que te escriba.";
      break;
    }

    const textos = response.content.filter((b) => b.type === "text").map((b) => limpiarTexto(b.text)).filter(Boolean);
    const herramientas = response.content.filter((b) => b.type === "tool_use");

    if (response.stop_reason !== "tool_use" || herramientas.length === 0) {
      respuestaFinal = textos.join("\n\n");
      break;
    }

    // Se agrega la respuesta completa, sin tocarla, y después todos los resultados juntos.
    messages.push({ role: "assistant", content: response.content });
    const resultados = [];
    for (const bloque of herramientas) {
      let resultado;
      try {
        resultado = await ejecutarHerramienta(bloque, ctx);
      } catch (e) {
        console.error("[bot] error en herramienta", bloque.name, e.message);
        resultado = { ok: false, error: "No se pudo completar la consulta" };
      }
      acciones.push(notaDeAccion(bloque, resultado));
      resultados.push({
        type: "tool_result",
        tool_use_id: bloque.id,
        content: JSON.stringify(resultado),
        is_error: resultado && resultado.ok === false ? true : undefined,
      });
    }
    messages.push({ role: "user", content: resultados });
  }

  if (!respuestaFinal) {
    respuestaFinal = "Dame un momento que lo reviso y te respondo.";
  }

  agregarTurnos(ctx.waId, [
    { role: "user", text: textoUsuario, ts: new Date().toISOString() },
    { role: "assistant", text: respuestaFinal, acciones: acciones.length ? acciones : undefined, ts: new Date().toISOString() },
  ], { nombre: conv.nombre, limite: conv.limite });
  return respuestaFinal;
}

module.exports = { responder, avisar, leerConversacion, agregarTurnos, marcarUltimaNoEnviada, listarConversaciones, quitarSilencio, leerAvisos };
