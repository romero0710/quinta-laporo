// Copias de seguridad de data/ (fechas ocupadas, charlas del bot, avisos y pausas).
// - Una copia por día en data/copias/AAAA-MM-DD.json.gz, se guardan las últimas 14.
//   Sirven si un archivo se rompe o se borra algo por error.
// - Desde el panel se baja una copia completa para guardarla fuera del servidor.
const fs = require("fs");
const path = require("path");
const zlib = require("zlib");

const DATA_DIR = path.join(__dirname, "..", "data");
const COPIAS_DIR = path.join(DATA_DIR, "copias");
const MAX_COPIAS = 14;

function diaArgentina() {
  return new Intl.DateTimeFormat("en-CA", { timeZone: "America/Argentina/Buenos_Aires" }).format(new Date());
}

// Todos los .json de data/ (menos las copias) en un solo objeto: { "bot/avisos.json": [...], ... }
function armarCopia() {
  const archivos = {};
  (function recorrer(dir) {
    for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
      const ruta = path.join(dir, e.name);
      if (e.isDirectory()) {
        if (ruta !== COPIAS_DIR) recorrer(ruta);
      } else if (e.name.endsWith(".json")) {
        const rel = path.relative(DATA_DIR, ruta).split(path.sep).join("/");
        try {
          archivos[rel] = JSON.parse(fs.readFileSync(ruta, "utf8"));
        } catch (err) {
          archivos[rel] = { error: "no se pudo leer: " + err.message };
        }
      }
    }
  })(DATA_DIR);
  return { creada: new Date().toISOString(), archivos };
}

function guardarCopiaDelDia() {
  try {
    if (!fs.existsSync(DATA_DIR)) return;
    fs.mkdirSync(COPIAS_DIR, { recursive: true });
    const archivo = path.join(COPIAS_DIR, `${diaArgentina()}.json.gz`);
    if (fs.existsSync(archivo)) return;
    fs.writeFileSync(archivo, zlib.gzipSync(JSON.stringify(armarCopia())));
    const viejas = fs.readdirSync(COPIAS_DIR).filter((f) => f.endsWith(".json.gz")).sort().slice(0, -MAX_COPIAS);
    for (const f of viejas) fs.unlinkSync(path.join(COPIAS_DIR, f));
    console.log("[copias] copia del día guardada:", path.basename(archivo));
  } catch (e) {
    console.warn("[copias] no se pudo guardar la copia del día:", e.message);
  }
}

// Al arrancar y cada 6 h: si todavía no hay copia de hoy, la hace.
function iniciarCopias() {
  guardarCopiaDelDia();
  setInterval(guardarCopiaDelDia, 6 * 3600000).unref();
}

module.exports = { armarCopia, iniciarCopias, diaArgentina };
