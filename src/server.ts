import "dotenv/config";
import express, { Request, Response } from "express";
import { signPayload, verifyHmacSignature } from "./crypto";
import { GatekeeperTask, handleGatekeeperTask } from "./gatekeeper";
import { handleStealVfyTurn, StealVfyEnvelope } from "./stealVfy";

const app = express();
const PORT = Number(process.env.PORT ?? 10000);
const HMAC_SECRET = process.env.AGENT_GAMES_HMAC_SECRET ?? "";

interface RawBodyRequest extends Request {
  rawBody?: Buffer;
}

// Tangkap raw bytes body persis sebelum JSON di-parse agar verifikasi HMAC-SHA256 akurat
app.use(
  express.json({
    limit: "1mb",
    verify: (req: RawBodyRequest, _res, buf) => {
      req.rawBody = buf;
    },
  })
);

function getSignatureHeader(req: Request): string | undefined { for (const [k, v] of Object.entries(req.headers)) { if (k.toLowerCase().includes("signature") && typeof v === "string" && v.trim()) return v.trim(); } return undefined; }

// Health check untuk Render & pengecekan cepat
app.get("/health", (_req: Request, res: Response) => {
  res.status(200).json({ status: "ok", timestamp: new Date().toISOString() });
});

// Preflight check sebelum turnamen dimulai
app.get("/", (_req: Request, res: Response) => {
  res.status(200).json({
    status: "ready",
    agent: "zkverify-dual-tournament-agent",
    modes: ["gatekeeper", "steal-the-vfy"],
  });
});

// Endpoint utama untuk seluruh tugas turnamen
app.post("/", async (req: RawBodyRequest, res: Response) => {
  const rawBody = req.rawBody ?? Buffer.from(JSON.stringify(req.body ?? {}));
  const sigHeader = getSignatureHeader(req);

  if (!verifyHmacSignature(rawBody, sigHeader, HMAC_SECRET, (req.header("x-zkverify-timestamp") ?? req.header("x-timestamp") ?? req.header("x-agent-timestamp")))) {
    res.status(401).json({ error: "INVALID_HMAC_SIGNATURE" });
    return;
  }

  const payload = req.body as Record<string, unknown>;

  try {
    let responsePayload: unknown;

    if (!payload || typeof payload !== "object" || payload.type === "preflight" || payload.type === "ping" || (!payload.matchId && !payload.proof && !payload.policy && !payload.task)) { const { rawJson, signature } = signPayload({ ok: true, status: "ready", agent: "zkverify-dual-tournament-agent" }, HMAC_SECRET); res.status(200).setHeader("content-type", "application/json").setHeader("x-agent-signature", signature).setHeader("x-signature", signature).send(rawJson); return; }
    // Deteksi otomatis apakah tugas yang masuk adalah Steal the VFY atau Proof Gatekeeper
    if (
      payload &&
      typeof payload === "object" &&
      ("matchId" in payload || payload.mode === "steal-the-vfy" || "strategyCommitment" in payload)
    ) {
      responsePayload = await handleStealVfyTurn(payload as unknown as StealVfyEnvelope);
    } else {
      responsePayload = await handleGatekeeperTask(payload as unknown as GatekeeperTask);
    }

    const { rawJson, signature } = signPayload(responsePayload, HMAC_SECRET);

    res
      .status(200)
      .setHeader("content-type", "application/json")
      .setHeader("x-agent-signature", signature)
      .setHeader("x-signature", signature)
      .send(rawJson);
  } catch (err) {
    console.error("[Server] Unhandled request error:", err instanceof Error ? err.message : "unknown");
    res.status(500).json({ error: "INTERNAL_AGENT_ERROR" });
  }
});

app.listen(PORT, "0.0.0.0", () => {
  console.log(`[zkVerify Agent] Listening on port ${PORT}`);
});