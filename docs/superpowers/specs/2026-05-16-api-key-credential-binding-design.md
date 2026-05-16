> **注：** 本文档由 **claude-sonnet-4-6** 模型自动生成。

# API Key 凭据绑定功能设计

## 概述

允许管理员在创建或编辑 API Key 时，将该 Key 绑定到指定的凭据账号。绑定后，该 Key 的所有请求只使用绑定凭据的 token，不参与全局调度。

## 数据模型

### `ApiKey`（`src/model/api_key.rs`）

新增字段：

```rust
#[serde(default)]
#[serde(skip_serializing_if = "Option::is_none")]
pub pinned_credential_id: Option<u64>,
```

向后兼容：旧 JSON 无此字段时反序列化为 `None`。

### `ApiKeyAuthResult::Valid`（`src/model/api_key.rs`）

```rust
Valid {
    id: u32,
    name: String,
    spending_limit: Option<f64>,
    pinned_credential_id: Option<u64>,  // 新增
}
```

### `ApiKeyContext`（`src/anthropic/middleware.rs`）

```rust
pub struct ApiKeyContext {
    pub id: u32,
    pub spending_limit: Option<f64>,
    pub pinned_credential_id: Option<u64>,  // 新增
}
```

### `CreateApiKeyRequest` / `UpdateApiKeyRequest`（`src/admin/types.rs`）

```rust
// CreateApiKeyRequest 新增
pub pinned_credential_id: Option<u64>,

// UpdateApiKeyRequest 新增（双层 Option：外层 None = 不修改，内层 None = 解除绑定）
pub pinned_credential_id: Option<Option<u64>>,
```

## 后端调度逻辑

### `MultiTokenManager::acquire_context_for`（`src/kiro/token_manager.rs`）

新增方法，按指定凭据 ID 直接获取 CallContext，不走正常调度：

```rust
pub async fn acquire_context_for(&self, credential_id: u64) -> anyhow::Result<CallContext>
```

行为：
- 按 ID 查找凭据 entry
- 凭据不存在或已禁用 → 返回 `Err`，不重试其他凭据，不自愈
- Token 过期 → 复用现有 `try_ensure_token` 刷新
- 成功 → 返回 `CallContext`

### `KiroProvider`（`src/kiro/provider.rs`）

`call` / `call_stream` 入口新增 `pinned_credential_id: Option<u64>` 参数：

- `Some(id)` → 调用 `acquire_context_for(id)`，失败直接返回 503
- `None` → 走现有 `acquire_context` 正常调度

### `anthropic/handlers.rs`

从 `ApiKeyContext` 取出 `pinned_credential_id`，传给 provider 调用。

### 错误响应

凭据不存在或已禁用时返回：

```json
{
  "type": "service_unavailable",
  "message": "Pinned credential #3 not found or disabled"
}
```

HTTP 状态码：`503 Service Unavailable`

## 前端 UI

### 创建 Key 对话框

- 新增「绑定凭据」下拉，位于名称输入框下方、有效期/额度设置上方
- 选项列表从 `useCredentials()` 拉取，格式：`凭据 #1 (email@example.com)` 或 `凭据 #1`
- 第一项固定为「不绑定（使用全局调度）」，值为 `null`

### 编辑 Key 对话框

- 同样新增「绑定凭据」下拉
- 回显当前绑定状态，可修改或解除绑定（选「不绑定」即解除）

### Key 卡片

- 已绑定时在 Key 名称旁显示 badge：`📌 凭据 #1`
- 未绑定不显示

### 前端类型（`admin-ui/src/types/api.ts`）

```typescript
interface CreateApiKeyRequest {
  // ...existing fields...
  pinnedCredentialId?: number | null
}

interface UpdateApiKeyRequest {
  // ...existing fields...
  pinnedCredentialId?: number | null
}

interface ApiKeyItem {
  // ...existing fields...
  pinnedCredentialId?: number | null
}
```

## 变更文件清单

| 文件 | 变更类型 |
|------|----------|
| `src/model/api_key.rs` | 新增字段、更新 `ApiKeyAuthResult`、`create`/`update` 方法 |
| `src/admin/types.rs` | 新增请求字段 |
| `src/admin/api_keys.rs` | 透传 `pinned_credential_id` 到 manager |
| `src/anthropic/middleware.rs` | `ApiKeyContext` 新增字段，认证逻辑透传 |
| `src/anthropic/handlers.rs` | 取出 pinned ID 传给 provider |
| `src/kiro/token_manager.rs` | 新增 `acquire_context_for` 方法 |
| `src/kiro/provider.rs` | `call`/`call_stream` 支持 pinned 调度 |
| `admin-ui/src/types/api.ts` | 新增类型字段 |
| `admin-ui/src/api/credentials.ts` | 透传新字段 |
| `admin-ui/src/components/api-keys-panel.tsx` | 创建/编辑对话框 + 卡片 badge |
