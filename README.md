# SPL Control Financiero

Aplicación en español para administrar eventos, finanzas y nómina de SPL y 5to Elemento.

## Funciones disponibles

- Panel responsivo para propietario, escritorio e iPad.
- Eventos, cobros, reembolsos, gastos, liquidaciones y reportes mensuales.
- Nóminas semanales con equipo completo, gastos opcionales, plantillas predeterminadas y pago completo reversible con historial.
- Autenticación Google restringida, sesiones persistentes y permisos por rol.
- Backend Fastify para PostgreSQL y backend local persistente para la aplicación Windows.
- Instalador NSIS de Tauri con interfaz, backend y runtime incluidos.
- Pruebas unitarias, de seguridad y de navegador para flujos normales, límites y cargas hostiles.

La versión web de desarrollo usa la API local en el puerto 3001.
La aplicación Tauri elige un puerto de bucle local disponible y conserva los datos en la carpeta privada de la aplicación.

## Configuración del backend central

El servidor central requiere las variables `DATABASE_URL`, `GOOGLE_CLIENT_ID`, `ADMIN_EMAIL` y `GOOGLE_ALLOWED_EMAILS`.
Aplica las migraciones de `server/db/migrations` a PostgreSQL antes de iniciar esa API.

```powershell
npm run start:server
```

Para desarrollo sin PostgreSQL ni Docker, `npm run dev` inicia la interfaz y un backend temporal en memoria.

```powershell
npm run dev
```

## Ejecutar durante desarrollo

```powershell
npm install
npm run dev
```

## Verificar

```powershell
npm run build
npm run build:server
npm test
npm run test:e2e
npm run build:desktop
node scripts/smoke-payroll-desktop.mjs
cargo test --manifest-path src-tauri/Cargo.toml
```

## Crear el instalador de Windows

La aplicación de escritorio usa un cliente OAuth de tipo Desktop app.
El acceso abre Google en el navegador del sistema y regresa a un callback local protegido con PKCE y estado aleatorio.
Descarga el JSON del cliente OAuth de tipo Desktop app desde Google Cloud y define `GOOGLE_DESKTOP_CREDENTIALS_FILE` con su ruta en `.env` antes de compilar.
El empaquetado verifica que el archivo incluya el ID y el secreto del mismo cliente; no agregues ese JSON al repositorio.
El modo de pruebas está disponible en desarrollo y permanece deshabilitado en los instaladores y en el servidor central de producción.
La versión 0.2.0 agrega presupuestos de nómina editables por evento, nóminas con varios trabajadores, liquidación total de gastos extra y modales propios para las operaciones financieras.

```powershell
$env:GOOGLE_DESKTOP_CREDENTIALS_FILE = "C:/ruta/al/cliente-oauth-desktop.json"
npm run desktop:build
```

El instalador se genera en `src-tauri/target/release/bundle/nsis`.
La firma Authenticode se añadirá cuando SPL disponga de un certificado de firma de código.

## Nóminas semanales

La nueva página guarda una semana completa con sus trabajadores y gastos generales.
Solo existen los estados No pagada y Pagada; guardar no registra un pago.
Los costos se reconocen al guardar y el pago completo registra una única salida por el total.
Los gastos asignados a eventos se consultan como referencias de la nómina, sin duplicar gastos ni admitir liquidaciones individuales.
Los registros anteriores se conservan en una sección de consulta, incluidos pagos parciales y capturas sin confirmar.

Antes de actualizar PostgreSQL, aplica las migraciones pendientes en orden, incluidas `003_weekly_payroll.sql` y `005_payroll_full_payment.sql`.
La primera transacción conserva la versión anterior de nómina en `weekly_payroll_backups` y mantiene intactas las tablas históricas.
En Windows, la migración crea `spl-data.json.before-payroll-v2.bak` junto al archivo de datos antes de convertirlo.
No reemplaces los datos nuevos por el respaldo después de registrar operaciones: el respaldo representa el estado anterior a la migración.

Las pruebas de nómina de Playwright usan el servidor real en el puerto 4318 y un archivo temporal aislado; no usan los datos de la aplicación instalada.
Las pruebas del adaptador PostgreSQL usan pg-mem para verificar su contrato SQL y el mismo dominio de nómina.
El bloqueo de transacciones simultáneas en un PostgreSQL desplegado requiere también validación en ese entorno.

## Fly, Neon y iOS

La API central dispone de una imagen de producción y una configuración inicial de Fly con 512 MB, suspensión automática y cero máquinas mínimas encendidas.
Neon conserva PostgreSQL y Tigris recibe respaldos diarios cifrados mediante un trabajo separado.
Consulta [DEPLOYMENT.md](./DEPLOYMENT.md) para migraciones, importación del archivo de Windows, restauración y TestFlight.

La aplicación Expo se encuentra en `mobile` y requiere una compilación de desarrollo o TestFlight para Google Sign-In.
Expo Go no incluye ese módulo nativo.
