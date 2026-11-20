# WeKnora 二开 - 编码规范与通用原则

## 一、分层规范（强制）

| 层级 | 目录 | 职责 | 禁止事项 |
|------|------|------|----------|
| **Model** | `internal/models/` | 定义数据结构和 GORM 注解 | 不得包含业务逻辑 |
| **Repository** | `internal/application/repository/` | 数据库 CRUD 操作 | 不得包含业务逻辑，只能做数据访问 |
| **Service** | `internal/application/service/` | 业务逻辑编排 | 不得直接操作 `*gorm.DB`，必须通过 Repository |
| **Handler** | `internal/handler/` | HTTP 请求处理、参数绑定、响应返回 | 不得包含业务逻辑，只能调用 Service |

## 二、依赖注入规范

- 所有依赖通过 `internal/container/container.go` 注册
- Service 依赖 Repository 接口（依赖倒置）
- Handler 依赖 Service 接口
- 示例：
  ```go
  type TagTreeService struct {
      repo repository.TagTreeRepository
  }
  func NewTagTreeService(repo repository.TagTreeRepository) *TagTreeService {
      return &TagTreeService{repo: repo}
  }
