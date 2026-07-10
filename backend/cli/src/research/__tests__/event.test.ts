import { describe, expect, it } from "bun:test"
import { Event } from "../domain/event"
import { ResearchID } from "../domain/id"
import { Ed25519 } from "../domain/signature"

const actor = { kind: "human" as const, id: "local:test", displayName: "Test Researcher" }

describe("Research event", () => {
  it("signs and verifies an event", async () => {
    const { signer } = Ed25519.generate()
    const event = await Event.create({
      eventId: ResearchID.create("event"),
      projectId: ResearchID.create("project"),
      type: "project.created",
      parents: [],
      actor,
      occurredAt: new Date().toISOString(),
      payload: { name: "A reproducible study" },
      signer,
    })
    expect(Event.verify(event)).toEqual({ valid: true, event })
  })

  it("detects payload tampering", async () => {
    const { signer } = Ed25519.generate()
    const event = await Event.create({
      eventId: ResearchID.create("event"),
      projectId: ResearchID.create("project"),
      type: "track.created",
      parents: [],
      actor,
      occurredAt: new Date().toISOString(),
      payload: { objective: "original" },
      signer,
    })
    const result = Event.verify({ ...event, payload: { objective: "changed" } })
    expect(result.valid).toBeFalse()
  })
})
