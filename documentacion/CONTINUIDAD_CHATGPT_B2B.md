# CONTINUIDAD_CHATGPT_B2B

## Propósito

Handoff operativo para continuar CuidaDiario PRO B2B sin depender del historial del chat. Ante divergencias prevalecen las instrucciones más recientes del usuario, las reglas de seguridad, el código comprobado y `ESTADO_Y_PLAN_B2B.md`.

## 1. Separación física y autoridad

- Copia controlada de trabajo: `C:\Cuidadiario-pro`.
- Repositorio frontend real: `C:\Users\ramos\Desktop\Personal\EDEN SOFTWORK\PROYECTOS\cuidadiario-pro`.
- Repositorio backend real: `C:\Users\ramos\Desktop\Personal\EDEN SOFTWORK\PROYECTOS\cuidadiario-backend`.
- **Autoridad de trabajo:** implementación, modificación y pruebas se realizan primero en `C:\Cuidadiario-pro`. Los repositorios Git reales se usan exclusivamente para promoción/despliegue de un paquete ya reconciliado y autorizado; no son el espacio ordinario de desarrollo.
- Después de cada promoción, todo cambio legítimo y acotado que haya sido necesario durante un gate productivo debe reconciliarse de vuelta hacia `C:\Cuidadiario-pro` por contenido, sin sobrescribir trabajo local posterior. Una diferencia en un repositorio real no adquiere autoridad por el solo hecho de estar desplegada.
- P0-C, P1-A/P1-B y P1-C fueron trasladados, desplegados, verificados y cerrados. P1-C quedó en backend `24b234af0e48b7017b3d9f5a0b32f26e67b26dd3` y frontend `7bb50132bdccdb62f8c02d0691b4bf98c4310d6b` el 04/10/2026.
- Alcance exclusivo: PRO B2B. B2C continúa fuera de alcance.

## 2. Estado exacto al 06/10/2026

- **P0-1:** VERIFICADO EN PRODUCCIÓN — 29/09/2026.
- **P0-2/P0-3/P0-8:** CERRADOS; frontend consolidado desplegado en el commit `9ec220c4722e528cda77c9ece3d21cb62bcd7068`.
- **P0-4/P0-5/P0-6/P0-7:** VERIFICADOS EN PRODUCCIÓN / CERRADOS — 30/09/2026; backend commit `db4d2bd756c339e010333bd96e173673388710f4`.
- **P0-C** es sólo la etiqueta operativa de P0-4+P0-5+P0-6+P0-7; no es un P0 nuevo. Cada bloque conserva evidencia, aceptación y rollback separados.
- **P0 COMPLETO — 30/09/2026.**
- **Mantenimiento B2B:** endpoint backend desplegado en `c598d557f96a43a2ece07f820b8f52c0091d85a0`; guard permanente corregido/versionado desplegado en frontend `ac3e46c9506c02ec62d650fdec4292d8bae7d6a1`; micro-gate productivo OFF→ON→OFF aprobado el 02/10/2026.
- **P1-A — Trazabilidad y preservación:** IMPLEMENTADO / DESPLEGADO / VERIFICADO EN PRODUCCIÓN / CLOSED.
- **P1-B — Integridad de operaciones:** IMPLEMENTADO / DESPLEGADO / VERIFICADO EN PRODUCCIÓN / CLOSED.
- **P1-C — Identidad del operador:** **IMPLEMENTADO / DESPLEGADO / VERIFICADO EN PRODUCCIÓN / CLOSED — 04/10/2026**.
- **P1-D1 — Backup y recuperación:** **OPERATIVO / VERIFICADO / CERRADO PARA EL ALCANCE ACTUAL (05/10/2026)**; Replica física diferida. **P1-D2 y P1-D3:** **DESPLEGADOS / VERIFICADOS / DOCUMENTADOS / CERRADOS (06/10/2026)**. **P1-D CERRADO. P1 COMPLETO / DESPLEGADO / VERIFICADO / DOCUMENTADO / CERRADO. No existe P1-E.**
- **Estado operativo final:** `B2B_MAINTENANCE_MODE=0`, `B2B_P1_BRIDGE_MODE=0`, `/health` saludable, `maintenance:false` y aplicación accesible.

### Paquete P1-A/P1-B cerrado

- Runner B2B con tres migraciones checksum/idempotentes y error bloqueante; ledger/trigger, idempotencia, versiones y soft-delete.
- Ledger sanitizado y actor backend; guard de egreso; conflicto opcional de versión; idempotencia opcional de toma/tarea/documento.
- Operaciones críticas transaccionales y con locks para stock/cuota. Documentos archivados conservan bytes y cuota, pero no listan/descargan.
- Frontend genera UUID por intento crítico sin reactivar ni tocar `cd_offline_queue`.
- Bridge de continuidad `B2B_P1_BRIDGE_MODE=1`: lectura/login sí, mutaciones B2B —incluido `POST /api/admin/set-plan`— 503, archivados permanecen ocultos. No usar backend pre-P1 como rollback tras migrar.
- Mercado Pago B2B no se amplió ni reactivó; UI/export del ledger no se implementaron.

### Paquete P1-C productivo y cerrado

- Migración `p1c_001_operator_identity`: directorio `operadores_b2b`, sesiones opacas `operador_sesiones_b2b` y referencias anulables `operador_b2b_id` en auditoría/idempotencia; aditiva, sin backfill ni reinterpretación histórica.
- Principal: usuario JWT revalidado y propietario de la sesión/FK histórica. Opera como sí mismo por defecto, también en `shared_mode`, sin PIN, operador duplicado, sesión secundaria ni timeout P1-C. Sólo otra persona activa una identidad separada mediante ID+PIN bcrypt; esa sesión dura como máximo 8 h y vence tras 60 min de inactividad. Administración de operadores y acciones exclusivamente AI requieren además principal administrador; una cuenta familiar no puede activar operadores.
- No hay asignaciones por operador: si su rol no tiene alcance institucional, no hereda las asignaciones del principal y falla cerrado.
- Auditoría conserva `actor_usuario_id` principal y suma `operador_b2b_id`; idempotencia queda separada por operador sin romper clientes/modo individual.
- Frontend: muestra al principal por defecto y abre el selector sólo a demanda. Volver al principal revoca el contexto secundario sin PIN. Sólo el operador secundario usa token/contexto/actividad en `sessionStorage`, header `X-B2B-Operator-Token`, ID+PIN, indicador persistente, fin/cambio e invalidación entre pestañas. El selector nominal y `_quien` fueron retirados de los flujos modificados. PIN/token no se guardan en `localStorage` ni Cache Storage.
- Evidencia runtime vigente: backend P1-C 59/59; P1-A/P1-B 110/110; P0-C 232/232; frontend P1-C 36/36; idempotencia 16/16; XSS 82/82; upgrade SW 43/43; navegador P1-C 24/24; caché 35/35; sesión 88/88; cola 37/37 y mantenimiento/no-B2B 46/46. Total **808/808 PASS**, Chrome 153, loopback, fixtures sintéticos, perfiles temporales y cero tráfico productivo.
- Gate de dump final: `cuidadiario_produccion_2026-10-04_predeploy_p1c_final.dump`, 10.092.797 bytes, SHA-256 `FCB2AF29069DCFDCF810E7E3C2BB4532A37A4BD7FF2C3C68F89E2766ABBA77E2`, custom/349 líneas. PostgreSQL 18.1 aislado, restore sin warnings y **185/185 PASS**; runner real dos veces, checksum P1-C `2c6cc0eb8aadc7db48d0741e7d3517a4ad62a2dbc901e38dfc6ba18018ffede2`, preservación total y cero operadores/sesiones/backfill.
- Paquete runtime aprobado: backend `index.js` `28A95F90FB2CD11E6F89B998B6921CAF07444A97CD3B8A6C18BB8E2327C7C323`, `b2b-p1.js` `91D5BDEC205944B27424B08844EACA6F27390B3C07B32C395D6015651D459CD2`, `b2b-p1c.js` `A2496002E70DBA1FEAC21288E0D5E9EAFC9B74D0E56EC54D00900E7856E96484`; frontend `js/api-b2b.js` `CCB0D983FCC2CD09D5567B77D44FCA93F267D127485DE2EB100017203219E556`, `js/utils-b2b.js` `5692E9086C1385C851AB96696143D8482F86595B95F121DF25052025CDD26538`, `js/staff.js` `6226333CC4F7D1A4EB7463B4DF91A91D6D6E918414BF2F22D3FEB73E420834C9`, `js/paciente.js` `67490795757F09449622E013972D2499BF4C917340CACCCFE6004817758E7EEB`, `pages/staff.html` `D110D00C3184948A8B31B5D1D0838535ADFF45DDE23B50CE258A6264CD6B596B`, `sw.js` `51DCA10095B2FCAF6AA4E76D267DCBB8555D83841148D28B61A54031BE4D1B60`.
- Producción: migración `p1c_001_operator_identity` aplicada con checksum aprobado; gate integral read-only con todos los componentes P1/P1-C correctos y gate corregido `constraints=10/10`, `legacy=8/8`, `p1c_operator_fks=2/2`, `unknown=0`. El `10/8` inicial fue un falso negativo del tooling que omitía del total esperado las dos FK P1-C; no hubo corrección productiva.
- Estado final: `/health` 200, `maintenance:false`, `B2B_MAINTENANCE_MODE=0`, `B2B_P1_BRIDGE_MODE=0`, ruta P1-C activa, seis blobs frontend exactos y login público operativo. Cero operadores es válido: el principal trabaja como sí mismo sin PIN; sólo otra persona usa operador+PIN, sesión de hasta 8 h y timeout por inactividad de 60 min.
- No hubo backfill, atribución histórica fabricada ni cambios B2C. P1-A/P1-B permanecen cerrados. Después de la migración, cualquier contingencia P1-C exige forward-fix bajo mantenimiento/bridge; no rollback automático al backend pre-P1-C.

### P1-D auditado/diseñado; D1 cerrado para el alcance actual

- El export actual `/api/b2b/reporte/export` es un reporte JSON parcial: omite asignaciones, tareas activas, catálogo/reposiciones, historial de citas, documentos, archivados, operadores, ledger y configuración completa. No es backup ni paquete de salida restaurable.
- Railway continúa sin backup programado observado. Localmente las tareas P1-D1 quedaron habilitadas: backup diario a las 20:00 y health a las 21:00. La ruta `pg_dump -> archivo custom cifrado -> pg_restore aislado` fue verificada con el artefacto productivo y el primer ciclo natural de ambas tareas quedó comprobado; los snapshots Railway siguen sin restauración comprobada.
- Objetivo proporcional propuesto: **RPO 24 horas y RTO 8 horas**, sostenido por dump lógico completo diario de la base compartida, copia cifrada fuera de Railway, manifiesto/hash, monitoreo y simulacro periódico. Son objetivos técnicos propuestos, no SLA vigente.
- La exportación institucional objetivo será un ZIP versionado con manifest, JSON/JSONL UTF-8, vistas CSV, documentos binarios y SHA-256; incluirá filas archivadas/egresadas y ledger, pero excluirá contraseñas/hashes de PIN, tokens, hashes de sesión, claves de idempotencia y otros secretos técnicos.
- El offboarding debe primero exportar/verificar/entregar, luego bloquear acceso y revocar credenciales/sesiones, registrar una decisión de retención y conservar sin DELETE físico hasta una autorización separada. Los plazos jurídicos/contractuales permanecen externos.
- Implementación en tres bloques: D1 backup/restore, D2 export institucional+ledger y D3 offboarding/retención están cerrados. D3 quedó desplegado y verificado productivamente sin ejecutar una baja real.
- D1 usa `pg_dump` custom completo de la base compartida, valida TOC, exige el ledger exacto de cinco migraciones P1 vigente, cifra CMS antes de persistir, emite manifiesto con SHA-256, rota 7 diarias/4 semanales/6 mensuales y registra estado explícito sin secretos. El restore exige loopback, base nueva con nombre allowlisted y confirmación; valida catálogo P1/P1-C/P1-D3, checksums y presencia no-B2B, y elimina la base temporal por defecto.
- Gate local D1: **51/51 PASS** sobre PostgreSQL 18.1 efímero, certificado de prueba, rutas con espacios y fixtures sintéticos B2B/no-B2B. Cubrió éxito, `pg_dump` fallido, dump vacío/corrupto, hash/manifiesto, retención 7/4/6, restore y fallo seguro, credenciales ausentes, bloqueo remoto/producción, secretos ausentes de metadatos y limpieza de temporales. Cero tráfico productivo.
- La notebook `MSI` bajo `MSI\ramos` quedó elegida como ejecutor y Primary local; la segunda PC será una Replica intermitente, pero no está disponible ni configurada. Custodia PFX/contraseña, secreto DPAPI, tareas locales, primer backup productivo, restore drill cronometrado y primer ciclo automático quedaron verificados. La Replica física se difiere hasta disponer de la segunda PC; RPO 24 h/RTO 8 h continúan siendo objetivos técnicos y no SLA ni garantías históricas.
- Decisión humana posterior: notebook Windows del responsable como ejecutor/almacén primario cifrado y segunda PC Windows como réplica física intermitente; no se contrata VM por ahora. El delta operativo quedó preparado en copia controlada: almacenes con rol Primary/Replica, `StartWhenAvailable`, catch-up aditivo cada 6 h, health de atraso >24 h/último fallo/hueco entre generaciones/réplica atrasada u offline y retención de réplica sólo con activación consciente. Gate específico del delta: **33/33 PASS** con pares cifrados sintéticos; no se repitió el gate base 51/51.
- **Checkpoint local del 05/10/2026:** `C:` fue verificado como `FullyDecrypted`, `ProtectionStatus=Off`, `EncryptionMethod=None`. La ausencia de BitLocker se acepta como limitación operativa y no reemplaza el cifrado CMS obligatorio antes de persistir. Se inicializó `C:\CuidaDiario_Backups` como Primary con ACL protegida limitada a `MSI\ramos`, SYSTEM y Administradores; se registró `VolumeEncryptionStatus=Disabled`; no contiene dump plano, PFX ni secreto. La configuración no secreta reside fuera del Primary en `%LOCALAPPDATA%\CuidaDiario\P1-D1`, también con ACL protegida. El certificado CMS real se creó y su clave privada permaneció temporalmente en `Cert:\CurrentUser\My` hasta completar la custodia PFX; después fue retirada, como detalla el incidente/reparación siguiente. Health inicial: `ATTENTION`, `P1D1_BACKUP_MISSING` y `P1D1_REPLICA_NOT_CONFIGURED`, estado correcto antes del primer backup/réplica. No hubo acceso a producción.
- **Anomalía y reparación local del 05/10/2026:** después de exportar/verificar el PFX offline, la retirada de la clave privada reveló que faltaban tanto `P1-D1.config.psd1` como `recovery-public.cer`; el diagnóstico posterior acreditó que el directorio local P1-D1 completo no existía. La causa de su desaparición es **NO DEMOSTRABLE** con la evidencia disponible: ningún script D1 contiene una eliminación posterior de ese árbol y no se atribuye una causa hipotética. Se detuvo el avance antes de DPAPI, tareas o producción. El bootstrap recibió `-RepairMissing`, escritura atómica y validación de drift; se agregó un validador fail-closed. La configuración/estado se reconstruyeron de valores ya aprobados y el `.cer` se extrajo del PFX existente, sin generar otro certificado. Veredicto real: `PASS`; thumbprint `7F6FE0E20ABFE650F69376E3EECDFA4CB76B444E`, `.cer` sin clave privada, entrada privada ausente de `Cert:\CurrentUser\My`, cifrado public-only PASS, PFX intacto de 3.596 bytes/SHA-256 `95897903FE77497C8AC1DD0E840B9B7B4066CF322D59263D840FDB0607EF0ACC`, Primary con cero PFX/dump plano/DPAPI y pendrive innecesario para operación diaria. Prueba focalizada posterior: **12/12 PASS**. No fue un incidente productivo: Railway/PostgreSQL nunca se accedieron.
- **DPAPI — 05/10/2026:** la URL productiva fue introducida únicamente en la variable de proceso aprobada, transformada bajo `MSI\ramos` y eliminada del entorno. Gate real: `SECRET_STORED_DPAPI`, descifrado DPAPI PASS, URL PostgreSQL válida/remota, SSL no deshabilitado, configuración local PASS, Replica nula y Primary con cero archivos sensibles. No se imprimió la URL ni hubo conexión. El registro de tareas fue endurecido para exigir configuración, certificado, DPAPI descifrable e identidad coincidente; el backup se registrará deshabilitado hasta la autorización del primer acceso productivo.
- **Abort seguro de Task Scheduler — 05/10/2026:** el primer registro terminó antes de pedir contraseña porque una Windows PowerShell elevada no encontraba `pwsh.exe` en `PATH`; no quedó ninguna de las dos tareas registrada y no se ejecutó backup ni acceso productivo. Se eliminó esa dependencia: registradores y validador exigen una ruta explícita de PowerShell 7, validan edición Core/versión/hash y rechazan Windows PowerShell 5.1. Se preparó además la fijación con ACL restringida del runtime 7.6.5 verificado en una ruta operacional estable, sin modificar el `PATH`. En ese checkpoint todavía estaban pendientes la instalación estable y el registro efectivo.
- **Segundo intento de Task Scheduler — 05/10/2026:** el runtime estable se instaló y quedó verificado en `C:\ProgramData\CuidaDiario\P1-D1\Runtime\PowerShell-7.6.5` (Core 7.6.5, SHA-256 aprobado, ACL restringida), pero después de ingresar la contraseña la consola se cerró sin conservar veredicto. La causa del cierre del host fue el `exit 1` del bloque envolvente al capturar una excepción; la excepción subyacente de `Register-ScheduledTask` es **NO DEMOSTRABLE** porque no existía transcript. Comprobación humana y read-only posterior: backup y health ausentes; no hubo tarea manual, backup ni producción. El registrador ahora emite etapas no sensibles y admite preflight sin mutación; el próximo intento usará transcript/log persistente y no contiene ningún `exit`.
- **Diagnóstico posterior del registro — 05/10/2026:** con la contraseña real, Windows registró correctamente backup y health; falló únicamente la validación posterior `P1D1_TASK_USER_MISMATCH_BACKUP` y el rollback dejó ambas ausentes. El valor textual concreto de `Principal.UserId` no se persistió antes de eliminar las tareas, pero se demostró la causa lógica: el validador comparaba texto literal, mientras Windows puede devolver otra representación de la misma cuenta. Se sustituyó por igualdad exacta de SID: `MSI\ramos` y `ramos` resuelven al mismo SID `S-1-5-21-62501617-763334010-2234187081-1001`; un SID diferente se rechaza. Gate sintético focalizado: **17/17 PASS**, incluida toda la configuración de ambas tareas, runtime exacto y Replica ausente. El procedimiento siguiente queda encapsulado como un único script block para que `try/catch/finally` no pueda fragmentarse al pegarlo.
- **Task Scheduler final — 05/10/2026:** gate real PASS. Windows devolvió `Principal.UserId=ramos` para ambas tareas y su SID coincidió exactamente con `MSI\ramos`. Backup quedó registrada/deshabilitada a las 20:00; health registrada/habilitada a las 21:00; ambas `Password`, `StartWhenAvailable`, `IgnoreNew`, compatibles con batería y apuntando al runtime Core 7.6.5 aprobado. Replica ausente, cero ejecución manual, artefacto o dump plano.
- **Primer intento productivo D1 — 05/10/2026:** todos los prechecks locales aprobaron y se ejecutó exactamente un `pg_dump` read-only mediante el tooling canónico. El gate abortó como `P1D1_UNEXPECTED_FAILURE`, dejó estado FAILURE no sensible, cero artefactos, cero `.dump`/temporales y la tarea diaria deshabilitada. La causa se reprodujo localmente con el dump predeploy conocido: `pg_restore --list` cerraba stdin tras obtener el TOC y la escritura del buffer de 10.078.861 bytes lanzaba “canalización terminada”. Se corrigió el transporte para deferir al exit code del proceso; el tramo local TOC→hash→CMS pasó con 310 entradas y un archivo corrupto continuó fallando cerrado.
- **Reintento único autorizado — 05/10/2026:** `PASS` con exactamente una invocación canónica/read-only. Se generó `full-shared-20261005T194139Z-42dc9d6a`, artefacto CMS `cuidadiario-full-shared-20261005T194139Z-42dc9d6a.dump.p7m` de 18.439.124 bytes y SHA-256 `904deb04c85db6833f389fac2ff483a77e4821cb69a89f8832592e1d6c63b981`; manifest `VALIDATED`, scope `full-shared-database`, 358 entradas TOC y las cuatro migraciones P1/P1-C exactas. `Test-CuidaDiarioBackupArtifact.ps1` aprobó en modo shallow; hash/tamaño coincidieron; manifest/logs no expusieron URL, contraseñas, secretos, PIN ni PFX; quedaron cero `.dump` planos y cero temporales. El health posterior detectó inicialmente una edad negativa por la conversión automática ISO→`DateTime` de PowerShell 7.6; la lectura quedó fijada como string UTC, una prueba focalizada aprobó **4/4** y el health real informó backup `OK/P1D1_BACKUP_CURRENT`, edad 0,08 h y `ATTENTION` sólo por `P1D1_REPLICA_NOT_CONFIGURED`. No hubo mutaciones productivas.
- **Restore drill real — 05/10/2026:** el mismo artefacto productivo fue descifrado y restaurado exclusivamente en PostgreSQL local/loopback, sobre una base temporal nueva allowlisted. Veredicto `PASS`: restore exitoso, catálogo P1/P1-C y cuatro checksums válidos, presencia estructural no-B2B preservada, duración `00:00:04.618`, cero conexiones/mutaciones productivas y base temporal eliminada. Después de la limpieza quedaron cero dumps planos y cero materiales criptográficos temporales.
- **Primer ciclo natural — 05/10/2026:** Task Scheduler ejecutó Backup a las `20:00:01` (`LastTaskResult=0`) y Health a las `21:00:01` (`LastTaskResult=2`, esperado por `ATTENTION` exclusivamente debido a Replica no configurada). El backup automático creó `full-shared-20261005T230001Z-a5ba68b5`: CMS de 18.439.144 bytes, SHA-256 `7a2c2a066158aa456395948ad237c927f81531fa18d130496069e27445c9db92`, manifest válido, 358 entradas TOC, cuatro migraciones exactas y validación shallow `PASS`. Health informó `BACKUP=OK/P1D1_BACKUP_CURRENT`; no hubo ejecución manual, restore, conexión productiva adicional ni mutación. Primary quedó sin `.dump` plano, temporales sensibles, PFX ni secretos detectados. Backup y Health permanecen habilitadas; Replica sigue no configurada/diferida.

### P1-D2 desplegado, verificado y cerrado

- `GET /api/b2b/institutional-export` es una ruta nueva y exclusivamente administrativa; conserva sin cambios `GET /api/b2b/reporte/export` como reporte parcial. La autorización usa sesión B2B vigente, tenant del principal y rol efectivo P1-C; un operador administrador no eleva a un principal no administrador.
- El exportador abre una única transacción `REPEATABLE READ READ ONLY`, revalida institución/principal y consulta mediante allowlist las 19 familias institucionales exportables, auditoría y journal P1. Cada fila debe pertenecer al tenant; las referencias a residentes, usuarios, operadores y recursos se validan contra el mismo paquete. Una relación no resoluble o cross-tenant aborta y limpia temporales.
- El ZIP `cuidadiario-export-<institucion>-<UTC>.zip` contiene manifest v1, README, JSON/JSONL canónico, CSV de conveniencia, ledger, documentos originales, `checksums.sha256` y digest del manifest. Documentos se escriben bajo rutas determinísticas basadas en ID; nombre original queda sólo en metadatos. Activos, inactivos, egresados y soft-deleted se incluyen.
- Se excluyen hashes/contraseñas/tokens/PIN, sesiones de operador, idempotencia, `_migrations`, variables/secretos y material criptográfico. Auditoría aplica redacción recursiva adicional. El ZIP se genera incrementalmente en un directorio temporal no público, usa `no-store`/attachment y se elimina tras servirlo o ante error; no se agregó cifrado ad hoc ni dependencia npm.
- La UI administrativa distingue “Exportación institucional completa” del reporte imprimible parcial, deshabilita el botón durante la generación y revoca el object URL tras descargar.
- Gate integral controlado: **537/537 PASS** en PostgreSQL 18 efímero/loopback, datos A/B/B2C completamente sintéticos y cero tráfico externo. Regresiones focalizadas: caché/network-only **35/35** e idempotencia **16/16**; total **588 PASS**.
- Producción: backend `1c50efce685e59ac89fbf762364741d39ffd28dd`, frontend `b86342ea07bf0bc5619b96bff77ead61a1ca50f8`. Assets públicos exactos, salvo el beacon añadido por Cloudflare al HTML; smoke PWA **23/23 PASS** en Chrome 153, sin mutaciones y con sólo `maintenance-status` como GET backend permanente.
- Se validó exactamente un ZIP productivo de 31.522 bytes/SHA-256 `948e251fdcb9fc120e96d491f011124b7c01c7a1b86a69286be3271da525e8c6`: schema v1, manifest/checksums, 19/19 familias, documentos, tenant isolation, secretos ausentes y B2C ausente. No se imprimieron filas ni valores; el ZIP y cualquier temporal quedaron eliminados. Cero DDL/DML, migraciones, cambios de esquema, P1-D1 o B2C.
- `ops/p1-d2/validate-institutional-export.js`, su prueba sintética y la corrección focalizada de `frontend/tests/p0-1-production-readonly.test.js` quedan sólo en la copia controlada como tooling reproducible. No se publican en el runtime. `frontend/sw.js` sí quedó reconciliado con el repositorio real: sólo agrega `/P1-D2` al comentario de distribución y no cambia cachés, rutas ni estrategias.

### P1-D3 desplegado, verificado y cerrado — 06/10/2026

- Diseño mínimo: `active → offboarding_prepared → retained`. Preparar exige export D2 reciente (receipt del mismo tenant, sin usar y de hasta 24 h), contraseña del principal administrador, motivo y frase `INICIAR BAJA`. Esa ventana es frescura técnica, no retención legal. Mientras está preparado se conserva operación normal y D2. Efectivizar exige una segunda confirmación `DAR DE BAJA`; fija `activa=FALSE`, revoca sesiones P1-C y anula tokens reset/verificación sin borrar datos.
- Migración candidata `p1d3_001_institution_lifecycle`, checksum `65eec6368114a7a6f4891d72f9370ca94ea2bb3bac5d98f5f8b4bd29eb351427`: nueve columnas aditivas en `instituciones_b2b`, tabla técnica de receipts, constraints e índices `RESTRICT`. Filas existentes quedan `active`. `retention_review_at` es sólo revisión humana; no hay cron, endpoint ni trigger de purga.
- Gate D3: **90/90 PASS** en PostgreSQL 18 efímero, datos A/B/B2C sintéticos y red externa bloqueada. Regresiones: P1-A/B 110/110, P1-C 59/59, D2 537/537, B2C/autorización 232/232, cliente idempotencia 16/16, caché 35/35, upgrade real SW Chrome 43/43, UX D3 17/17 y validador D2 5/5. Se comprobaron fingerprints clínicos/documentales, ledger histórico y B2C preservados.
- Producción: backend `865e56025c9b763b0c9664cdf5ec4e165f32d4e4`, frontend `52260dd13c05ec68b79a58ffe24bb9063ce753ed`, PostgreSQL 17.11 y quinta migración/checksum exactos. El gate read-only final aprobó 5/5 migraciones, P1-A/B/C, nueve columnas institucionales D3, tabla/constraints/índices de receipts y tenant productivo `id=30` en `active`, `activa=TRUE`, sin preparación/finalización.
- El primer gate abortó de forma segura por un filtro textual no único: dos instituciones contenían “Los Aromos”. La consulta diagnóstica read-only distinguió la residencia productiva `id=30` de la instancia de prueba; el gate pasó a identidad estable por ID. No se tocaron datos para corregirlo.
- No se ejecutaron `prepare`, `finalize`, borrado físico ni purga. No existe reactivación automática en este alcance: cualquier recuperación administrativa futura deberá diseñarse/autorizarse aparte y nunca revivir sesiones/tokens anteriores.
- Adaptación D1: el tooling operativo ahora exige exactamente las cinco migraciones vigentes; backup sintético cifrado con manifest de cinco migraciones y catálogo restaurado 2/2 PASS. Las tareas siguen habilitadas y D1 continúa cerrado para el alcance actual.

## 3. Qué implementa el paquete backend P0-C desplegado

- P0-4: `authB2BMiddleware` exige JWT firmado con `b2b: true` y revalida usuario, institución, pertenencia, rol, actividad y e-mail verificado en cada request protegido. Usa identidad/permisos actuales y falla cerrado.
- P0-5: documentos aplican cabeceras no-store y resuelven tenant, residente/asignación, sección familiar y ownership antes de devolver bytes o borrar.
- P0-6: listas clínicas/operativas exigen contexto a roles restringidos; administrador/personal con permiso global conservan listados legítimos. Catálogo/reposiciones/notificaciones se acotan y dashboard/reportes respetan cada sección familiar.
- P0-7: mutaciones por ID resuelven primero recurso, tenant y residente mediante helper allowlisted; catálogo valida su vínculo; ID inexistente, cross-tenant, no asignado, rol incorrecto o padre no resoluble no escribe.
- P0-C no tuvo migraciones ni cambio de esquema. P1-A cerró posteriormente versionado, ledger, guard de egreso y los seis soft-delete; P1-B cerró transacciones/idempotencia en los flujos cubiertos.

## 4. Archivos del paquete P1 promovido

Runtime:

1. `backend/index.js`
2. `backend/db.js`
3. `backend/b2b-p1.js` (nuevo)
4. `frontend/js/api-b2b.js`
5. `frontend/sw.js` (cambio mínimo de bytes para distribución P1)

Prueba:

1. `backend/tests/p0-c-authorization.test.js`
2. `backend/tests/p1-a-b-integrity.test.js` (nuevo)
3. `frontend/tests/p1-idempotency.test.js` (nuevo; ampliado a 16 aserciones)
4. `frontend/tests/p1-service-worker-upgrade.test.js` (nuevo; Chrome P0→P1, 43 aserciones)

Documentación actualizada:

1. `documentacion/README_PROYECTO_B2B.md`
2. `documentacion/ARQUITECTURA_B2B.md`
3. `documentacion/MODELO_DATOS_B2B.md`
4. `documentacion/MAPA_API_B2B.md`
5. `documentacion/ESTADO_Y_PLAN_B2B.md`
6. `documentacion/CONTINUIDAD_CHATGPT_B2B.md`

`documentacion/AUDITORIA_SEGURA.md` se preserva sin cambios. `MODELO_DATOS_B2B.md` conserva el modelo P1 controlado y no recibió contenido del micro-gate.

Para distribuir el cliente P1-A/P1-B se modificó únicamente el comentario identificador de `frontend/sw.js`; no cambiaron cachés, rutas ni estrategias. Ese byte quedó desplegado en `c452c23dfd28baccd9f93cc58936523db793ae0e`. P1-C volvió a cambiar sólo ese comentario (`/P1-C`) para distribuir sus assets y quedó desplegado en `7bb50132bdccdb62f8c02d0691b4bf98c4310d6b`, sin alterar estrategias. El mecanismo de mantenimiento no modificó `sw.js`. No se modificaron manifests/dependencias ni archivos B2C y no se instalaron dependencias.

La reconciliación del 02/10 detectó que ese comentario P1 había sido sustituido por la versión P0 productiva. Se restauró exclusivamente `/P1-B`; el diff contra producción es una línea y el hash raw es `0AB125822EA1C6D74FC5EB703659E105F7A2750C967CC4453C9FF2DA474E4D32` (LF `8E05D1CA773F66108F1AA0368378B22188D3D9BBC1F08A7001D99C59BBC5BD8C`). `p1-service-worker-upgrade.test.js` conservó sus 43 aserciones y recibió sólo endurecimiento del runner para el sandbox Windows. Edge 154.0.4258.48 aprobó 43/43 en loopback: P0 instalado/controlando, `updatefound=1`, P1 activado/controlando, cliente P1 efectivo, idempotencia, purga/network-only B2B, no-B2B preservado y offline fail-closed. Cero servicios externos; perfil temporal eliminado.

## 5. Entorno y evidencia P0-C

- Node `v24.11.1`.
- PostgreSQL 18 efímero por ejecución, sólo loopback, base `cuidadiario_p0c_test_*`, directorio temporal eliminado al finalizar.
- Esquema mínimo y fixtures completamente sintéticos: instituciones A/B/inactiva; AI/CS/FA/MD, usuarios inactivos/no verificados/rol inválido; residentes asignados/no asignados/cross-tenant; recursos clínicos, catálogo/reposiciones, documentos y una tabla/usuario B2C ficticios.
- JWT firmados con secreto exclusivamente local.
- `P0C_TEST_MODE=1` rechaza host no loopback, nombre de base no-test, secreto no sintético y variables de Railway/Resend/Mercado Pago/PayPal/VAPID/backend externo. El arnés bloquea `https`/`fetch` externos.
- Suite final P0-C: **9 aserciones unitarias + 223 HTTP = 232 PASS; 0 intentos externos**.
- Regresión frontend repetida: P0-1 35 + P0-2 88 + P0-3 37 + P0-8 82 = **242 PASS**.
- Sintaxis de `backend/index.js`, `backend/db.js` y el test: PASS.
- No quedaron procesos ni directorios PostgreSQL temporales P0-C.

Evidencia de despliegue/cierre:

- Backup predeploy: `cuidadiario_produccion_2026-10-01_pre_p0c.dump`, 10.078.959 bytes, timestamp local `30/09/2026 20:06:44 -03:00`, custom `PGDMP`; `pg_restore 18.1 --list` exitoso, 325 líneas/310 entradas TOC no vacías. No se restauró.
- Gate Git: `HEAD=db4d2bd756c339e010333bd96e173673388710f4`, parent `11f4774870d8e89960bcfcfa0626781c772ce034`, working tree limpio y tres archivos idénticos al paquete aprobado. Las 232 pruebas no se repitieron porque el código no cambió.
- Push normal a `origin/main`; cero force/rebase/amend. Railway informó `success` para ese SHA, deployment `af85a53b-67e5-4ed5-8a50-773cc8525b32`.
- Smoke: tres `/health` 200 con uptime creciente; `/api/b2b/auth/me` 401 sin token; `/api/b2b/documentos/0/download` 401 con `no-store`, `no-cache` y `Expires: 0`; lectura PostgreSQL con token sintético inexistente 400 y sin alcanzar la rama de actualización.
- Cero métodos mutadores, cuentas, residentes, documentos o credenciales reales; cero SQL, migraciones, cambios de esquema o configuración Railway.
- La UI Railway exigió autenticación GitHub y los logs internos no se inspeccionaron. Su contenido/retención siguen **[NO VERIFICADO]**; el estado final, uptime continuo, lectura PostgreSQL y ausencia de 5xx no mostraron crash loop ni incompatibilidad evidente en la ventana observada.

### Evidencia P1 controlada/predeploy

- Node `v24.11.1`; PostgreSQL 18 efímero en loopback, base `cuidadiario_p1_test_*`, eliminada al finalizar.
- P1 backend: 106 aserciones PASS; P1 frontend: 11 PASS; checksum divergente, minimización REFERENCE y bridge administrativo incluidos.
- Regresiones: P0-C 232, P0-1/P0-2/P0-3/P0-8 determinísticas 242 y Chrome P0-1 69: total consolidado **660 PASS**.
- Carreras reales: dos PATCH con una versión, dos tomas con stock 1, key concurrente y cuota documental concurrente.
- Fallos inyectados: registro; stock/historial/ledger de toma; update/historial de restock; historial de tarea; cuota documental. Se comprobó rollback sin filas/stock/ledger/reservas parciales.
- Barreras `P1_TEST_MODE`: host loopback, nombre dedicado, JWT sintético, variables externas ausentes; `https`/`fetch` externos bloqueados. Resultado: cero intentos externos.
- Regresión B2C exclusivamente sintética; tabla, login y contrato de token preservados.

### Evidencia del micro-gate productivo de mantenimiento

- Backend `c598d557f96a43a2ece07f820b8f52c0091d85a0`: endpoint público `GET /api/b2b/maintenance-status`, 200/no-store, booleano derivado sólo de `B2B_MAINTENANCE_MODE`, sin consulta a PostgreSQL.
- Frontend `ac3e46c9506c02ec62d650fdec4292d8bae7d6a1`: `maintenance-b2b-v2.js` canónico (`SHA-256 0D4081BD7D3A8BC5BABE0CBAF008076F3A6F514408E64DF238F542892190A978`) después de `api-b2b.js` en las 15 entradas B2B.
- Secuencia final OFF→ON→OFF en Edge con perfil temporal: misma pestaña detectó ON en ~5,5 s, Reintentar permaneció bloqueado y el overlay se retiró al volver a OFF; aperturas nuevas y B2C/no-B2B normales; cero requests mutantes al backend. Los POST de Cloudflare RUM se bloquearon localmente antes de enviarse.
- Intentos abortados que no deben repetirse: `3dffdcb`/`9251203` dependía de reemplazar `sw.js` bajo un TTL canónico `max-age=14400`; `a20694e`/`855831f` usaba `globalThis.API_B2B` pese a que la configuración es un binding léxico. El asset v2 evita reutilizar la versión defectuosa.
- Ese micro-gate terminó con mantenimiento `0` y bridge aún no activado. Durante la promoción posterior ambos mecanismos se usaron temporalmente; el estado final productivo es mantenimiento `0`, bridge `0`, `/health` saludable y `maintenance:false`.

## 6. Matriz cubierta

Se probaron JWT vigente/inexistente/inactivo/no verificado/no-B2B, institución inactiva o cambiada, rol cambiado/inválido y revocación entre requests; AI/MD/CS/FA; mismo tenant asignado/no asignado; otro tenant; ID inexistente/malformado; recurso con padre no resoluble; secciones familiares habilitadas/deshabilitadas; listas con/sin `paciente_id`; administrador global; documentos permitidos/no asignados/cross-tenant/ownership/cabeceras/bytes; dashboard/reportes por bloque; mutaciones por familia; y regresión B2C sintética. Además del status se verificó que los bodies no contuvieran marcadores ficticios de otros residentes/tenants.

## 7. Rollback

- P0-4: revertir revalidación/middleware B2B.
- P0-5: revertir middleware de cabeceras y autorización de documentos.
- P0-6: revertir helper/filtros de listas y agregados por familia.
- P0-7: revertir helper allowlisted y guards de mutación por familia.
- Conjunto desplegado: revertir mediante un commit nuevo el cambio `db4d2bd756c339e010333bd96e173673388710f4` hacia su parent `11f4774870d8e89960bcfcfa0626781c772ce034`; no hacer reset/force y no tocar frontend, DB ni datos. No existe rollback SQL y restaurar la base no es el rollback normal.

## 8. Cierre productivo y próximo paso

El backup fresco predeploy fue `cuidadiario_produccion_2026-10-02_predeploy_p1.dump`: 10.079.205 bytes, 325 líneas TOC y SHA-256 `30656BC093BFE7CD1E02014B176E883E42D462109DF7A57CD8352A4F22388CAB`. Restauró en PostgreSQL 18.1 efímero/local y aprobó 363/363 verificaciones, sin tráfico externo; el clúster temporal fue eliminado. Esto acredita el despliegue P1-A/P1-B, no una política completa de continuidad.

Backend productivo: `6502be8b87aacfbb396530e09dbbbf939a6651fc`. Las tres migraciones/checksums quedaron aplicadas y el gate estructural final fue `PASS|3|13|13|18|35|4|1|1|0|`, `VERDICT=PASS`. La función append-only coincidió byte a byte con la migración (`prosrc_md5=0864804c40294a982bb42a4d78089202`); un ABORT anterior fue un falso negativo del tooling, no un defecto productivo.

Frontend productivo: `c452c23dfd28baccd9f93cc58936523db793ae0e`, limitado a `js/api-b2b.js` y `sw.js`. GitHub Pages publicó P1; el worker quedó activado/controlando y el guard de mantenimiento cargó sin overlay con mantenimiento OFF. El smoke público no ejecutó mutaciones ni operaciones sobre residentes reales.

P1-C está cerrado; P1-D1 está cerrado para su alcance actual; P1-D2 y P1-D3 están cerrados. **P1-D está cerrado y P1 está completo/cerrado.** La Replica física está diferida y no reabre D1. No usar `sw.js` como interruptor, no reabrir bloques cerrados sin una regresión demostrada y no crear P1-E.

## 9. Orden de lectura

1. `README_PROYECTO_B2B.md`
2. `ARQUITECTURA_B2B.md`
3. `MODELO_DATOS_B2B.md`
4. `MAPA_API_B2B.md`
5. `ESTADO_Y_PLAN_B2B.md`
6. `AUDITORIA_SEGURA.md`
7. `CONTINUIDAD_CHATGPT_B2B.md`

## 10. Política documental permanente

### 10.1 Fuente de verdad de trabajo

La documentación técnica canónica de trabajo se mantiene en `C:\Cuidadiario-pro\documentacion` y acompaña a la copia controlada. La documentación de `C:\Users\ramos\Desktop\Personal\EDEN SOFTWORK\PROYECTOS\cuidadiario-pro\documentacion` es la copia versionable/publicable, pero no reemplaza a la copia controlada como autoridad ordinaria de trabajo.

### 10.2 Actualización durante el desarrollo

Cuando un avance en la copia controlada cambie materialmente estado, arquitectura, modelo, API, seguridad, reglas operativas o próximos pasos, se actualizan allí únicamente los documentos afectados. No se posterga deliberadamente esa información para una reconstrucción masiva ni se editan todos los documentos por cambios menores.

### 10.3 Promoción y evidencia productiva

Los repositorios Git reales sólo se modifican con autorización explícita. La promoción de código no vuelve fuente de verdad a su documentación. La documentación promovida debe partir de la copia controlada reconciliada, salvo evidencia nueva del propio gate. Commit productivo, resultado de gate, estado final o comportamiento público pueden registrarse provisionalmente donde cierre la operación, pero antes del cierre documental deben reconciliarse hacia `C:\Cuidadiario-pro\documentacion`; ninguna información material válida puede quedar sólo en el repositorio real.

### 10.4 Definition of Done documental

Un bloque que requiera documentación no queda documentalmente cerrado hasta que su estado real figure en `C:\Cuidadiario-pro\documentacion`, no existan contradicciones materiales conocidas entre los documentos canónicos y toda evidencia productiva relevante haya vuelto a la copia controlada. Esto no exige commit/push documental.

### 10.5 Prohibición de divergencia silenciosa

Nunca se sobrescribe una copia sólo porque la otra parezca más reciente. Antes de sincronizar se comparan los pares, se identifican divergencias materiales, se preserva la información válida y se reconcilia conscientemente. Una diferencia del repositorio real no adquiere autoridad por estar en Git o desplegada.

### 10.6 Inicio y cierre de futuras tareas

Si una tarea puede afectar arquitectura, código, modelo, API, seguridad, plan o procedimientos, se consulta primero el handoff/estado y sólo los documentos materialmente relacionados de `C:\Cuidadiario-pro\documentacion`; no hace falta releer los seis en cada microtarea. Al terminar una tarea material se debe preguntar: **“¿Este cambio modifica información que algún documento canónico debe reflejar?”** Si no, no se edita documentación. Si sí, se actualizan únicamente los documentos afectados en la copia controlada antes de declarar terminado el trabajo.

Nunca registrar secretos, credenciales, JWT, URLs privadas de base, datos de residentes ni contenido clínico real.
