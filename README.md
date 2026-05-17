# gestion-subestaciones

Mini-GMAO (Gestión del Mantenimiento Asistido por Ordenador) de subestaciones eléctricas. API REST para llevar inventario y ciclo de vida de mantenimiento de transformadores, interruptores automáticos, seccionadores, pararrayos y baterías de condensadores. Inspirado en SAP PM e IBM Maximo, reducido al núcleo de dominio.

Solo backend. Frontend, refresh tokens y CI/CD quedan explícitamente fuera del scope actual (ver [Roadmap](#roadmap)).

## Stack

| Capa | Tecnología |
| --- | --- |
| Runtime | Node.js 18+ (ESM puro) |
| HTTP | Express 4 |
| ORM | Prisma 5 |
| BD | PostgreSQL 16 (Docker) |
| Auth | JWT (`jsonwebtoken`) + `bcryptjs` |
| Validación | Zod |
| Tests | Vitest + Supertest (unidad/integración) · Newman + Postman (E2E) |

## Arranque rápido

Requisitos: Node 18+ y Docker.

```bash
git clone <repo> gestion-subestaciones
cd gestion-subestaciones

docker compose up -d                          # PostgreSQL en :5432

cd backend
npm install
cp .env.example .env                          # valores por defecto OK para local
npx prisma migrate deploy
node prisma/seed.js                           # 5 usuarios, 4 subestaciones, 18 activos, ~25 OTs
npm run dev                                   # API en http://localhost:3000/api/v1
```

Verificación rápida:

```bash
curl -X POST http://localhost:3000/api/v1/auth/login \
  -H "Content-Type: application/json" \
  -d '{"email":"admin@gmao.com","password":"admin123"}'
```

### Credenciales demo

Solo desarrollo. **No reutilizar en producción.**

| Email | Password | Rol |
| --- | --- | --- |
| `admin@gmao.com` | `admin123` | ADMIN |
| `tecnico@gmao.com` · `tecnico2@gmao.com` | `tecnico123` | TECNICO |
| `operario@gmao.com` · `operario2@gmao.com` | `operario123` | OPERARIO |

### Variables de entorno

| Variable | Defecto | Notas |
| --- | --- | --- |
| `DATABASE_URL` | `postgresql://gmao:gmao_dev_password@localhost:5432/gestion_subestaciones` | Coincide con `docker-compose.yml` |
| `JWT_SECRET` | (placeholder) | Cambiar a un valor aleatorio largo en producción |
| `PORT` | `3000` | — |
| `WEBHOOK_URL` | `""` | Vacío = no se notifica a n8n (modo dev) |

## Estructura

Arquitectura **feature-based** con servicios puros. Una carpeta por dominio, mismo patrón de cuatro archivos en cada una:

```
backend/
├── app.js                # Composición Express (montaje de routers + errorHandler)
├── server.js             # Entry point (app.listen)
├── features/
│   ├── auth/             # registro, login, perfil
│   ├── usuarios/         # CRUD admin-only
│   ├── subestaciones/    # CRUD + activación con guardarraíl
│   ├── activos/          # CRUD + OTs anidadas + etiquetas (núcleo del proyecto)
│   ├── ordenes-trabajo/  # solo listado global (OTs inmutables)
│   ├── etiquetas/        # CRUD + asociación N:M
│   └── dashboard/        # KPIs agregados
├── middleware/           # verificarToken, requireRol, validate, errorHandler
├── lib/                  # prisma, transiciones, intervalos, webhook, errores, paginacion
├── prisma/               # schema.prisma, migrations/, seed.js
├── tests/                # 8 suites Vitest + helper limpiar-bd
└── postman/              # colección y environment (E2E con Newman)
```

Dentro de cada feature: `routes.js` (rutas + middleware) · `controller.js` (adaptador HTTP delgado) · `service.js` (lógica de negocio) · `schema.js` (validación Zod).

Los services son puros: reciben datos planos, devuelven datos planos, lanzan errores del dominio definidos en `lib/errores.js`. Sin `req`/`res`. Testeables sin Express.

## Modelo de dominio

### Entidades

- **Usuario** — id `cuid()`, `passwordHash` (nombre explícito, nunca `password`), `rol` enum, soft delete con flag `activo`.
- **Subestacion** — código funcional (`SE-NORTE-220`), tensión nominal en kV, soft delete con flag `activa`.
- **Activo** — código funcional con prefijo IEC 81346-2 (`T-`, `TT-`, `QA-`, `QB-`, `F-`, `C-`), `estado` enum, `fechaProximaInspeccion` **almacenada** (no calculada al vuelo: la usan Regla B, dashboard y filtros de listado).
- **OrdenTrabajo (OT)** — **inmutable**: sin `updatedAt`, sin endpoints `PUT` ni `DELETE`. Lleva snapshot `estadoAnterior` / `estadoNuevo` para que el histórico sea autosuficiente aunque la lógica cambie en el futuro.
- **Etiqueta** — único modelo con `Int autoincrement` (metadato interno, no recurso navegable). Relación N:M con Activo vía tabla join implícita.

Todas las FKs declaran `onDelete: Restrict`, salvo las dos de la tabla join `_ActivosEtiquetas` (que son `CASCADE` para permitir el único hard delete del proyecto).

### Roles

| Rol | Puede |
| --- | --- |
| OPERARIO | Lectura completa. OTs **solo de tipo `INSPECCION`**. (Rol por defecto del registro público.) |
| TECNICO | Lo anterior + crear/editar activos, asociar etiquetas, registrar OTs de cualquier tipo. |
| ADMIN | Todo lo anterior + gestión de usuarios, subestaciones y borrado de etiquetas. |

### Enums clave

- **EstadoActivo**: `EN_SERVICIO`, `AVERIADO`, `FUERA_DE_SERVICIO` (≡ "en descargo" en jerga del sector eléctrico), `DADO_DE_BAJA`.
- **TipoActivo**: `TRANSFORMADOR_POTENCIA`, `INTERRUPTOR_AUTOMATICO`, `SECCIONADOR`, `PARARRAYOS`, `TRANSFORMADOR_MEDIDA`, `BATERIA_CONDENSADORES`.
- **TipoOrdenTrabajo**: `INSPECCION`, `PREVENTIVO`, `CORRECTIVO`, `INSTALACION`, `BAJA`.
- **ResultadoInspeccion**: `CONFORME`, `NO_CONFORME` (terminología UNE-EN 13306 §4.4).

## Endpoints

Todo bajo `/api/v1`. Cabecera `Authorization: Bearer <token>` requerida salvo en registro y login. Los listados aceptan `?pagina=N&limite=M` (defaults 1/20, máximo 100) y devuelven `{ datos, paginacion: { pagina, limite, total, totalPaginas } }`.

### Auth · `/auth`
| Método | Ruta | Acceso |
| --- | --- | --- |
| POST | `/registro` | público (fuerza `rol=OPERARIO`, ignora cualquier `rol` enviado en body) |
| POST | `/login` | público |
| GET | `/perfil` | autenticado |

### Usuarios · `/usuarios` (todo ADMIN)
| Método | Ruta | Notas |
| --- | --- | --- |
| GET | `/` · `/:id` | filtros: `rol`, `activo` |
| PATCH | `/:id/rol` | no permite modificar el rol propio |
| PATCH | `/:id/activacion` | no permite desactivarse a uno mismo |

### Subestaciones · `/subestaciones`
| Método | Ruta | Acceso |
| --- | --- | --- |
| GET | `/` · `/:id` | autenticado · filtros: `activa`, `tensionMin`, `tensionMax` |
| POST · PUT | `/` · `/:id` | ADMIN |
| PATCH | `/:id/activacion` | ADMIN · bloquea desactivar si hay activos no `DADO_DE_BAJA` |

### Activos · `/activos`
| Método | Ruta | Acceso |
| --- | --- | --- |
| GET | `/` · `/:id` | autenticado · filtros: `subestacionId`, `tipo`, `estado`, `etiqueta`, `busqueda`, `inspeccionVencida` |
| POST | `/` | TECNICO+ · crea activo + OT `INSTALACION` **atómicamente** |
| PUT | `/:id` | TECNICO+ · edita `fabricante`, `modelo`, `numeroSerie` |
| GET | `/:id/ordenes-trabajo` | autenticado · historial paginado |
| POST | `/:id/ordenes-trabajo` | OPERARIO solo `INSPECCION` · TECNICO+ cualquier tipo · aplica Reglas A y B |
| POST | `/:id/etiquetas` | TECNICO+ · semántica `set` (reemplazo total) |

### Órdenes de trabajo · `/ordenes-trabajo`
| Método | Ruta | Notas |
| --- | --- | --- |
| GET | `/` | autenticado · filtros: `tipo`, `autorId`, `activoId`, `fechaDesde`, `fechaHasta` |

No hay POST/PUT/DELETE: las OTs nacen anidadas bajo activo y son **inmutables**.

### Etiquetas · `/etiquetas`
| Método | Ruta | Acceso |
| --- | --- | --- |
| GET | `/` | autenticado · incluye `_count` de activos por etiqueta |
| POST | `/` | TECNICO+ |
| DELETE | `/:id` | ADMIN · **único hard delete del proyecto** |

### Dashboard · `/dashboard`
| Método | Ruta | Devuelve |
| --- | --- | --- |
| GET | `/` | `activosPorEstado`, `inspeccionesVencidas`, `topInspeccionesAtrasadas`, `otsUltimos30DiasPorTipo`, `ultimasOrdenesTrabajo` |

## Reglas de negocio

El núcleo no trivial del proyecto. Ambas se aplican al registrar una OT en `POST /activos/:id/ordenes-trabajo`.

### Regla A — Máquina de estados del activo

Implementada como **función pura** en `lib/transiciones.js`. Se aplica **dentro de una transacción Prisma** junto con la creación de la OT, la actualización del activo y (si procede) el recálculo de `fechaProximaInspeccion`. Si la celda está prohibida, lanza `ReglaNegocio` (HTTP 422) y la transacción hace rollback.

| Estado actual | INSPECCION | PREVENTIVO | CORRECTIVO | INSTALACION | BAJA |
| --- | --- | --- | --- | --- | --- |
| `EN_SERVICIO` | CONFORME → `EN_SERVICIO` · NO_CONFORME → `AVERIADO` | `FUERA_DE_SERVICIO` | `FUERA_DE_SERVICIO` | ❌ | `DADO_DE_BAJA` |
| `AVERIADO` | `AVERIADO` (no-op) | ❌ | `FUERA_DE_SERVICIO` | ❌ | `DADO_DE_BAJA` |
| `FUERA_DE_SERVICIO` | `FUERA_DE_SERVICIO` (no-op) | ❌ | `EN_SERVICIO` | ❌ | `DADO_DE_BAJA` |
| `DADO_DE_BAJA` | ❌ | ❌ | ❌ | `EN_SERVICIO` | ❌ |

`INSPECCION` sobre `EN_SERVICIO` es el único caso donde el `resultado` modifica la transición. En `AVERIADO`/`FUERA_DE_SERVICIO` la inspección es no-op pero `resultado` sigue siendo obligatorio (una OT sin veredicto no tiene sentido auditable).

### Regla B — Bloqueo por inspección vencida

Si `activo.fechaProximaInspeccion < hoy`, **no se permite registrar `PREVENTIVO`**. Hay que cerrar primero una `INSPECCION CONFORME`, que recalcula `fechaProximaInspeccion` usando el intervalo por tipo de activo (`lib/intervalos-inspeccion.js`):

| Tipo | Intervalo |
| --- | --- |
| `SECCIONADOR` | 90 días |
| `TRANSFORMADOR_POTENCIA` · `BATERIA_CONDENSADORES` | 180 días |
| `INTERRUPTOR_AUTOMATICO` · `PARARRAYOS` · `TRANSFORMADOR_MEDIDA` | 365 días |

Se evalúa **antes** de abrir la transacción: si bloquea, no se toca BD ni se dispara webhook.

## Decisiones de diseño

- **OT inmutable**. Sin `PUT` ni `DELETE`. Las correcciones se asientan como OTs nuevas. El histórico tiene valor auditable.
- **Snapshot `estadoAnterior`/`estadoNuevo`** en cada OT. Si la matriz cambia en el futuro, las OTs antiguas siguen siendo legibles sin reproducir la lógica vigente.
- **Atomicidad: crear activo + OT INSTALACION** ocurren en `prisma.$transaction`. No hay activos sin su OT de origen.
- **Regla B fuera de la transacción, Regla A dentro**. Fail-fast antes de abrir BD; rollback automático si la transición es inválida.
- **Webhook tras el commit, async sin `await`**. Disparado solo en eventos críticos (`ot.correctivo`, `ot.averia_detectada`). Si rollback hubiera, no se notifica. Si n8n falla, la OT sigue válida. `WEBHOOK_URL` vacía = no-op. Timeout de 5s con `AbortController`.
- **Soft delete asimétrico**. `Usuario`/`Subestacion` con flag booleano. `Activo` mediante estado `DADO_DE_BAJA` (preserva FKs `onDelete: Restrict`). `Etiqueta` es el único hard delete del proyecto.
- **`passwordHash` (no `password`)** como nombre de campo. Primera línea de defensa contra fugas. Helper `sinPasswordHash` + constante `CAMPOS_PUBLICOS` en cada query de usuario refuerzan el patrón.
- **Mensajes de error genéricos en login**. "Credenciales incorrectas" para email inexistente, password incorrecta y usuario desactivado: evita enumeración.
- **Autoprotección del ADMIN**. No puede modificar su propio rol ni desactivarse a sí mismo (`ReglaNegocio` 422).
- **Desactivación de subestación bloqueada si hay activos vivos**. No dejar activos huérfanos en una sub apagada.
- **IDs `cuid()` para entidades públicas**, `Int autoincrement` solo para `Etiqueta`. Evita enumeración de recursos en URLs.
- **Aritmética de fechas en UTC** (`setUTCDate`). Evita derivas por zona horaria en el filtro de inspecciones vencidas alrededor del cambio de día.
- **Dashboard rellena claves de enum con 0** cuando `groupBy` no devuelve datos para un grupo. Estabilidad para gráficos del frontend (no aparecen/desaparecen barras).
- **Dashboard excluye `DADO_DE_BAJA`** de "inspecciones vencidas" y del top: un activo retirado no se inspecciona.
- **Autorización híbrida en OTs**: rol + contenido del body. `OPERARIO` solo puede registrar `INSPECCION`; resto cualquier tipo. Middleware a medida en `features/activos/routes.js`.
- **Prefijo `/api/v1/`** en todas las rutas. Preparado para versionado futuro.

## Tests

```bash
npm test           # Vitest + Supertest (unidad e integración contra BD)
npm run test:api   # Newman contra API en ejecución (E2E)
```

**8 suites Vitest**: `auth`, `usuarios`, `subestaciones`, `activos`, `ordenes-trabajo`, `etiquetas`, `dashboard` y `transiciones` (esta última testea la función pura sin BD). Cada suite se autoabastece de fixtures en `beforeAll` y limpia con el helper compartido `tests/lib/limpiar-bd.js`. El webhook se mockea con `vi.mock` para verificar llamadas sin tocar n8n.

**Newman** ejecuta la colección Postman contra la API real. Los códigos únicos se generan con `Date.now()` en pre-request scripts → la colección es **idempotente** y se puede ejecutar N veces sin chocar con los `@unique` de Prisma.

> Los tests Vitest limpian la BD. Si quieres usar la API después de ejecutarlos, vuelve a correr `node prisma/seed.js`.

## Postman

Importar los dos JSON de `backend/postman/` en Postman Desktop y seleccionar el environment `gestion-subestaciones (local)`. Carpetas de la colección:

- **★ DEMO 4min** — 11 requests numeradas que recorren un ciclo de avería completo: login admin → crear activo → `INSPECCION NO_CONFORME` → `CORRECTIVO` → `CORRECTIVO` → cambio a operario → demo 403 → etiquetas → dashboard. Los nombres declaran la transición esperada (ej. `[EN_SERVICIO → AVERIADO]`) y los test scripts la verifican.
- **Auth · Subestaciones · Activos · Órdenes de Trabajo · Etiquetas · Usuarios · Dashboard** — cobertura por feature.
- **Peticiones `[demo 403]`** — tres requests específicas que demuestran el modelo de autorización: operario intentando crear subestación, operario intentando `PREVENTIVO`, técnico intentando borrar etiqueta.

Las requests guardan en el environment las variables que las siguientes necesitan (`tokenAdmin`, `subestacionId`, `activoId`, `etiquetaId`...), así que **basta con ejecutar la colección en orden con el Runner**.

Ver [`DEMO.md`](DEMO.md) para el guion paso a paso de la demo de 4 minutos.

## Base normativa

El modelo se apoya en normativa real del sector:

- **UNE-EN 13306** — Terminología del mantenimiento. Origen de los tipos `PREVENTIVO` / `CORRECTIVO` / `INSPECCION` y de los resultados `CONFORME` / `NO_CONFORME` (§4.4 Conformidad).
- **IEC 81346-2** — Designación de referencia. Prefijos del `Activo.codigo`:
  - `T-` transformador de potencia · `TT-` transformador de medida (uso habitual en España)
  - `QA-` interruptor automático · `QB-` seccionador
  - `F-` descargador de sobretensión (pararrayos) · `C-` batería de condensadores
- **UNE-EN 60099** — Pararrayos. El enum mantiene "PARARRAYOS" por reconocibilidad sobre la designación normativa "descargador de sobretensión".

## Roadmap

Fuera del scope actual; extensiones naturales para próximas iteraciones:

- Cron de generación automática de `PREVENTIVO`s a partir de `fechaProximaInspeccion`.
- Ciclo de vida ampliado de la OT (estados `PENDIENTE` / `EN_CURSO` / `CERRADA`) en lugar del modelo inmutable.
- Jerarquía de ubicaciones: `Subestacion → Bahía → Posición → Activo`.
- Adjuntos en OTs (fotos de campo, PDFs de informes).
- Refresh tokens y revocación granular de JWT.
- Búsqueda full-text sobre activos y OTs con `tsvector`.
- Frontend React consumiendo esta API.
- CI/CD con despliegue automatizado del backend y BD gestionada.