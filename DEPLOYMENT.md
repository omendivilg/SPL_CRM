# Despliegue económico de SPL

## Preparación

Crea un proyecto PostgreSQL vacío en Neon y copia su cadena TLS en `DATABASE_URL`.
Crea la aplicación de Fly con un nombre disponible y reemplaza el valor `app` de `fly.toml` si fuera necesario.
Crea un bucket privado de Tigris para los respaldos.
Nunca guardes secretos reales en archivos versionados.

Configura los secretos de la API:

```powershell
fly secrets set DATABASE_URL="..." GOOGLE_CLIENT_ID="..." GOOGLE_IOS_CLIENT_ID="..." GOOGLE_ALLOWED_EMAILS="..." ADMIN_EMAIL="..."
```

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
