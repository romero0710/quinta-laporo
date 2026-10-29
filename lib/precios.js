// Reglas de precio y disponibilidad de la Quinta La Poro (definidas por Lauti).
//   - Sábado, domingo y feriados: precio de fin de semana. Viernes cuenta como día de semana.
//   - Pasar el día: incluye hasta 20 personas; cada persona extra paga EXTRA_POR_PERSONA por día.
//   - Pernocte: mínimo 2 días seguidos (entra el día 1 a las 10 h y sale el día 2 a las 20 h); no se alquila una sola noche.
//     Incluye hasta 15 personas; de 16 a 20 cada extra paga EXTRA_POR_PERSONA por día; más de 20 no se permite.
//   - Fiestas: Navidad (24 al 27 de dic.) y Año Nuevo (31 de dic. al 3 de ene.) se alquilan solo como paquete completo
//     a precio fijo, hasta 20 personas. Incluye 15 para dormir; de 16 a 20 los que duermen pagan EXTRA_POR_PERSONA por día
//     y los que solo pasan el día no pagan extra. Los días que se sumen fuera del paquete se cobran normal.
//   - Menores de 3 años no pagan el extra por persona (sí cuentan para el máximo).
//   - Estadías largas: según el total de días de la estadía se descuenta un monto fijo (ver descuentoPorDias),
//     solo sobre los días que se cobran normal; el precio de los paquetes de fiestas no cambia.
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
// Último día que se alquila esta temporada (Lauti, 2026-10-28: "hasta marzo del año que viene").
// Fechas posteriores todavía no se toman. Se cambia con TEMPORADA_HASTA en Easypanel.
const TEMPORADA_HASTA = process.env.TEMPORADA_HASTA || "2027-03-31";
// A partir de 3 días: $50.000; 7: $100.000; 10: $150.000; 15: $200.000; y después $50.000 más cada 5 días.
function descuentoPorDias(dias) {
  if (dias >= 15) return 200000 + Math.floor((dias - 15) / 5) * 50000;
  if (dias >= 10) return 150000;
  if (dias >= 7) return 100000;
  if (dias >= 3) return 50000;
  return 0;
}
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
function calcularDisponibilidad({ desde: desdeStr, hasta: hastaStr, personas: personasIn, duermen: duermenIn, menores3: menores3In, pernocte = false, ocupadas = [] }) {
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
  const finTemporada = parseFecha(TEMPORADA_HASTA);
  if (finTemporada && hasta > finTemporada) {
    const [a, m, d] = TEMPORADA_HASTA.split("-");
    return { ok: false, fuera_de_temporada: true, error: `Por ahora solo se alquila hasta el ${d}/${m}/${a}. Fechas posteriores todavía no se toman.` };
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
  const leerOpcional = (v, nombre) => {
    if (v === undefined || v === null || v === "") return { valor: null };
    const n = Number(v);
    if (!Number.isInteger(n) || n < 0 || (personas && n > personas)) {
      return { error: `${nombre} tiene que ser un número entero entre 0 y la cantidad de personas` };
    }
    return { valor: n };
  };
  const duermenR = leerOpcional(duermenIn, "duermen");
  const menores3R = leerOpcional(menores3In, "menores3");
  if (duermenR.error || menores3R.error) return { ok: false, error: duermenR.error || menores3R.error };
  const menores3 = menores3R.valor || 0;

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
  const extras = personas ? Math.max(0, personas - menores3 - incluidas) : 0;
  // En el paquete solo pagan extra los que duermen (si no se indica, se asume que duermen todos).
  const duermen = duermenR.valor ?? personas;
  const extrasPaquete = personas ? Math.max(0, duermen - menores3 - INCLUIDAS.pernocte) : 0;

  const resultado = [];
  for (let i = 0; i < dias; i++) {
    const d = new Date(desde.getTime() + i * 86400000);
    const fecha = iso(d);
    const paquete = paqueteDe(d);
    if (paquete) {
      // El precio del paquete se cuenta una sola vez en `paquetes`, no por día.
      const dia = { fecha, disponible: !ocupadasSet.has(fecha), tipo: `paquete ${paquete.nombre}`, precio: 0 };
      if (personas) {
        const adicional = extrasPaquete * EXTRA_POR_PERSONA;
        Object.assign(dia, { personas_extra: extrasPaquete, adicional, total: adicional });
      }
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
  // El descuento nunca supera lo que se cobra por los días normales (sin paquete).
  const subtotalNormal = resultado.filter((d) => !d.tipo.startsWith("paquete")).reduce((sum, d) => sum + (d.total ?? d.precio), 0);
  const descuento = Math.min(descuentoPorDias(dias), subtotalNormal);
  if (descuento) respuesta.descuento = { dias, monto: descuento };
  if (paquetes.length) respuesta.paquetes = paquetes;
  if (ajustado) respuesta.rango_ajustado = { desde: iso(desde), hasta: iso(hasta) };
  if (personas) {
    respuesta.personas = personas;
    respuesta.personas_incluidas = incluidas;
    if (menores3) respuesta.menores3 = menores3;
    if (paquetes.length) respuesta.duermen = duermen;
    respuesta.total = resultado.reduce((sum, d) => sum + d.total, 0) + paquetes.reduce((sum, p) => sum + p.precio, 0) - descuento;
    respuesta.todos_disponibles = resultado.every((d) => d.disponible);
  }
  respuesta.nota = `Pasar el día incluye hasta ${INCLUIDAS.dia} personas y dormir hasta ${INCLUIDAS.pernocte}; ` +
    `cada persona extra suma $${EXTRA_POR_PERSONA.toLocaleString("es-AR")} por día (para dormir, máximo ${MAX_PERNOCTE}). ` +
    "Menores de 3 años no pagan el extra. Feriados se cobran como fin de semana. Ingreso desde las 10 h, salida hasta las 20 h." +
    (paquetes.length ? " Navidad (del 24 al 27 de diciembre) y Año Nuevo (del 31 de diciembre al 3 de enero) se alquilan solo como paquete completo de 4 días a $3.000.000, para hasta 20 personas: incluye 15 durmiendo, los que duermen de la 16 a la 20 pagan $25.000 por día cada uno y los que solo pasan el día no pagan extra; no se alquilan días sueltos de esas fechas. Los días que se agreguen antes o después del paquete se cobran normal, según su tipo." : "") +
    (descuento ? ` Por ser una estadía de ${dias} días se descuentan $${descuento.toLocaleString("es-AR")} del precio de los días que no son paquete de fiestas (ya restados del total).` : "") +
    (ajustado ? " La consulta tocaba solo parte de un paquete de fiestas, así que se cotizó el paquete completo." : "") +
    (pernocte ? " Para dormir se alquila mínimo 2 días: entrada el primer día a las 10 h y salida el último día a las 20 h; cada día se cobra según su tipo. No se alquila una sola noche." : "");
  return respuesta;
}

module.exports = { calcularDisponibilidad, descuentoPorDias, PRECIOS, INCLUIDAS, TEMPORADA_HASTA };
