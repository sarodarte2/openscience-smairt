import path from "node:path"
import { execFile, spawn } from "node:child_process"
import { promisify } from "node:util"
import { chmod, mkdir, readFile, rename, writeFile } from "node:fs/promises"
import { createCipheriv, createDecipheriv, randomBytes, scryptSync } from "node:crypto"
import { Global } from "../../../global"
import { Ed25519, type Signer } from "../../domain/signature"

const execute = promisify(execFile)
const SERVICE = "org.openscience.research.signing"
const ACCOUNT = "default"
const cache: { signer?: Signer } = {}

interface IdentityIndex {
  version: 1
  backend: "macos-keychain" | "linux-secret-service" | "encrypted-file"
  keyId: string
}

interface EncryptedKey {
  version: 1
  cipher: "aes-256-gcm"
  kdf: "scrypt"
  salt: string
  iv: string
  tag: string
  content: string
}

function files() {
  const directory = path.join(Global.Path.data, "research/identity")
  return { directory, index: path.join(directory, "index.json"), encrypted: path.join(directory, "signing-key.enc") }
}

function runInput(command: string, args: string[], input: string): Promise<string> {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, { stdio: ["pipe", "pipe", "pipe"] })
    const stdout: Buffer[] = []
    const stderr: Buffer[] = []
    child.stdout.on("data", (chunk: Buffer) => stdout.push(chunk))
    child.stderr.on("data", (chunk: Buffer) => stderr.push(chunk))
    child.on("error", reject)
    child.on("close", (code) => {
      if (code === 0) {
        resolve(Buffer.concat(stdout).toString("utf8").trim())
        return
      }
      reject(new Error(Buffer.concat(stderr).toString("utf8").trim() || `${command} exited ${code}`))
    })
    child.stdin.end(input)
  })
}

function encrypt(privateKey: string, passphrase: string): EncryptedKey {
  const salt = randomBytes(16)
  const iv = randomBytes(12)
  const key = scryptSync(passphrase, salt, 32)
  const cipher = createCipheriv("aes-256-gcm", key, iv)
  const content = Buffer.concat([cipher.update(privateKey, "utf8"), cipher.final()])
  return {
    version: 1,
    cipher: "aes-256-gcm",
    kdf: "scrypt",
    salt: salt.toString("base64"),
    iv: iv.toString("base64"),
    tag: cipher.getAuthTag().toString("base64"),
    content: content.toString("base64"),
  }
}

function decrypt(value: EncryptedKey, passphrase: string) {
  const key = scryptSync(passphrase, Buffer.from(value.salt, "base64"), 32)
  const decipher = createDecipheriv("aes-256-gcm", key, Buffer.from(value.iv, "base64"))
  decipher.setAuthTag(Buffer.from(value.tag, "base64"))
  return Buffer.concat([decipher.update(Buffer.from(value.content, "base64")), decipher.final()]).toString("utf8")
}

async function storeSystem(privateKey: string): Promise<IdentityIndex["backend"]> {
  const secret = Buffer.from(privateKey, "utf8").toString("base64")
  if (process.platform === "darwin") {
    await runInput(
      "/usr/bin/security",
      ["add-generic-password", "-U", "-a", ACCOUNT, "-s", SERVICE, "-w"],
      secret + "\n",
    )
    return "macos-keychain"
  }
  if (process.platform === "linux") {
    await runInput(
      "secret-tool",
      ["store", "--label=OpenScience Research signing key", "service", SERVICE, "account", ACCOUNT],
      secret,
    )
    return "linux-secret-service"
  }
  throw new Error("No supported operating-system secret store")
}

async function loadSystem(backend: IdentityIndex["backend"]) {
  if (backend === "macos-keychain") {
    const result = await execute("/usr/bin/security", ["find-generic-password", "-a", ACCOUNT, "-s", SERVICE, "-w"], {
      encoding: "utf8",
    })
    return Buffer.from(result.stdout.trim(), "base64").toString("utf8")
  }
  if (backend === "linux-secret-service") {
    const secret = await runInput("secret-tool", ["lookup", "service", SERVICE, "account", ACCOUNT], "")
    return Buffer.from(secret, "base64").toString("utf8")
  }
  throw new Error("Identity is not stored in an operating-system secret store")
}

async function writeIndex(index: IdentityIndex) {
  const target = files()
  await mkdir(target.directory, { recursive: true, mode: 0o700 })
  await secureWrite(target.index, JSON.stringify(index, null, 2) + "\n")
  await chmod(target.index, 0o600)
}

async function secureWrite(file: string, content: string) {
  const temporary = file + ".tmp"
  await writeFile(temporary, content, { mode: 0o600 })
  await chmod(temporary, 0o600)
  await rename(temporary, file)
}

async function readIndex(): Promise<IdentityIndex | null> {
  try {
    const value: unknown = JSON.parse(await readFile(files().index, "utf8"))
    if (!value || typeof value !== "object") throw new Error("Signing identity index is not an object")
    const index = value as Partial<IdentityIndex>
    const backends = new Set(["macos-keychain", "linux-secret-service", "encrypted-file"])
    if (index.version !== 1 || !index.backend || !backends.has(index.backend) || !index.keyId?.startsWith("sha256:")) {
      throw new Error("Signing identity index is invalid")
    }
    return index as IdentityIndex
  } catch (error) {
    const code = error instanceof Error && "code" in error ? error.code : undefined
    if (code === "ENOENT") return null
    throw error
  }
}

export class IdentityPassphraseRequiredError extends Error {
  constructor() {
    super("A passphrase is required for the encrypted signing-key fallback")
  }
}

export namespace LocalIdentity {
  export async function loadOrCreate(
    options: { passphrase?: string; preferEncryptedFile?: boolean } = {},
  ): Promise<Signer> {
    if (cache.signer) return cache.signer
    const target = files()
    const index = await readIndex()
    if (index) {
      if (index.backend === "encrypted-file") {
        if (!options.passphrase) throw new IdentityPassphraseRequiredError()
        const stored = JSON.parse(await readFile(target.encrypted, "utf8")) as EncryptedKey
        const signer = Ed25519.fromPrivateKey(decrypt(stored, options.passphrase))
        if (signer.keyId !== index.keyId) throw new Error("Stored identity fingerprint does not match its index")
        cache.signer = signer
        return signer
      }
      const signer = Ed25519.fromPrivateKey(await loadSystem(index.backend))
      if (signer.keyId !== index.keyId) throw new Error("Stored identity fingerprint does not match its index")
      cache.signer = signer
      return signer
    }

    const generated = Ed25519.generate()
    if (!options.preferEncryptedFile) {
      const backend = await storeSystem(generated.privateKey).catch(() => null)
      if (backend) {
        await writeIndex({ version: 1, backend, keyId: generated.signer.keyId })
        cache.signer = generated.signer
        return generated.signer
      }
    }
    if (!options.passphrase) throw new IdentityPassphraseRequiredError()
    await mkdir(target.directory, { recursive: true, mode: 0o700 })
    await secureWrite(
      target.encrypted,
      JSON.stringify(encrypt(generated.privateKey, options.passphrase), null, 2) + "\n",
    )
    await chmod(target.encrypted, 0o600)
    await writeIndex({ version: 1, backend: "encrypted-file", keyId: generated.signer.keyId })
    cache.signer = generated.signer
    return generated.signer
  }
}
