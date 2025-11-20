 import express from "express";
import cors from "cors";
import pg from "pg";
import dotenv from "dotenv";
import authRoutes from "./routes/authRoutes.js";
import * as Y from "yjs";

dotenv.config();
const app = express();
app.use(cors());
app.use(express.json());

const pool = new pg.Pool({
  user: process.env.DB_USER,
  host: process.env.DB_HOST,
  database: process.env.DB_NAME,
  password: process.env.DB_PASSWORD,
  port: 5432,
});

//Rotas
app.use("/api/auth", authRoutes); // Adiciona a rota de autenticação



// Rota de sincronização Yjs
app.post("/api/sincronizarStateVector", async (req, res) => {
  const { familiaId, stateVectors } = req.body;
  if (!familiaId || typeof stateVectors !== "object") {
    return res
        .status(400)
        .json({ error: "familiaId ou stateVectors inválido." });
  }
  try {
    // 1) Pega todos os docs dessa família
    const { rows } = await pool.query(
        `SELECT gastoId, yjs_updates FROM gastos WHERE familia_id = $1`,
        [familiaId]
    );

    const updatesOut = {};

    // 2) Para cada documento (gasto)
    for (const { gastoid: gastoId, yjs_updates } of rows) {
      const doc = new Y.Doc();
      // Aplica os updates já salvos
      for (const updBuffer of yjs_updates) {
        Y.applyUpdate(doc, new Uint8Array(updBuffer));
      }

      // 3) Faz diff vs. stateVector do cliente
      const clientSVb64 = stateVectors[gastoId];
      const clientSV = clientSVb64
          ? new Uint8Array(Buffer.from(clientSVb64, "base64"))
          : undefined;
      const diff = clientSV
          ? Y.encodeStateAsUpdate(doc, clientSV)
          : Y.encodeStateAsUpdate(doc);

      // 4) Só retorna se houver algo novo
      updatesOut[gastoId] = diff.length ? Buffer.from(diff).toString("base64") : null;
    }

    // 5) Envia os diffs em um único objeto
    return res.json({ updates: updatesOut });
  } catch (error) {
    console.error("Erro ao sincronizar Yjs :", error);
    return res.status(500).json({ error: "Erro ao sincronizar Yjs." });
  }
});





// Rota para salvar updates do cliente
app.post("/api/sincronizar", async (req, res) => {
  const {  gastoId, familiaId, update } = req.body;

  if (!update || !gastoId || !familiaId) {
    return res.status(400).json({ error: "update, familiaId ou gastoId não fornecido." });
  }

  try {
    const updateBuffer = new Uint8Array(Buffer.from(update, "base64"));

    await pool.query(
        `INSERT INTO gastos (familia_id, gastoId, yjs_updates)
         VALUES ($1, $2, ARRAY[$3]::bytea[])
           ON CONFLICT (familia_id, gastoId)
       DO UPDATE SET yjs_updates = array_append(gastos.yjs_updates, $3)`,
        [familiaId, gastoId, Buffer.from(updateBuffer)]
    );

    res.json({ success: true });
  } catch (error) {
    console.error("Erro ao salvar update:", error);
    res.status(500).json({ error: "Erro ao salvar update." });
  }
});






app.get('/api/buscarusuario', async (req, res) => {
  try {
    const userId = parseInt(req.query.id, 10);  // Supondo que o ID do usuário venha da query string
    if (!userId) {
      return res.status(400).json({ error: "ID do usuário não fornecido" });
    }

    const result = await pool.query("SELECT id, nome, email, familia_id FROM usuario WHERE id = $1", [userId]);

    if (result.rows.length === 0) {
      return res.status(404).json({ error: "Usuário não encontrado" });
    }

    res.json(result.rows[0]);
  } catch (error) {
    console.error("Erro ao buscar usuário:", error);
    res.status(500).json({ error: "Erro interno do servidor" });
  }
});



const PORT = process.env.PORT || 3008;
app.listen(PORT, () => console.log(`Servidor rodando na porta ${PORT}`));

// Exporta app como default
export default app;