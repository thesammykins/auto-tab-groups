import type {
  AiCompletionRequest,
  AiCompletionResponse,
  AiModelConfig,
  AiModelStatus
} from "../../types"
import type { AiProviderInterface } from "./AiProviderInterface"

export const APPLE_MODEL_ID = "apple-system"
export const APPLE_ORIGIN_PERMISSION = "http://127.0.0.1/*"
const RULE_ID = 1976
const ENDPOINT = "http://127.0.0.1:1976"
const START_SERVER = "Start fm serve --host 127.0.0.1 --port 1976 in Terminal."

function object(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value))
    throw new Error("Invalid response from Apple model server")
  return value as Record<string, unknown>
}

export class AppleFmProvider implements AiProviderInterface {
  private status: AiModelStatus = "idle"
  private error: string | null = null
  getStatus(): AiModelStatus {
    return this.status
  }
  getProgress(): number {
    return this.status === "ready" ? 100 : 0
  }
  getError(): string | null {
    return this.error
  }
  getAvailableModels(): readonly AiModelConfig[] {
    return [
      {
        id: APPLE_MODEL_ID,
        displayName: "Apple Foundation Models (macOS 27, built-in server)",
        sizeInMb: 0,
        vramRequiredMb: 0
      }
    ]
  }

  private async request(path: string, body?: unknown): Promise<Record<string, unknown>> {
    if (!(await browser.permissions.contains({ origins: [APPLE_ORIGIN_PERMISSION] }))) {
      throw new Error("Allow localhost access using Connect in AI settings.")
    }
    let response: Response
    try {
      response = await fetch(`${ENDPOINT}${path}`, {
        method: body === undefined ? "GET" : "POST",
        headers: body === undefined ? undefined : { "Content-Type": "application/json" },
        body: body === undefined ? undefined : JSON.stringify(body),
        signal: AbortSignal.timeout(45000),
        credentials: "omit",
        redirect: "error"
      })
    } catch {
      throw new Error(`Apple model server did not respond. ${START_SERVER}`)
    }
    const data = object(await response.json())
    if (!response.ok) {
      const error =
        data.error && typeof data.error === "object" ? object(data.error).message : undefined
      throw new Error(
        typeof error === "string"
          ? error.slice(0, 500)
          : `Apple model server returned ${response.status}`
      )
    }
    return data
  }

  async loadModel(modelId: string): Promise<void> {
    if (modelId !== APPLE_MODEL_ID) throw new Error("Unknown Apple model")
    this.status = "loading"
    this.error = null
    try {
      if (
        !(await browser.permissions.contains({
          origins: [APPLE_ORIGIN_PERMISSION],
          permissions: ["declarativeNetRequestWithHostAccess"]
        }))
      )
        throw new Error("Allow localhost access using Connect in AI settings.")
      // fm rejects browser Origin/Fetch-Metadata headers. Limit compatibility
      // strictly to this extension's POST to its fixed loopback completion endpoint;
      // web pages, other extensions and every other URL remain unaffected.
      await browser.declarativeNetRequest.updateSessionRules({
        removeRuleIds: [RULE_ID],
        addRules: [
          {
            id: RULE_ID,
            action: {
              type: "modifyHeaders",
              requestHeaders: [
                { header: "origin", operation: "remove" },
                { header: "sec-fetch-site", operation: "remove" }
              ]
            },
            condition: {
              regexFilter: "^http://127\\.0\\.0\\.1:1976/v1/chat/completions$",
              initiatorDomains: [browser.runtime.id],
              requestMethods: ["post"],
              resourceTypes: ["xmlhttprequest"]
            }
          }
        ]
      })
      const result = await this.request("/v1/models")
      if (!Array.isArray(result.data) || !result.data.some(item => object(item).id === "system"))
        throw new Error("Apple system model is unavailable")
      this.status = "ready"
      await browser.storage.session.set({ appleFmConnected: true })
    } catch (error) {
      this.status = "error"
      this.error = error instanceof Error ? error.message : "Apple model connection failed"
      throw error
    }
  }

  async unloadModel(): Promise<void> {
    // Disconnect this extension; the OS owns the model and the user's server.
    this.status = "idle"
    this.error = null
    await browser.storage.session.set({ appleFmConnected: false })
    await browser.declarativeNetRequest.updateSessionRules({ removeRuleIds: [RULE_ID] })
  }

  async isConnected(): Promise<boolean> {
    return (await browser.storage.session.get("appleFmConnected")).appleFmConnected === true
  }

  async complete(request: AiCompletionRequest): Promise<AiCompletionResponse> {
    try {
      // A worker restart loses the connection status, not the user's permission.
      if (!(await this.isConnected()))
        throw new Error("Connect to Apple Foundation Models in AI settings first.")
      if (this.status !== "ready") await this.loadModel(APPLE_MODEL_ID)
      const data = await this.request("/v1/chat/completions", {
        model: "system",
        messages: request.messages,
        stream: false,
        max_tokens: request.maxTokens ?? 256,
        temperature: request.temperature ?? 0.2,
        ...(request.responseSchema
          ? {
              response_format: {
                type: "json_schema",
                json_schema: { name: "response", schema: JSON.parse(request.responseSchema) }
              }
            }
          : {})
      })
      if (!Array.isArray(data.choices) || data.choices.length === 0)
        throw new Error("Apple model returned no choices")
      const choice = object(data.choices[0])
      const message = object(choice.message)
      if (typeof message.content !== "string")
        throw new Error("Apple model returned invalid content")
      return {
        content: message.content,
        finishReason: typeof choice.finish_reason === "string" ? choice.finish_reason : "unknown"
      }
    } catch (error) {
      this.status = "error"
      this.error = error instanceof Error ? error.message : "Apple model request failed"
      throw error
    }
  }
  async isAvailable(): Promise<boolean> {
    try {
      await this.loadModel(APPLE_MODEL_ID)
      return true
    } catch {
      return false
    }
  }
}
export const appleFmProvider = new AppleFmProvider()
