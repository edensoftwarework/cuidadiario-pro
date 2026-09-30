# Mapa de API de CuidaDiario PRO B2B

**Fuente:** declaraciones de rutas y consultas de `backend/index.js` al 15 de septiembre de 2026.  
**Base pública confirmada en Railway y configurada en el frontend:** `https://cuidadiario-backend-production.up.railway.app`, dirigida al puerto 8080, seguida de la ruta indicada.  
**Nota:** todos los controladores están actualmente en el mismo archivo; “control” describe lo que el backend ejecuta, no lo que oculta la UI.

**[ACTUAL]** Este inventario describe rutas vigentes en código. Las recomendaciones del final son **[FUTURO]**.

## 1. Leyenda de controles

| Código | Control actual |
|---|---|
| `A` | `authB2BMiddleware`: JWT válido con marca B2B. |
| `R(...)` | `requireB2BRole`: rol incluido en la lista. |
| `C(acción)` | `checkB2BCanDo`: permiso configurable de institución/rol. |
| `P` | `checkB2BPacienteAccess`: acceso al residente por institución, rol/permisos y/o asignación. |
| `F(sección)` | `checkB2BFamiliarCanSee`: sección familiar habilitada. |
| `L` | `requireActivePlan` o chequeo de límite/estado de plan equivalente. |
| `K` | encabezado `X-Admin-Key` comparado con `SUPERADMIN_KEY`; no usa JWT B2B. |
| Público | Sin JWT; puede tener rate limit, token de un solo uso o firma de proveedor. |

Abreviaturas de rol: `AI` administrador institucional, `MD` médico, `CS` cuidador/personal, `FA` familiar.

## 2. Reglas transversales

- Las consultas B2B usan normalmente `institucion_id` del JWT como frontera de tenant.
- `A` valida claims del token, pero no recarga usuario/institución/rol/estado en cada petición.
- `P` no se aplica de modo uniforme: varias listas lo ejecutan sólo cuando el cliente envía `paciente_id`; varias mutaciones por ID sólo restringen por institución y rol.
- Los controles `F` afectan lectura familiar de módulos, pero no todas las respuestas agregadas los aplican sección por sección.
- `L` aparece principalmente en altas y acciones; no equivale a una política uniforme para todos los `PATCH` y `DELETE`.
- En el paquete frontend local P0-3, `POST`, `PATCH` y `DELETE` son exclusivamente de red: no se encolan ni reintentan automáticamente. Una `cd_offline_queue` heredada permanece byte a byte, sin lectura, migración, transmisión o borrado automático. El backend sigue sin contrato de idempotencia extremo a extremo para futuros reintentos explícitos. **[VERIFICADO EN ENTORNO CONTROLADO — 30/09/2026; NO EN PRODUCCIÓN].**

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

**[VERIFICADO EN ENTORNO CONTROLADO — P0-2, 30/09/2026]:** el cliente local exige un JWT estructuralmente B2B y temporalmente vigente para atravesar la guardia; no restaura el último usuario offline. Logout y cualquier 401 eliminan token, usuario actual/legado y selección activa de estación, preservando la cola offline y preferencias. Esta comprobación cliente no valida firma ni reemplaza `A`; la autenticidad y autorización siguen dependiendo del backend. **[NO VERIFICADO EN PRODUCCIÓN].**

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

## 6. Residentes

| Método y ruta | Finalidad / tablas | Control | Consumidor | Observación actual |
|---|---|---|---|---|
| `GET /api/b2b/pacientes` | Lista residentes activos. | `A`; AI todos; FA sólo asignados; MD/CS todos o asignados según permiso/query | pacientes, cuidador, familiar, formularios | `mis_asignados=1` fuerza asignaciones para MD/CS. |
| `GET /api/b2b/pacientes/:id` | Ficha activa. | `A P` | `paciente.js` y vistas por residente | Devuelve 404 cuando no hay acceso. |
| `POST /api/b2b/pacientes` | Alta de residente. | `A C(crear_paciente) L` | `pacientes.js` | Inserta datos identificatorios y de salud/cuidado. |
| `PATCH /api/b2b/pacientes/:id` | Editar o registrar egreso. | `A C(editar_paciente/dar_alta)` | `pacientes.js`, `paciente.js` | No ejecuta `P`; restringe por institución. Sobrescribe sin versión. |
| `DELETE /api/b2b/pacientes/:id` | Desactivar residente. | `A C(eliminar_paciente)` | `pacientes.js` | No ejecuta `P`; no borra físicamente. |

## 7. Medicamentos e inventario

| Método y ruta | Finalidad / tablas | Control | Consumidor | Observación actual |
|---|---|---|---|---|
| `GET /api/b2b/medicamentos/historial` | Administraciones por institución/residente. | `A F(medicamentos)` para FA; `P` sólo si hay `paciente_id` | `paciente.js`, `familiar.js` | Sin filtro de residente, una llamada directa lista historial institucional. |
| `GET /api/b2b/medicamentos` | Medicación activa. | `A F(medicamentos)` para FA; `P` sólo si hay `paciente_id` | `paciente.js`, `familiar.js` | Mismo comportamiento con parámetro omitido. |
| `POST /api/b2b/medicamentos` | Crear indicación. | `A R(AI,CS,MD) L P` | `paciente.js` | Puede asociar catálogo. |
| `POST /api/b2b/medicamentos/:id/toma` | Registrar administración y descontar stock. | `A R(AI,CS,MD) L` | `paciente.js` | Busca recurso por institución, no ejecuta `P`; crea historial y acepta `_quien`/`_offline_ts`. |
| `PATCH /api/b2b/medicamentos/:id` | Editar indicación/stock. | `A R(AI,CS,MD)` | `paciente.js` | Institución + rol; no `P` ni versión. |
| `DELETE /api/b2b/medicamentos/:id` | Desactivar. | `A R(AI,CS,MD)` | `paciente.js` | Institución + rol; no `P`. |
| `GET /api/b2b/catalogo/stock-bajo` | Listar todo stock bajo institucional/específico. | `A R(AI,MD,CS)` | método disponible en cliente; uso directo no confirmado | No filtra por asignación. |
| `GET /api/b2b/catalogo` | Lista inventario institucional o de residente. | `A`; para FA exige residente asignado y no muestra institucional | catálogo, paciente, familiar | Para MD/CS no ejecuta `P` al pedir residente. |
| `POST /api/b2b/catalogo` | Crear ítem. | `A R(AI,MD,CS) C(gestionar_catalogo) L` | `catalogo.js` | Si hay residente sólo valida pertenencia a institución, no asignación. |
| `PATCH /api/b2b/catalogo/:id` | Editar; si aumenta stock inserta reposición. | `A R(AI,MD,CS) C(gestionar_catalogo)` | `catalogo.js` | Sin `P`; resto de cambios no queda versionado. |
| `GET /api/b2b/catalogo/restock-historial` | Últimas 50 reposiciones, filtros opcionales. | `A` | `catalogo.js` | Sin filtros devuelve historial institucional; no `P`/`F`. |
| `DELETE /api/b2b/catalogo/:id` | Desactivar ítem. | `A R(AI)` | `catalogo.js` | No borra físicamente. |

## 8. Citas y tareas

| Método y ruta | Finalidad | Control | Consumidor | Ciclo/hallazgo |
|---|---|---|---|---|
| `GET /api/b2b/citas` | Listar citas. | `A F(citas)` para FA; `P` sólo con `paciente_id` | `paciente.js`, `familiar.js` | Omisión del filtro permite lista institucional. |
| `POST /api/b2b/citas` | Crear cita. | `A R(AI,CS,MD) L P` | `paciente.js` | — |
| `PATCH /api/b2b/citas/:id` | Editar/estado. | `A R(AI,CS,MD)` | `paciente.js` | Sin `P`; sobreescribe. |
| `GET /api/b2b/citas/historial` | Citas actuales con estado `realizada`. | `A F(citas)` para FA; `P` sólo con `paciente_id` | `paciente.js` | No usa `historial_citas_b2b`. |
| `DELETE /api/b2b/citas/:id` | Eliminar cita. | `A R(AI,CS,MD)` | `paciente.js` | Borrado físico; sin `P`. |
| `GET /api/b2b/tareas/historial` | Listar cumplimientos. | `A F(tareas)` para FA; `P` sólo con `paciente_id` | `paciente.js`, `familiar.js` | Omisión permite lista institucional. |
| `GET /api/b2b/tareas` | Listar tareas activas. | `A F(tareas)` para FA; `P` sólo con `paciente_id` | `paciente.js`, `familiar.js` | Omisión permite lista institucional. |
| `POST /api/b2b/tareas` | Crear tarea. | `A R(AI,CS,MD) L P` | `paciente.js` | — |
| `POST /api/b2b/tareas/:id/completar` | Registrar cumplimiento. | `A R(AI,CS,MD) L P` | `paciente.js` | Conserva historial; acepta atribución offline/compartida. |
| `PATCH /api/b2b/tareas/:id` | Editar. | `A R(AI,CS,MD)` | `paciente.js` | Sin `P`; sin versión. |
| `DELETE /api/b2b/tareas/:id` | Desactivar. | `A R(AI,CS,MD)` | `paciente.js` | Sin `P`; no borra físicamente. |

## 9. Síntomas, signos, contactos y notas

| Familia | GET | POST | PATCH | DELETE | Control y persistencia |
|---|---|---|---|---|---|
| Síntomas (`sintomas_b2b`, `pacientes_b2b`) | `/api/b2b/sintomas` | `/api/b2b/sintomas` | `/api/b2b/sintomas/:id` | `/api/b2b/sintomas/:id` | GET: `A F(sintomas)` para FA y `P` sólo con filtro. POST: `A R(AI,CS,MD) L P`. PATCH/DELETE: `A R(...)`, institución, sin `P`; DELETE físico. |
| Signos vitales (`signos_vitales_b2b`, `pacientes_b2b`) | `/api/b2b/signos-vitales` | `/api/b2b/signos-vitales` | — | `/api/b2b/signos-vitales/:id` | GET: `A F(signos)` para FA y `P` sólo con filtro. POST: `A R(...) L P`. DELETE: `A R(...)`, institución, sin `P`, físico. |
| Contactos (`contactos_b2b`) | `/api/b2b/contactos` | `/api/b2b/contactos` | `/api/b2b/contactos/:id` | `/api/b2b/contactos/:id` | GET: `A F(contactos)` para FA y `P` sólo con filtro. POST: `A R(...) P` (sin `L`). PATCH/DELETE: `A R(...)`, institución, sin `P`; DELETE físico. |
| Notas (`notas_b2b`, `pacientes_b2b`) | `/api/b2b/notas` | `/api/b2b/notas` | `/api/b2b/notas/:id` | `/api/b2b/notas/:id` | GET: `A F(notas)` para FA y `P` sólo con filtro. POST: `A R(...) L P`. PATCH/DELETE: `A R(...)`, institución, sin `P`; DELETE físico. |

Consumidor principal: `paciente.js`; las vistas de cuidador/familiar consumen subconjuntos. Síntomas y signos admiten fecha offline; síntomas/notas admiten nombre visible `_quien`. Ninguna de estas familias conserva versiones generales.

## 10. Notificaciones, panel y reportes

| Método y ruta | Finalidad / contenido | Control | Consumidor | Observación actual |
|---|---|---|---|---|
| `GET /api/b2b/notificaciones` | Citas próximas, notas urgentes, síntomas recientes, stock, cumpleaños, ingresos y egresos. | `A`; filtra asignaciones para FA y aplica secciones familiares al armar ítems | `utils-b2b.js` | No es web push; es consulta periódica/visual. |
| `POST /api/b2b/notificaciones/vistas` | Actualizar última apertura de campana. | `A` | `utils-b2b.js` | Muta sólo usuario actual. |
| `GET /api/b2b/dashboard` | Conteos, staff agregado, citas, síntomas, notas urgentes, cumpleaños y stock. | `A`; filtra asignados para FA y MD/CS restringidos | `dashboard.js` | Para FA filtra residente, pero no aplica cada bandera `F`; puede incluir notas urgentes aunque la sección notas esté deshabilitada. |
| `GET /api/b2b/reportes` | Ficha y series de un residente en un período. | `A P`; exige `paciente_id` | `reportes.js` | Devuelve también contactos y notas sin aplicar banderas `F` por sección. |
| `GET /api/b2b/reporte/export` | Exportación JSON institucional. | `A`, comprobación AI interna | `configuracion.js` | No incluye asignaciones, catálogo/reposiciones, tareas activas, documentos ni historial de citas; no es backup completo restaurable. |

## 11. Documentos

| Método y ruta | Finalidad | Control | Consumidor | Observación actual |
|---|---|---|---|---|
| `POST /api/b2b/documentos` | Guardar base64, hasta ~5 MB por archivo y cuota textual institucional de 200 MB. | `A R(AI,CS,MD) L P` | `paciente.js` | Persiste contenido dentro de PostgreSQL. |
| `GET /api/b2b/documentos?paciente_id=` | Listar metadatos sin binario. | `A F(documentos)` para FA + `P` | `paciente.js`, `familiar.js` | Exige residente. |
| `GET /api/b2b/documentos/:id/download` | Recuperar binario. | `A` + institución | `paciente.js` | No ejecuta `P` ni `F`; P0-1 impide su caché por el SW **[VERIFICADO EN PRODUCCIÓN — 29/09/2026]**. |
| `DELETE /api/b2b/documentos/:id` | Eliminar documento. | `A`; subidor o AI + institución | `paciente.js` | No ejecuta `P`/`F`; borrado físico. |

## 12. Control administrativo B2B separado

| Método y ruta | Finalidad | Control | Consumidor |
|---|---|---|---|
| `GET /api/admin/institucion/:id` | Consultar institución, plan y conteos. | `K` | `admin-panel.html` |
| `POST /api/admin/set-plan` | Activar/cambiar plan manual. | `K` | `admin-panel.html` |

Estas rutas actúan sobre B2B, pero están fuera del espacio `/api/b2b/` y dependen de una clave estática de entorno. No exponen contenido clínico según las consultas observadas.

## 13. Matriz de middleware por tipo de riesgo

| Riesgo que intenta cubrir | Mecanismo actual | Cobertura conocida |
|---|---|---|
| Sesión no autenticada | `A` | Casi todas las rutas B2B; webhook usa firma y auth usa tokens específicos. |
| Cruce entre instituciones | `institucion_id` del JWT/consulta | Ampliamente aplicado; requiere pruebas automáticas exhaustivas. |
| Rol no autorizado | `R` o checks internos | Aplicación desigual entre familias. |
| Usuario sin asignación | `P` | Fuerte en ficha/altas; ausente o condicional en varias listas/mutaciones. |
| Sección familiar deshabilitada | `F` | Rutas de módulo y notificaciones; incompleto en dashboard/reportes/download. |
| Plan vencido/límite | `L` / `checkInstPlanForAction` | Principalmente creación/acciones, no todas las mutaciones. |
| Repetición offline | Ninguno extremo a extremo | `_qid` queda sólo en navegador. |
| Registro de quién/cuándo | IDs/nombres en algunos eventos | Parcial; `_quien` no es autenticación y no hay auditoría general. |

## 14. Resumen de tablas leídas/modificadas por familia

| Familia API | Lecturas principales | Escrituras principales |
|---|---|---|
| Suscripción/plan | institución, conteos de residentes/usuarios | campos comerciales de `instituciones_b2b` |
| Auth/perfil | `usuarios_b2b`, `instituciones_b2b` | ambas durante registro; tokens, hash, perfil y preferencias de usuario |
| Institución/staff/asignaciones | las tres tablas homónimas y residentes para asignar | institución, usuarios y asignaciones |
| Residentes | `pacientes_b2b`, permisos/asignaciones | `pacientes_b2b` |
| Medicamentos | medicamentos, historial, catálogo, residentes/asignaciones | medicamentos, historial de administraciones y stock de catálogo |
| Catálogo | catálogo, reposiciones, residentes/usuarios | catálogo e historial de reposición |
| Citas | citas, residentes/asignaciones | `citas_b2b`; la tabla `historial_citas_b2b` no se usa |
| Tareas | tareas, historial, residentes/asignaciones | tareas e historial de cumplimientos |
| Síntomas/signos/contactos/notas | tabla de la familia, residentes/asignaciones | tabla de la familia |
| Notificaciones/dashboard | usuarios, asignaciones, residentes, citas, notas, síntomas, inventario e historiales | última vista de notificaciones únicamente |
| Reportes/export | múltiples tablas de dominio B2B | ninguna; producen respuesta/descarga |
| Documentos | documentos, residentes/asignaciones | `documentos_b2b` |
| Superadmin | institución y conteos | plan/estado comercial de institución |

## 15. Cambios mínimos recomendados para el mapa futuro

Sin cambiar rutas B2C ni datos existentes:

1. incorporar un guard único B2B que recargue usuario/institución y centralice rol, sección y `P`;
2. aplicar `P` después de resolver el `paciente_id` real del recurso en toda lectura, edición, acción y eliminación;
3. exigir filtros explícitos o autorización institucional privilegiada en endpoints de lista;
4. respetar `F` en respuestas agregadas y descargas;
5. agregar idempotency key persistida a mutaciones reenviables;
6. registrar auditoría aditiva de mutación/eliminación, sin reescribir eventos pasados;
7. reemplazar borrados físicos futuros por estados/revocación compatibles donde corresponda;
8. acompañar cada ruta con pruebas negativas entre institución, rol, asignación y estado de sesión.

Estos puntos son plan futuro, no están implementados. Su prioridad y clasificación están en `ESTADO_Y_PLAN_B2B.md`.
