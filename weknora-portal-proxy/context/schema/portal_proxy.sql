-- portal_proxy 数据库 DDL（B1 路线 POC）
-- 用法：
--   sudo docker exec WeKnora-postgres-dev psql -U postgres -c "CREATE DATABASE portal_proxy;"
--   sudo docker exec -i WeKnora-postgres-dev psql -U postgres -d portal_proxy < .context/schema/portal_proxy.sql
-- 清场：DROP DATABASE portal_proxy;
-- 约定：无外键（跨库+沿用 WeKnora "No FK by design"）；时间一律 TIMESTAMPTZ。

BEGIN;

-- ── 1. 员工目录（SSO 模拟 IdP 的账号源）─────────────────────────
CREATE TABLE IF NOT EXISTS employees (
    id            BIGSERIAL PRIMARY KEY,
    uum_user_id   VARCHAR(128) NOT NULL UNIQUE,
    display_name  VARCHAR(128) NOT NULL,
    password_hash VARCHAR(128) NOT NULL,            -- bcrypt
    is_admin      BOOLEAN      NOT NULL DEFAULT false,
    is_active     BOOLEAN      NOT NULL DEFAULT true,
    created_at    TIMESTAMPTZ  NOT NULL DEFAULT now(),
    updated_at    TIMESTAMPTZ  NOT NULL DEFAULT now()
);

-- ── 2. 核心：用户↔知识库 权限表 ─────────────────────────────────
CREATE TABLE IF NOT EXISTS kb_permissions (
    id           BIGSERIAL PRIMARY KEY,
    uum_user_id  VARCHAR(128) NOT NULL,             -- 逻辑关联 employees.uum_user_id
    kb_id        VARCHAR(36)  NOT NULL,             -- 逻辑关联 WeKnora.knowledge_bases.id（跨库）
    permission   VARCHAR(16)  NOT NULL DEFAULT 'viewer',  -- viewer | editor
    category     VARCHAR(32)  NOT NULL DEFAULT '团队',     -- 展示分组：个人|团队|公共
    status       VARCHAR(16)  NOT NULL DEFAULT 'active',  -- active | revoked（过期=读取时按 valid_until 惰性判定）
    valid_until  TIMESTAMPTZ,                       -- NULL=永久
    granted_by   VARCHAR(128) NOT NULL,
    reason       VARCHAR(255),
    created_at   TIMESTAMPTZ  NOT NULL DEFAULT now(),
    updated_at   TIMESTAMPTZ  NOT NULL DEFAULT now(),
    CONSTRAINT uq_kb_permissions_user_kb UNIQUE (uum_user_id, kb_id),
    CONSTRAINT chk_kb_permissions_perm CHECK (permission IN ('viewer', 'editor')),
    CONSTRAINT chk_kb_permissions_status CHECK (status IN ('active', 'revoked'))
);
CREATE INDEX IF NOT EXISTS idx_kb_permissions_user ON kb_permissions(uum_user_id);
CREATE INDEX IF NOT EXISTS idx_kb_permissions_kb   ON kb_permissions(kb_id);

-- ── 3. 门户会话 ──────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS portal_sessions (
    id           VARCHAR(36) PRIMARY KEY,           -- 即 cookie 值（UUID）
    uum_user_id  VARCHAR(128) NOT NULL,
    created_at   TIMESTAMPTZ  NOT NULL DEFAULT now(),
    expires_at   TIMESTAMPTZ  NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_portal_sessions_expires ON portal_sessions(expires_at);

-- ── 4. 实名审计（本路线唯一的用户级审计）─────────────────────────
CREATE TABLE IF NOT EXISTS audit_log (
    id         BIGSERIAL PRIMARY KEY,
    actor      VARCHAR(128) NOT NULL,               -- 工号；系统动作为 'system'
    action     VARCHAR(64)  NOT NULL,               -- grant|revoke|update_perm|login|logout|denied|upload|search
    target     VARCHAR(255) NOT NULL,
    detail     JSONB        NOT NULL DEFAULT '{}',
    created_at TIMESTAMPTZ  NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_audit_log_actor   ON audit_log(actor);
CREATE INDEX IF NOT EXISTS idx_audit_log_action  ON audit_log(action);
CREATE INDEX IF NOT EXISTS idx_audit_log_created ON audit_log(created_at);

COMMIT;

-- ── 种子员工（密码哈希请在初始化脚本里用 bcrypt 现算替换占位符）──
-- INSERT INTO employees (uum_user_id, display_name, password_hash, is_admin, is_active)
-- VALUES
--   ('REVIEW-A0001', '评审管理员', '$2a$10$<bcrypt-hash>', true,  true),
--   ('REVIEW-U0001', '评审用户一', '$2a$10$<bcrypt-hash>', false, true),
--   ('REVIEW-U0002', '评审用户二', '$2a$10$<bcrypt-hash>', false, true);
--
-- ── 种子授权示例（kb_id 填 WeKnora 实际值）───────────────────────
-- INSERT INTO kb_permissions (uum_user_id, kb_id, permission, category, granted_by, reason)
-- VALUES
--   ('REVIEW-U0001', '<kb-uuid-1>', 'editor', '团队', 'REVIEW-A0001', 'POC 演示'),
--   ('REVIEW-U0002', '<kb-uuid-1>', 'viewer', '团队', 'REVIEW-A0001', 'POC 演示'),
--   ('REVIEW-U0002', '<kb-uuid-2>', 'viewer', '公共', 'REVIEW-A0001', 'POC 演示');
--   -- 越权验证点：U0002 未被授予 <kb-uuid-3>，访问 /kb/<kb-uuid-3> 必须 404 并记审计 denied。
