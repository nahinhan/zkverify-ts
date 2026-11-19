import express, { Request, Response } from "express";
import crypto from "crypto";
import { verifyHmacSignature } from "./crypto.js";
import { handleGatekeeperTask, GatekeeperTask } from "./gatekeeper.js";
import { handleStealVfyTurn, StealVfyEnvelope } from "./stealVfy.js";

const app = express();
const PORT = Number(process.env.PORT ?? 10000);
const HMAC_SECRET = (process.env.AGENT_GAMES_HMAC_SECRET ?? "").trim();

app.use(express.json({ verify: (req: any, _res, buf) => { req.rawBody = buf; } }));

function getSig(req: Request): string | undefined {
  for (const [k, v] of Object.entries(req.headers)) {
    if (k.toLowerCase().includes("signature") && typeof v === "string" && v.trim()) return v.trim();
  }
  return undefined;
}

function sendSignedV1(res: Response, bodyObj: Record<string, unknown>, reqTs?: string) {
  const ts = reqTs || String(Math.floor(Date.now() / 1000));
  const payload = { ok: true, protocolVersion: "v1", ...bodyObj };
  const rawJson = JSON.stringify(payload);
  const sig = crypto.createHmac("sha256", HMAC_SECRET).update(`${ts}.${rawJson}`, "utf8").digest("hex");
  res.status(200)
    .setHeader("content-type", "application/json")
    .setHeader("x-agent-games-signature", sig)
    .setHeader("x-agent-games-timestamp", ts)
    .setHeader("x-agent-signature", sig)
    .send(rawJson);
}

app.get("/health", (_req: Request, res: Response) => {
  res.status(200).json({ ok: true, protocolVersion: "v1", status: "ok" });
});

app.get("/", (_req: Request, res: Response) => {
  sendSignedV1(res, { status: "ready", agent: "zkverify-dual-tournament-agent" });
});

app.post(["/", "/agent", "/webhook"], async (req: any, res: Response) => {
  try {
    const rawBody: Buffer = req.rawBody ?? Buffer.from(JSON.stringify(req.body ?? {}), "utf8");
    const sigHeader = getSig(req);
    const reqTs = req.header("x-agent-games-timestamp") ?? req.header("x-zkverify-timestamp") ?? req.header("x-timestamp");

    if (!verifyHmacSignature(rawBody, sigHeader, HMAC_SECRET, reqTs)) {
      res.status(401).json({ error: "INVALID_HMAC_SIGNATURE" });
      return;
    }

    const payload = req.body;
    if (!payload || typeof payload !== "object" || payload.type === "preflight" || payload.preflight || (!payload.matchId && !payload.proof && !payload.policy && !payload.task)) {
      sendSignedV1(res, { status: "ready" }, reqTs);
      return;
    }

    let result: any;
    if ("matchId" in payload || payload.mode === "steal-the-vfy" || "strategyCommitment" in payload) {
      result = await handleStealVfyTurn(payload as StealVfyEnvelope);
    } else {
      result = await handleGatekeeperTask(payload as GatekeeperTask);
    }

    sendSignedV1(res, typeof result === "object" && result !== null ? result : { output: result }, reqTs);
  } catch (err) {
    console.error("[Server] Error:", err instanceof Error ? err.message : err);
    res.status(500).json({ error: "INTERNAL_AGENT_ERROR" });
  }
});

app.listen(PORT, "0.0.0.0", () => {
  console.log(`[zkVerify Agent] Listening on port ${PORT}`);
});