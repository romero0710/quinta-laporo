// Reglas de precio y disponibilidad de la Quinta La Poro (definidas por Lauti).
//   - Sábado, domingo y feriados: precio de fin de semana. Viernes cuenta como día de semana.
//   - Pasar el día: incluye hasta 20 personas; cada persona extra paga EXTRA_POR_PERSONA por día.
//   - Pernocte: mínimo 2 días seguidos (entra el día 1 a las 10 h y sale el día 2 a las 20 h); no se alquila una sola noche.
//     Incluye hasta 15 personas; de 16 a 20 cada extra paga EXTRA_POR_PERSONA por día; más de 20 no se permite.
//   - Fiestas: Navidad (24 al 27 de dic.) y Año Nuevo (31 de dic. al 3 de ene.) se alquilan solo como paquete completo
//     a precio fijo, hasta 15 personas para dormir y hasta 20 en total. Los días que se sumen fuera del paquete se cobran normal.
const PRECIOS = { semana: 350000, finde: 400000 };
const EXTRA_POR_PERSONA = 25000;
const INCLUIDAS = { dia: 20, pernocte: 15 };
const MAX_PERNOCTE = 20;
const MAX_DIAS = 62;
// mes/día de inicio y cantidad de días; el año se toma de la fecha consultada.
const PAQUETES = [
  { nombre: "Navidad", mes: 12, dia: 24, dias: 4, precio: 3000000 },
  { nombre: "Año Nuevo", mes: 12, dia: 31, dias: 4, precio: 3000000 },
];
const MAX_PAQUETE = 20;
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

const iso = (d) => d.toISOString().slice(0, 10);

// Paquete de fiestas al que pertenece una fecha (o null), con sus fechas de inicio y fin.
function paqueteDe(d) {
  for (const p of PAQUETES) {
    for (const anio of [d.getUTCFullYear() - 1, d.getUTCFullYear()]) {
      const inicio = new Date(Date.UTC(anio, p.mes - 1, p.dia));
      const fin = new Date(inicio.getTime() + (p.dias - 1) * 86400000);
      if (d >= inicio && d <= fin) return { ...p, inicio, fin };
    }
  }
  return null;
}

// Devuelve { ok: true, ... } o { ok: false, error }
function calcularDisponibilidad({ desde: desdeStr, hasta: hastaStr, personas: personasIn, pernocte = false, ocupadas = [] }) {
  let desde = parseFecha(desdeStr);
  let hasta = hastaStr ? parseFecha(hastaStr) : desde;
  if (!desde || !hasta) {
    return { ok: false, error: "Usá desde=AAAA-MM-DD y opcionalmente hasta=AAAA-MM-DD" };
  }
  // Para dormir se cobran como mínimo 2 días: el de entrada y el de salida.
  if (pernocte && hasta <= desde) hasta = new Date(desde.getTime() + 86400000);
  // Si el rango toca un paquete de fiestas, se extiende para cubrirlo completo.
  let ajustado = false;
  const pDesde = paqueteDe(desde);
  if (pDesde && pDesde.inicio < desde) { desde = pDesde.inicio; ajustado = true; }
  const pHasta = paqueteDe(hasta);
  if (pHasta && pHasta.fin > hasta) { hasta = pHasta.fin; ajustado = true; }
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

  const ocupadasSet = new Set(ocupadas);
  const paquetes = [];
  for (let i = 0; i < dias; i++) {
    const p = paqueteDe(new Date(desde.getTime() + i * 86400000));
    if (p && !paquetes.some((q) => q.desde === iso(p.inicio))) {
      const fechas = Array.from({ length: p.dias }, (_, j) => iso(new Date(p.inicio.getTime() + j * 86400000)));
      paquetes.push({
        nombre: p.nombre,
        desde: fechas[0],
        hasta: fechas[fechas.length - 1],
        precio: p.precio,
        disponible: fechas.every((f) => !ocupadasSet.has(f)),
      });
    }
  }
  // Las fiestas siempre son con pernocte.
  if (paquetes.length) pernocte = true;
  if (paquetes.length && personas && personas > MAX_PAQUETE) {
    return { ok: false, error: `En Navidad y Año Nuevo el máximo es de ${MAX_PAQUETE} personas (hasta 15 para dormir)` };
  }

  const incluidas = pernocte ? INCLUIDAS.pernocte : INCLUIDAS.dia;
  const extras = personas ? Math.max(0, personas - incluidas) : 0;

  const resultado = [];
  for (let i = 0; i < dias; i++) {
    const d = new Date(desde.getTime() + i * 86400000);
    const fecha = iso(d);
    const paquete = paqueteDe(d);
    if (paquete) {
      // El precio del paquete se cuenta una sola vez en `paquetes`, no por día.
      const dia = { fecha, disponible: !ocupadasSet.has(fecha), tipo: `paquete ${paquete.nombre}`, precio: 0 };
      if (personas) Object.assign(dia, { personas_extra: 0, adicional: 0, total: 0 });
      resultado.push(dia);
      continue;
    }
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
  if (paquetes.length) respuesta.paquetes = paquetes;
  if (ajustado) respuesta.rango_ajustado = { desde: iso(desde), hasta: iso(hasta) };
  if (personas) {
    respuesta.personas = personas;
    respuesta.personas_incluidas = incluidas;
    respuesta.total = resultado.reduce((sum, d) => sum + d.total, 0) + paquetes.reduce((sum, p) => sum + p.precio, 0);
    respuesta.todos_disponibles = resultado.every((d) => d.disponible);
  }
  respuesta.nota = `Pasar el día incluye hasta ${INCLUIDAS.dia} personas y dormir hasta ${INCLUIDAS.pernocte}; ` +
    `cada persona extra suma $${EXTRA_POR_PERSONA.toLocaleString("es-AR")} por día (para dormir, máximo ${MAX_PERNOCTE}). ` +
    "Feriados se cobran como fin de semana. Ingreso desde las 10 h, salida hasta las 20 h." +
    (paquetes.length ? " Navidad (del 24 al 27 de diciembre) y Año Nuevo (del 31 de diciembre al 3 de enero) se alquilan solo como paquete completo de 4 días a $3.000.000, para hasta 15 personas durmiendo y hasta 20 en total; no se alquilan días sueltos de esas fechas. Los días que se agreguen antes o después del paquete se cobran normal, según su tipo." : "") +
    (ajustado ? " La consulta tocaba solo parte de un paquete de fiestas, así que se cotizó el paquete completo." : "") +
    (pernocte ? " Para dormir se alquila mínimo 2 días: entrada el primer día a las 10 h y salida el último día a las 20 h; cada día se cobra según su tipo. No se alquila una sola noche." : "");
  return respuesta;
}

module.exports = { calcularDisponibilidad };
