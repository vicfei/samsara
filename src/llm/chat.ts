// LLM 适配器(M1 最小版,主文档 §13"模型适配器插件" + 附录 E 前置)
// 模型即插件:提供 llm.chat 服务,可热替换(余效应的天然场景)。
// 完整模型注册表/自动路由属 M2(附录 E);M1 只需"给一个能对话的提供者"。

import { serviceKey } from "../kernel/types.js";
import type { PluginManifest, PluginModule } from "../kernel/types.js";
import type { KernelContext } from "../kernel/types.js";

// ── 服务契约(经 ctx.inject 消费;tool_desc_max_chars 式的防投毒约束随 M2 注册表)──

export interface ToolDef {
  name: string;
  description: string;
  parameters?: Record<string, unknown>;
}

export interface ToolCall {
  id: string;
  name: string;
  args: unknown;
}

export interface ChatMessage {
  role: "system" | "user" | "assistant" | "tool";
  content: string;
  /** assistant 消息携带的工具调用请求 */
  toolCalls?: ToolCall[];
  /** tool 角色消息对应的调用 id */
  toolCallId?: string;
}

export interface ChatRequest {
  messages: ChatMessage[];
  tools?: ToolDef[];
  model?: string;
  temperature?: number;
}

export interface ChatResult {
  content: string;
  /** 模型请求的工具调用(ReAct 动作决策) */
  toolCalls?: ToolCall[];
  finishReason?: "stop" | "tool_calls";
  modelLabel: string; // 实际使用的模型标识(入轨迹,供记分卡/影子验证)
  usage?: { promptTokens: number; completionTokens: number };
}

export interface ChatService {
  complete(req: ChatRequest): Promise<ChatResult>;
}

export const CHAT_SERVICE = serviceKey<ChatService>("llm.chat");

// ── Mock 提供者:脚本化回复——测试与无密钥演示用,零网络依赖 ──

/** mock 剧本条目:字符串=最终回复;对象=本轮工具调用 */
export type MockTurn = string | { toolCalls: ToolCall[] };

export function mockChatPlugin(
  script: MockTurn[] | ((req: ChatRequest) => MockTurn),
  modelLabel = "mock-1",
): { manifest: PluginManifest; module: PluginModule } {
  const queue = Array.isArray(script) ? [...script] : [];
  const resolve = (req: ChatRequest): MockTurn =>
    typeof script === "function"
      ? script(req)
      : (queue.length > 1 ? queue.shift() : queue[0]) ?? "(mock 空剧本)";
  return {
    manifest: {
      name: "llm-mock", version: "1.0.0", kind: "tool",
      provides: ["llm.chat"], requires: [], rLevel: "R0",
    },
    module: {
      start(ctx: KernelContext) {
        ctx.provide(CHAT_SERVICE, {
          async complete(req) {
            const promptTokens = req.messages.reduce((n, m) => n + m.content.length, 0);
            const turn = resolve(req);
            if (typeof turn !== "string") {
              const content = `调用工具: ${turn.toolCalls.map((c) => c.name).join(", ")}`;
              return {
                content, toolCalls: turn.toolCalls, finishReason: "tool_calls" as const, modelLabel,
                usage: { promptTokens, completionTokens: content.length },
              };
            }
            return { content: turn, finishReason: "stop" as const, modelLabel, usage: { promptTokens, completionTokens: turn.length } };
          },
        });
      },
    },
  };
}

// ── OpenAI 兼容提供者:环境变量驱动;未配密钥时不激活 ──

export interface OpenAICompatOptions {
  baseUrl?: string;   // 默认 https://api.openai.com/v1(兼容任何 OpenAI 风格网关)
  apiKey?: string;    // 默认 env OPENAI_API_KEY——凭据永不入轨迹/账本(附录 E.1)
  model: string;
}

export function openAICompatChatPlugin(opts: OpenAICompatOptions): { manifest: PluginManifest; module: PluginModule } {
  const baseUrl = opts.baseUrl ?? "https://api.openai.com/v1";
  const model = opts.model;
  return {
    manifest: {
      name: "llm-openai-compat", version: "1.0.0", kind: "tool",
      provides: ["llm.chat"], requires: [], rLevel: "R0",
    },
    module: {
      start(ctx: KernelContext) {
        const apiKey = opts.apiKey ?? process.env.OPENAI_API_KEY;
        if (!apiKey) throw new Error("OPENAI_API_KEY 未配置(提供者拒绝启动,服务不半价)");
        ctx.provide(CHAT_SERVICE, {
          async complete(req) {
            const messages = req.messages.map((m) => ({
              role: m.role,
              content: m.content,
              ...(m.toolCalls ? { tool_calls: m.toolCalls.map((c) => ({ id: c.id, type: "function", function: { name: c.name, arguments: JSON.stringify(c.args) } })) } : {}),
              ...(m.toolCallId ? { tool_call_id: m.toolCallId } : {}),
            }));
            const res = await fetch(`${baseUrl}/chat/completions`, {
              method: "POST",
              headers: { "content-type": "application/json", authorization: `Bearer ${apiKey}` },
              body: JSON.stringify({
                model: req.model ?? model,
                temperature: req.temperature,
                messages,
                ...(req.tools ? { tools: req.tools.map((t) => ({ type: "function", function: { name: t.name, description: t.description, ...(t.parameters ? { parameters: t.parameters } : {}) } })) } : {}),
              }),
            });
            if (!res.ok) throw new Error(`LLM 网关 ${res.status}: ${await res.text()}`);
            const data = (await res.json()) as {
              choices: { message: { content: string; tool_calls?: { id: string; function: { name: string; arguments: string } }[] }; finish_reason?: string }[];
              usage?: { prompt_tokens: number; completion_tokens: number };
            };
            const choice = data.choices[0];
            const toolCalls = choice?.message?.tool_calls?.map((c) => {
              let args: unknown = {};
              try { args = JSON.parse(c.function.arguments); } catch { args = { _raw: c.function.arguments }; }
              return { id: c.id, name: c.function.name, args };
            });
            return {
              content: choice?.message?.content ?? "",
              ...(toolCalls ? { toolCalls } : {}),
              ...(choice?.finish_reason ? { finishReason: choice.finish_reason as "stop" | "tool_calls" } : {}),
              modelLabel: req.model ?? model,
              ...(data.usage ? { usage: { promptTokens: data.usage.prompt_tokens, completionTokens: data.usage.completion_tokens } } : {}),
            };
          },
        });
      },
    },
  };
}
