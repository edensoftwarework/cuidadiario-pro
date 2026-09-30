# CONTINUIDAD_CHATGPT_B2B

## Propósito

Handoff operativo para continuar CuidaDiario PRO B2B sin depender del historial del chat. No reemplaza al código ni a los documentos canónicos. Ante divergencias prevalecen las instrucciones más recientes del usuario, las reglas de seguridad, el código comprobado y `ESTADO_Y_PLAN_B2B.md`.

## 1. Separación física y autoridad

- Copia controlada de trabajo: `C:\Cuidadiario-pro`.
- Repositorio Git real del frontend: `C:\Users\ramos\Desktop\Personal\EDEN SOFTWORK\PROYECTOS\cuidadiario-pro`.
- Codex trabaja y prueba en la copia controlada. **No publica desde `C:\Cuidadiario-pro`**, no debe inicializar Git allí y no debe tocar el repositorio real sin una instrucción posterior explícita.
- El traslado, revisión, `git add`, commit, push y despliegue son pasos posteriores bajo aprobación humana.
- Alcance exclusivo: PRO B2B. B2C está fuera de alcance; los componentes compartidos deben conservar su comportamiento.

## 2. Forma de trabajo

El usuario supervisa y autoriza despliegues y decisiones de negocio. ChatGPT coordina secuencia, agrupación, criterios de aceptación y revisión. Codex implementa y prueba únicamente dentro del alcance autorizado.

Priorizar paquetes coherentes sobre microtareas: agrupar verificaciones compatibles y evitar repetir pruebas equivalentes sin un riesgo concreto. Cada bloque conserva objetivo, evidencia, aceptación y rollback separados. No agrupar si mezcla cambios irreversibles, oculta regresiones o viola dependencias.

## 3. Estado exacto al 30/09/2026

- **P0-1:** VERIFICADO EN PRODUCCIÓN — 29/09/2026.
- **P0-2:** VERIFICADO EN ENTORNO CONTROLADO — NO DESPLEGADO.
- **P0-3:** VERIFICADO EN ENTORNO CONTROLADO — NO DESPLEGADO.
- **P0-8:** VERIFICADO EN ENTORNO CONTROLADO — NO DESPLEGADO.
- **Paquete P0-2 + P0-3 + P0-8:** **LISTO TÉCNICAMENTE PARA TRASLADO MANUAL AL REPOSITORIO REAL Y REVISIÓN HUMANA PREVIA AL DESPLIEGUE.**
- **P0-4/P0-5/P0-6/P0-7:** no iniciados.

La pasada final corrigió sólo la entrada duplicada `./login.html` de `frontend/sw.js`; `login.html` y `admin-panel.html` quedaron una vez cada uno en `STATIC_ASSETS`. `CACHE_NAME` continúa en `cuidadiario-pro-v6`; no cambiaron las estrategias P0-1.

## 4. Evidencia final local

Todas las pruebas usaron localhost, fixtures sintéticos y perfiles temporales. No hubo backend, producción, Railway, PostgreSQL, datos ni cuentas reales.

| Suite | Resultado |
|---|---:|
| `frontend/tests/p0-1-cache.test.js` | 35 PASS |
| `frontend/tests/p0-2-session.test.js` | 88 PASS |
| `frontend/tests/p0-3-offline-queue.test.js` | 37 PASS |
| `frontend/tests/p0-8-xss.test.js` | 82 PASS |
| `frontend/tests/p0-1-browser.test.js` | 69 PASS |
| `frontend/tests/p0-a-browser.test.js` | 15 PASS |
| **Total** | **326 PASS** |

Chrome `153.0.8010.48`; Node `v24.11.1`. El service worker se instaló, activó y controló el origen local; no retuvo GET B2B, preservó `/api/b2b-other`, API/cachés no-B2B y shell. La cola heredada conservó exactamente:

```text
[  {"method":"POST","path":"/api/b2b/notas","body":{"texto":"á<&>"}}  ]
```

POST/PATCH/DELETE offline fallaron de forma explícita; `online` + reload produjo cero mutaciones automáticas. Los payloads HTML/SVG/eventos/URL produjeron cero ejecución y cero nodos ejecutables, manteniendo texto legítimo, Unicode y multilínea.

## 5. Reglas que no deben perderse

- P0-2 no trata la validación local del JWT como validación criptográfica ni reemplaza P0-4.
- P0-3 no lee, parsea, modifica, borra, transmite, migra, reasigna ni reconcilia `cd_offline_queue`. Un rollback tampoco debe hacerlo.
- P0-8 neutraliza al renderizar; no reescribe datos existentes.
- P0-1 sigue siendo network-only para `/api/b2b` y `/api/b2b/...`; `/api/b2b-other` no pertenece a esa condición.
- No iniciar P0-4 o posteriores ni funciones solicitadas por Los Aromos como efecto lateral del traslado frontend.

## 6. Política de validación

La producción no es un banco de pruebas. La lógica se prueba exhaustivamente en entorno controlado. Después de un futuro despliegue frontend sólo corresponde una validación proporcional: revisión/artefactos correctos, finalización de GitHub Pages, dominio, actualización/activación/control del service worker, distribución/caché y smoke no destructivo. No repetir en producción la matriz XSS, las mutaciones offline ni pruebas con datos o cuentas reales.

Para cambios futuros de backend/base: implementar y probar con backend/PostgreSQL aislados y datos ficticios; ejecutar matrices negativas de tenant/rol/asignación/recurso; comprobar regresión B2C sin modificar B2C; preparar rollback; obtener aprobación humana; desplegar sólo lo aprobado; y hacer en producción un smoke mínimo. Las migraciones requieren backup reciente recuperable, ensayo aislado, rollback o forward-fix, aprobación y verificación agregada/no destructiva.

## 7. Próximo paso autorizado pendiente

El próximo evento es **revisión humana del paquete y traslado manual** desde la copia controlada al repositorio real, usando la lista exacta de 18 archivos runtime y su mapeo P0 de `ESTADO_Y_PLAN_B2B.md`. También deben trasladarse las suites y documentos actualizados indicados en el informe final de esta pasada.

Este handoff no autoriza copiar, usar Git, publicar, desplegar ni probar producción. Tras un traslado posterior, comparar los archivos, ejecutar la misma matriz local en el repositorio real y recién entonces decidir commit/despliegue.

## 8. Documentos canónicos

Leer, en este orden:

1. `README_PROYECTO_B2B.md`
2. `ARQUITECTURA_B2B.md`
3. `MODELO_DATOS_B2B.md`
4. `MAPA_API_B2B.md`
5. `ESTADO_Y_PLAN_B2B.md`
6. `AUDITORIA_SEGURA.md`
7. `CONTINUIDAD_CHATGPT_B2B.md`

Nunca registrar aquí secretos, credenciales, JWT, URLs privadas de base, datos de residentes ni contenido clínico real.
