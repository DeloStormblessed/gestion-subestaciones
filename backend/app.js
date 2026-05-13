// backend/app.js

import express from "express";
import authRoutes from "./features/auth/auth.routes.js";
import usuariosRoutes from "./features/usuarios/usuarios.routes.js";
import errorHandler from "./middleware/errorHandler.js";

const app = express();
app.use(express.json());

app.use("/api/v1/auth", authRoutes);
app.use("/api/v1/usuarios", usuariosRoutes);

app.use(errorHandler);

export default app;
