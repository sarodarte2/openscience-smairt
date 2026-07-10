import z from "zod"
import { Canonical, type JsonValue } from "./canonical"
import { Hash, Actor, Json, Timestamp } from "./schema"
import { ResearchID } from "./id"
import { Ed25519, type Signature, type Signer } from "./signature"

export const EventParent = z.object({ eventId: ResearchID.schema("event"), hash: Hash }).strict()

export const EventSignature = z
  .object({
    algorithm: z.literal("ed25519"),
    keyId: z.string().startsWith("sha256:"),
    publicKey: z.string().min(1),
    value: z.string().min(1),
  })
  .strict()

const UnsignedEvent = z
  .object({
    schemaVersion: z.literal(1),
    eventId: ResearchID.schema("event"),
    projectId: ResearchID.schema("project"),
    type: z.string().regex(/^[a-z][a-z0-9]*(\.[a-z][a-z0-9_]*)+$/),
    parents: z.array(EventParent),
    actor: Actor,
    occurredAt: Timestamp,
    payload: Json,
    payloadHash: Hash,
  })
  .strict()

export const ResearchEvent = UnsignedEvent.extend({
  contentHash: Hash,
  signature: EventSignature,
  eventHash: Hash,
}).strict()
export type ResearchEvent = z.infer<typeof ResearchEvent>
export type EventParent = z.infer<typeof EventParent>

function unsigned(event: z.infer<typeof UnsignedEvent>): JsonValue {
  return event as JsonValue
}

function signed(event: z.infer<typeof UnsignedEvent>, contentHash: string, signature: Signature): JsonValue {
  return { ...event, contentHash, signature } as unknown as JsonValue
}

export namespace Event {
  export async function create(input: {
    eventId: string
    projectId: string
    type: string
    parents: EventParent[]
    actor: z.infer<typeof Actor>
    occurredAt: string
    payload: JsonValue
    signer: Signer
  }): Promise<ResearchEvent> {
    const base = UnsignedEvent.parse({
      schemaVersion: 1,
      eventId: input.eventId,
      projectId: input.projectId,
      type: input.type,
      parents: input.parents,
      actor: input.actor,
      occurredAt: input.occurredAt,
      payload: input.payload,
      payloadHash: Canonical.hash(input.payload),
    })
    const canonical = Canonical.stringify(unsigned(base))
    const contentHash = Canonical.hash(unsigned(base))
    const signature = {
      algorithm: "ed25519" as const,
      keyId: input.signer.keyId,
      publicKey: input.signer.publicKey,
      value: await input.signer.sign(canonical),
    }
    return ResearchEvent.parse({
      ...base,
      contentHash,
      signature,
      eventHash: Canonical.hash(signed(base, contentHash, signature)),
    })
  }

  export function verify(value: unknown): { valid: true; event: ResearchEvent } | { valid: false; reason: string } {
    const parsed = ResearchEvent.safeParse(value)
    if (!parsed.success) return { valid: false, reason: z.prettifyError(parsed.error) }
    const event = parsed.data
    if (Canonical.hash(event.payload as JsonValue) !== event.payloadHash) {
      return { valid: false, reason: "Payload hash does not match" }
    }
    const { contentHash, signature, eventHash, ...base } = event
    const content = unsigned(base)
    if (Canonical.hash(content) !== contentHash) return { valid: false, reason: "Content hash does not match" }
    if (!Ed25519.verify(Canonical.stringify(content), signature)) {
      return { valid: false, reason: "Ed25519 signature is invalid" }
    }
    if (Canonical.hash(signed(base, contentHash, signature)) !== eventHash) {
      return { valid: false, reason: "Event hash does not match" }
    }
    return { valid: true, event }
  }
}
