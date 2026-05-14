/*
  Warnings:

  - The values [OK,AVERIA_DETECTADA] on the enum `ResultadoInspeccion` will be removed. If these variants are still used in the database, this will fail.

*/
-- AlterEnum
BEGIN;
CREATE TYPE "ResultadoInspeccion_new" AS ENUM ('CONFORME', 'NO_CONFORME');
ALTER TABLE "ordenes_trabajo" ALTER COLUMN "resultado" TYPE "ResultadoInspeccion_new" USING ("resultado"::text::"ResultadoInspeccion_new");
ALTER TYPE "ResultadoInspeccion" RENAME TO "ResultadoInspeccion_old";
ALTER TYPE "ResultadoInspeccion_new" RENAME TO "ResultadoInspeccion";
DROP TYPE "ResultadoInspeccion_old";
COMMIT;
