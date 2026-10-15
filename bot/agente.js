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

function registrarAviso(aviso) {
  let lista = [];
  try {
    lista = JSON.parse(fs.readFileSync(AVISOS_FILE, "utf8"));
  } catch (e) { /* primera vez */ }
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
      required: ["desde", "hasta", "personas", "pernocte"],
      properties: {
        desde: { type: "string", description: "Primera fecha, formato AAAA-MM-DD" },
        hasta: { type: ["string", "null"], description: "Último día (AAAA-MM-DD), el día de salida. Para dormir es como mínimo el día siguiente a desde; null si es para pasar un solo día" },
        personas: { type: ["integer", "null"], description: "Cantidad de personas; null si todavía no la dijo" },
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
];

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
      pernocte: Boolean(input.pernocte),
      ocupadas: ctx.leerOcupadas(),
    });
  }
  if (bloque.name === "avisar_a_lauti") {
    const aviso = {
      fecha: new Date().toISOString(),
      waId: ctx.waId,
      canal: ctx.canal || "WhatsApp",
      contacto: ctx.contacto || "",
      nombre: ctx.nombre || null,
      motivo: input.motivo,
      resumen: input.resumen,
    };
    registrarAviso(aviso);
    await ctx.notificarLauti(aviso);
    return { ok: true, mensaje: "Aviso enviado a Lauti." };
  }
  return { ok: false, error: `Herramienta desconocida: ${bloque.name}` };
}

// Recibe uno o más textos nuevos de la persona y devuelve la respuesta del bot.
async function responder(textosNuevos, ctx) {
  const conv = leerConversacion(ctx.waId);
  if (ctx.nombre) conv.nombre = ctx.nombre;
  const textoUsuario = textosNuevos.join("\n");

  // Historial previo solo como texto: no se reenvían bloques de razonamiento entre mensajes.
  const messages = conv.turnos.map((t) => ({ role: t.role, content: t.text }));
  // La API pide que el primer mensaje sea del usuario.
  while (messages.length && messages[0].role !== "user") messages.shift();
  messages.push({ role: "user", content: textoUsuario });
  const canal = ctx.canal || "WhatsApp";
  messages.push({ role: "system", content: `Hoy es ${fechaHoyArgentina()} (hora de Argentina). La persona escribe por ${canal}.` +
    (canal === "WhatsApp" ? "" : " Acá no se ve la negrita con asteriscos: escribí texto plano.") +
    (conv.nombre ? ` Figura como "${conv.nombre}".` : "") });

  let respuestaFinal = "";
  for (let vuelta = 0; vuelta < MAX_VUELTAS_HERRAMIENTAS; vuelta++) {
    const response = await getClient().beta.messages.create({
      model: MODEL,
      max_tokens: 4000,
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

    const textos = response.content.filter((b) => b.type === "text").map((b) => b.text.trim()).filter(Boolean);
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

  conv.turnos.push({ role: "user", text: textoUsuario, ts: new Date().toISOString() });
  conv.turnos.push({ role: "assistant", text: respuestaFinal, ts: new Date().toISOString() });
  guardarConversacion(conv);
  return respuestaFinal;
}

module.exports = { responder, leerConversacion };
