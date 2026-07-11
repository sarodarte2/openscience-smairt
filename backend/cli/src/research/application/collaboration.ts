import path from "node:path"
import { readFile } from "node:fs/promises"
import z from "zod"
import { Canonical, type JsonValue } from "../domain/canonical"
import { ResearchProject } from "../domain/schema"
import { Ed25519, type Signature, type Signer } from "../domain/signature"

const Payload = z
  .object({
    version: z.literal(1),
    type: z.literal("openscience.join-request"),
    projectId: z.string().min(1),
    displayName: z.string().min(1).max(200),
    email: z.string().email().optional(),
    signingKeyId: z.string().startsWith("sha256:"),
    publicKey: z.string().min(1),
    issuedAt: z.string().datetime({ offset: true }),
    nonce: z.string().uuid(),
  })
  .strict()

const Envelope = z
  .object({
    payload: Payload,
    signature: z
      .object({
        algorithm: z.literal("ed25519"),
        keyId: z.string().startsWith("sha256:"),
        publicKey: z.string().min(1),
        value: z.string().min(1),
      })
      .strict(),
  })
  .strict()

function encode(value: unknown) {
  return Buffer.from(JSON.stringify(value), "utf8").toString("base64url")
}

function decode(value: string) {
  if (!/^[A-Za-z0-9_-]+$/.test(value)) throw new Error("Join request is not valid Base64URL")
  return JSON.parse(Buffer.from(value, "base64url").toString("utf8"))
}

async function project(root: string) {
  return ResearchProject.parse(
    JSON.parse(await readFile(path.join(root, ".openscience/research/project.json"), "utf8")),
  )
}

export namespace ResearchCollaborationService {
  export async function createJoinRequest(input: {
    projectRoot: string
    displayName: string
    email?: string
    signer: Signer
  }) {
    const currentProject = await project(input.projectRoot)
    const payload = Payload.parse({
      version: 1,
      type: "openscience.join-request",
      projectId: currentProject.id,
      displayName: input.displayName,
      ...(input.email ? { email: input.email } : {}),
      signingKeyId: input.signer.keyId,
      publicKey: input.signer.publicKey,
      issuedAt: new Date().toISOString(),
      nonce: crypto.randomUUID(),
    })
    const signature: Signature = {
      algorithm: "ed25519",
      keyId: input.signer.keyId,
      publicKey: input.signer.publicKey,
      value: await input.signer.sign(Canonical.stringify(payload as JsonValue)),
    }
    return { bundle: encode({ payload, signature }), request: payload }
  }

  export async function verifyJoinRequest(input: { projectRoot: string; bundle: string }) {
    const currentProject = await project(input.projectRoot)
    const envelope = Envelope.parse(decode(input.bundle))
    if (envelope.payload.projectId !== currentProject.id) throw new Error("Join request belongs to another study")
    if (
      envelope.signature.keyId !== envelope.payload.signingKeyId ||
      envelope.signature.publicKey !== envelope.payload.publicKey
    ) {
      throw new Error("Join request identity does not match its signature")
    }
    if (!Ed25519.verify(Canonical.stringify(envelope.payload as JsonValue), envelope.signature)) {
      throw new Error("Join request signature is invalid")
    }
    return envelope.payload
  }
}
