import cors from "cors";
import dotenv from "dotenv";
import express from "express";
import userRoutes from "./routes/user.routes";

dotenv.config();

const app = express();
const port = Number(process.env.PORT || 4000);

app.use(cors());
app.use(express.json());

app.use("/users", userRoutes);

app.get("/health", (_req, res) => {
  res.status(200).json({
    status: "ok",
    service: "amana-backend",
    timestamp: new Date().toISOString(),
  });
});

app.listen(port, () => {
  console.log(`Amana backend listening on port ${port}`);
});
