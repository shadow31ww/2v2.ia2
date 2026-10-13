# Juego HTML online

## Despliegue gratuito en Render
1. Sube `index.html`, `server.js`, `package.json` y `render.yaml` a la raíz de un repositorio GitHub.
2. En Render, elige **New + → Web Service** y conecta ese repositorio.
3. Selecciona el plan **Free**. Runtime: Node. Build command: `npm install`. Start command: `npm start`.
4. Cuando el despliegue termine, abre la URL `https://...onrender.com`.
5. En el juego, crea una sala y comparte el nombre y la contraseña con tu amigo. Ambos deben seleccionar el mismo modo.

El servicio gratuito puede tardar cerca de un minuto en despertar después de 15 minutos sin tráfico. Las salas y partidas viven en memoria: si Render reinicia o duerme el servidor, las salas desaparecen y habrá que crearlas de nuevo.
