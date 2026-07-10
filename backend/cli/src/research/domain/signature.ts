import {
  createHash,
  createPrivateKey,
  createPublicKey,
  generateKeyPairSync,
  sign as nodeSign,
  verify as nodeVerify,
} from "node:crypto"

export interface Signature {
  algorithm: "ed25519"
  keyId: string
  publicKey: string
  value: string
}

export interface Signer {
  keyId: string
  publicKey: string
  sign(content: string): Promise<string>
}

function fingerprint(publicKey: string) {
  return createHash("sha256").update(Buffer.from(publicKey, "base64")).digest("hex")
}

export namespace Ed25519 {
  export function generate(): { signer: Signer; privateKey: string } {
    const pair = generateKeyPairSync("ed25519")
    const publicKey = pair.publicKey.export({ type: "spki", format: "der" }).toString("base64")
    const privateKey = pair.privateKey.export({ type: "pkcs8", format: "pem" }).toString()
    return { signer: fromPrivateKey(privateKey), privateKey }
  }

  export function fromPrivateKey(privateKey: string): Signer {
    const secret = createPrivateKey(privateKey)
    const publicKey = createPublicKey(secret).export({ type: "spki", format: "der" }).toString("base64")
    return {
      keyId: "sha256:" + fingerprint(publicKey),
      publicKey,
      async sign(content) {
        return nodeSign(null, Buffer.from(content, "utf8"), secret).toString("base64")
      },
    }
  }

  export function verify(content: string, signature: Signature) {
    if (signature.algorithm !== "ed25519") return false
    if (signature.keyId !== "sha256:" + fingerprint(signature.publicKey)) return false
    try {
      const key = createPublicKey({ key: Buffer.from(signature.publicKey, "base64"), type: "spki", format: "der" })
      return nodeVerify(null, Buffer.from(content, "utf8"), key, Buffer.from(signature.value, "base64"))
    } catch {
      return false
    }
  }
}
