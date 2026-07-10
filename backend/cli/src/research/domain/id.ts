import z from "zod"
import { ulid } from "ulid"

export const ResearchIDKind = {
  project: "rsp",
  foundation: "rsf",
  track: "rst",
  workspace: "rsw",
  iteration: "rsi",
  protocol: "rsc",
  run: "rsr",
  artifact: "rsa",
  analysis: "rsn",
  member: "rsm",
  event: "rse",
  approval: "rsv",
  claim: "rsl",
} as const

export type ResearchIDKind = keyof typeof ResearchIDKind

const BODY = /^[0-9A-HJKMNP-TV-Z]{26}$/

export namespace ResearchID {
  export function schema(kind: ResearchIDKind) {
    const prefix = ResearchIDKind[kind]
    return z.string().refine((value) => {
      if (!value.startsWith(prefix + "_")) return false
      return BODY.test(value.slice(prefix.length + 1))
    }, `Expected a ${kind} identifier`)
  }

  export function create(kind: ResearchIDKind) {
    return `${ResearchIDKind[kind]}_${ulid()}`
  }

  export function is(kind: ResearchIDKind, value: string) {
    return schema(kind).safeParse(value).success
  }
}
