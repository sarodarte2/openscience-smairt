import path from "node:path"
import { readFile, readdir } from "node:fs/promises"
import { ProjectMember } from "../domain/schema"

export namespace ProjectMembership {
  export async function localMember(projectRoot: string, keyId: string) {
    const directory = path.join(projectRoot, ".openscience/research/projections/members")
    const names = await readdir(directory)
    const members = await Promise.all(
      names
        .filter((name) => name.endsWith(".json"))
        .map(async (name) => ProjectMember.parse(JSON.parse(await readFile(path.join(directory, name), "utf8")))),
    )
    return members.find((candidate) => candidate.active && candidate.signingKeyId === keyId) ?? null
  }
}
