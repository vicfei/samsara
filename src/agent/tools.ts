// 工具注册表与示例工具(接口文档 §5.4 ToolPlugin 的 M1 子集)
// 注册 = 可逆效应(主文档 §3.2.2 原生示例):工具插件在 start 里注册,卸载即注销;
// 执行经任务作用域 ctx —— 工具自决副作用分类(write 携带逆操作 + rebindArgs)。

import { mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { serviceKey } from "../kernel/types.js";
import type { PluginManifest, PluginModule, KernelContext } from "../kernel/types.js";

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
  run(args: unknown, ctx: KernelContext): Promise<ToolResult> | ToolResult;
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

export function fsToolPlugin(workDir: string): { manifest: PluginManifest; module: PluginModule } {
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
    run(args, ctx) {
      const { name, content } = args as { name?: string; content?: string };
      if (typeof name !== "string" || name.includes("/") || typeof content !== "string") {
        return { content: "错误:参数须为 {name(无路径分隔符), content}", ok: false };
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
    run(args) {
      const { name } = args as { name?: string };
      if (typeof name !== "string" || name.includes("/")) return { content: "错误:name 须为文件名", ok: false };
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
