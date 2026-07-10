import { createHash } from "node:crypto"

export type JsonPrimitive = string | number | boolean | null
export type JsonValue = JsonPrimitive | JsonValue[] | { [key: string]: JsonValue }

function isObject(value: unknown): value is Record<string, unknown> {
  if (value === null || typeof value !== "object" || Array.isArray(value)) return false
  const prototype = Object.getPrototypeOf(value)
  return prototype === Object.prototype || prototype === null
}

function serialize(value: unknown, path: string): string {
  if (value === null) return "null"
  if (typeof value === "string" || typeof value === "boolean") return JSON.stringify(value)
  if (typeof value === "number") {
    if (!Number.isFinite(value)) throw new TypeError(`Non-finite number at ${path}`)
    return JSON.stringify(value)
  }
  if (Array.isArray(value)) {
    return "[" + value.map((item, index) => serialize(item, `${path}[${index}]`)).join(",") + "]"
  }
  if (isObject(value)) {
    const entries = Object.keys(value)
      .sort()
      .map((key) => {
        const item = value[key]
        if (item === undefined) throw new TypeError(`Undefined value at ${path}.${key}`)
        return JSON.stringify(key) + ":" + serialize(item, `${path}.${key}`)
      })
    return "{" + entries.join(",") + "}"
  }
  throw new TypeError(`Unsupported canonical JSON value at ${path}`)
}

export namespace Canonical {
  /** RFC 8785-compatible serialization for the JSON values accepted by the research ledger. */
  export function stringify(value: JsonValue): string {
    return serialize(value, "$")
  }

  export function hash(value: JsonValue): string {
    return createHash("sha256").update(stringify(value), "utf8").digest("hex")
  }
}
