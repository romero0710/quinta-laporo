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
- Quincho: cocina industrial, microondas, heladera, freezer, parrilla (sin horno de barro en verano 2026-27)
- Juegos en el quincho: mesa de pool, metegol, ping pong y TV con Chromecast, sin cable (no es una sala aparte)
- Predio 2000 m²: pileta 11x5, aro de basquet, cancha de fútbol y vóley, juegos para niños
- Zona de quintas, segura y tranquila

## Precios
- Día de semana: $350.000
- Fin de semana: $400.000
- Alquiler por día o pernocte
- Viernes = día de semana. Feriados y puentes = precio de fin de semana (lista en config/feriados.json, actualizar cada año)
- Navidad (24 al 27 dic) y Año Nuevo (31 dic al 3 ene): solo paquete completo de 4 días a $3.000.000, máximo 20. Incluye 15 durmiendo; de la 16 a la 20 los que duermen pagan $25.000 por día y los que solo pasan el día no pagan extra (API: &duermen=N). Días agregados fuera del paquete se cobran normal. Definido en PAQUETES de lib/precios.js
- Estadías largas (2026-10-20): descuento fijo según el total de días: 3+ $50.000, 7+ $100.000, 10+ $150.000, 15+ $200.000 y $50.000 más cada 5 días. Se resta solo de los días que no son paquete de fiestas (descuentoPorDias en lib/precios.js)
- Pasar el día: incluye hasta 20 personas. Pernocte: incluye hasta 15, máximo 20.
- Persona extra: $25.000 por persona por día (día: más de 20; pernocte: de 16 a 20)
- Menores de 3 años no pagan el extra por persona, pero cuentan para el máximo (API: &menores3=N)
- Ingreso desde las 10 h, salida hasta las 20 h. Pet friendly.

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
    - parrilla.jpg  (parrilla)
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
    - ADMIN_PASSWORD=<clave del admin>  (solo en Easypanel, nunca en el repo)
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
    - Env: ADMIN_PASSWORD (seteada en Easypanel, no se guarda acá), PORT=3000
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
- 2026-10-22: La ubicación solo se menciona si la preguntan o si creen que la quinta está en otra provincia (en una burbuja corta); antes la decía en el saludo.
- 2026-10-22: El bot da el precio base ($350.000 semana / $400.000 finde y feriados, sacado de lib/precios.js) apenas preguntan el precio, antes de pedir fecha y personas. Dice que la quinta está en Exaltación de la Cruz, zona norte de Buenos Aires, y aclara si creen que está en otra provincia.
- 2026-10-21: El saludo automático de los anuncios de Messenger/Instagram ya no pausa el bot. Llega como eco de la página igual que una respuesta de Lauti; ahora un eco sin mensaje del cliente en las últimas 24 h se toma como automático (queda en el panel como "Saludo del anuncio").
- 2026-10-21: Copias de seguridad y aviso de caída. Copia diaria de data/ en data/copias/ (últimas 14) y botón "💾 Copia" en el panel para bajarla. GET /api/salud (para UptimeRobot): 200 si anda, 503 si la última respuesta de la IA falló. Si la IA falla (por ejemplo sin crédito en Anthropic) el mensaje del cliente queda guardado, se le manda una disculpa (una cada 6 h por charla) y se avisa a Lauti (uno por hora).
- 2026-10-20: Al arrancar, si el número de WhatsApp no está registrado en la Cloud API y está WHATSAPP_PIN (6 dígitos) en Easypanel, el server lo registra solo (paso necesario al pasar el número real de la quinta).
- 2026-10-20: Panel de conversaciones en /admin.html (pestañas Conversaciones y Avisos): ver las charlas del bot de los 3 canales, contestar a mano (el bot se pausa 12 h), pausar hasta reactivar y reactivar. Los mensajes que llegan con el bot pausado y lo que Lauti escribe (panel o Business Suite) quedan guardados. Seguridad: sesión con cookie HttpOnly + SameSite=Strict de 12 h (la clave ya no se guarda en el navegador), chequeo de origen, CSP y sin iframe en el panel, todo el texto se muestra sin HTML. Pausas en data/bot/pausas.json (sobreviven al redeploy). API en bot/panel.js.
- 2026-10-15: Bot también por Instagram y Messenger (webhook /webhook/meta, env META_PAGE_TOKEN y META_APP_ID). Si Lauti contesta a mano en una charla de Instagram/Messenger, el bot se calla ahí 12 h (BOT_PAUSA_HORAS). WhatsApp con token permanente (usuario del sistema).
- 2026-10-14: Bot de WhatsApp con la API oficial de Meta (Cloud API) + Claude. Webhook en /webhook/whatsapp (verificación GET y mensajes POST firmados con el App Secret). Cotiza con la misma lógica de /api/disponibilidad (ahora en lib/precios.js) y avisa a Lauti cuando hay que reservar, visitar, descuentos o dudas. Nunca confirma reservas ni pasa datos bancarios. Se activa solo cuando están las env vars WHATSAPP_* y ANTHROPIC_API_KEY en Easypanel (BOT_ACTIVO=no lo apaga). Conversaciones y avisos en data/bot/ (volumen persistente).
- 2026-10-09: API para el bot: GET /api/disponibilidad?desde&hasta&personas&pernocte=si → disponibilidad, tipo de día, precio, adicional por personas extra y total. Feriados en config/feriados.json (NO en data/, que es el volumen de Easypanel y taparía el archivo).
- 2026-10-06: Nuevas secciones: Reglas de la casa (index.html) y Testimonios (se cargan de public/data/testimonios.json; la sección queda oculta mientras el archivo esté vacío). Formato: [{"nombre","origen","fecha","estrellas","texto"}]. Solo testimonios reales.
- 2026-10-06: Seguridad: ADMIN_PASSWORD solo por env (sin default), límite de 5 intentos/15 min. Clave cambiada en Easypanel.
- 2026-09-07: Retoques post-deploy: menú a 4 botones (Galería, Precios, Disponibilidad, Consultar), capacidad "15 personas" (antes 15/20), mapa con coords exactas + link corto maps.app.goo.gl/NPRU7kQhGvFF2T6L8, badge "verificado en Espacio Quintas" (hero + contacto), galería ampliada con TODAS las fotos de la carpeta y nueva sección de 4 videos (public/videos/). Redeploy + verificado en vivo.
- 2026-09-07: Inicio del proyecto. Plan definido. Arranca paso 1.
- 2026-09-07: Pasos 1 y 2 hechos: landing page + calendario público funcional. Falta backend (paso 3).
- 2026-09-07: Integradas 9 fotos reales (Desktop/quinta). Nueva sección "Galería". Hero con pileta. Verificado: todos los assets sirven 200. Sigue backend + panel admin.
- 2026-09-07: DEPLOY HECHO (paso 7). Repo público en GitHub (romero0710/quinta-laporo), app `quinta` creada en Easypanel (proyecto larom) con fuente Git + Dockerfile, env vars, volumen persistente /app/data y dominio quintalaporo.larom.cloud con SSL. Verificado end-to-end online. PROYECTO COMPLETO.
- 2026-09-07: Pasos 4, 5, 6 HECHOS. Backend Express + API (GET público, POST con auth Bearer), panel admin con login (contraseña en env ADMIN_PASSWORD), sanitización/dedup de fechas. Favicon + og:image + theme-color. Test e2e OK (login, auth 401, guardado, static, imágenes 200). Dockerfile + .dockerignore listos. Falta solo el deploy (paso 7).
