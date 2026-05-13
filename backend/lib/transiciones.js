// backend/lib/transiciones.js

import { ReglaNegocio } from "./errores.js";

// Matriz de transiciones (scope §7 regla A).
// MATRIZ[estadoActual][tipoOT] = estadoNuevo, o null si la transición está prohibida.
//
// El caso EN_SERVICIO + INSPECCION queda fuera de la matriz porque depende
// del resultadoInspeccion (OK → EN_SERVICIO; AVERIA_DETECTADA → AVERIADO).
// El resto de combinaciones con INSPECCION sí van en la matriz porque ignoran
// el resultado (un activo AVERIADO sigue AVERIADO se inspeccione como se inspeccione;
// para repararlo hace falta un CORRECTIVO).
const MATRIZ = {
  EN_SERVICIO: {
    // INSPECCION → tratado aparte (depende de resultadoInspeccion)
    PREVENTIVO: "FUERA_DE_SERVICIO",
    CORRECTIVO: "FUERA_DE_SERVICIO",
    INSTALACION: null,
    BAJA: "DADO_DE_BAJA",
  },
  AVERIADO: {
    INSPECCION: "AVERIADO",
    PREVENTIVO: null,
    CORRECTIVO: "FUERA_DE_SERVICIO",
    INSTALACION: null,
    BAJA: "DADO_DE_BAJA",
  },
  FUERA_DE_SERVICIO: {
    INSPECCION: "FUERA_DE_SERVICIO",
    PREVENTIVO: null,
    CORRECTIVO: "EN_SERVICIO",
    INSTALACION: null,
    BAJA: "DADO_DE_BAJA",
  },
  DADO_DE_BAJA: {
    INSPECCION: null,
    PREVENTIVO: null,
    CORRECTIVO: null,
    INSTALACION: "EN_SERVICIO",
    BAJA: null,
  },
};

/**
 * Aplica una transición de estado sobre un activo según la matriz §7 regla A.
 * Función pura: sin BD, sin Express, testeable como módulo aislado.
 *
 * @param {string} estadoActual - Estado actual del activo (EstadoActivo enum).
 * @param {string} tipoOT - Tipo de la OT a registrar (TipoOrdenTrabajo enum).
 * @param {string} [resultadoInspeccion] - 'OK' o 'AVERIA_DETECTADA'. Obligatorio si tipoOT === 'INSPECCION'.
 * @returns {string} El nuevo estado del activo tras aplicar la OT.
 * @throws {ReglaNegocio} Si la transición no está permitida, si una INSPECCION
 *   llega sin resultado válido, o si el estado de partida es desconocido.
 */
export function aplicarTransicion(estadoActual, tipoOT, resultadoInspeccion) {
  const transicionesDelEstado = MATRIZ[estadoActual];
  if (!transicionesDelEstado) {
    // Defensa contra llamadas malformadas (tests directos, datos corruptos).
    // En producción nunca debería llegar aquí: el enum de Prisma lo blinda.
    throw new ReglaNegocio(`Estado desconocido: ${estadoActual}`);
  }

  // Caso especial: la INSPECCION exige siempre indicar el resultado, incluso
  // cuando el resultado no cambia el estado. Una OT de inspección sin
  // veredicto no tiene sentido semántico ni se puede asentar en el histórico.
  if (tipoOT === "INSPECCION") {
    if (
      resultadoInspeccion !== "OK" &&
      resultadoInspeccion !== "AVERIA_DETECTADA"
    ) {
      throw new ReglaNegocio(
        "Una OT de tipo INSPECCION requiere indicar resultadoInspeccion (OK o AVERIA_DETECTADA)",
      );
    }
    // El único estado donde el resultado modifica la transición:
    if (estadoActual === "EN_SERVICIO") {
      return resultadoInspeccion === "OK" ? "EN_SERVICIO" : "AVERIADO";
    }
    // Para AVERIADO y FUERA_DE_SERVICIO la INSPECCION es no-op; para DADO_DE_BAJA
    // está prohibida. Ambos casos los resuelve la matriz unas líneas más abajo.
  }

  const estadoNuevo = transicionesDelEstado[tipoOT];
  if (estadoNuevo === null || estadoNuevo === undefined) {
    throw new ReglaNegocio(
      `Transición no permitida: no se puede aplicar una OT de tipo ${tipoOT} a un activo en estado ${estadoActual}`,
    );
  }
  return estadoNuevo;
}
