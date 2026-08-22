# Línea de vida — Fase 7

Una vertical slice local para explorar fotografías seleccionadas de Google Drive por fecha, sin clasificación de contenido. El repositorio contiene una web editorial, una API NestJS, PostgreSQL, Redis y un worker BullMQ independiente.

## Inicio rápido

1. Copia `.env.example` a `.env` y completa `SESSION_SECRET` y `TOKEN_ENCRYPTION_KEY` con valores locales seguros.
2. PostgreSQL se publica en el puerto host `5433` por defecto (y mantiene `5432` dentro de Docker). Si necesitas otro puerto host, ajusta `POSTGRES_HOST_PORT` y el puerto de `DATABASE_URL` al mismo valor en `.env`; después ejecuta `docker compose up -d` para PostgreSQL y Redis (solo dependencias).
3. Ejecuta `pnpm install`, `pnpm --filter @linea-de-vida/api prisma:deploy`, `pnpm dev` y, en otra terminal, `pnpm dev:worker`. Los scripts locales cargan exclusivamente el archivo `.env` de la raíz y reemplazan las variables heredadas con el mismo nombre; no exportes `DATABASE_URL` ni otras variables locales manualmente. Así API, worker y Prisma usan la misma base local.
4. Abre `http://localhost:3000`. Sin credenciales Google, usa **Entrar en desarrollo**: crea una sesión local; nunca finge autorización de Drive.

## Arquitectura y contrato

| Proceso            | Responsabilidad                                                                 |
| ------------------ | ------------------------------------------------------------------------------- |
| `apps/web`         | Next.js App Router; onboarding, fuente, años y galería demostrativa accesible.  |
| `apps/api`         | Sesión, autorización por `userId`, recursos REST, OAuth y proxy de medios.      |
| `apps/api` worker  | Consume `photo-sync`; explora exclusivamente la carpeta fuente y descendientes. |
| PostgreSQL / Redis | Estado persistente / cola BullMQ.                                               |

La API nunca entrega tokens Google ni URLs de Drive al navegador. Las rutas de thumbnail y contenido comprueban primero que la foto sea del usuario de sesión.

## Google Cloud y OAuth

1. En Google Cloud Console, crea un OAuth client de tipo **Web application** y activa **Google Drive API**.
2. Registra exactamente `GOOGLE_LOGIN_REDIRECT_URI` (por defecto `http://localhost:3001/v1/auth/google/callback`). Una discrepancia causa `redirect_uri_mismatch`. `GOOGLE_DRIVE_REDIRECT_URI` puede mantenerse solo para una futura conexión alternativa; no es parte del onboarding predeterminado.
3. Define `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`, `GOOGLE_LOGIN_REDIRECT_URI` y una clave de cifrado de 32 bytes base64 en `.env`. Registra la URI de login exacta en Google Cloud.
4. **Continuar con Google** inicia un único consentimiento combinado para `openid email profile` y exactamente `https://www.googleapis.com/auth/drive.readonly`, con PKCE, `state` persistido de un solo uso, `access_type=offline`, `include_granted_scopes=true` y selección explícita de cuenta. El callback valida identidad y scope, crea/actualiza `User` y su `OAuthConnection` para el mismo subject de Google, cifra el refresh token y crea la sesión. El intercambio, refresh y cifrado ocurren exclusivamente en API; ningún token cruza al cliente.
5. Mientras la pantalla de consentimiento OAuth esté en **Testing**, añade la cuenta real que probará la aplicación en **Google Auth platform → Audience → Test users**. Esto habilita pruebas privadas; no sustituye la verificación pública de Google requerida antes de publicar para una audiencia amplia o según los scopes aplicables.

Antes de producción, confirma los requisitos actuales de audiencia, pantalla de consentimiento y verificación OAuth de Google. Este repositorio no afirma que una aplicación con este scope ya esté verificada. Sigue pendiente una prueba real y registrada de login, consentimiento `drive.readonly`, refresh, streaming y revocación contra el cliente OAuth de producción.

## Producción: configuración y despliegue

La API falla al arrancar en producción si faltan secretos, si son débiles o de ejemplo, si los orígenes/redirect URI no usan HTTPS o si falta la protección de métricas. No expongas PostgreSQL ni Redis a Internet: son dependencias privadas de API/worker.

1. Define `NODE_ENV=production`, `DATABASE_URL`, `REDIS_URL`, `API_ORIGIN`, `ALLOWED_WEB_ORIGINS`, `SESSION_SECRET` (32+ caracteres aleatorios), `TOKEN_ENCRYPTION_KEY` (base64 de exactamente 32 bytes), los cuatro valores OAuth Google y `METRICS_TOKEN` (32+ caracteres aleatorios).
2. Registra en Google exactamente las URI HTTPS de callback y el origen web permitido. Conserva los secretos en un gestor de secretos; nunca en la imagen, repositorio o logs.
3. Ejecuta `pnpm install --frozen-lockfile`, `pnpm --filter @linea-de-vida/api prisma:deploy`, inicia API y worker como procesos separados y publica ambos orígenes detrás de un proxy TLS que preserve `X-Forwarded-Proto`.
4. Comprueba `GET /v1/health`, `GET /v1/readiness` y `GET /v1/metrics` (este último con `Authorization: Bearer $METRICS_TOKEN` desde red interna). El endpoint de métricas no responde sin token.

`ALLOWED_WEB_ORIGINS` es una lista separada por comas. CORS acepta exclusivamente esos orígenes con credenciales; las mutaciones autenticadas vuelven a comprobar `Origin`. Los callbacks OAuth son GET de redirección y se protegen con cookie `httpOnly` temporal, `state` criptográfico de un solo uso y PKCE; no dependen de `Origin`, que los navegadores no envían de forma fiable durante la redirección.

## Retención, logs y backup

| Dato                                           | Retención                                          | Limpieza                           |
| ---------------------------------------------- | -------------------------------------------------- | ---------------------------------- |
| `SyncIssue`                                    | 30 días por defecto                                | `SYNC_ISSUE_RETENTION_DAYS`        |
| `SyncRun` terminal e incidencias asociadas     | 90 días por defecto                                | `SYNC_RUN_RETENTION_DAYS`          |
| Fotos, overrides, conexión y archivos de Drive | No los borra esta tarea                            | Fuera del comando de retención     |
| Logs estructurados de proceso                  | Política del proveedor, mínimo recomendado 30 días | Configurar en el agregador de logs |

La limpieza es manual y requiere confirmación explícita: `RETENTION_PURGE_CONFIRMATION=DELETE_SYNC_METADATA pnpm --filter @linea-de-vida/api retention:purge`. Solo elimina metadatos terminales de sync en PostgreSQL; nunca llama a Drive ni borra fotografías. Agenda el mismo comando como job controlado únicamente después de probar una restauración.

Para backup PostgreSQL, ejecuta desde un host autorizado `pg_dump --format=custom --no-owner "$DATABASE_URL" > linea-de-vida-YYYYMMDD.dump`, cifra el archivo y guárdalo fuera del servidor. Para restaurar en una base vacía/aislada: `pg_restore --clean --if-exists --no-owner --dbname="$DATABASE_URL" linea-de-vida-YYYYMMDD.dump`, luego ejecuta `prisma:deploy` y valida `/v1/readiness`. Prueba restauraciones periódicamente; no uses una restauración de prueba contra producción.

## REST de la slice

| Ruta                                                             | Descripción                                                             |
| ---------------------------------------------------------------- | ----------------------------------------------------------------------- |
| `GET /v1/health`                                                 | Health check.                                                           |
| `GET /v1/me`                                                     | Sesión y configuración Drive, sin secretos.                             |
| `POST /v1/auth/google/authorize`                                 | Inicia login y consentimiento Drive combinado, sin tokens en respuesta. |
| `GET /v1/auth/google/callback`                                   | Valida identidad/Drive, crea sesión y conexión, sin token en respuesta. |
| `POST /v1/oauth/google/drive/authorize`                          | Ruta alternativa futura; no se muestra en el onboarding.                |
| `GET /v1/oauth/google/drive/callback`                            | Callback de la ruta alternativa futura, sin token en respuesta.         |
| `GET /v1/oauth-connections/:id/drive/folders/:folderId/children` | Lista solo las hijas de una carpeta solicitada.                         |
| `GET/POST /v1/photo-sources`                                     | Lista/registra una carpeta concreta del usuario.                        |
| `POST /v1/photo-sources/:id/sync-runs`                           | Devuelve `202` y encola el escaneo.                                     |
| `GET /v1/sync-runs/:id`                                          | Progreso del propietario.                                               |
| `GET /v1/sync-runs/:id/issues?cursor=&limit=`                    | Incidencias paginadas del propietario.                                  |
| `GET /v1/timeline/years`                                         | Años disponibles desde PostgreSQL.                                      |
| `GET /v1/timeline/years/:year/months`                            | Meses y grupo `Fecha sin concretar`.                                    |
| `GET /v1/timeline/years/:year/months/:month/days`                | Días y grupo `Día sin concretar`.                                       |
| `GET /v1/timeline/undated`                                       | Conteo de fotos sin año.                                                |
| `GET /v1/photos?...&cursor=&limit=`                              | Galería cursor-paginada por granularidad.                               |
| `PUT /v1/photos/:id/manual-date`                                 | Crea o reemplaza la fecha manual de una foto propia.                    |
| `DELETE /v1/photos/:id/manual-date`                              | Elimina el override y restaura la detección.                            |
| `PUT /v1/photos/manual-date-overrides`                           | Aplica una fecha a un lote propio de hasta 50 fotos.                    |
| `GET /v1/photos/:id/thumbnail`                                   | Proxy privado de JPEG/PNG/WebP; HEIC/HEIF devuelve fallback `415`.      |
| `GET /v1/photos/:id/content`                                     | Proxy streaming privado del original soportado; HEIC/HEIF se descarga.  |

Todas las rutas salvo health/callback requieren sesión firmada en cookie `httpOnly`; las mutaciones validan `Origin`. Los proxies resuelven y autorizan foto, fuente y conexión activa para el `userId` antes de llamar a Drive; una foto `MISSING` devuelve `410`, una fuente desconectada `503`, y nunca se entrega una URL ni un token de Drive. Los cursores de timeline y galería son opacos y están ligados a su granularidad; no se renderizan colecciones completas. Los agregados se calculan en PostgreSQL sobre el índice efectivo, sin descargar fotografías. La desvinculación marca las fuentes desconectadas y revoca el token; si Google falla, conserva el secreto cifrado solo para reintentar la revocación y bloquea todo nuevo acceso.

## Medios y compatibilidad

Los originales se transmiten por streaming, con cancelación al abortar el cliente y timeout acotado por `MEDIA_PROXY_TIMEOUT_MS`; no se almacenan ni se cargan completos en memoria. Los thumbnails pueden usar únicamente una caché **en memoria**, privada, temporal y deshabilitada por defecto en desarrollo (`MEDIA_THUMBNAIL_CACHE_ENABLED=false`). Sus claves son hashes, su TTL y límites de entradas/tamaño se configuran en `.env`; no guarda originales, tokens, URLs de Drive ni metadatos privados. Si la caché falla o excede límites, se omite sin bloquear la respuesta.

JPEG, PNG y WebP se muestran por el proxy de thumbnail. HEIC/HEIF continúan indexados y se pueden descargar desde `content`, pero no se convierten: la UI informa el límite de navegador. No hay CDN pública ni caché persistente.

## Fechas, sync y modelo

`Photo` conserva detección y `ManualDateOverride` por separado. La fecha efectiva indexada es una proyección transaccional de override o detección; `YEAR` y `MONTH` usan un ancla técnica únicamente con su precisión, por lo que la interfaz no muestra falsamente el 1 de enero. Al eliminar un override se restaura exactamente `detectedDate` y `detectedPrecision`. Las respuestas de galería incluyen la fecha detectada, la fecha efectiva, fuente y precisión; `MANUAL` es el origen efectivo, no una fuente de detección. `FolderDateParser` acepta solo segmentos deterministas ES/EN o numéricos. `createdTime` y `modifiedTime` de Drive no se usan como fecha histórica.

Una fuente se crea como `GENERIC` o `GOOGLE_TAKEOUT`. Solo la segunda lee JSON adyacentes de la carpeta exportada: usa `photoTakenTime` después de EXIF/metadata de Drive y antes de carpeta, conserva GPS validado y registra el resultado de match. JSON ausente no es un error y JSON inválido crea una incidencia sin detener el sync. Consulta [la guía Takeout](docs/google-takeout.md) antes de preparar la carpeta.

El editor acepta año, mes opcional y día opcional. La API valida años 1900–2100, precisión consistente, mes/día y calendario real; no acepta una hora ni fabrica partes de la fecha. Las mutaciones individuales y masivas verifican cada `photoId` contra el `userId` de sesión dentro de una transacción. El lote es idempotente, atómico y está limitado a 50 fotos por petición.

El worker no limita artificialmente una ejecución a 100 imágenes: guarda checkpoint de carpeta/cursor tras cada página, procesa lotes pequeños con concurrencia configurable de 5–10 y usa `jobId` por fuente para evitar syncs activas conflictivas. El estado expone fase `SCANNING`/`PROCESSING`, encontrados, procesados, indexados e incidencias; no publica un porcentaje cuando Drive no ofrece un total fiable. Un `SUCCEEDED` completo marca como `MISSING` solo los archivos antes indexados de esa fuente que no se vieron; fallos, permisos denegados, avisos y ejecuciones parciales nunca reconcilian. El upsert por `(userId, driveFileId)` reactiva archivos y actualiza carpeta/ruta sin duplicarlos, preservando override y metadatos Takeout válidos. `DriveAdapter` desacopla Google de dominio y `MemoryDriveProvider` permite pruebas/desarrollo sin una cuenta Google real.

La migración reproducible está en `apps/api/prisma/migrations/20260821000000_init/migration.sql`. Contiene las entidades `User`, `OAuthConnection`, `PhotoSource`, `SyncRun`, `SyncIssue`, `Photo` y `ManualDateOverride`, sus claves únicas e índices de timeline.

## Verificación

```bash
pnpm format:check
pnpm lint
pnpm typecheck
pnpm test
pnpm build
```

## Limitaciones intencionales / siguiente fase

- Takeout requiere una carpeta exportada y seleccionada explícitamente; no importa rutas locales ni interpreta álbumes/eventos.
- Una sola fuente y cuenta Drive en la experiencia; no hay selector de múltiples cuentas.
- El selector navega desde un ID de carpeta introducido explícitamente; nunca puede abrir ni enumerar `root`/todo Drive. La navegación y el callback reales requieren credenciales Google válidas, URI registradas y una cuenta que conceda el permiso.
- No usa Drive Changes API: cada ejecución recorre la fuente explícita y descendientes. El checkpoint no es un delta de Drive y una cola de carpetas excesiva se detiene de forma segura sin marcar `MISSING`. La edición masiva de fechas sigue limitada a 50 fotos por petición y no incluye motivo por foto.
- Sin conversión HEIC ni procesamiento/copia permanente de imágenes; HEIC/HEIF se conservan indexados y descargables, con fallback de navegador.
- La verificación OAuth real sigue pendiente: las pruebas automatizadas no pueden demostrar la configuración de Google Cloud, consentimiento, refresh, streaming ni revocación remota. El rate limit en este despliegue es en memoria por proceso; para múltiples réplicas debe sustituirse por un almacén compartido antes de escalar.
- La interfaz usa solo contratos de la API: no mezcla contenido demostrativo con datos indexados.
