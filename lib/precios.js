// Reglas de precio y disponibilidad de la Quinta La Poro (definidas por Lauti).
//   - Sábado, domingo y feriados: precio de fin de semana. Viernes cuenta como día de semana.
//   - Pasar el día: incluye hasta 20 personas; cada persona extra paga EXTRA_POR_PERSONA por día.
//   - Pernocte: incluye hasta 15 personas; de 16 a 20 cada extra paga EXTRA_POR_PERSONA por día; más de 20 no se permite.
const PRECIOS = { semana: 350000, finde: 400000 };
const EXTRA_POR_PERSONA = 25000;
const INCLUIDAS = { dia: 20, pernocte: 15 };
const MAX_PERNOCTE = 20;
const MAX_DIAS = 62;
const FECHA_RE = /^\d{4}-\d{2}-\d{2}$/;
const FERIADOS = (() => {
  try {
    return require("../config/feriados.json").feriados || {};
  } catch (e) {
    return {};
  }
})();

function parseFecha(str) {
  if (!FECHA_RE.test(str || "")) return null;
  const d = new Date(str + "T00:00:00Z");
  return isNaN(d) || d.toISOString().slice(0, 10) !== str ? null : d;
}

// Devuelve { ok: true, ... } o { ok: false, error }
function calcularDisponibilidad({ desde: desdeStr, hasta: hastaStr, personas: personasIn, pernocte = false, ocupadas = [] }) {
  const desde = parseFecha(desdeStr);
  const hasta = hastaStr ? parseFecha(hastaStr) : desde;
  if (!desde || !hasta) {
    return { ok: false, error: "Usá desde=AAAA-MM-DD y opcionalmente hasta=AAAA-MM-DD" };
  }
  const dias = Math.round((hasta - desde) / 86400000) + 1;
  if (dias < 1 || dias > MAX_DIAS) {
    return { ok: false, error: `El rango tiene que ser de 1 a ${MAX_DIAS} días` };
  }

  let personas = null;
  if (personasIn !== undefined && personasIn !== null && personasIn !== "") {
    personas = Number(personasIn);
    if (!Number.isInteger(personas) || personas < 1) {
      return { ok: false, error: "personas tiene que ser un número entero mayor a 0" };
    }
    if (pernocte && personas > MAX_PERNOCTE) {
      return { ok: false, error: `Para dormir el máximo es de ${MAX_PERNOCTE} personas` };
    }
  }
  const incluidas = pernocte ? INCLUIDAS.pernocte : INCLUIDAS.dia;
  const extras = personas ? Math.max(0, personas - incluidas) : 0;

  const ocupadasSet = new Set(ocupadas);
  const resultado = [];
  for (let i = 0; i < dias; i++) {
    const d = new Date(desde.getTime() + i * 86400000);
    const fecha = d.toISOString().slice(0, 10);
    const feriado = FERIADOS[fecha] || null;
    const finde = d.getUTCDay() === 0 || d.getUTCDay() === 6;
    const base = finde || feriado ? PRECIOS.finde : PRECIOS.semana;
    const dia = {
      fecha,
      disponible: !ocupadasSet.has(fecha),
      tipo: feriado ? "feriado" : finde ? "fin de semana" : "día de semana",
      precio: base,
    };
    if (feriado) dia.feriado = feriado;
    if (personas) {
      dia.personas_extra = extras;
      dia.adicional = extras * EXTRA_POR_PERSONA;
      dia.total = base + dia.adicional;
    }
    resultado.push(dia);
  }

  const respuesta = { ok: true, pernocte, dias: resultado };
  if (personas) {
    respuesta.personas = personas;
    respuesta.personas_incluidas = incluidas;
    respuesta.total = resultado.reduce((sum, d) => sum + d.total, 0);
    respuesta.todos_disponibles = resultado.every((d) => d.disponible);
  }
  respuesta.nota = `Pasar el día incluye hasta ${INCLUIDAS.dia} personas y dormir hasta ${INCLUIDAS.pernocte}; ` +
    `cada persona extra suma $${EXTRA_POR_PERSONA.toLocaleString("es-AR")} por día (para dormir, máximo ${MAX_PERNOCTE}). ` +
    "Feriados se cobran como fin de semana. Ingreso desde las 10 h, salida hasta las 20 h.";
  return respuesta;
}

module.exports = { calcularDisponibilidad };
