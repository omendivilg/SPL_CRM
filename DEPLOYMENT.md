# Despliegue económico de SPL

## Preparación

Crea un proyecto PostgreSQL vacío en Neon y copia su cadena TLS en `DATABASE_URL`.
Crea la aplicación de Fly con un nombre disponible y reemplaza el valor `app` de `fly.toml` si fuera necesario.
Crea un bucket privado de Tigris para los respaldos.
Nunca guardes secretos reales en archivos versionados.

Configura los secretos de la API:

```powershell
fly secrets set DATABASE_URL="..." GOOGLE_CLIENT_ID="..." GOOGLE_IOS_CLIENT_ID="..." GOOGLE_ALLOWED_EMAILS="..." ADMIN_EMAIL="..." ADMIN_EMAILS="..."
```

La imagen sirve la interfaz y la API desde el mismo dominio.
La interfaz obtiene el ID público de Google de `GET /api/auth/google/config` al iniciar; no requiere recompilar la imagen con `VITE_GOOGLE_CLIENT_ID`.
Registra el origen HTTPS de Fly como origen JavaScript autorizado del cliente OAuth web en Google Cloud.
El ID público es la única configuración que expone ese endpoint; las credenciales y la lista de correos permitidos permanecen en el servidor.

Antes de desplegar, construye y valida la imagen con una base PostgreSQL temporal con TLS:

```powershell
docker build -t spl-readiness:local .
npm run test:docker -- spl-readiness:local
```

La prueba verifica la interfaz, la configuración de Google en el navegador, las restricciones de acceso, la persistencia, un respaldo y restauración local, la caída y recuperación de PostgreSQL y el cierre con SIGTERM.
La prueba usa Google simulado para comprobar la carga del botón; el acceso con una cuenta real debe validarse después con la configuración de Google Cloud.
`GET /health` devuelve HTTP 503 cuando PostgreSQL no está disponible y HTTP 200 cuando vuelve a responder.
Fly concede 15 segundos para cerrar solicitudes y conexiones; el servidor termina con error si el cierre supera 10 segundos.
El contenedor se ejecuta como el usuario `node` e incluye una comprobación de salud de Docker.
La imagen incluye `pg_dump` y `pg_restore` de PostgreSQL 18 desde el repositorio firmado de PostgreSQL.
La prueba de restauración usa PostgreSQL 18; valida también la restauración contra la versión elegida en Neon antes de cambiar los datos de Windows.

Aplica las migraciones desde una máquina de confianza antes de desplegar una versión que las necesite:

```powershell
$env:NODE_ENV = "production"
$env:DATABASE_URL = "..."
npm run db:migrate
```

Despliega y comprueba el arranque en frío:

```powershell
fly deploy
fly status
Invoke-RestMethod https://spl-control-financiero.fly.dev/health
```

La configuración detiene la única Machine cuando no hay tráfico y la inicia con la siguiente petición.
Revisa el panel de costos de Fly después de las pruebas y configura una alerta de facturación de US$5.

## Windows conectado a Fly

El instalador 0.3.13 utiliza `https://spl-crm.fly.dev` como API central mediante `SPL_API_URL`, configurada por el lanzador de Tauri.
La interfaz permanece incluida en el instalador y se sirve desde un puerto local de loopback.
El inicio de sesión con Google abre el navegador del sistema y regresa al callback local.
La API de Fly debe aceptar el ID público del cliente OAuth de tipo Aplicación de escritorio mediante `GOOGLE_DESKTOP_CLIENT_ID` además del cliente web `GOOGLE_CLIENT_ID`.
El archivo indicado por `GOOGLE_DESKTOP_CREDENTIALS_FILE` se usa exclusivamente para construir el backend de escritorio con las credenciales instaladas existentes.
No copies ese archivo ni su contenido a la documentación ni al repositorio.

La nueva versión no abre ni modifica `spl-data.json` al utilizar la API central.
Conserva el archivo de `%APPDATA%\mx.spl.control-financiero` como origen de la importación posterior.
No existe escritura local de respaldo cuando Fly no responde; los datos nuevos requieren conexión al servidor.
La interfaz local puede abrirse sin conexión, pero iniciar sesión y consultar o guardar datos requiere que Fly esté disponible.

Antes de entregar el instalador, valida inicio de sesión real, lectura del evento de prueba de Neon, creación y persistencia de un cobro, cierre y reapertura de sesión y recuperación después de una desconexión.
Confirma que Fly sigue apuntando a `spl-dev` durante estas pruebas.
Construye el instalador con `npm run desktop:build` únicamente después de que los controles de integración hayan aprobado el cambio.
No cambies la conexión a producción ni importes el JSON como parte de la construcción del instalador.
Si fuera necesario recuperar la versión anterior, cierra la aplicación e instala el instalador local previo; sus datos JSON permanecen disponibles.
Los registros creados en Neon no se copian automáticamente al JSON al volver a la versión anterior.

## Migración desde Windows

Cierra la aplicación de Windows antes de copiar `spl-data.json`.
El importador crea un respaldo junto al archivo original, rechaza una base con datos y registra el hash del archivo importado.
Ejecutar otra vez el mismo archivo no duplica datos.

```powershell
$env:NODE_ENV = "production"
$env:DATABASE_URL = "..."
npm run db:import-local -- "C:\ruta\spl-data.json"
```

Compara los conteos impresos con el origen y revisa los totales desde la interfaz antes de cambiar Windows a la API central.
Las sesiones locales no se migran y todos los usuarios deberán entrar nuevamente.

## Respaldos

El trabajo `npm run backup:create` produce un `pg_dump`, lo comprime, lo cifra con AES-256-GCM y lo carga al bucket privado.
Conserva los siete archivos más recientes y un archivo por semana para las cuatro semanas anteriores.
Configura sus secretos en una Machine independiente y prográmala diariamente con Fly Machines.
La Machine de respaldo debe usar la misma imagen y ejecutar `node build-server/scripts/backup.js create`.

Prueba la restauración contra una base temporal, nunca directamente sobre producción:

```powershell
$env:BACKUP_KEY = "postgres/archivo.dump.gz.enc"
npm run backup:restore
```

Documenta la fecha, el archivo usado y los conteos restaurados.
Una restauración correcta debe completarse antes del cambio de datos de Windows.

## TestFlight

Copia `mobile/.env.example` a `mobile/.env` y completa la URL y los clientes OAuth.
El cliente de iOS debe usar el identificador `mx.spl.controlfinanciero`.
La cuenta de Google debe tener configurado ese cliente y la API debe aceptar su audiencia mediante `GOOGLE_IOS_CLIENT_ID`.
Configura las tres variables `EXPO_PUBLIC_*` también en el ambiente de producción de EAS antes de compilar.

```powershell
cd mobile
npx tsc --noEmit
npx expo-doctor
npx eas-cli@latest build --platform ios --profile production
npx eas-cli@latest submit --platform ios --profile production
```

El primer envío requiere vincular el proyecto de Expo, iniciar sesión en Apple y crear o seleccionar el registro de App Store Connect.
No publiques en App Store desde este flujo; la entrega objetivo es TestFlight interno.
