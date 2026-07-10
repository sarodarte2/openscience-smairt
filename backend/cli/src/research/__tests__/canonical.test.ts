import { describe, expect, it } from "bun:test"
import { Canonical, type JsonValue } from "../domain/canonical"

describe("Canonical JSON", () => {
  it("sorts keys recursively without changing array order", () => {
    expect(Canonical.stringify({ z: 1, a: { y: true, b: [3, 2, 1] } })).toBe('{"a":{"b":[3,2,1],"y":true},"z":1}')
  })

  it("produces the same digest for equivalent key order", () => {
    expect(Canonical.hash({ a: 1, b: { c: 2 } })).toBe(Canonical.hash({ b: { c: 2 }, a: 1 }))
  })

  it("rejects values JSON cannot reproduce", () => {
    expect(() => Canonical.stringify({ value: Number.NaN })).toThrow("Non-finite")
    expect(() => Canonical.stringify({ value: undefined } as unknown as JsonValue)).toThrow("Undefined")
  })
})
