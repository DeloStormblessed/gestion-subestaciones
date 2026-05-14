import prisma from "../lib/prisma.js";

// Limpieza exhaustiva de la BD de tests. Orden estricto: de hijos a padres
// según las FKs declaradas con onDelete: Restrict en schema.prisma. Invertir
// el orden rompe con P2003 (foreign key constraint).
//
// Fuente única de verdad: si se añade una entidad nueva al modelo (planes de
// mantenimiento, repuestos...), se actualiza aquí y todos los test files
// heredan el cambio sin tocarlos uno a uno.
//
// Se usa tanto en beforeAll (estado conocido al arrancar) como en afterAll
// (no dejar residuos para el siguiente test file). Esto hace que cada test
// file sea autocontenido y deje de depender de fileParallelism: false.
export const limpiarBD = async () => {
  await prisma.ordenTrabajo.deleteMany();
  await prisma.activo.deleteMany();
  await prisma.etiqueta.deleteMany();
  await prisma.subestacion.deleteMany();
  await prisma.usuario.deleteMany();
};
