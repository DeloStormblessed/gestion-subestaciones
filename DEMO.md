# Demo — gestion-subestaciones

## Preparación (antes de los 4 min)

```bash
# Terminal 1 — dejar corriendo durante toda la demo
docker compose up -d
cd backend && npm run dev

# Terminal 2 — ejecutar y cerrar
cd backend && node prisma/seed.js
```

> Si antes ejecutas `npm test`, vuelve a correr `node prisma/seed.js` porque los tests limpian la BD.

### Importar en Postman (solo la primera vez)

1. `File → Import` → seleccionar los dos archivos de `backend/postman/`:
   - `gestion-subestaciones.postman_collection.json`
   - `gestion-subestaciones.postman_environment.json`
2. Arriba a la derecha seleccionar el environment **`gestion-subestaciones`**
3. En el panel izquierdo abrir la carpeta **`★ DEMO 4min`**

---

## Los 4 minutos

Ejecutar cada request en orden. Pulsar **Send** y señalar lo relevante.

### 01 · Login Admin
**Qué señalar:** el token JWT en la respuesta y el campo `rol: "ADMIN"` dentro del objeto `usuario`.

### 02 · Listar subestaciones
**Qué señalar:** estructura de respuesta paginada `{ datos: [...], paginacion: { pagina, limite, total, totalPaginas } }` con los datos del seed.

### 03 · Crear activo
**Qué señalar:** la respuesta 201 incluye `estado: "EN_SERVICIO"` — el activo se crea directamente operativo porque la creación genera una OT de tipo `INSTALACION` en la misma transacción de base de datos.

### 04 · OT INSPECCION NO_CONFORME
**Qué señalar:** los campos `estadoAnterior: "EN_SERVICIO"` y `estadoNuevo: "AVERIADO"` en la respuesta — la máquina de estados en acción. Si `WEBHOOK_URL` estuviera configurada, aquí se dispararía el evento `ot.averia_detectada` a n8n.

### 05 · OT CORRECTIVO (AVERIADO → FUERA_DE_SERVICIO)
**Qué señalar:** `estadoAnterior: "AVERIADO"` → `estadoNuevo: "FUERA_DE_SERVICIO"` — el activo entra en reparación. Este evento también dispara el webhook `ot.correctivo`.

### 06 · OT CORRECTIVO (FUERA_DE_SERVICIO → EN_SERVICIO)
**Qué señalar:** `estadoAnterior: "FUERA_DE_SERVICIO"` → `estadoNuevo: "EN_SERVICIO"` — reparación completada. Ciclo de avería completo: detectada → en reparación → resuelta.

### 07 · Login Operario
**Qué señalar:** mismo endpoint de auth, diferente credencial. El token ahora contiene `rol: "OPERARIO"`.

### 08 · [demo 403] Operario intenta OT PREVENTIVO
**Qué señalar:** HTTP 403 con mensaje `"Los operarios solo pueden registrar OTs de tipo INSPECCION"` — autorización granular por rol y por tipo de operación, no solo por endpoint.

### 09a · Crear etiqueta "Alta Tensión"
**Qué señalar:** creación con color hex `#FF5733`. La respuesta incluye `_count: { activos: 0 }` — aún sin asociar.

### 09b · Asociar etiqueta al activo
**Qué señalar:** semántica `set` total — el body `{ etiquetaIds: [...] }` reemplaza el conjunto completo de etiquetas del activo. La respuesta muestra el activo con la etiqueta ya asociada.

### 10 · Dashboard
**Qué señalar:** `activosPorEstado` refleja el activo que acabamos de reparar en `EN_SERVICIO`; `otsUltimos30DiasPorTipo` muestra las OTs creadas durante la demo. Todas las claves de enum están siempre presentes (aunque sean 0) para estabilidad de gráficos.

---

## Si sobra tiempo (~30 s)

En una terminal aparte, ejecutar los tests automatizados:

```bash
cd backend && npm test
```

162 tests en verde sobre 8 suites: auth, transiciones, activos, órdenes de trabajo, subestaciones, etiquetas, usuarios y dashboard.
