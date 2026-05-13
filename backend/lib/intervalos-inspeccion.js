// Intervalos de inspección preventiva por tipo de activo, expresados en días.
// Vive como constante en código (no tabla en BD) porque corresponden a normativa,
// no a configuración runtime. Si en el futuro se necesita dinámico, se migra a
// una tabla `IntervaloInspeccion` y se cambia la implementación de
// `obtenerIntervaloInspeccion` sin tocar a los consumidores (scope §7).

const INTERVALOS_INSPECCION_DIAS = {
  TRANSFORMADOR_POTENCIA: 180,
  INTERRUPTOR_AUTOMATICO: 365,
  SECCIONADOR: 90,
  PARARRAYOS: 365,
  TRANSFORMADOR_MEDIDA: 365,
  BATERIA_CONDENSADORES: 180,
};

/**
 * Devuelve el intervalo de inspección en días para un tipo de activo.
 * Lanza si el tipo no está mapeado: prefiero fallo ruidoso a un activo
 * con fechaProximaInspeccion silenciosamente incorrecta.
 */
export function obtenerIntervaloInspeccion(tipoActivo) {
  const dias = INTERVALOS_INSPECCION_DIAS[tipoActivo];
  if (dias === undefined) {
    throw new Error(
      `Tipo de activo sin intervalo de inspección definido: ${tipoActivo}`,
    );
  }
  return dias;
}

/**
 * Helper de conveniencia: calcula la próxima fecha de inspección a partir
 * de una fecha base y el tipo de activo. Se usa al crear un activo
 * (base = fechaPuestaEnServicio) y al cerrar una INSPECCION OK (base = hoy).
 */
export function calcularProximaInspeccion(fechaBase, tipoActivo) {
  const dias = obtenerIntervaloInspeccion(tipoActivo);
  // Aritmética en UTC con setUTCDate para evitar derivas por zona horaria.
  // Si usáramos setDate (hora local), un activo dado de alta a las 23h en
  // Madrid acabaría con la próxima inspección un día antes en UTC, lo que
  // descuadraría los filtros de "inspección vencida" alrededor del cambio
  // de día. Las fechas en BD viven en UTC; razonemos en UTC.
  const proxima = new Date(fechaBase);
  proxima.setUTCDate(proxima.getUTCDate() + dias);
  return proxima;
}
