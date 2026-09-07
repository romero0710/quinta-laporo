FROM node:20-alpine

WORKDIR /app

# Instalar solo dependencias de producción
COPY package*.json ./
RUN npm install --omit=dev

# Copiar el resto de la app
COPY . .

# Los datos de fechas ocupadas se persisten en /app/data (montar como volumen en Easypanel)
ENV PORT=3000
EXPOSE 3000

CMD ["node", "server.js"]
