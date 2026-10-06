// 工具注册表与示例工具(接口文档 §5.4 ToolPlugin 的 M1 子集)
// 注册 = 可逆效应(主文档 §3.2.2 原生示例):工具插件在 start 里注册,卸载即注销;
// 执行经任务作用域 ctx —— 工具自决副作用分类(write 携带逆操作 + rebindArgs)。

import { mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { serviceKey } from "../kernel/types.js";
import type { PluginManifest, PluginModule, KernelContext } from "../kernel/types.js";
import type { Skills } from "../l2/skills.js";

/** 任务信息(工具第三参,M1 扩展:save_skill 等会话感知工具用;M2 归并入 ctx) */
export interface TaskInfo {
  sessionKey: string;
  agentId: string;
  traceId: string;
}

export interface ToolResult {
  content: string;          // 回传给模型的内容
  ok?: boolean;             // 缺省 true
}

export interface AgentTool {
  name: string;
  description: string;      // ≤ 500 字符(接口 §5.4,防投毒)
  sideEffect: "none" | "read" | "write" | "destructive"; // K.1 分类挂点
  parameters?: Record<string, unknown>; // JSON Schema(M1 弱校验)
  pluginId?: string;        // 注册方填写:效应归属与重绑定发现
  run(args: unknown, ctx: KernelContext, task?: TaskInfo): Promise<ToolResult> | ToolResult;
}

export interface ToolRegistry {
  register(tool: AgentTool): AgentTool;
  unregister(name: string): boolean;
  get(name: string): AgentTool | undefined;
  list(): AgentTool[];
}

export const TOOL_REGISTRY = serviceKey<ToolRegistry>("tools.registry");

/** 注册表插件:唯一职责是持有工具清单;工具插件以可逆效应向它注册 */
export function toolRegistryPlugin(): { manifest: PluginManifest; module: PluginModule } {
  const tools = new Map<string, AgentTool>();
  return {
    manifest: {
      name: "tool-registry", version: "1.0.0", kind: "tool",
      provides: ["tools.registry"], requires: [], rLevel: "R0",
    },
    module: {
      start(ctx) {
        ctx.provide(TOOL_REGISTRY, {
          register(tool) { tools.set(tool.name, tool); return tool; },
          unregister(name) { return tools.delete(name); },
          get(name) { return tools.get(name); },
          list() { return [...tools.values()].sort((a, b) => a.name.localeCompare(b.name)); },
        });
      },
    },
  };
}

// ── 示例工具 1:calc(纯函数,sideEffect none)──────────────────

export function calcToolPlugin(): { manifest: PluginManifest; module: PluginModule } {
  const manifest: PluginManifest = {
    name: "tool-calc", version: "1.0.0", kind: "tool",
    provides: [], requires: ["tools.registry"], rLevel: "R0",
  };
  return {
    manifest,
    module: {
      start(ctx) {
        const registry = ctx.inject(TOOL_REGISTRY).get();
        ctx.effect(
          "register tool: calc",
          () => registry.register({
            name: "calc",
            description: "计算算术表达式,如 {\"expression\": \"2+3*4\"}",
            sideEffect: "none",
            parameters: { type: "object", properties: { expression: { type: "string" } }, required: ["expression"] },
            pluginId: "tool-calc@1.0.0",
            run(args) {
              const { expression } = args as { expression?: string };
              if (typeof expression !== "string" || !/^[0-9+\-*/().\s]+$/.test(expression)) {
                return { content: "错误:仅允许算术表达式(数字与 + - * / ( ) )", ok: false };
              }
              // 白名单后的表达式求值(不含标识符/字母,无注入面)
              const value = Function(`"use strict"; return (${expression});`)() as number;
              return { content: String(value) };
            },
          }),
          (tool) => { registry.unregister((tool as AgentTool).name); },
        );
      },
    },
  };
}

// ── 示例工具 2:fs(write 携带逆操作 + rebindArgs,read 只读)──

/** 会话工作区解析(M3-S3/K.2):write 需可写捕获层,read 只需根目录视图 */
export interface WorkspaceView {
  root: string;
  write(rel: string, content: string | Buffer): void;
  read(rel: string): string | undefined;
}

export function fsToolPlugin(workDir: string,
    wsOpts?: { workspaceFor?: (sessionKey: string, create: boolean) => WorkspaceView | undefined },
): { manifest: PluginManifest; module: PluginModule } {
  const pathOf = (n: string) => join(workDir, n);
  const manifest: PluginManifest = {
    name: "tool-fs", version: "1.0.0", kind: "tool",
    provides: [], requires: ["tools.registry"], rLevel: "R0",
  };
  const writeTool: AgentTool = {
    name: "write_file",
    description: "把内容写入工作区文件,如 {\"name\": \"result.txt\", \"content\": \"…\"}",
    sideEffect: "write", // 可补偿(K.1);此处实现为完全可逆
    parameters: { type: "object", properties: { name: { type: "string" }, content: { type: "string" } }, required: ["name", "content"] },
    pluginId: "tool-fs@1.0.0",
    run(args, ctx, task) {
      const { name, content } = args as { name?: string; content?: string };
      if (typeof name !== "string" || name.includes("/") || typeof content !== "string") {
        return { content: "错误:参数须为 {name(无路径分隔符), content}", ok: false };
      }
      // M3-S3(K.2):会话有捕获层则经覆盖层写(单效应承载整个会话工作区,原件可还原);
      // 无捕获层(向后兼容/cli run)保持逐写效应(agent 归属,逆=删除)
      const ws = task !== undefined ? wsOpts?.workspaceFor?.(task.sessionKey, true) : undefined;
      if (ws !== undefined) {
        try { ws.write(name, content); } catch (err) { return { content: `写入失败: ${String(err).slice(0, 100)}`, ok: false }; }
        return { content: `已写入 ${name}(${content.length} 字符;会话工作区可逆)` };
      }
      void ctx.effect(
        `write ${name}`,
        () => { mkdirSync(workDir, { recursive: true }); writeFileSync(pathOf(name), content); return pathOf(name); },
        () => { rmSync(pathOf(name)); },
        { rebindArgs: { name, content } }, // owner 默认=任务 agent(ctx 归属)
      );
      return { content: `已写入 ${name}(${content.length} 字符)` };
    },
  };
  const readTool: AgentTool = {
    name: "read_file",
    description: "读取工作区文件内容,如 {\"name\": \"result.txt\"}",
    sideEffect: "read",
    parameters: { type: "object", properties: { name: { type: "string" } }, required: ["name"] },
    pluginId: "tool-fs@1.0.0",
    run(args, _ctx, task) {
      const { name } = args as { name?: string };
      if (typeof name !== "string" || name.includes("/")) return { content: "错误:name 须为文件名", ok: false };
      // 会话工作区优先(捕获层直读);无则共享工作区
      const ws = task !== undefined ? wsOpts?.workspaceFor?.(task.sessionKey, false) : undefined;
      if (ws !== undefined) {
        const c = ws.read(name);
        return c !== undefined ? { content: c } : { content: `文件不存在: ${name}`, ok: false };
      }
      try { return { content: readFileSync(pathOf(name), "utf-8") }; }
      catch { return { content: `文件不存在: ${name}`, ok: false }; }
    },
  };
  return {
    manifest,
    module: {
      start(ctx) {
        const registry = ctx.inject(TOOL_REGISTRY).get();
        void ctx.effect("register tool: write_file", () => registry.register(writeTool),
          () => { registry.unregister("write_file"); });
        void ctx.effect("register tool: read_file", () => registry.register(readTool),
          () => { registry.unregister("read_file"); });
      },
      rebind(rc) { // 崩溃恢复:重挂文件写入效应(逆操作+前滚)。
        // 注册类效应不在此重挂——注册表本身随插件再激活重建(suspend→activate 重跑 start,
        // register 按 name 幂等),恢复编排属 M1 运行时组合层。
        for (const e of rc.knownEffects) {
          if (e.desc.startsWith("write ")) {
            const { name, content } = (e.rebindArgs ?? {}) as { name: string; content: string };
            rc.reattach(
              e.token,
              () => { rmSync(pathOf(name)); },
              undefined,
              () => { mkdirSync(workDir, { recursive: true }); writeFileSync(pathOf(name), content); },
            );
          }
        }
      },
    },
  };
}

// ── 技能沉淀工具(§6.1:任务成功后沉淀;sideEffect write,内容入 CAS 经账本)──

export function skillToolPlugin(skills: Skills): { manifest: PluginManifest; module: PluginModule } {
  const manifest: PluginManifest = {
    name: "tool-skill", version: "1.0.0", kind: "skill-store",
    provides: [], requires: ["tools.registry"], rLevel: "R0",
  };
  const readTool: AgentTool = {
    name: "read_skill",
    description: "读取全局技能的完整内容(步骤/陷阱),如 {\"name\": \"weekly-style\"};执行任务前需要技能详细步骤时调用",
    sideEffect: "read",
    parameters: { type: "object", properties: { name: { type: "string" } }, required: ["name"] },
    pluginId: "tool-skill@1.0.0",
    run(args) {
      const { name } = args as { name?: string };
      if (typeof name !== "string") return { content: "错误:需 {name}", ok: false };
      const content = skills.readMain(name);
      return content !== undefined ? { content } : { content: `全局无此技能: ${name}(仅 main 可读,分支技能晋升后可见)`, ok: false };
    },
  };
  const promoteTool: AgentTool = {
    name: "promote_skill",
    description: "把当前会话分支上的技能晋升为全局(所有会话可见),如 {\"name\": \"weekly-style\"};当用户说'晋升技能/设为全局/让所有会话可用'时调用",
    sideEffect: "write", // 晋升 = main 新版本(经账本,§6.4 R0/R1 自动合并的最小形态)
    parameters: { type: "object", properties: { name: { type: "string" } }, required: ["name"] },
    pluginId: "tool-skill@1.0.0",
    run(args, _ctx, task) {
      const { name } = args as { name?: string };
      if (typeof name !== "string" || task === undefined) {
        return { content: "错误:需 {name} 且在任务上下文中调用", ok: false };
      }
      try {
        const meta = skills.promote(task.sessionKey, name,
          { kind: "human" as const, id: task.sessionKey.split(":").pop() ?? "agent", trust: "owner" as const });
        return { content: `技能 ${meta.name} 已晋升全局 main(v${meta.version}),所有会话可见` };
      } catch (err) {
        return { content: `晋升失败: ${String(err)}`, ok: false };
      }
    },
  };
  return {
    manifest,
    module: {
      start(ctx) {
        const registry = ctx.inject(TOOL_REGISTRY).get();
        void ctx.effect("register tool: read_skill", () => registry.register(readTool),
          () => { registry.unregister("read_skill"); });
        void ctx.effect("register tool: promote_skill", () => registry.register(promoteTool),
          () => { registry.unregister("promote_skill"); });
        void ctx.effect("register tool: save_skill", () => registry.register({
          name: "save_skill",
          description: "沉淀技能到当前会话分支,如 {\"name\": \"weekly-style\", \"trigger\": \"写周报时\", \"body\": \"步骤…\"};frontmatter 自动组装",
          sideEffect: "write",
          parameters: {
            type: "object",
            properties: { name: { type: "string" }, trigger: { type: "string" }, body: { type: "string" } },
            required: ["name", "body"],
          },
          pluginId: "tool-skill@1.0.0",
          run(args, _ctx, task) {
            const { name, trigger, body } = args as { name?: string; trigger?: string; body?: string };
            if (typeof name !== "string" || typeof body !== "string" || task === undefined) {
              return { content: "错误:需 {name, trigger?, body} 且在任务上下文中调用", ok: false };
            }
            const markdown = `---\nname: ${name}\n${trigger !== undefined ? `trigger: ${trigger}\n` : ""}---\n\n${body}\n`;
            try {
              const meta = skills.write(task.sessionKey, name, markdown,
                { kind: "human" as const, id: "agent", trust: "owner" as const },
                { trace_id: task.traceId, source: "agent" });
              return { content: `技能 ${meta.name} v${meta.version} 已沉淀到会话分支(晋升后全局可见)` };
            } catch (err) {
              return { content: `沉淀失败: ${String(err)}`, ok: false };
            }
          },
        }), () => { registry.unregister("save_skill"); });
      },
    },
  };
}
