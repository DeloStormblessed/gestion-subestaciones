-- CreateEnum
CREATE TYPE "Rol" AS ENUM ('OPERARIO', 'TECNICO', 'ADMIN');

-- CreateEnum
CREATE TYPE "EstadoActivo" AS ENUM ('EN_SERVICIO', 'AVERIADO', 'FUERA_DE_SERVICIO', 'DADO_DE_BAJA');

-- CreateEnum
CREATE TYPE "TipoActivo" AS ENUM ('TRANSFORMADOR_POTENCIA', 'INTERRUPTOR_AUTOMATICO', 'SECCIONADOR', 'PARARRAYOS', 'TRANSFORMADOR_MEDIDA', 'BATERIA_CONDENSADORES');

-- CreateEnum
CREATE TYPE "TipoOrdenTrabajo" AS ENUM ('INSPECCION', 'PREVENTIVO', 'CORRECTIVO', 'INSTALACION', 'BAJA');

-- CreateEnum
CREATE TYPE "ResultadoInspeccion" AS ENUM ('OK', 'AVERIA_DETECTADA');

-- CreateTable
CREATE TABLE "usuarios" (
    "id" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "passwordHash" TEXT NOT NULL,
    "nombre" TEXT NOT NULL,
    "rol" "Rol" NOT NULL DEFAULT 'OPERARIO',
    "activo" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "usuarios_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "subestaciones" (
    "id" TEXT NOT NULL,
    "codigo" TEXT NOT NULL,
    "nombre" TEXT NOT NULL,
    "ubicacion" TEXT NOT NULL,
    "tensionNominal" INTEGER NOT NULL,
    "activa" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "subestaciones_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "activos" (
    "id" TEXT NOT NULL,
    "codigo" TEXT NOT NULL,
    "tipo" "TipoActivo" NOT NULL,
    "fabricante" TEXT NOT NULL,
    "modelo" TEXT,
    "numeroSerie" TEXT,
    "fechaPuestaEnServicio" TIMESTAMP(3) NOT NULL,
    "estado" "EstadoActivo" NOT NULL DEFAULT 'EN_SERVICIO',
    "fechaProximaInspeccion" TIMESTAMP(3) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "subestacionId" TEXT NOT NULL,

    CONSTRAINT "activos_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ordenes_trabajo" (
    "id" TEXT NOT NULL,
    "tipo" "TipoOrdenTrabajo" NOT NULL,
    "descripcion" TEXT NOT NULL,
    "resultado" "ResultadoInspeccion",
    "estadoAnterior" "EstadoActivo" NOT NULL,
    "estadoNuevo" "EstadoActivo" NOT NULL,
    "fechaIntervencion" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "activoId" TEXT NOT NULL,
    "autorId" TEXT NOT NULL,

    CONSTRAINT "ordenes_trabajo_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "etiquetas" (
    "id" SERIAL NOT NULL,
    "nombre" TEXT NOT NULL,
    "color" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "etiquetas_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "_ActivosEtiquetas" (
    "A" TEXT NOT NULL,
    "B" INTEGER NOT NULL
);

-- CreateIndex
CREATE UNIQUE INDEX "usuarios_email_key" ON "usuarios"("email");

-- CreateIndex
CREATE INDEX "usuarios_email_idx" ON "usuarios"("email");

-- CreateIndex
CREATE UNIQUE INDEX "subestaciones_codigo_key" ON "subestaciones"("codigo");

-- CreateIndex
CREATE INDEX "subestaciones_codigo_idx" ON "subestaciones"("codigo");

-- CreateIndex
CREATE UNIQUE INDEX "activos_codigo_key" ON "activos"("codigo");

-- CreateIndex
CREATE UNIQUE INDEX "activos_numeroSerie_key" ON "activos"("numeroSerie");

-- CreateIndex
CREATE INDEX "activos_subestacionId_idx" ON "activos"("subestacionId");

-- CreateIndex
CREATE INDEX "activos_estado_idx" ON "activos"("estado");

-- CreateIndex
CREATE INDEX "activos_fechaProximaInspeccion_idx" ON "activos"("fechaProximaInspeccion");

-- CreateIndex
CREATE INDEX "activos_tipo_idx" ON "activos"("tipo");

-- CreateIndex
CREATE INDEX "ordenes_trabajo_activoId_createdAt_idx" ON "ordenes_trabajo"("activoId", "createdAt");

-- CreateIndex
CREATE INDEX "ordenes_trabajo_tipo_idx" ON "ordenes_trabajo"("tipo");

-- CreateIndex
CREATE INDEX "ordenes_trabajo_autorId_idx" ON "ordenes_trabajo"("autorId");

-- CreateIndex
CREATE UNIQUE INDEX "etiquetas_nombre_key" ON "etiquetas"("nombre");

-- CreateIndex
CREATE UNIQUE INDEX "_ActivosEtiquetas_AB_unique" ON "_ActivosEtiquetas"("A", "B");

-- CreateIndex
CREATE INDEX "_ActivosEtiquetas_B_index" ON "_ActivosEtiquetas"("B");

-- AddForeignKey
ALTER TABLE "activos" ADD CONSTRAINT "activos_subestacionId_fkey" FOREIGN KEY ("subestacionId") REFERENCES "subestaciones"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ordenes_trabajo" ADD CONSTRAINT "ordenes_trabajo_activoId_fkey" FOREIGN KEY ("activoId") REFERENCES "activos"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ordenes_trabajo" ADD CONSTRAINT "ordenes_trabajo_autorId_fkey" FOREIGN KEY ("autorId") REFERENCES "usuarios"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "_ActivosEtiquetas" ADD CONSTRAINT "_ActivosEtiquetas_A_fkey" FOREIGN KEY ("A") REFERENCES "activos"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "_ActivosEtiquetas" ADD CONSTRAINT "_ActivosEtiquetas_B_fkey" FOREIGN KEY ("B") REFERENCES "etiquetas"("id") ON DELETE CASCADE ON UPDATE CASCADE;
