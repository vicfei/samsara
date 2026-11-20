# AI 开发工具切换/交接提示词

## 使用场景
当你从工具 A 切换到工具 B（如从 Kimi Code 切到 ZCode）时，发送此提示词让新工具快速恢复上下文。

---

## 场景一：标准交接（有 .context/ 目录）

**提示词正文**：
> “你好，我正在进行 WeKnora 的二次开发。当前开发分支是 `feature/tag-system`，项目根目录下有一个完整的 `.context/` 文件夹，存储了所有设计文档、Schema 和进度记录。”
>
> “请先按以下顺序阅读：”
> 1. `.context/README.md` —— 目录说明
> 2. `.context/sessions/progress.md` —— 当前开发进度
> 3. `.context/design/功能文档.md` —— 宏观架构
> 4. `.context/design/数据模型.md` —— 扩展表定义
> 5. `.context/design/外部接口.md` —— API 映射
>
> “阅读完成后，请告诉我当前项目状态和下一步计划，然后我们继续开发。”

---

## 场景二：快速恢复（没有 .context/ 或需要快速确认）

**提示词正文**：
> “我正在基于 WeKnora 进行二次开发，项目在 `~/WeKnora` 目录下，当前分支是 `feature/tag-system`。”
>
> “我们正在实现层级标签树（`tag_tree`）功能。请先快速阅读以下文件了解项目现状：”
> - `go.mod` —— 技术栈（Go 1.26+）
> - `internal/handler/knowledge_base.go` —— Handler 层写法
> - `internal/application/service/knowledgebase.go` —— Service 层写法
> - `internal/application/repository/knowledgebase.go` —— Repository 层写法
>
> “如果我们已经创建了 `internal/models/tag_tree.go`，请阅读它并告诉我当前进度。”

---

## 场景三：交叉验证（用新工具评审旧代码）

**提示词正文**：
> “上一个 AI 工具刚刚完成了 `tag_tree` 的代码。请你作为代码评审员，独立审查以下文件：”
>
> 1. `internal/models/tag_tree.go`
> 2. `internal/application/repository/tag_tree_repo.go`
> 3. `internal/application/service/tag_tree_service.go`
> 4. `internal/handler/tag_tree_handler.go`
>
> “请重点检查：”
> - 是否符合 WeKnora 的分层规范（Repository 只做数据访问，不含业务逻辑）
> - GORM 查询是否正确处理了软删除（`deleted_at IS NULL`）
> - 错误处理是否使用了项目统一的 `errors` 包
> - 是否有 SQL 注入或性能隐患（如 N+1 查询）
> - 事务是否正确使用
>
> “给出改进建议后，我们继续下一个功能。”
