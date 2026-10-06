# Mapa de API de CuidaDiario PRO B2B

**Fuente:** declaraciones de rutas y consultas de `backend/index.js`, `backend/b2b-p1.js`, `backend/b2b-p1c.js` y `backend/b2b-p1d2.js`, actualizadas con P0-C/P1-A/P1-B/P1-C/P1-D2 productivos al 6 de octubre de 2026.
**Base pública confirmada en Railway y configurada en el frontend:** `https://cuidadiario-backend-production.up.railway.app`, dirigida al puerto 8080, seguida de la ruta indicada.  
**Nota:** el monolito continúa en `index.js`, pero P1-C y P1-D2 registran rutas desde módulos propios; “control” describe el backend, no sólo lo que oculta la UI. Las rutas P1-C y P1-D2 están activas en producción.

**[ACTUAL]** Este inventario describe rutas vigentes en código. Las recomendaciones del final son **[FUTURO]**.

## 1. Leyenda de controles

| Código | Control actual |
|---|---|
| `A` | `authB2BMiddleware`: JWT válido con `b2b: true` y revalidación actual de usuario, institución, pertenencia, rol, estado y e-mail verificado. |
| `R(...)` | `requireB2BRole`: rol incluido en la lista. |
| `C(acción)` | `checkB2BCanDo`: permiso configurable de institución/rol. |
| `P` | `checkB2BPacienteAccess`: acceso al residente por institución, rol/permisos y/o asignación. |
| `F(sección)` | `checkB2BFamiliarCanSee`: sección familiar habilitada. |
| `L` | `requireActivePlan` o chequeo de límite/estado de plan equivalente. |
| `K` | encabezado `X-Admin-Key` comparado con `SUPERADMIN_KEY`; no usa JWT B2B. |
| `V` | versión prospectiva; `expected_version`/`If-Match` opcional y conflicto 409. |
| `I` | `Idempotency-Key` opcional con resultado persistido y conflicto de payload. |
| `G` | guard central de residente egresado. |
| `S` | soft-delete; lecturas normales filtran `deleted_at IS NULL`. |
| `O` | Contexto secundario opt-in mediante `X-B2B-Operator-Token`: sólo aparece al cambiar desde el principal a otra persona verificada por PIN. Sin header, el principal JWT opera como sí mismo. **[P1-C VERIFICADO EN PRODUCCIÓN / CERRADO — 04/10/2026]** |
| Público | Sin JWT; puede tener rate limit, token de un solo uso o firma de proveedor. |

Abreviaturas de rol: `AI` administrador institucional, `MD` médico, `CS` cuidador/personal, `FA` familiar.

## 2. Reglas transversales

- Las consultas B2B usan `institucion_id` revalidado contra el usuario actual como frontera de tenant.
- `A` recarga usuario, institución, rol, estado, verificación y permisos actuales en cada petición protegida. Un token con tenant divergente o identidad ya no vigente falla cerrado.
- En P1-C, `A` conserva el usuario como principal y actor efectivo por defecto, incluso con `shared_mode=true`. Sólo si la petición presenta el header secundario se exige `O`; un token presentado pero inválido/vencido/revocado, operador inactivo o versión de credencial distinta devuelve 428 `OPERATOR_REQUIRED`, sin degradar silenciosamente al principal durante esa petición.
- Las listas clínicas/operativas exigen `paciente_id` a familiar y personal sin permiso global; administrador/personal con alcance institucional conservan la lista global dentro del tenant.
- Las mutaciones por ID resuelven primero el recurso, su `paciente_id`, tenant y acceso actual. Los recursos no encontrados, cross-tenant, no asignados o con padre no resoluble no se mutan.
- Los controles `F` se aplican también a dashboard, reportes, catálogo/reposiciones familiares y documentos.
- `L` aparece principalmente en altas y acciones; no equivale a una política uniforme para todos los `PATCH` y `DELETE`.
- Desde P0-3, `POST`, `PATCH` y `DELETE` son exclusivamente de red: no se encolan ni reintentan automáticamente. Una `cd_offline_queue` heredada permanece byte a byte, sin lectura, migración, transmisión o borrado automático. P1-B agrega idempotencia opcional a toma, tarea completada y carga documental; clientes heredados sin header continúan funcionando. **[P1-B VERIFICADO EN PRODUCCIÓN / CERRADO — 03/10/2026].**

**Estado P1-A/P1-B productivo:** las mutaciones de dominio cubiertas registran ledger sanitizado dentro de la misma transacción; filas editables tienen versión prospectiva; los egresados conservan lectura histórica y bloquean nuevas mutaciones, con cierres administrativos acotados y, donde el código lo contempla, corrección excepcional por AI con motivo; las seis familias `S` preservan la fila y quedan fuera de GET/list/download. Mercado Pago B2B no fue ampliado ni reactivado.

**Estado P1-C:** **DESPLEGADO / VERIFICADO EN PRODUCCIÓN / CERRADO — 04/10/2026.** Backend `24b234af0e48b7017b3d9f5a0b32f26e67b26dd3`; frontend `7bb50132bdccdb62f8c02d0691b4bf98c4310d6b`. El principal autentica y opera como sí mismo sin PIN/sesión secundaria. Otra persona debe activar un operador; entonces aporta identidad/rol efectivos durante hasta 8 h y 60 min de inactividad. Auditoría e idempotencia incorporan `operador_b2b_id` sólo para ese contexto. `_quien` nunca sustituye estas identidades y cero operadores configurados es válido.

El gate postdeploy PostgreSQL 17 read-only confirmó las cuatro migraciones/checksums, estructura P1-C, cero backfill y P1-A/P1-B intactos. El primer `base_constraints=10/8` fue un falso negativo: los diez son ocho heredados más las dos FK P1-C; el gate corregido aprobó `constraints=10/10`, `legacy=8/8`, `p1c_operator_fks=2/2`, `unknown=0`. El cierre dejó mantenimiento `0`, bridge `0`, `/health` sano, `maintenance:false` y los seis blobs frontend aprobados.

**Gate con dump fresco y cierre productivo:** sobre una restauración aislada se confirmaron rutas P1 de idempotencia, versión, soft-delete, egreso, documentos/cuota y bridge. El gate estructural productivo final dio `PASS|3|13|13|18|35|4|1|1|0|`. El bridge permite login/GET y bloquea mutadores HTTP B2B, `verify-subscription`, `auth/verify-email` y `POST /api/admin/set-plan`; no intercepta B2C ni protege migraciones, jobs/timers, SQL administrativo o la sincronización periódica directa de Mercado Pago. Al cierre productivo quedó en `0`.

**Estado P0-C:** P0-4/P0-5/P0-6/P0-7 están **[VERIFICADOS EN PRODUCCIÓN / CERRADOS — 30/09/2026]**. La matriz final ejecutó previamente 232 aserciones sobre Express y PostgreSQL 18 efímero locales, con fixtures/JWT sintéticos y cero intentos externos. No se repitió en producción: el commit exacto `db4d2bd756c339e010333bd96e173673388710f4`, deployment Railway `af85a53b-67e5-4ed5-8a50-773cc8525b32`, aprobó un smoke GET mínimo sin credenciales/datos reales ni mutaciones. No hubo migraciones, cambios de esquema ni cambios B2C.

### 2.1 Estado de mantenimiento B2B

| Método y ruta | Finalidad | Control | Persistencia/efecto |
|---|---|---|---|
| `GET /api/b2b/maintenance-status` | Informar exclusivamente si la capa visual B2B debe mostrar mantenimiento. | Público, sólo lectura; `B2B_MAINTENANCE_MODE === '1'`. | No consulta DB, no usa sesión, no expone datos personales/secretos y responde `Cache-Control: no-store`. **[VERIFICADO EN PRODUCCIÓN — 02/10/2026]** |

El guard frontend `maintenance-b2b-v2.js` consume esta ruta mediante el binding léxico `API_B2B.BASE_URL`, con `credentials: omit`, `cache: no-store` y polling de 5 s. La ruta y el overlay no bloquean técnicamente mutaciones: `B2B_P1_BRIDGE_MODE` es una barrera backend separada. `sw.js` no participa en la alternancia. El mecanismo OFF→ON→OFF y el bridge se verificaron en producción; el cierre dejó ambos modos en `0`, preservó B2C/no-B2B y no usó datos clínicos.

## 3. Suscripciones y plan

| Método y ruta | Finalidad / tablas | Control | Consumidor frontend | Efecto externo o persistencia |
|---|---|---|---|---|
| `POST /api/b2b/create-subscription` | Crear preaprobación para institución; lee `instituciones_b2b` y conteos. | `A R(AI)` | Código en `configuracion.js`; flujo actualmente no habilitado | Si se activa, envía datos comerciales a Mercado Pago y puede cancelar preaprobación anterior. |
| `POST /api/b2b/webhook/mercadopago` | Sincronizar plan desde evento de preaprobación. | Público + verificación de firma MP + consulta posterior a MP | Mercado Pago | Actualiza plan, ID y vencimiento en `instituciones_b2b`. |
| `GET /api/b2b/verify-subscription` | Consultar/confirmar preaprobación. | `A R(AI)`; valida `external_reference` si recibe ID | Código en `configuracion.js`; flujo actualmente no habilitado | Puede actualizar plan, ID, vencimiento y descuento. |
| `POST /api/b2b/cancel-subscription` | Programar baja y detener cobros futuros. | `A R(AI)` | Código en `configuracion.js`; flujo actualmente no habilitado | Llama a MP y actualiza campos comerciales. |

Estas cuatro rutas están implementadas y existen variables relacionadas por nombre, pero el propietario confirmó que Mercado Pago no está habilitado actualmente en el frontend B2B ni es utilizado por Los Aromos. La integración queda clasificada como **implementada/inactiva o latente**; no se ha verificado validez de credenciales, webhooks ni tráfico. El helper/credencial convive con otro producto: **[COMPARTIDO - NO TOCAR B2C]**.

## 4. Autenticación, perfil y preferencias

| Método y ruta | Finalidad / tablas | Control | Consumidor |
|---|---|---|---|
| `POST /api/b2b/auth/register` | Crear institución y administrador, hash y token de verificación. | Público + rate limit | `register.html` |
| `POST /api/b2b/auth/login` | Validar contraseña/estados y emitir JWT de 30 días. | Público + rate limit | `login.html`, `api-b2b.js` |
| `GET /api/b2b/auth/me` | Leer perfil y datos de institución. | `A` | guardias/utilidades B2B |
| `PATCH /api/b2b/auth/me` | Actualizar nombre, e-mail, contraseña u otros campos admitidos del usuario actual. | `A` | `configuracion.js` |
| `GET /api/b2b/me/notif-prefs` | Leer preferencias de notificación. | `A` | `configuracion.js` / utilidades |
| `PATCH /api/b2b/me/notif-prefs` | Reemplazar preferencias JSON. | `A` | `configuracion.js` |
| `POST /api/b2b/auth/forgot-password` | Generar token y enviar enlace de recuperación. | Público + rate limit | `login.html` |
| `POST /api/b2b/auth/reset-password` | Validar token/expiración y cambiar hash. | Público + token | `reset-password.html` |
| `GET /api/b2b/auth/verify-email` | Validar token/expiración y marcar e-mail verificado. | Público + token | `verify-email.html` |
| `POST /api/b2b/auth/resend-verification` | Rotar token y reenviar verificación. | `A` | flujo de verificación |

Registro, recuperación, verificación y bienvenida están programados para usar Resend. La variable relacionada existe por nombre, pero el estado operativo externo no fue comprobado. La URL con token puede quedar en historial/cache/logs. El JWT y los helpers de correo son **[COMPARTIDO - NO TOCAR B2C]**.

**[CERRADO — P0-2, 30/09/2026]:** el cliente exige un JWT estructuralmente B2B y temporalmente vigente para atravesar la guardia; no restaura el último usuario offline. Logout y los 401 de sesión eliminan token, usuario actual/legado y selección activa de estación, preservando la cola offline y preferencias. Desde P1-C productivo, `401 OPERATOR_PIN_INVALID` se trata como error de credencial secundaria y no cierra el principal. Esta comprobación cliente no valida firma ni reemplaza `A`; la autenticidad y autorización siguen dependiendo del backend.

## 5. Institución, equipo y asignaciones

| Método y ruta | Finalidad / tablas | Control | Consumidor |
|---|---|---|---|
| `GET /api/b2b/institucion` | Devuelve la fila de institución (`i.*`) y conteos activos. | `A` | onboarding, configuración, navegación, catálogo |
| `PATCH /api/b2b/institucion` | Edita identidad, stock, permisos, onboarding y modo compartido. | `A R(AI)` | `onboarding.js`, `configuracion.js` |
| `GET /api/b2b/staff` | Lista ID, nombre, e-mail, rol, activo y fecha. | `A`; AI o `C(ver_staff/crear_staff/asignar_paciente)` | `staff.js`, selectores operativos |
| `POST /api/b2b/staff` | Crea usuario y envía bienvenida. | `A`; AI o `C(crear_staff)` + chequeo `L` | `staff.js` |
| `PATCH /api/b2b/staff/:id` | Edita identidad, rol, activo y/o contraseña. | `A R(AI)` | `staff.js` |
| `DELETE /api/b2b/staff/:id` | Desactiva; impide autodesactivación. | `A R(AI)` | `staff.js` |
| `GET /api/b2b/asignaciones` | Lista asignaciones activas con usuario y residente. | `A`; AI o `C(ver_staff/asignar_paciente)` | `staff.js` |
| `POST /api/b2b/asignaciones` | Crea o reactiva, validando ambos extremos en la institución. | `A`; AI o `C(asignar_paciente)` | `staff.js` |
| `DELETE /api/b2b/asignaciones/:id` | Desactiva. | `A`; AI o `C(asignar_paciente)` | `staff.js` |

### 5.1 Operadores de estación compartida — P1-C productivo

| Método y ruta | Finalidad / tablas | Control | Consumidor / efecto |
|---|---|---|---|
| `GET /api/b2b/operators` | Lista operadores activos del tenant; `?all=1` incluye datos administrativos y desactivados. | `A`; bootstrap sin `O`; `all=1` requiere principal AI. | Selector P1-C; `staff.js` para administración. |
| `POST /api/b2b/operators` | Crea operador con PIN bcrypt. | `A`; principal AI; nombre/rol/PIN validados; transacción + ledger. | `staff.js`; no crea usuario/JWT. |
| `PATCH /api/b2b/operators/:id` | Cambia nombre/rol/estado y opcionalmente PIN; revoca sesiones si cambia credencial/rol/estado. | `A`; principal AI; tenant + lock + ledger. | `staff.js`. |
| `POST /api/b2b/operators/activate` | Al cambiar a otra persona, valida ID+PIN, limita 5 fallos/15 min en memoria y crea sesión opaca de hasta 8 h. | `A`; `shared_mode`; principal familiar bloqueado; operador AI exige principal AI. | Devuelve token una vez y `no-store`; `api-b2b.js` lo guarda sólo en `sessionStorage`. |
| `GET /api/b2b/operators/context` | Revalida/toca sesión, operador activo, versión, expiración e inactividad. | `A` + header de operador; bootstrap específico. | Refresh/guard frontend; `no-store`. |
| `POST /api/b2b/operators/end-shift` | Revoca idempotentemente el token de esa pestaña/principal. | `A` + header opcional; bootstrap específico. | Fin de turno; luego limpieza local y broadcast. |

Las rutas operativas usan al principal si no se seleccionó otra persona. Cuando existe `O`, `requireB2BRole` usa el rol del operador; una acción exclusivamente AI exige además principal AI. Sin asignaciones propias por operador, el rol restringido no hereda asignaciones del principal y falla cerrado. Volver al titular revoca `O` y continúa sin PIN. En modo individual la semántica previa permanece.

## 6. Residentes

| Método y ruta | Finalidad / tablas | Control | Consumidor | Observación actual |
|---|---|---|---|---|
| `GET /api/b2b/pacientes` | Lista residentes activos. | `A`; AI todos; FA sólo asignados; MD/CS todos o asignados según permiso/query | pacientes, cuidador, familiar, formularios | `mis_asignados=1` fuerza asignaciones para MD/CS. |
| `GET /api/b2b/pacientes/:id` | Ficha activa. | `A P` | `paciente.js` y vistas por residente | Devuelve 404 cuando no hay acceso. |
| `POST /api/b2b/pacientes` | Alta de residente. | `A C(crear_paciente) L` | `pacientes.js` | Inserta datos identificatorios y de salud/cuidado. |
| `PATCH /api/b2b/pacientes/:id` | Editar o registrar egreso. | `A C(editar_paciente/dar_alta) P V G` | `pacientes.js`, `paciente.js` | Egreso se audita como transición; no admite `fecha_egreso=null` como reactivación. |
| `DELETE /api/b2b/pacientes/:id` | Desactivar residente. | `A C(eliminar_paciente) P` | `pacientes.js` | Autoriza antes de desactivar; no borra físicamente. |

## 7. Medicamentos e inventario

| Método y ruta | Finalidad / tablas | Control | Consumidor | Observación actual |
|---|---|---|---|---|
| `GET /api/b2b/medicamentos/historial` | Administraciones por institución/residente. | `A F(medicamentos) P/listado institucional explícito` | `paciente.js`, `familiar.js` | FA y personal restringido requieren `paciente_id`; alcance institucional legítimo conserva lista global. |
| `GET /api/b2b/medicamentos` | Medicación activa. | `A F(medicamentos) P/listado institucional explícito` | `paciente.js`, `familiar.js` | Misma regla fail-closed. |
| `POST /api/b2b/medicamentos` | Crear indicación. | `A R(AI,CS,MD) L P` | `paciente.js` | Puede asociar catálogo. |
| `POST /api/b2b/medicamentos/:id/toma` | Registrar administración y descontar stock. | `A R(AI,CS,MD) L P(recurso) G I` | `paciente.js` | Stock, historial, ledger e idempotencia son atómicos; actor backend es autoridad y `_quien` no lo reemplaza. |
| `PATCH /api/b2b/medicamentos/:id` | Editar indicación/stock. | `A R(AI,CS,MD) P(recurso) G V` | `paciente.js` | Valida vínculo de catálogo y versión opcional. |
| `DELETE /api/b2b/medicamentos/:id` | Desactivar. | `A R(AI,CS,MD) P(recurso)` | `paciente.js` | Falla antes de escribir si no hay acceso. |
| `GET /api/b2b/catalogo/stock-bajo` | Listar stock bajo institucional/específico. | `A R(AI,MD,CS) P cuando hay residente` | método disponible en cliente; uso directo no confirmado | Sin filtro, personal restringido recibe sólo institucional + residentes asignados. |
| `GET /api/b2b/catalogo` | Lista inventario institucional o de residente. | `A F(medicamentos) para FA; P cuando hay residente` | catálogo, paciente, familiar | Un filtro de residente siempre se autoriza; sin filtro conserva sólo catálogo institucional. |
| `POST /api/b2b/catalogo` | Crear ítem. | `A R(AI,MD,CS) C(gestionar_catalogo) L P si hay residente` | `catalogo.js` | Vínculo institucional o al mismo residente autorizado. |
| `PATCH /api/b2b/catalogo/:id` | Editar; si aumenta stock inserta reposición. | `A R(AI,MD,CS) C(gestionar_catalogo) P/G si tiene residente V` | `catalogo.js` | Cambio, historial de reposición y ledger son atómicos. |
| `GET /api/b2b/catalogo/restock-historial` | Últimas 50 reposiciones. | `A F(medicamentos) para FA; P/listado acotado` | `catalogo.js` | FA requiere residente; personal restringido sin filtro recibe sólo institucional + asignados. |
| `DELETE /api/b2b/catalogo/:id` | Desactivar ítem. | `A R(AI)` | `catalogo.js` | No borra físicamente. |

## 8. Citas y tareas

| Método y ruta | Finalidad | Control | Consumidor | Ciclo/hallazgo |
|---|---|---|---|---|
| `GET /api/b2b/citas` | Listar citas. | `A F(citas) P/listado institucional explícito` | `paciente.js`, `familiar.js` | FA/personal restringido requieren residente; alcance institucional conserva lista global. |
| `POST /api/b2b/citas` | Crear cita. | `A R(AI,CS,MD) L P` | `paciente.js` | — |
| `PATCH /api/b2b/citas/:id` | Editar/estado. | `A R(AI,CS,MD) P(recurso)` | `paciente.js` | Autoriza antes de sobrescribir. |
| `GET /api/b2b/citas/historial` | Citas actuales con estado `realizada`. | `A F(citas) P/listado institucional explícito` | `paciente.js` | No usa `historial_citas_b2b`. |
| `DELETE /api/b2b/citas/:id` | Archivar cita. | `A R(AI,CS,MD) P(recurso) G V S` | `paciente.js` | Soft-delete repetible; la fila queda preservada. |
| `GET /api/b2b/tareas/historial` | Listar cumplimientos. | `A F(tareas) P/listado institucional explícito` | `paciente.js`, `familiar.js` | Omisión falla cerrada para roles restringidos. |
| `GET /api/b2b/tareas` | Listar tareas activas. | `A F(tareas) P/listado institucional explícito` | `paciente.js`, `familiar.js` | Misma regla. |
| `POST /api/b2b/tareas` | Crear tarea. | `A R(AI,CS,MD) L P` | `paciente.js` | — |
| `POST /api/b2b/tareas/:id/completar` | Registrar cumplimiento. | `A R(AI,CS,MD) L P G I` | `paciente.js` | Historial, ledger e idempotencia son atómicos; actor backend es autoridad. |
| `PATCH /api/b2b/tareas/:id` | Editar. | `A R(AI,CS,MD) P(recurso) G V` | `paciente.js` | Conflicto opcional por versión. |
| `DELETE /api/b2b/tareas/:id` | Desactivar. | `A R(AI,CS,MD) P(recurso)` | `paciente.js` | Autoriza antes de desactivar; no borra físicamente. |

## 9. Síntomas, signos, contactos y notas

| Familia | GET | POST | PATCH | DELETE | Control y persistencia |
|---|---|---|---|---|---|
| Síntomas (`sintomas_b2b`, `pacientes_b2b`) | `/api/b2b/sintomas` | `/api/b2b/sintomas` | `/api/b2b/sintomas/:id` | `/api/b2b/sintomas/:id` | `A/F/P/G/V`; DELETE es `S`, no físico. |
| Signos vitales (`signos_vitales_b2b`, `pacientes_b2b`) | `/api/b2b/signos-vitales` | `/api/b2b/signos-vitales` | — | `/api/b2b/signos-vitales/:id` | `A/F/P/G`; DELETE es `S`, no físico. |
| Contactos (`contactos_b2b`) | `/api/b2b/contactos` | `/api/b2b/contactos` | `/api/b2b/contactos/:id` | `/api/b2b/contactos/:id` | `A/F/P/G/V`; DELETE es `S`, no físico. |
| Notas (`notas_b2b`, `pacientes_b2b`) | `/api/b2b/notas` | `/api/b2b/notas` | `/api/b2b/notas/:id` | `/api/b2b/notas/:id` | `A/F/P/G/V`; DELETE es `S`, no físico. |

Consumidor principal: `paciente.js`; las vistas de cuidador/familiar consumen subconjuntos. La fecha offline puede conservarse como momento declarado, pero identidad/actor provienen del backend. Las familias editables conservan versión prospectiva.

## 10. Notificaciones, panel y reportes

| Método y ruta | Finalidad / contenido | Control | Consumidor | Observación actual |
|---|---|---|---|---|
| `GET /api/b2b/notificaciones` | Citas próximas, notas urgentes, síntomas recientes, stock, cumpleaños, ingresos y egresos. | `A`; filtra asignaciones para FA y aplica secciones familiares al armar ítems | `utils-b2b.js` | No es web push; es consulta periódica/visual. |
| `POST /api/b2b/notificaciones/vistas` | Actualizar última apertura de campana. | `A` | `utils-b2b.js` | Muta sólo usuario actual. |
| `GET /api/b2b/dashboard` | Conteos, staff agregado, citas, síntomas, notas urgentes, cumpleaños y stock. | `A`; asignaciones/alcance institucional + `F` por bloque para FA | `dashboard.js` | Medicación, tareas, citas, síntomas y notas se omiten/ponen en cero cuando la sección familiar está deshabilitada. |
| `GET /api/b2b/reportes` | Ficha y series de un residente en un período. | `A P`; exige `paciente_id`; `F` por bloque para FA | `reportes.js` | Medicación/historial, citas, tareas, síntomas, signos, contactos y notas respetan la sección vigente. |
| `GET /api/b2b/reporte/export` | Exportación JSON institucional. | `A`, comprobación AI interna | `configuracion.js` | No incluye asignaciones, catálogo/reposiciones, tareas activas, documentos ni historial de citas; no es backup completo restaurable. |
| `GET /api/b2b/institutional-export` | ZIP institucional v1 con manifest/hashes, JSON/JSONL, vistas CSV, documentos y ledger. | `A R(AI)`; revalidación de principal/operador/tenant dentro de snapshot read-only | `configuracion.js` mediante `api.download()` | **[VERIFICADO EN PRODUCCIÓN / CERRADO — 06/10/2026].** Incluye activos, inactivos, egresados y soft-deleted; excluye credenciales, sesiones, idempotencia, `_migrations` y B2C. `private, no-store`. |

## 11. Documentos

| Método y ruta | Finalidad | Control | Consumidor | Observación actual |
|---|---|---|---|---|
| `POST /api/b2b/documentos` | Guardar base64, hasta ~5 MB por archivo y cuota textual institucional de 200 MB. | `A R(AI,CS,MD) L P G I` | `paciente.js` | Lock institucional serializa cuota; inserción/ledger/idempotencia son atómicos. |
| `GET /api/b2b/documentos?paciente_id=` | Listar metadatos sin binario. | `A F(documentos)` para FA + `P` | `paciente.js`, `familiar.js` | Exige residente. |
| `GET /api/b2b/documentos/:id/download` | Recuperar binario. | `A P(recurso) F(documentos)` para FA | `paciente.js` | Resuelve tenant/residente antes de devolver bytes; respuestas de la familia usan `no-store`; P0-1 además impide Cache Storage. |
| `DELETE /api/b2b/documentos/:id` | Archivar documento. | `A P(recurso) F(documentos)` para FA + subidor o AI + `G V S` | `paciente.js` | Conserva bytes y cuota; listado/descarga normal lo excluyen; 404 evita enumeración. |

## 12. Control administrativo B2B separado

| Método y ruta | Finalidad | Control | Consumidor |
|---|---|---|---|
| `GET /api/admin/institucion/:id` | Consultar institución, plan y conteos. | `K` | `admin-panel.html` |
| `POST /api/admin/set-plan` | Activar/cambiar plan manual. | `K` | `admin-panel.html` |

Estas rutas actúan sobre B2B, pero están fuera del espacio `/api/b2b/` y dependen de una clave estática de entorno. No exponen contenido clínico según las consultas observadas.

## 13. Matriz de middleware por tipo de riesgo

| Riesgo que intenta cubrir | Mecanismo actual | Cobertura conocida |
|---|---|---|
| Sesión no autenticada/no vigente | `A` | Casi todas las rutas B2B; revalida estado actual. Webhook usa firma y auth usa tokens específicos. |
| Cruce entre instituciones | `institucion_id` del JWT/consulta | Ampliamente aplicado; requiere pruebas automáticas exhaustivas. |
| Rol no autorizado | `R` o checks internos | Aplicación desigual entre familias. |
| Usuario sin asignación | `P` + helpers de lista/recurso | Aplicado a ficha, listas restringidas, documentos, agregados y mutaciones inventariadas. |
| Sección familiar deshabilitada | `F` | Rutas de módulo, notificaciones, dashboard, reportes, catálogo/reposiciones y documentos. |
| Plan vencido/límite | `L` / `checkInstPlanForAction` | Principalmente creación/acciones, no todas las mutaciones. |
| Repetición/retry explícito | `I` en toma/tarea/documento | Opcional y persistido; no reactiva cola offline. |
| Registro de quién/cuándo | Ledger allowlisted | P1-A productivo registra principal. P1-C productivo suma operador verificado como dimensión separada; historia previa queda `NULL`, sin reinterpretar `_quien`. |

## 14. Resumen de tablas leídas/modificadas por familia

| Familia API | Lecturas principales | Escrituras principales |
|---|---|---|
| Suscripción/plan | institución, conteos de residentes/usuarios | campos comerciales de `instituciones_b2b` |
| Auth/perfil | `usuarios_b2b`, `instituciones_b2b` | ambas durante registro; tokens, hash, perfil y preferencias de usuario |
| Operadores P1-C productivo | `operadores_b2b`, `operador_sesiones_b2b`, principal/institución | directorio/sesiones; `operador_b2b_id` en auditoría e idempotencia |
| Institución/staff/asignaciones | las tres tablas homónimas y residentes para asignar | institución, usuarios y asignaciones |
| Residentes | `pacientes_b2b`, permisos/asignaciones | `pacientes_b2b` |
| Medicamentos | medicamentos, historial, catálogo, residentes/asignaciones | medicamentos, historial de administraciones y stock de catálogo |
| Catálogo | catálogo, reposiciones, residentes/usuarios | catálogo e historial de reposición |
| Citas | citas, residentes/asignaciones | `citas_b2b`; la tabla `historial_citas_b2b` no se usa |
| Tareas | tareas, historial, residentes/asignaciones | tareas e historial de cumplimientos |
| Síntomas/signos/contactos/notas | tabla de la familia, residentes/asignaciones | tabla de la familia |
| Notificaciones/dashboard | usuarios, asignaciones, residentes, citas, notas, síntomas, inventario e historiales | última vista de notificaciones únicamente |
| Reportes/export | múltiples tablas de dominio B2B; P1-D2 agrega operadores, ledger y documentos por allowlist | ninguna; producen respuesta/descarga y el snapshot P1-D2 es `READ ONLY` |
| Documentos | documentos, residentes/asignaciones | `documentos_b2b` |
| Superadmin | institución y conteos | plan/estado comercial de institución |

## 15. Cambios mínimos posteriores

Sin cambiar rutas B2C ni datos existentes:

1. mantener la matriz negativa P0-C de institución, rol, asignación, sección y estado de sesión como regresión obligatoria;
2. conservar como regresión obligatoria las garantías ya desplegadas de idempotencia, ledger, versiones y estados lógicos;
3. diseñar outbox/saga antes de intentar atomicidad con Resend o Mercado Pago;
4. conservar la regresión P1-C/P1-D2 sin reabrir los bloques cerrados;
5. mantener la exportación del ledger P1-D2 sólo lectura y no añadir mutaciones de auditoría.

P0-C está desplegado y cerrado desde el 30/09/2026. P1-A/P1-B están **[VERIFICADOS EN PRODUCCIÓN / CERRADOS — 03/10/2026]**. P1-C está **[DESPLEGADO / VERIFICADO EN PRODUCCIÓN / CERRADO — 04/10/2026]**; P1-D1 está cerrado para su alcance actual; P1-D2 está **[IMPLEMENTADO / DESPLEGADO / VERIFICADO EN PRODUCCIÓN / CERRADO — 06/10/2026]**; P1-D3 no se inició y no existe P1-E. Después de la migración P1-C cualquier contingencia requiere forward-fix bajo mantenimiento/bridge, no rollback automático al runtime anterior.
