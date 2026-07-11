import { describe, expect, it } from "bun:test"
import { Governance, ResearchCapability } from "../domain/governance"

const human = { kind: "human" as const, id: "local:researcher", displayName: "Researcher" }
const agent = {
  kind: "agent" as const,
  id: "agent:coordinator",
  displayName: "Research coordinator",
  delegationId: "delegation:test",
}

describe("Research governance", () => {
  it("allows a researcher to execute a run but not manage membership", () => {
    expect(Governance.can({ actor: human, role: "researcher" }, ResearchCapability.runExecute)).toBeTrue()
    expect(Governance.can({ actor: human, role: "researcher" }, ResearchCapability.membershipManage)).toBeFalse()
  })

  it("allows only explicitly delegated agent capabilities", () => {
    const context = {
      actor: agent,
      role: "researcher" as const,
      delegatedCapabilities: [ResearchCapability.runExecute],
    }
    expect(Governance.can(context, ResearchCapability.runExecute)).toBeTrue()
    expect(Governance.can(context, ResearchCapability.trackCreate)).toBeFalse()
    expect(Governance.can({ ...context, role: "viewer" }, ResearchCapability.runExecute)).toBeFalse()
  })

  it("rejects AI approval and foundation promotion through the common policy", () => {
    const context = {
      actor: agent,
      delegatedCapabilities: [ResearchCapability.protocolApprove, ResearchCapability.foundationPromote],
    }
    expect(Governance.can(context, ResearchCapability.protocolApprove)).toBeFalse()
    expect(
      Governance.can(
        { ...context, delegatedCapabilities: [ResearchCapability.protocolFreeze] },
        ResearchCapability.protocolFreeze,
      ),
    ).toBeFalse()
    expect(Governance.can(context, ResearchCapability.foundationPromote)).toBeFalse()
    expect(
      Governance.can(
        { ...context, delegatedCapabilities: [ResearchCapability.environmentManage] },
        ResearchCapability.environmentManage,
      ),
    ).toBeFalse()
  })
})
