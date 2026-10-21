# Línea de vida — modelo de datos (Fase 0)

## Decisión

PostgreSQL contendrá un modelo normalizado. La identidad de una foto es su **contenido por usuario**: `Photo.contentKey` = `md5:<md5Checksum>:<size>` de Drive (o `drive:<fileId>` cuando Drive no da checksum). Cada archivo de Drive que contiene esos bytes es una copia (`PhotoFile`, única por `(userId, driveFileId)`); el identificador de Drive sigue siendo estable para la integración y se aísla por usuario, pero ya no identifica la foto. `Photo.driveFileId/sourceId/folderId/fileName/mimeType` reflejan la copia principal (preferentemente `ACTIVE`).

## Entidades

| Entidad              | Campos esenciales                                                                                                                            | Propósito                                          |
| -------------------- | -------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------- |
| `User`               | `id`, `googleSubject` único, `email`, `displayName`, timestamps                                                                              | Identidad local y frontera de autorización.        |
| `OAuthConnection`    | `id`, `userId`, `provider`, `googleAccountId`, `grantedScopes`, `refreshTokenCiphertext`, `status`, timestamps                               | Credencial Drive aislada y cifrada.                |
| `PhotoSource`        | `id`, `userId`, `oauthConnectionId`, `driveFolderId`, `name`, `type`, `status`, `lastCursor`, timestamps                                     | Carpeta raíz autorizada; delimita el escaneo.      |
| `SyncRun`            | `id`, `photoSourceId`, `status`, `mode`, `cursorStartedAt`, `cursorCompletedAt`, contadores, timestamps                                      | Ejecución observable e idempotente.                |
| `SyncIssue`          | `id`, `syncRunId`, `driveFileId?`, `code`, `severity`, `details`, timestamps                                                                 | Fallo recuperable y auditable sin detener el lote. |
| `Photo`              | `id`, `userId`, `contentKey`, copia principal (`driveFileId`, `sourceId`, …), estado, metadatos, fecha detectada, match/GPS Takeout          | Foto única por contenido.                          |
| `PhotoFile`          | `id`, `photoId`, `userId`, `sourceId`, `driveFileId`, `folderId?`, nombre, MIME, `md5Checksum?`, `sizeBytes?`, `status`, `lastSeenSyncRunId` | Una copia en Drive de la foto; `ACTIVE`/`MISSING`. |
| `ManualDateOverride` | `id`, `photoId` único, `dateValue`, `precision`, `reason?`, timestamps                                                                       | Corrección explícita vigente, una por foto.        |

## Enums

| Enum                    | Valores                                                                                                                             |
| ----------------------- | ----------------------------------------------------------------------------------------------------------------------------------- |
| `OAuthConnectionStatus` | `ACTIVE`, `REVOKED`, `REVOCATION_PENDING`, `ERROR`                                                                                  |
| `PhotoSourceStatus`     | `ACTIVE`, `PAUSED`, `DISCONNECTED`                                                                                                  |
| `SyncRunStatus`         | `QUEUED`, `RUNNING`, `SUCCEEDED`, `PARTIAL`, `FAILED`, `CANCELLED`                                                                  |
| `SyncMode`              | `INITIAL`, `INCREMENTAL`, `MANUAL`                                                                                                  |
| `PhotoStatus`           | `ACTIVE`, `MISSING`, `UNSUPPORTED`, `ACCESS_DENIED`                                                                                 |
| `DatePrecision`         | `DAY`, `MONTH`, `YEAR`, `UNKNOWN`                                                                                                   |
| `DateSource`            | `EXIF`, `DRIVE_IMAGE_METADATA`, `TAKEOUT`, `FOLDER`, `NONE`                                                                         |
| `PhotoSourceType`       | `GENERIC`, `GOOGLE_TAKEOUT`                                                                                                         |
| `TakeoutMatchStatus`    | `NOT_APPLICABLE`, `TAKEOUT_MATCHED`, `TAKEOUT_NOT_FOUND`, `TAKEOUT_AMBIGUOUS`                                                       |
| `SyncIssueCode`         | `RATE_LIMITED`, `DRIVE_UNAVAILABLE`, `ACCESS_DENIED`, `INVALID_TAKEOUT_JSON`, `UNREADABLE_METADATA`, `UNSUPPORTED_MEDIA`, `UNKNOWN` |
| `SyncIssueSeverity`     | `INFO`, `WARNING`, `ERROR`                                                                                                          |

`MANUAL` no pertenece a `DateSource`: es una fuente de presentación, no de detección. Esto elimina la contradicción de ubicarlo en distinta posición de prioridad.

## Fechas y precisión

`Photo.detectedDate` es `date` nullable y `detectedPrecision` es `DatePrecision`. Para `YEAR`, se guarda el año como un ancla técnica (por ejemplo `2024-01-01`) **solo junto con la precisión `YEAR`**, nunca como afirmación de que la foto fue tomada el 1 de enero. Para `MONTH`, se usa ancla del primer día y `MONTH`. Las consultas y la API deben devolver siempre ambas columnas; el cliente presenta `2024` o `marzo de 2024`, no la ancla.

`ManualDateOverride` usa el mismo patrón (`dateValue` + `precision`). La fecha efectiva se calcula sin duplicar datos:

```text
effectiveDateValue     = COALESCE(override.dateValue, photo.detectedDate)
effectiveDatePrecision = COALESCE(override.precision, photo.detectedPrecision, UNKNOWN)
effectiveDateOrigin    = override ? MANUAL : photo.detectedSource
```

Se conservan detectada y override separadas porque responden a preguntas distintas: la primera permite auditar, re-ejecutar y mejorar el resolver; la segunda expresa una decisión humana que nunca debe ser destruida por una sincronización. El índice de timeline debe materializar o usar una vista/consulta que combine ambas, sin sobrescribir la detección.

## Índices y restricciones

| Tabla                | Restricción/índice                                                              | Razón                                      |
| -------------------- | ------------------------------------------------------------------------------- | ------------------------------------------ |
| `User`               | `UNIQUE(googleSubject)`                                                         | Una identidad Google por usuario local.    |
| `OAuthConnection`    | `UNIQUE(userId, provider, googleAccountId)`                                     | Evita conexiones duplicadas.               |
| `PhotoSource`        | `UNIQUE(userId, driveFolderId)`; índice `(userId, status)`                      | Una raíz por usuario y listado autorizado. |
| `Photo`              | `UNIQUE(userId, contentKey)`; índice `(userId, driveFileId)`                    | Idempotencia por contenido y aislamiento.  |
| `PhotoFile`          | `UNIQUE(userId, driveFileId)`; `(photoId, status)`, `(sourceId, status)`        | Copias de una foto y reconciliación.       |
| `Photo`              | `(userId, status)`, `(sourceId, status)`                                        | Timeline y reconciliación de fuente.       |
| `Photo`              | índice de fecha efectiva `(userId, effectiveDateValue, effectiveDatePrecision)` | Año/mes/día paginados sin escaneo total.   |
| `SyncRun`            | `(photoSourceId, createdAt DESC)`, `(status, createdAt)`                        | Progreso e inspección operativa.           |
| `SyncIssue`          | `(syncRunId, severity)`, `(driveFileId)`                                        | Diagnóstico por ejecución/archivo.         |
| `ManualDateOverride` | `UNIQUE(photoId)`                                                               | Una corrección vigente por foto.           |

El índice de fecha efectiva puede ser una columna generada/materializada o una vista indexable según las capacidades elegidas en Prisma/PostgreSQL; la implementación debe demostrar con `EXPLAIN` que el listado no degrada a exploración por usuario.

## Reglas de integridad

- `Photo.userId` debe coincidir con el propietario de `Photo.sourceId` y de su conexión.
- Una fuente solo usa una conexión `ACTIVE` del mismo usuario.
- Un `SyncRun` solo modifica fotos de su `PhotoSource`.
- `MISSING` conserva metadatos y fecha para permitir reaparición y auditoría.
- Ninguna tabla persiste access token transitorio; solo refresh token cifrado donde sea necesario.
