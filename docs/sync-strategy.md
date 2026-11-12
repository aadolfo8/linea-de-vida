# Línea de vida — estrategia de sincronización y resolución de fechas (Fase 5)

## Objetivo

Convertir archivos de fuentes Drive configuradas en registros de foto idempotentes, con fechas explicables y sin bloquear una petición HTTP. La cola es la propia tabla `SyncRun` en PostgreSQL y un `SyncScheduler` dentro de la API la consume; no hay Redis ni worker aparte.

## Ciclo de sincronización

1. La API autoriza la fuente y crea `SyncRun(QUEUED)`.
2. Encola un trabajo con `syncRunId`, `photoSourceId` y clave idempotente.
3. El `SyncScheduler` toma el run (`QUEUED` → `RUNNING`, `FOR UPDATE SKIP LOCKED`), recorre recursivamente solo la fuente y sus páginas hijas; persiste un checkpoint de carpeta/cursor después de cada página.
4. Filtra formatos de imagen permitidos y procesa cada página en lotes con concurrencia limitada (5 por defecto; configurable entre 5 y 10), sin límite normal de 100 fotos.
5. Para cada fallo aislado crea `SyncIssue`; el lote continúa cuando sea seguro.
6. Si termina con incidencias recuperables, queda `PARTIAL`; si completa, `SUCCEEDED`; si no puede continuar, `FAILED`.
7. La API expone el estado sin ejecutar el trabajo dentro del ciclo de solicitud.

El escaneo no impone un máximo artificial de fotos. Solo conserva una página y un lote de trabajo en memoria; la cola pendiente de carpetas está limitada por `SYNC_MAX_PENDING_FOLDERS` (10 000 por defecto). Alcanzar ese límite es una ejecución `PARTIAL` segura: no reconcilia ausencias.

## Paginación, reintento e idempotencia

| Riesgo                  | Política                                                                                                                                       |
| ----------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------- |
| Listas grandes          | Cursor y cola de carpetas persistidos por `SyncRun`; una reentrega continúa desde la última página confirmada.                                 |
| Saturación              | `SYNC_ITEM_CONCURRENCY` (5 por defecto, 5–10) y páginas de `SYNC_PAGE_SIZE` (100 por defecto).                                                 |
| 429/5xx                 | `Retry-After` tiene prioridad; si no existe, backoff exponencial con jitter. Drive se reintenta 3 veces y el planificador reintenta el run hasta 3 veces (`attempts`, `nextAttemptAt`) antes de marcarlo `FAILED`. Un run `RUNNING` sin actividad durante 10 minutos vuelve a `QUEUED` y reanuda desde su checkpoint. |
| Autorización/validación | 401/403/4xx no transitorios no se reintentan; quedan `FAILED` con incidencia.                                                                  |
| Reentrega de trabajo    | Un índice parcial único y `jobId=source:<sourceId>` permiten una sola ejecución activa por fuente.                                             |
| Archivo desaparecido    | Solo un `SUCCEEDED` completo marca `MISSING` por `lastSeenSyncRunId`; no borra filas, Takeout ni overrides.                                    |
| Permiso denegado        | Marca foto/fuente según alcance, registra incidencia y no intenta el resto de recursos fuera de la fuente.                                     |

## PhotoDateResolver

El resolver es una función determinista que recibe metadatos normalizados y produce `detectedDate`, `detectedPrecision` y `detectedSource`. Nunca muta `ManualDateOverride`.

| Prioridad de detección | Evidencia                                          | Resultado                                       |
| ---------------------: | -------------------------------------------------- | ----------------------------------------------- |
|                      1 | EXIF válido o `imageMediaMetadata.time` de Drive   | Día si existe fecha completa.                   |
|                      2 | `photoTakenTime` Takeout emparejado sin ambigüedad | Día si existe fecha completa.                   |
|                      3 | Nombre de archivo con fecha completa y plausible   | Día (`FILENAME`).                               |
|                      4 | Ruta de carpetas determinista                      | Día, mes o año según los segmentos encontrados. |
|                      5 | Sin evidencia aceptable                            | `null`, `UNKNOWN`, `NONE`.                      |

`MANUAL` no se ubica en esta tabla: su valor no es una detección. Al construir `effectiveDate`, un `ManualDateOverride` vigente tiene prioridad absoluta sobre cualquier resultado de la tabla. Esta separación resuelve la contradicción de listar MANUAL con un orden distinto sin reescribir la evidencia automática.

### Carpetas deterministas

Solo se aceptan años de cuatro dígitos (por ejemplo, `1998`, `2024`) y meses inequívocos: números `01`–`12`, español (`enero`…`diciembre`) o inglés (`january`…`december`), sin distinguir mayúsculas/acentos. Segmentos como `2024-03-14`, `14 marzo 2024` o una jerarquía inequívoca `2024/marzo/14` pueden aportar día. Términos ambiguos como `verano`, `vacaciones`, `antiguas`, un año de dos dígitos o un número de carpeta sin contexto no crean fecha.

La implementación define una tabla de patrones con pruebas de tabla. No sustituye falta de información con el 1 de enero.

### Fechas en el nombre de archivo

Solo se leen patrones completos y deterministas (`src/filename-date.ts`), siempre con precisión `DAY`: WhatsApp (`IMG-20190812-WA0001`, `VID-…-WA…`, `WhatsApp Image 2019-08-12 at …`, `Imagen de WhatsApp 2019-08-12 a las …`), cámaras Android (`IMG_/VID_/MVIMG_/PANO_/BURST_YYYYMMDD_HHMMSS`), Pixel (`PXL_YYYYMMDD_…`), capturas (`Screenshot_2019-08-12-…`, `Screenshot_YYYYMMDD-HHMMSS`, `Screenshot from …`, `Captura de pantalla …`, `Screen Shot …`), Signal (`signal-YYYY-MM-DD-…`) y marcas de tiempo (`YYYYMMDD_HHMMSS`, `YYYY-MM-DD HH.MM.SS`). Se rechaza un mes o día imposible, una hora inválida, un año anterior a 1900 y una fecha posterior a hoy; un número de ocho cifras suelto o un nombre como `foto 2019-08-12` no cuentan.

## Takeout: Fase 4

El importador Takeout se activa exclusivamente en fuentes `GOOGLE_TAKEOUT`. Trata cada JSON como entrada no confiable, no registra su contenido y limita su lectura. Su emparejador restringe candidatos a la misma carpeta, prioriza sidecar adyacente, nombre exacto, variantes normalizadas, nombre sin extensión y `title`; exige unicidad y conserva razón/estado (`TAKEOUT_MATCHED`, `TAKEOUT_NOT_FOUND` o `TAKEOUT_AMBIGUOUS`). Crea `INVALID_TAKEOUT_JSON` o una incidencia de ambigüedad cuando procede. Ninguna foto se descarta porque el JSON falte, falle al parsear o no encuentre pareja. GPS se persiste únicamente tras un JSON validado y match único; esta fase no crea mapas.

## Consulta temporal eficiente

El backend calcula `effectiveDateValue` y `effectiveDatePrecision` a partir del override o la detección. Para una navegación por año, filtra por rango de ancla y precisión compatible; para una vista de mes, excluye precisión `YEAR`; para día, exige `DAY`. El grupo «Fecha sin concretar» contiene `UNKNOWN` y, según la vista, precisiones insuficientes para el nivel solicitado. El índice efectivo definido en `data-model.md` respalda las consultas paginadas.

## Operación y pruebas requeridas antes de ampliar alcance

- Pruebas unitarias del resolver para EXIF, Drive, Takeout, carpetas, ambigüedad y override.
- Pruebas de integración del adaptador con respuestas paginadas, 429, 5xx, `Retry-After` y archivo desaparecido.
- Prueba de que una petición de crear sincronización devuelve antes de terminar el trabajo.
- Prueba de repetición del mismo trabajo sin duplicados.
- Pruebas de checkpoint, reintentos transitorios, exclusión por fuente, reconciliación segura y movimiento por `driveFileId`.
- Prueba de autorización: un usuario no obtiene ni media ni estado de otra persona.
