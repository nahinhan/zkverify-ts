import "dotenv/config";
import { signPayload } from "../crypto";
import { computePublicInputsHash } from "../stealVfy";

const BASE_URL = `http://localhost:${process.env.PORT ?? 10000}`;
const SECRET = process.env.AGENT_GAMES_HMAC_SECRET ?? "dev-secret-key";

async function sendSignedRequest(payload: unknown) {
  const { rawJson, signature } = signPayload(payload, SECRET);
  const res = await fetch(BASE_URL, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "x-agent-signature": signature,
    },
    body: rawJson,
  });
  const text = await res.text();
  return { status: res.status, body: JSON.parse(text) };
}

async function runTests() {
  console.log("1. Menguji GET / (Preflight)...");
  const preflight = await fetch(BASE_URL);
  console.log("   Status:", preflight.status, await preflight.json());

  console.log("\n2. Menguji Proof Gatekeeper (Valid Request)...");
  const gkRes = await sendSignedRequest({
    type: "gatekeeper_verify",
    task_id: "test-gk-001",
    input: {
      registered_vk: "0x6b79c6012a6d8651f3e13bc4d2a20370280ab49700c90c5316d4168bfbad77b0",
      proof_vk: "0x6b79c6012a6d8651f3e13bc4d2a20370280ab49700c90c5316d4168bfbad77b0",
      minimum: "100",
      public_balance: "500",
      expiry_block: "2000",
      current_block: "1500",
      recipient: "0x1111111111111111111111111111111111111111",
      condition_recipient: "0x1111111111111111111111111111111111111111",
      amount: "200",
      max_transfer: "300",
      proof_tx: "0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
    },
  });
  console.log("   Status:", gkRes.status, "| Decision:", gkRes.body.decision, "| Reason:", gkRes.body.reason_code);

  console.log("\n3. Menguji Steal the VFY (Turn 1)...");
  const sampleMatchId = "123e4567-e89b-12d3-a456-426614174000";
  const sampleCommitment = "123456789012345678901234567890";
  const expectedHash = computePublicInputsHash({
    commitment: sampleCommitment,
    matchId: sampleMatchId,
    turn: 1,
    selfBalance: "1000",
    opponentBalance: "1000",
    actionType: "HOLD",
    amount: 0,
  });
  console.log("   Expected publicInputsHash:", expectedHash);

  const vfyRes = await sendSignedRequest({
    protocolVersion: "1.0",
    eventId: "evt-001",
    mode: "steal-the-vfy",
    matchId: sampleMatchId,
    turn: 1,
    issuedAt: new Date().toISOString(),
    deadlineAt: new Date(Date.now() + 30_000).toISOString(),
    state: {
      selfBalance: "1000",
      opponentBalance: "1000",
      selfFortifiedUntilTurn: null,
      opponentFortifiedUntilTurn: null,
    },
    strategyCommitment: { hash: sampleCommitment },
    resolverVersion: "v1",
    nonce: "nonce-001",
  });
  console.log("   Status:", vfyRes.status, "| Action:", vfyRes.body.action, "| Hash Match:", vfyRes.body.policyProof?.publicInputsHash === expectedHash);
}

runTests().catch((err) => {
  console.error("Test error:", err);
  process.exit(1);
});