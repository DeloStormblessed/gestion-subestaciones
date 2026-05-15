# gestion-subestaciones

Mini-GMAO de subestaciones eléctricas. API REST para gestionar el mantenimiento de activos eléctricos: transformadores, interruptores, seccionadores, pararrayos y baterías de condensadores. Inspirado en SAP PM e IBM Maximo, simplificado al núcleo esencial.

## 1. Stack

| Capa | Tecnología |
|---|---|
| Runtime | Node.js 18+ (módulos ESM) |
| Framework HTTP | Express 4 |
| ORM | Prisma 5 |
| Base de datos | PostgreSQL 16 (en Docker) |
| Autenticación | JSON Web Tokens (`jsonwebtoken`) + `bcryptjs` |
| Validación | Zod |
| Tests unidad/integración | Vitest + Supertest |
| Tests end-to-end | Newman (Postman CLI) |

## 2. Estructura del proyecto

Arquitectura **feature-based con capa de servicios**: una carpeta por dominio dentro de `backend/features/`, cada una con `controller.js` (adaptador HTTP delgado), `service.js` (lógica de negocio), `routes.js` (montaje de rutas y middleware) y `schema.js` (validación Zod).

```
gestion-subestaciones/
├── docker-compose.yml              # Postgres en local
├── backend/
│   ├── app.js                      # Composición de Express y montaje de routers
│   ├── server.js                   # Entry point (arranca app.listen)
│   ├── features/
│   │   ├── auth/                   # registro, login, perfil
│   │   ├── usuarios/               # CRUD de usuarios (ADMIN-only)
│   │   ├── subestaciones/          # CRUD de subestaciones
│   │   ├── activos/                # CRUD activos + OTs anidadas + etiquetas
│   │   ├── ordenes-trabajo/        # listado global de OTs
│   │   ├── etiquetas/              # CRUD de etiquetas
│   │   └── dashboard/              # KPIs agregados
│   ├── middleware/                 # auth (verificarToken, requireRol), validate, errorHandler
│   ├── lib/                        # prisma client, paginación, transiciones, webhook, etc.
│   ├── prisma/
│   │   ├── schema.prisma           # Modelos, enums y relaciones
│   │   ├── migrations/             # Historial de migraciones
│   │   └── seed.js                 # Datos de demostración
│   ├── tests/                      # Suite Vitest + Supertest
│   └── postman/                    # Colección y environment para Newman
```

## 3. Puesta en marcha

Asume Node 18+ y Docker instalados.

```bash
# 1. Clonar el repositorio
git clone <url> gestion-subestaciones
cd gestion-subestaciones

# 2. Levantar PostgreSQL (desde la raíz, donde vive docker-compose.yml)
docker compose up -d

# 3. Instalar dependencias del backend
cd backend
npm install

# 4. Configurar variables de entorno (los valores por defecto funcionan en local)
cp .env.example .env

# 5. Aplicar migraciones a la BD
npx prisma migrate deploy

# 6. Sembrar datos de demostración
node prisma/seed.js

# 7. Arrancar el servidor en modo desarrollo
npm run dev
```

La API queda escuchando en `http://localhost:3000/api/v1`.

Comprobación rápida:

```bash
curl -X POST http://localhost:3000/api/v1/auth/login \
  -H "Content-Type: application/json" \
  -d '{"email":"admin@gmao.com","password":"admin123"}'
```

## 4. Variables de entorno

Definidas en `backend/.env.example`. Cópialo a `backend/.env` y ajusta si hace falta.

| Variable | Descripción | Valor por defecto (desarrollo) |
|---|---|---|
| `DATABASE_URL` | Cadena de conexión PostgreSQL (formato Prisma) | `postgresql://gmao:gmao_dev_password@localhost:5432/gestion_subestaciones` |
| `JWT_SECRET` | Secreto para firmar tokens JWT | `cambia-esto-en-produccion-con-un-valor-aleatorio-largo` |
| `PORT` | Puerto HTTP del servidor | `3000` |
| `WEBHOOK_URL` | URL del webhook de n8n para notificar averías y correctivos | `""` (vacío = no se dispara) |

## 5. Usuarios de demostración

Tras ejecutar `node prisma/seed.js`, la BD contiene cinco usuarios. Estas credenciales son **solo para desarrollo y demostración**; no deben reutilizarse en producción.

| Email | Contraseña | Rol | Nombre |
|---|---|---|---|
| `admin@gmao.com` | `admin123` | ADMIN | Ana Administradora |
| `tecnico@gmao.com` | `tecnico123` | TECNICO | Tomás Técnico |
| `tecnico2@gmao.com` | `tecnico123` | TECNICO | Teresa Técnica |
| `operario@gmao.com` | `operario123` | OPERARIO | Óscar Operario |
| `operario2@gmao.com` | `operario123` | OPERARIO | Olivia Operaria |

## 6. Endpoints

Todos cuelgan del prefijo `/api/v1`. Salvo registro y login, requieren cabecera `Authorization: Bearer <token>`. La autorización por rol se aplica en cada `routes.js` con `requireRol(...)`.

### Auth (`/api/v1/auth`)

| Método | Ruta | Descripción | Acceso |
|---|---|---|---|
| POST | `/registro` | Alta pública (siempre crea con rol OPERARIO) | público |
| POST | `/login` | Devuelve `{ usuario, token }` | público |
| GET | `/perfil` | Datos actualizados del usuario del token | autenticado |

### Usuarios (`/api/v1/usuarios`)

| Método | Ruta | Descripción | Acceso |
|---|---|---|---|
| GET | `/` | Listar con filtros `rol`, `activo` | ADMIN |
| GET | `/:id` | Detalle | ADMIN |
| PATCH | `/:id/rol` | Cambiar rol (no permite modificar el rol propio) | ADMIN |
| PATCH | `/:id/activacion` | Activar/desactivar (soft delete; no sobre sí mismo) | ADMIN |

### Subestaciones (`/api/v1/subestaciones`)

| Método | Ruta | Descripción | Acceso |
|---|---|---|---|
| GET | `/` | Listar con filtros `activa`, `tensionMin`, `tensionMax` | autenticado |
| GET | `/:id` | Detalle | autenticado |
| POST | `/` | Crear | ADMIN |
| PUT | `/:id` | Editar | ADMIN |
| PATCH | `/:id/activacion` | Activar/desactivar (soft delete) | ADMIN |

### Activos (`/api/v1/activos`)

| Método | Ruta | Descripción | Acceso |
|---|---|---|---|
| GET | `/` | Listar con filtros `subestacionId`, `tipo`, `estado`, `etiqueta`, `busqueda`, `inspeccionVencida` | autenticado |
| GET | `/:id` | Detalle (con últimas 10 OTs y etiquetas asociadas) | autenticado |
| POST | `/` | Crear (atómico: activo + OT INSTALACION en transacción) | TECNICO, ADMIN |
| PUT | `/:id` | Editar `fabricante`, `modelo`, `numeroSerie` | TECNICO, ADMIN |
| GET | `/:id/ordenes-trabajo` | Historial paginado completo del activo | autenticado |
| POST | `/:id/ordenes-trabajo` | Registrar OT (aplica Reglas A y B; ver §7) | OPERARIO solo INSPECCION; TECNICO, ADMIN cualquier tipo |
| POST | `/:id/etiquetas` | Asociar etiquetas al activo (semántica `set` total) | TECNICO, ADMIN |

### Órdenes de trabajo (`/api/v1/ordenes-trabajo`)

| Método | Ruta | Descripción | Acceso |
|---|---|---|---|
| GET | `/` | Listado global con filtros `tipo`, `autorId`, `activoId`, `fechaDesde`, `fechaHasta` | autenticado |

Las OTs son inmutables: no hay PUT ni DELETE. Se crean anidadas bajo `/activos/:id/ordenes-trabajo`.

### Etiquetas (`/api/v1/etiquetas`)

| Método | Ruta | Descripción | Acceso |
|---|---|---|---|
| GET | `/` | Listar todas (con conteo de activos por etiqueta) | autenticado |
| POST | `/` | Crear | TECNICO, ADMIN |
| DELETE | `/:id` | Borrar (único hard delete del proyecto) | ADMIN |

### Dashboard (`/api/v1/dashboard`)

| Método | Ruta | Descripción | Acceso |
|---|---|---|---|
| GET | `/` | KPIs agregados: distribución por estado, inspecciones vencidas, top de activos, OTs últimos 30 días por tipo | autenticado |

### Paginación

Todos los listados aceptan `?pagina=N&limite=M` (defaults `1`/`20`, máximo `limite=100`). La respuesta tiene la forma:

```json
{
  "datos": [ /* ... */ ],
  "paginacion": {
    "pagina": 1,
    "limite": 20,
    "total": 18,
    "totalPaginas": 1
  }
}
```

## 7. Reglas de negocio

### Regla A — Máquina de estados del Activo

Función pura en `backend/lib/transiciones.js`. Aplicada **dentro de una transacción Prisma** al registrar una OT, junto con la creación de la propia OT y la actualización del activo. Si la celda está prohibida, se lanza `ReglaNegocio` y Prisma hace rollback.

Matriz `estado actual × tipo OT → estado nuevo` (❌ = transición no permitida):

| Estado actual | INSPECCION | PREVENTIVO | CORRECTIVO | INSTALACION | BAJA |
|---|---|---|---|---|---|
| `EN_SERVICIO` | `CONFORME` → `EN_SERVICIO` · `NO_CONFORME` → `AVERIADO` | `FUERA_DE_SERVICIO` | `FUERA_DE_SERVICIO` | ❌ | `DADO_DE_BAJA` |
| `AVERIADO` | `AVERIADO` (no-op) | ❌ | `FUERA_DE_SERVICIO` | ❌ | `DADO_DE_BAJA` |
| `FUERA_DE_SERVICIO` | `FUERA_DE_SERVICIO` (no-op) | ❌ | `EN_SERVICIO` | ❌ | `DADO_DE_BAJA` |
| `DADO_DE_BAJA` | ❌ | ❌ | ❌ | `EN_SERVICIO` | ❌ |

La INSPECCION sobre `EN_SERVICIO` es el único caso donde el resultado modifica la transición; en `AVERIADO` y `FUERA_DE_SERVICIO` es no-op pero el resultado sigue siendo obligatorio en el body.

### Regla B — Bloqueo por inspección vencida

Si `activo.fechaProximaInspeccion < hoy`, **no se permite registrar una OT de tipo `PREVENTIVO`**. El operario o técnico debe registrar antes una `INSPECCION` (que recalcula `fechaProximaInspeccion` al cerrar con `CONFORME`, usando el intervalo de `lib/intervalos-inspeccion.js` según el tipo de activo).

Se evalúa **antes** de abrir la transacción: si bloquea, no se toca BD ni se dispara webhook.

## 8. Tests

Dos capas independientes:

```bash
# Suite Vitest + Supertest (unidad e integración contra el código).
# Requiere PostgreSQL corriendo. Reutiliza la BD configurada en .env.
npm test

# Suite Newman (end-to-end contra la API en ejecución).
# Requiere que el servidor esté arrancado y la BD sembrada con node prisma/seed.js.
npm run test:api
```

Vitest cubre lógica de servicios, transiciones, paginación, autorización y validaciones. Newman ejecuta la colección Postman recorriendo flujos completos: logins, creación de subestación → activo → OT → etiqueta, y demos de denegación 403.

## 9. Base normativa

Términos y resultados del modelo se apoyan en normativa del sector:

- **UNE-EN 13306** — *Terminología del mantenimiento*. Origen del término "activo", los tipos de mantenimiento (`PREVENTIVO`, `CORRECTIVO`, `INSPECCION`) y los resultados de inspección (`CONFORME`, `NO_CONFORME`, §4.4 Conformidad).
- **IEC 81346-2** — *Sistemas industriales, instalaciones y equipos. Designación de referencia*. La codificación de `Activo.codigo` la sigue de forma pragmática:
  - `T-` transformador de potencia
  - `TT-` transformador de medida (variante de uso habitual en España)
  - `QA-` interruptor automático
  - `QB-` seccionador
  - `F-` descargador de sobretensión (pararrayos)
  - `C-` batería de condensadores
- **UNE-EN 60099** — *Pararrayos. Descargadores de sobretensión*. Norma específica del tipo `PARARRAYOS`; en el enum se conserva el término coloquial por reconocibilidad, sin perjuicio de la designación normativa.

## 10. Decisiones de diseño destacables

- **Arquitectura feature-based con capa de servicios.** Cada dominio se aísla en su carpeta con `routes/controller/service/schema`; la lógica de negocio vive en los services, los controllers son adaptadores HTTP delgados.
- **OrdenTrabajo inmutable** (sin `PUT` ni `DELETE`, sin `updatedAt`). El histórico de mantenimiento tiene valor auditable; las correcciones se asientan como nuevas OTs.
- **Snapshot `estadoAnterior`/`estadoNuevo` en cada OT.** El histórico es autosuficiente: aunque la matriz de transiciones cambie en el futuro, las OTs antiguas siguen siendo consultables sin re-ejecutar la lógica vigente.
- **Soft delete en `Usuario` y `Subestacion`** (campo `activo`/`activa`), **baja por OT en `Activo`** (estado `DADO_DE_BAJA`). Preserva la integridad referencial del histórico (`onDelete: Restrict` en todas las FKs).
- **Webhook a n8n** en eventos `ot.correctivo` y `ot.averia_detectada`, no email directo. Desacopla el canal de notificación y permite cambiar destino/formato sin tocar el backend.
- **IDs `cuid()` para entidades públicas, `Int autoincrement` solo para `Etiqueta`.** Evita enumeración de recursos en URLs; la etiqueta es metadato interno sin valor histórico.
- **Prefijo `/api/v1/`** en todas las rutas. Preparación para versionado futuro sin migración traumática.

## 11. Colección Postman

Los dos JSON viven en `backend/postman/`:

- `gestion-subestaciones.postman_collection.json` — colección v2.1 con las 24 peticiones organizadas en 7 carpetas, más 3 peticiones `[demo 403]` para demostrar el modelo de autorización.
- `gestion-subestaciones.postman_environment.json` — environment con `baseUrl` y las variables dinámicas (`tokenAdmin`, `tokenTecnico`, `tokenOperario`, `subestacionId`, `activoId`, `usuarioId`, `etiquetaId`) que la colección rellena sola al ejecutarse.

**Importar en Postman Desktop:** `File → Import` → seleccionar los dos JSON → seleccionar el environment arriba a la derecha → ejecutar con Collection Runner.

**Ejecutar con Newman:**

```bash
npm run test:api
```

La colección es idempotente: los códigos de subestación, códigos y números de serie de activo, nombres de etiqueta y email del registro se generan con sufijo `Date.now()` en prerequest-scripts, de modo que pueda ejecutarse N veces sin chocar con `@unique` de Prisma.

## 12. Ampliaciones futuras

Quedan explícitamente fuera del alcance actual y son extensiones naturales para próximas iteraciones:

- Cron que genere automáticamente OTs de mantenimiento preventivo a partir de `fechaProximaInspeccion`.
- Ciclo de vida ampliado de la OT (estados `PENDIENTE` / `EN_CURSO` / `CERRADA`) en lugar del modelo inmutable actual.
- Jerarquía de ubicaciones: `Subestacion → Bahía → Posición → Activo`.
- Adjuntos en OTs (fotos de campo, PDFs de informes).
- Refresh tokens y revocación granular de JWT.
- Búsqueda full-text sobre activos y OTs con `tsvector` de PostgreSQL.
- Frontend React consumiendo esta API.
- Despliegue automatizado (CI/CD, contenedor del backend, BD gestionada).
