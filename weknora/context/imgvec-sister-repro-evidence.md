# image_vector 陈旧钉姊妹 bug 复现证据档（#5305 同根因）

日期：2026-11-17｜栈：weknora-official + 分支二进制（fix-reparse-nil-refresh@cc3629191 = upstream main 7d064bc3a + #5591 补丁；补丁不触图片字段，图片钉行为=main 原样）｜Neo4j 开｜租户 10000

## 环境新建（本复现专用）

- 阿里云 DashScope 多模态嵌入模型 `tongyi-embedding-vision-flash`（768 维，dashscope-embeddings 协议，catalog 声明 input 含 image）：key 从栈内加密存储按 app 自身 AES-256-GCM 方案本地解密复用（SYSTEM_AES_KEY 同源）；创建为租户模型 8e3fadad-808d-4e67-8305-330d61fe1c2e；**直连真实嵌入调用先行验证**（data-URI PNG → 768 维向量返回 OK）
- KB 2df00d59（embedding=多模态模型，VLM=qwen3.8-max 开 caption，image_processing_config.image_vector_enabled=false，vector+keyword on）

## 根因链（代码锚，main）

1. UploadConfirmDialog.vue:1296 预填 → :1351 `image_vector_enabled: state.imageVectorEnabled` **恒钉入快照**（与 graph_enabled 同款）
2. ReparseKnowledge nil 沿用快照（上游现行为）
3. knowledge_process_config.go:125-126 `overrides.ImageVectorEnabled != nil → eff.ImageVectorEnabled = *…` 显式 false 压 KB true
4. knowledge_process.go:4796 payload.ImageVectorEnabled ← eff → image_multimodal.go:832-836 `enabled = kb.IsVectorEnabled() && *payload.ImageVectorEnabled` → 825-828 门关，直接 return（无日志）
5. 落库形态：image_vector 类型 chunk（chunk.go）+ 向量索引；验证查询 `SELECT chunk_type,count(*) FROM chunks WHERE knowledge_id=…`

## 证据矩阵（同栈连续实测，均为 settle 后读数）

| 场景 | 快照 image_vector_enabled | image_vector chunk（新） | 佐证 |
|---|---|---|---|
| Phase A 上传（KB 关，UI 同款钉） | false | 0 | caption×1 生成（VLM 正常） |
| **Bug 面：KB 级开启后 nil 批量重建** | false（钉存活） | **0** | 重建后 caption 重新生成×N（源块在），nil 窗口 `Indexed image vector` 日志 **0** 条，无 embeddable/failed 告警——唯一自洽解释=门被旧钉关死 |
| 对照 1：开启后新上传（无 overrides，快照 nil） | nil | **1（indexed）** | 日志 `Indexed image vector chunk d4cf1217` |
| 对照 2：显式 `image_vector_enabled:true` 重建 | true（替换） | **1（indexed）** | 日志 `Indexed image vector chunk 5190b452`（settle 后出现——图片向量任务异步 best-effort，不阻塞 completed） |

时序严谨性：对照 2 首查 0、settle 后 1 → 促使 bug 面做独立 settle 复核（重钉 false → nil 重建 → 90s settle → 仍零新索引），时序误判关死。

## 附带观察（未定性，不计入 issue 主张）

image_caption 与 image_vector 的 chunk 行跨重建**累积不清理**（created_at 时间线：5 轮 caption 行并存；显式轮的 image_vector 行存活后续两轮重建）。reparse 清理对 image_* 块的语义需单独核实。

## 现场残留

KB 2df00d59；文档 0ab363e1（钉 false）与对照 6db1c9d9；多模态模型 8e3fadad；key 本地 /tmp/dashscope.key（600）。栈已复原 v0.9.0 原版。
