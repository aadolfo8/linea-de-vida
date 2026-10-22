# Línea de vida — roadmap (Fases 0–7)

## Estado de implementación

La Fase 0 queda definida por estos documentos. Las Fases 1–6 están implementadas localmente. La Fase 5 aporta paginación con checkpoint durable, lotes de concurrencia limitada, reintentos transitorios, exclusión de ejecución activa por fuente y reconciliación `MISSING` solo tras un escaneo completo exitoso. La Fase 6 aporta proxies privados autorizados para thumbnail y contenido, streaming cancelable, caché temporal acotada solo para miniaturas y fallback HEIC/HEIF descargable. La validación contra Google real (cliente configurado, URI registradas, consentimiento, refresh, streaming y revocación remota) sigue pendiente de credenciales y consola; no se afirma como verificada. Las fases posteriores requieren aprobación de alcance y una implementación incremental; no son compromiso de calendario.

| Fase                         | Resultado verificable                                                                                                                                          | Fuera de fase                                                                 |
| ---------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------- |
| 0. Fundaciones               | Especificación, arquitectura, modelo, OAuth/Drive, sincronización y roadmap revisables                                                                         | Código, dependencias, infraestructura ejecutable                              |
| 1. Vertical slice            | Login, vinculación explícita Drive, una fuente, worker local, escaneo ≤100, EXIF/carpeta, persistencia, años, galería anual y thumbnail proxy                  | Takeout, múltiples fuentes, edición manual UI, meses/días, contenido completo |
| 2. Timeline navegable        | Año→mes→día→fotos, grupo de fecha sin concretar, paginación y estados vacíos                                                                                   | Búsqueda por contenido, IA/ML/OCR                                             |
| 3. Calidad de fechas         | UI/API de overrides, trazabilidad de fuente/precisión, edición masiva ≤50 y pruebas de resolver/HTTP                                                           | Inferencia no determinista                                                    |
| 4. Takeout                   | Implementada: importador defensivo, matcher auditable, `photoTakenTime`, GPS validado e incidencias                                                            | Descartar fotos sin JSON, mapas, eventos o álbumes                            |
| 5. Sincronización robusta    | Implementada: checkpoint, reintentos, exclusión por fuente, progreso honesto y reconciliación `MISSING` segura                                                 | Drive Changes API, escaneo de todo Drive                                      |
| 6. Medios y compatibilidad   | Implementada: proxies autorizados, streaming abortable, caché privada temporal de thumbnails y fallback HEIC/HEIF descargable                                  | Conversión HEIC, CDN pública, persistencia de originales o URLs/token Drive   |
| 7. Preparación de producción | Implementada localmente: validación estricta, CORS/CSRF, límites, headers, observabilidad, retención, backup y guía de despliegue; prueba OAuth real pendiente | Funcionalidades de clasificación por contenido                                |

## Definición precisa de la Fase 1

### Entregables

1. Monorepo pnpm con `apps/web` y `apps/api`; PostgreSQL y Redis definidos en Docker Compose.
2. Sesión de usuario y flujo OAuth incremental separando login de consentimiento Drive `drive.readonly`.
3. Una `PhotoSource` explícita basada en carpeta Drive, con propiedad autorizada.
4. `POST /v1/photo-sources/{sourceId}/sync-runs` crea una ejecución asíncrona; worker BullMQ local la procesa.
5. Recorrido recursivo de la fuente con máximo de 100 imágenes y persistencia idempotente.
6. `PhotoDateResolver` con EXIF/metadatos Drive de imagen y carpetas deterministas; sin Takeout.
7. Timeline de años y galería paginada de un año.
8. Ruta proxy autorizada de miniatura.

### Criterios de aceptación

- Una persona autenticada puede vincular Drive de manera explícita y seleccionar una carpeta.
- El backend nunca solicita archivos fuera de la carpeta fuente y sus descendientes.
- La petición HTTP de sincronización responde `202` y el worker realiza el escaneo.
- El escaneo no procesa más de 100 imágenes y registra su límite.
- Repetir la sincronización no duplica fotos con mismo `(userId, driveFileId)`.
- Se pueden ver años disponibles y fotos de un año sin exponer token ni URL de Drive.
- Una foto sin fecha no recibe por defecto un 1 de enero y puede agruparse como no concretada.

### Exclusiones explícitas

No incluye Takeout, múltiples fuentes, selector de múltiples cuentas, sincronización incremental/delta, reanudación durable, vista mes/día, corrección manual desde UI, descarga/contenido completo, conversión HEIC, gestión de cuenta, eliminación/retención, despliegue, métricas, límites de negocio ni IA/ML/OCR/reconocimiento de contenido.

## API REST inicial

Todos los endpoints están bajo `/v1`, requieren sesión salvo callbacks OAuth, aplican autorización por recurso y devuelven errores consistentes (`code`, `message`, `requestId`). Las colecciones usan cursor opaco `cursor` y `limit` (1–100), responden `items` y `nextCursor`.

| Método y ruta                                     | Finalidad                              | Respuesta                                           |
| ------------------------------------------------- | -------------------------------------- | --------------------------------------------------- |
| `GET /v1/me`                                      | Sesión actual                          | Usuario y estado de conexión Drive                  |
| `POST /v1/oauth/google/drive/authorize`           | Inicia consentimiento Drive            | Redirección/URL de autorización protegida con state |
| `GET /v1/oauth/google/drive/callback`             | Procesa código OAuth                   | Redirección web segura; no token                    |
| `DELETE /v1/oauth-connections/{id}`               | Revoca y desvincula                    | `204` o estado pendiente de revocación              |
| `GET /v1/photo-sources`                           | Lista fuentes propias                  | Colección paginada                                  |
| `POST /v1/photo-sources`                          | Registra carpeta fuente explícita      | `201 PhotoSource`                                   |
| `GET /v1/photo-sources/{id}`                      | Lee fuente propia                      | `200 PhotoSource`                                   |
| `POST /v1/photo-sources/{id}/sync-runs`           | Solicita sincronización                | `202 SyncRun`                                       |
| `GET /v1/sync-runs/{id}`                          | Consulta progreso propio               | `200 SyncRun`                                       |
| `GET /v1/sync-runs/{id}/issues`                   | Lista incidencias                      | Colección paginada                                  |
| `GET /v1/timeline/years`                          | Años con fotos efectivas               | Colección paginada                                  |
| `GET /v1/timeline/years/:year/months`             | Meses y `Fecha sin concretar`          | Colección paginada de agregados                     |
| `GET /v1/timeline/years/:year/months/:month/days` | Días y `Día sin concretar`             | Colección paginada de agregados                     |
| `GET /v1/timeline/undated`                        | Conteo de fotos sin año                | Agregado autorizado                                 |
| `GET /v1/photos`                                  | Galería por granularidad               | Cursor con `year`, `month`, `day` y `precision`     |
| `GET /v1/photos/{id}/thumbnail`                   | Proxy de miniatura autorizado          | Stream de imagen o error de compatibilidad          |
| `GET /v1/photos/{id}/content`                     | Proxy de contenido autorizado (fase 6) | Stream; no URL Drive                                |
| `PUT /v1/photos/{id}/manual-date`                 | Crea/actualiza override (fase 3)       | `200` foto con fecha efectiva                       |
| `DELETE /v1/photos/{id}/manual-date`              | Elimina override (fase 3)              | `204`                                               |
| `PUT /v1/photos/manual-date-overrides`            | Reemplaza override de lote propio ≤50  | `200 { items: Photo[] }`                            |

Las acciones de sincronización se modelan como creación de subrecurso porque producen una ejecución observable. No se usan rutas de verbo como `/sync-now`. Los límites y filtros se validan. `GET /v1/photos` acepta una galería anual (`year`), o grupos exactos con `precision=YEAR`, `precision=MONTH`, `precision=DAY`; `precision=UNKNOWN` conserva la ruta de fotos sin fecha. Los cursores son opacos y están ligados al recurso consultado. Las rutas de override reciben partes de calendario (`year`, `month?`, `day?`, `precision`) y nunca una hora; el lote rechaza por completo la petición si cualquier ID no pertenece a la sesión.

## Riesgos y mitigaciones

| Riesgo                              | Mitigación                                                                                                               |
| ----------------------------------- | ------------------------------------------------------------------------------------------------------------------------ |
| Verificación/políticas OAuth Google | Diseñar consentimiento mínimo, URL de privacidad y evidencia de uso; validar requisitos de consola antes de lanzamiento. |
| Robo de tokens                      | Backend exclusivo, cifrado en reposo, rotación de clave, logs redactados y revocación en app.                            |
| Rate limiting/API indisponible      | Concurrencia 5–10, backoff con jitter/`Retry-After`, BullMQ e incidencias visibles.                                      |
| Permisos cambiantes                 | Autorización por usuario/fuente/foto, `ACCESS_DENIED`, no tratar como borrado.                                           |
| HEIC no visible en navegador        | Fallback de descarga/original y estrategia de representación diferida.                                                   |
| Takeout inconsistente               | Parser defensivo, matching auditable y cero descarte por JSON faltante.                                                  |
| Escalabilidad                       | Cursores, índices efectivos, trabajos asíncronos y límites de fuente/ejecución.                                          |
| Acceso horizontal indebido          | Filtros `userId` en cada repositorio, pruebas negativas y proxy autorizado.                                              |

## Puertas antes de cada avance

- Fase 1: revisar OAuth, modelo Prisma, contratos OpenAPI y prueba de límites de fuente.
- Fase 4: corpus de Takeout anonimizado con casos inválidos/ambiguos.
- Fase 5: pruebas de reintento, reanudación e idempotencia bajo fallos simulados.
- Fase 7: threat model, revisión de permisos OAuth, carga, backup/restauración y accesibilidad.

## Cierre de Fase 7 y riesgo pendiente

La API valida secretos y HTTPS en producción, limita cuerpo/stream y aplica rate limit por usuario firmado (o IP anónima) con contadores atómicos en Redis compartido. Si Redis falla, usa un fallback local acotado a 10 000 identidades por proceso: conserva los límites de identidades activas y rechaza nuevas identidades cuando se llena, en vez de desalojar contadores vigentes. Incluye request IDs, logs estructurados sin contenido privado, health/readiness y métricas autenticadas. La limpieza nunca borra fotos Drive y el procedimiento de backup/restauración está en [la referencia técnica](technical-reference.md).

Antes de lanzamiento aún se requiere una prueba real documentada de Google OAuth con cliente/URIs de producción, una revisión de threat model y una prueba de carga. La consistencia global del rate limit depende de que Redis esté disponible; durante una caída, los fallbacks son locales a cada proceso y no coordinan sus contadores entre réplicas.
