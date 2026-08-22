# Línea de vida — arquitectura (Fase 0)

## Decisión

Se adopta un monorepo **pnpm** con `apps/web` y `apps/api`. La web usará Next.js App Router, TypeScript y Tailwind; la API será NestJS REST con TypeScript. La persistencia será PostgreSQL mediante Prisma. Docker Compose levantará PostgreSQL y Redis. No se crean aún paquetes, dependencias ni código.

| Área                | Responsabilidad                               | Decisión y justificación                                                                             |
| ------------------- | --------------------------------------------- | ---------------------------------------------------------------------------------------------------- |
| `apps/web`          | Experiencia temporal y sesión de navegador    | Next.js App Router facilita rutas de UI; Tailwind mantiene un sistema visual pequeño y consistente.  |
| `apps/api`          | Dominio, autorización, OAuth, Drive y proxies | NestJS concentra secretos y autorización por recurso fuera del navegador.                            |
| PostgreSQL + Prisma | Estado normalizado y consultas de timeline    | Integridad relacional, índices explícitos y migraciones tipadas.                                     |
| Redis               | Transporte/estado de trabajos                 | Base de BullMQ cuando se introduzca.                                                                 |
| BullMQ              | Sincronizaciones asíncronas                   | Se introduce desde la vertical slice con un worker local: una sincronización no puede bloquear HTTP. |

## Límites y flujo

```text
Navegador ──cookies de sesión──> Web ──REST──> API ──> PostgreSQL
                                       │            │
                                       │            └──> Redis <──> worker BullMQ local
                                       │                              │
                                       └── Drive Adapter ──> Google Drive API
```

La API es la única que llama a Google: cifra y descifra el refresh token, intercambia códigos OAuth y ejecuta el adaptador. La web nunca recibe tokens Google ni enlaces de medios de Drive como contrato estable. El worker procesa una fuente autorizada y persiste el resultado; HTTP crea una solicitud de sincronización y devuelve el recurso `SyncRun`.

## Módulos de API

| Módulo            | Contrato interno                                                                                                   |
| ----------------- | ------------------------------------------------------------------------------------------------------------------ |
| Auth              | Identidad local, sesión y cookies.                                                                                 |
| OAuthConnection   | Inicia/cierra consentimiento, protege `state` y almacena credenciales cifradas.                                    |
| PhotoSource       | Autoriza propiedad de la fuente y define el límite de exploración.                                                 |
| Sync              | Crea ejecuciones, entrega trabajos y expone progreso/incidencias.                                                  |
| Drive Adapter     | Interfaz propia para listar, leer metadatos y transmitir contenido/miniaturas; no filtra tipos del SDK al dominio. |
| PhotoDateResolver | Produce `detectedDate`, precisión y procedencia sin escribir overrides.                                            |
| Timeline          | Consulta `effectiveDate` con autorización del propietario.                                                         |
| Media Proxy       | Autoriza foto, fuente y conexión activa del usuario antes de solicitar media a Drive; transmite sin exponer URL.   |

## Seguridad

La autenticación de la aplicación y la autorización de Drive son etapas separadas. Iniciar sesión identifica al usuario; solo «Vincular Drive» inicia consentimiento incremental para `https://www.googleapis.com/auth/drive.readonly`. El flujo servidor usa `state` criptográficamente aleatorio, URI de redirección registrada, intercambio de código en backend y `access_type=offline`; Google recomienda autorización incremental con `include_granted_scopes=true` y comprobar los scopes concedidos. [OAuth web](https://developers.google.com/identity/protocols/oauth2/web-server)

- El refresh token se cifra en reposo con una clave gestionada fuera de la base de datos (KMS/secret manager en producción; clave de desarrollo separada). Solo API/worker pueden descifrarlo.
- La sesión se representa con cookie `httpOnly`, `Secure` en HTTPS y `SameSite=Lax` como valor inicial. La API aplica protección CSRF a mutaciones y valida `Origin`/`Referer` cuando corresponda.
- No se registra el token, código OAuth, cabecera `Authorization` ni URL firmada completa.
- Desvincular revoca el token ante Google, invalida la conexión local y elimina las credenciales cifradas. Si Google falla, la conexión queda `REVOCATION_PENDING` y se reintenta sin conservar acceso para nuevas operaciones.
- Toda ruta resuelve primero el usuario de sesión y luego filtra por `userId`; un identificador de foto jamás es autorización suficiente.
- Los proxies devuelven `404` para recursos ajenos o inexistentes, `410` para una foto reconciliada como `MISSING` y `503` para fuente/conexión Drive desconectada o acceso revocado; no contactan Drive antes de estas comprobaciones.
- Los originales usan streaming con abort del cliente y timeout. Solo thumbnails JPEG/PNG/WebP pueden entrar en una caché de proceso temporal, privada, con clave hash, TTL y límites estrictos; originales, tokens, URLs temporales y metadatos privados no se persisten ni cachean.

## Integración y asincronía

La interfaz `DriveAdapter` abstrae SDK/HTTP: `listChildren`, `getFile`, `getThumbnailStream` y `getContentStream`. Los dos últimos aceptan señal de abort para cancelar solicitudes/streams remotos. Usa paginación por cursor, concurrencia configurable entre 5 y 10 (valor inicial 5), backoff exponencial con jitter para 429 y 5xx, y respeta `Retry-After` si está presente. Google indica reintento con backoff exponencial ante límites de cuota/rate limit. [Límites Drive](https://developers.google.com/workspace/drive/api/guides/limits)

Las escrituras son idempotentes mediante la clave `(userId, driveFileId)` y el identificador de trabajo. Un archivo ya conocido se actualiza; el ausente pasa a `MISSING`, no se borra durante un escaneo. El trabajo libera HTTP: `POST /sync-runs` encola, responde `202 Accepted` y la consulta posterior revela estado.

## Operación de producción (Fase 7)

- El proceso valida al inicio secretos no triviales, URLs/orígenes permitidos, HTTPS, callbacks OAuth y token de métricas. Producción no permite login de desarrollo ni cookies sin `Secure`.
- CORS permite únicamente `ALLOWED_WEB_ORIGINS`; cada mutación autenticada exige además un `Origin` permitido. Los callbacks OAuth GET se validan por state de un solo uso, PKCE y cookie temporal firmada, no por Origin.
- El API limita body JSON/urlencoded, transmite medios con timeout/abort y usa rate limits configurables separados para lectura/escritura, por usuario firmado o IP anónima. La implementación actual es en memoria y debe centralizarse para varias réplicas.
- Request IDs y logs JSON registran solo evento, método, status y duración. Se excluyen tokens, cookies, authorization, URL/ruta, nombres de fotos, query/body e identidad. `/health` no consulta dependencias; `/readiness` verifica PostgreSQL; `/metrics` requiere bearer token.
- `SyncIssue` se retiene 30 días y SyncRun terminal 90 por defecto. La limpieza confirmada opera únicamente en PostgreSQL y jamás llama a Drive; fotos y overrides no participan. Backup/restauración de PostgreSQL se realiza por procedimiento documentado y debe probarse antes de usarlo.

## Decisiones aplazadas

- Estrategia multi-tenant, cuotas de producto y retención/borrado de cuenta.
- Webhooks/cambios de Drive y sincronización incremental definitiva.
- Conversión de HEIC y almacenamiento temporal de derivados.
- Rate limit distribuido, automatización gestionada de backup y verificación real de Google OAuth en producción.

## Verificación de diseño

- [ ] El árbol pnpm se crea con los dos paquetes al iniciar implementación.
- [ ] Docker Compose solo describe PostgreSQL y Redis.
- [ ] El worker local se ejecuta fuera del proceso HTTP desde la vertical slice.
- [ ] Ningún contrato REST devuelve token Google.
