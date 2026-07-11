import { Hono } from "hono"
import { HTTPException } from "hono/http-exception"
import { describeRoute, resolver, validator } from "hono-openapi"
import z from "zod"
import { lazy } from "@/util/lazy"
import { LocalIdentity } from "@/research/adapters/identity/local"
import {
  ResearchScaffoldOperation,
  ResearchScaffoldRequest,
  ResearchScaffoldService,
} from "@/research/application/scaffold"

const Start = ResearchScaffoldRequest.extend({ passphrase: z.string().min(12).optional() })
const Resume = z.object({ passphrase: z.string().min(12).optional() }).strict()
const Preview = z.object({
  slug: z.string(),
  destination: z.string(),
  repositoryMode: z.enum(["new", "existing", "later"]),
  environmentName: z.string(),
  environmentYml: z.string(),
  directories: z.array(z.string()),
  stages: z.array(z.string()),
})

function actor(keyId: string, displayName: string) {
  return { kind: "human" as const, id: `identity:${keyId}`, displayName }
}

export const ResearchScaffoldRoutes = lazy(() =>
  new Hono()
    .post(
      "/preview",
      describeRoute({
        summary: "Preview an OpenScience–SMAIRT study scaffold",
        operationId: "research.scaffold.preview",
        responses: {
          200: {
            description: "Scaffold preview",
            content: { "application/json": { schema: resolver(Preview) } },
          },
        },
      }),
      validator("json", ResearchScaffoldRequest),
      async (c) => c.json(ResearchScaffoldService.preview(c.req.valid("json"))),
    )
    .post(
      "/",
      describeRoute({
        summary: "Start resumable study creation",
        operationId: "research.scaffold.start",
        responses: {
          202: {
            description: "Scaffold operation accepted",
            content: { "application/json": { schema: resolver(ResearchScaffoldOperation) } },
          },
        },
      }),
      validator("json", Start),
      async (c) => {
        const body = c.req.valid("json")
        const signer = await LocalIdentity.loadOrCreate({ passphrase: body.passphrase })
        return c.json(
          await ResearchScaffoldService.start(
            ResearchScaffoldRequest.parse(body),
            actor(signer.keyId, body.author.displayName),
            signer,
          ),
          202,
        )
      },
    )
    .get(
      "/:id",
      describeRoute({
        summary: "Read study creation progress",
        operationId: "research.scaffold.get",
        responses: {
          200: {
            description: "Scaffold operation",
            content: { "application/json": { schema: resolver(ResearchScaffoldOperation) } },
          },
        },
      }),
      validator("param", z.object({ id: z.string().startsWith("rso_") })),
      async (c) => c.json(await ResearchScaffoldService.get(c.req.valid("param").id)),
    )
    .post(
      "/:id/cancel",
      describeRoute({
        summary: "Cancel study creation safely",
        operationId: "research.scaffold.cancel",
        responses: {
          200: {
            description: "Cancelled scaffold operation",
            content: { "application/json": { schema: resolver(ResearchScaffoldOperation) } },
          },
        },
      }),
      validator("param", z.object({ id: z.string().startsWith("rso_") })),
      async (c) => c.json(await ResearchScaffoldService.cancel(c.req.valid("param").id)),
    )
    .post(
      "/:id/resume",
      describeRoute({
        summary: "Resume interrupted study creation",
        operationId: "research.scaffold.resume",
        responses: {
          200: {
            description: "Resumed scaffold operation",
            content: { "application/json": { schema: resolver(ResearchScaffoldOperation) } },
          },
          409: { description: "Not resumable" },
        },
      }),
      validator("param", z.object({ id: z.string().startsWith("rso_") })),
      validator("json", Resume),
      async (c) => {
        const id = c.req.valid("param").id
        const operation = await ResearchScaffoldService.get(id).catch(() => null)
        if (!operation) throw new HTTPException(404, { message: "Scaffold operation not found" })
        const signer = await LocalIdentity.loadOrCreate({ passphrase: c.req.valid("json").passphrase })
        return c.json(
          await ResearchScaffoldService.resume(id, actor(signer.keyId, operation.request.author.displayName), signer),
        )
      },
    ),
)
