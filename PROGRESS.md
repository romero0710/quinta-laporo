# Quinta La Poro — Web de alquiler

Progreso del proyecto. Cada sesión: leer esto primero para saber dónde seguimos.

## Objetivo
Web linda y cálida para mostrar la Quinta La Poro y su info, con un **calendario de
disponibilidad** (fechas ocupadas) que administra Lautaro desde un panel con contraseña.

## Stack
- Frontend: HTML + CSS + JS puro
- Backend: Node + Express
- Datos: `data/occupied.json` (fechas ocupadas)
- Admin protegido por contraseña → lo maneja Lautaro

## Datos de la quinta
- Nombre: Quinta La Poro
- Instagram: https://www.instagram.com/quinta.laporo/
- Atom.bio: https://www.atom.bio/quintalaporo
- WhatsApp: https://wa.me/541123372986
- Marketplace: https://www.facebook.com/marketplace/item/1353972539762945?locale=es_LA
- Ubicación (Google Maps): Quinta La Poro, -34.3857363, -59.1070159
- Capacidad: 15/20 personas
- 4 habitaciones (todas con ventilador de techo), 4 baños completos con ducha
- Quincho: cocina industrial, microondas, heladera, freezer, parrilla, horno de barro
- Sala de juegos: pool, ping pong, metegol, TV
- Predio 2000 m²: pileta 11x5, aro de basquet, cancha de fútbol y vóley, juegos para niños
- Zona de quintas, segura y tranquila

## Precios
- Día de semana: $400.000
- Fin de semana: $450.000
- Alquiler por día o pernocte
- Días festivos: precio aparte, se consulta

## Plan (pasos)
1. [HECHO] Scaffold + landing page (public/index.html, styles.css)
2. [HECHO] Calendario público solo lectura (public/script.js lee data/occupied.json o /api/occupied)
3. [HECHO PARCIAL] Fotos reales de la quinta integradas (hero, predio, galería)
4. [HECHO] Backend + API (Express: GET/POST /api/occupied, servir /public)
5. [HECHO] Panel admin con login (public/admin.html + auth por contraseña)
6. [HECHO] Ajustes finos (favicon 🏡, og:image=hero, theme-color, twitter card)
7. [HECHO] Deploy en VPS (Easypanel en Hostinger) — ONLINE ✅

## Archivos creados
- PROGRESS.md
- public/index.html  (landing completa: hero, la casa, predio, GALERÍA, precios, calendario, mapa, contacto)
- public/styles.css  (paleta cálida verde/terracota, responsive)
- public/script.js   (calendario funcional, navegación de meses)
- public/data/occupied.json (para modo estático)
- data/occupied.json (fuente para el backend futuro)
- public/images/       9 fotos reales de la quinta:
    - hero.jpg      (portada: pileta + palmera + vóley)
    - casa.jpg      (frente de la casa con galería)
    - pileta.jpg    (pileta con casa de fondo — cálida)
    - quincho.jpg   (pool + ping pong)
    - parrilla.jpg  (parrilla y horno de barro)
    - parque.jpg    (parque con arcos de fútbol)
    - habitacion.jpg
    - bano.jpg
    - detalle.jpg   (mate branded "Quinta La Poro")

## Cómo previsualizar localmente (Windows / Node)
Desde quinta-laporo/public:
  node -e "const http=require('http'),fs=require('fs'),path=require('path');const t={'.html':'text/html','.css':'text/css','.js':'text/javascript','.json':'application/json','.jpg':'image/jpeg','.png':'image/png'};http.createServer((q,r)=>{let p=path.join(__dirname,decodeURIComponent(q.url.split('?')[0])==='/'?'/index.html':decodeURIComponent(q.url.split('?')[0]));fs.readFile(p,(e,d)=>{if(e){r.writeHead(404);r.end();return}r.writeHead(200,{'Content-Type':t[path.extname(p)]||'application/octet-stream'});r.end(d)})}).listen(8791,()=>console.log('http://localhost:8791'))"
Después abrir http://localhost:8791

## Nota técnica
- Todos los assets responden 200 al servir por HTTP.
- El calendario intenta /api/occupied (paso 4), y cae a data/occupied.json (que ya está en public/data/).

## Deploy (paso 7) — Easypanel en Hostinger
- Panel: https://easypanel.larom.cloud/  (login de Lautaro; NO guardar credenciales en el repo)
- Ya listo para deploy: `Dockerfile` (node:20-alpine) + `.dockerignore`.
- IMPORTANTE: montar `/app/data` como volumen persistente en Easypanel para que
  las fechas ocupadas NO se borren en cada redeploy.
- Variables de entorno a setear en Easypanel:
    - PORT=3000
    - ADMIN_PASSWORD=Tatata1208  (Lautaro la cambia después)
- Puerto interno del contenedor: 3000.
- Opciones de fuente para Easypanel:
    A) Repo Git (recomendado, redeploy con un push) → hay que crear repo en GitHub.
    B) Subir/armar imagen Docker manualmente.
- Decisiones pendientes de Lautaro antes de subir:
    1. Método: repo GitHub (A) vs. carga manual (B).
    2. Dominio/subdominio para la web (ej: quintalaporo.larom.cloud o dominio propio).

## Pendientes / a pedirle a Lautaro
- Definir método de deploy (GitHub vs manual) y dominio.
- (Opcional) revisar textos/precios finales antes de publicar.

## Deploy — ESTADO: ONLINE ✅
- **Web en vivo:** https://quintalaporo.larom.cloud (SSL OK, wildcard *.larom.cloud ya apunta al server)
- **URL alternativa Easypanel:** https://larom-quinta.0ptqum.easypanel.host
- **GitHub (público):** https://github.com/romero0710/quinta-laporo
- **Easypanel:** proyecto `larom`, servicio `quinta` (app)
    - Fuente: Git (repo público, rama `main`, ruta `/`)
    - Build: Dockerfile
    - Env: ADMIN_PASSWORD=Tatata1208, PORT=3000
    - Volumen persistente: `data` → `/app/data` (las fechas ocupadas sobreviven redeploys)
    - Dominios: ambos apuntan al puerto interno 3000
- **Verificado end-to-end:** landing 200, /admin.html 200, /api/occupied OK,
  login correcto 200 / incorrecto 401, escritura+lectura+persistencia de fechas OK, imágenes 200.

### Cómo actualizar la web a futuro
1. Cambiar archivos en `quinta-laporo/` y `git push` a GitHub (rama main).
2. En Easypanel → proyecto larom → servicio quinta → botón "Implementar" (redeploy).
   (Opcional: configurar auto-deploy por webhook para que se publique solo con el push.)

### Pendientes de seguridad (para Lautaro)
- Revocar/regenerar el token de GitHub que se pegó en el chat.
- Cambiar la clave de Easypanel que se pegó en el chat.
- Cambiar ADMIN_PASSWORD cuando quiera (editar env en Easypanel + redeploy).

## Log
- 2026-09-07: Inicio del proyecto. Plan definido. Arranca paso 1.
- 2026-09-07: Pasos 1 y 2 hechos: landing page + calendario público funcional. Falta backend (paso 3).
- 2026-09-07: Integradas 9 fotos reales (Desktop/quinta). Nueva sección "Galería". Hero con pileta. Verificado: todos los assets sirven 200. Sigue backend + panel admin.
- 2026-09-07: DEPLOY HECHO (paso 7). Repo público en GitHub (romero0710/quinta-laporo), app `quinta` creada en Easypanel (proyecto larom) con fuente Git + Dockerfile, env vars, volumen persistente /app/data y dominio quintalaporo.larom.cloud con SSL. Verificado end-to-end online. PROYECTO COMPLETO.
- 2026-09-07: Pasos 4, 5, 6 HECHOS. Backend Express + API (GET público, POST con auth Bearer), panel admin con login (contraseña Tatata1208), sanitización/dedup de fechas. Favicon + og:image + theme-color. Test e2e OK (login, auth 401, guardado, static, imágenes 200). Dockerfile + .dockerignore listos. Falta solo el deploy (paso 7).
