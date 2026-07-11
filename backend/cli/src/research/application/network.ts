import { FilesystemLedger } from "../adapters/ledger/filesystem"
import { ResearchProject } from "../domain/schema"

function loopback(value: string | undefined) {
  if (!value) return false
  try {
    const url = new URL(value)
    return ["localhost", "127.0.0.1", "::1"].includes(url.hostname)
  } catch {
    return false
  }
}

async function project(root: string) {
  const ledger = await FilesystemLedger.inspect(root)
  if (ledger.events.length === 0) return null
  if (ledger.readOnly) throw new Error("Study network policy is unavailable because the signed ledger is invalid")
  const genesis = ledger.events.find((event) => event.type === "project.created")
  if (!genesis?.payload || typeof genesis.payload !== "object" || Array.isArray(genesis.payload)) {
    throw new Error("Study network policy is missing from the signed project genesis")
  }
  return ResearchProject.parse((genesis.payload as Record<string, unknown>).project)
}

export namespace ResearchNetworkPolicy {
  export async function restricted(projectRoot: string) {
    const value = await project(projectRoot)
    return value?.profile?.networkMode === "offline" || value?.profile?.egressPolicy === "air-gapped"
  }

  export async function assertModelRequest(input: { projectRoot: string; providerId: string; baseURL?: string }) {
    if (!(await restricted(input.projectRoot)) || loopback(input.baseURL)) return
    throw new Error(
      `Study network policy blocks ${input.providerId}. Choose a loopback model endpoint or change the reviewed data-and-safety policy.`,
    )
  }
}
