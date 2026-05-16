# API Key 凭据绑定 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 允许管理员在创建或编辑 API Key 时绑定指定凭据，绑定后该 Key 的所有请求只使用该凭据的 token，不参与全局调度。

**Architecture:** 在 `ApiKey` 数据模型中新增 `pinned_credential_id: Option<u64>` 字段，认证中间件将其注入 `ApiKeyContext`，handler 取出后传给 `KiroProvider`，provider 通过新增的 `acquire_context_for(id)` 方法绕过正常调度直接使用指定凭据。

**Tech Stack:** Rust (axum, serde, parking_lot), React + TypeScript (TanStack Query)

---

## 文件变更清单

| 文件 | 变更 |
|------|------|
| `src/model/api_key.rs` | `ApiKey` 新增字段；`ApiKeyAuthResult::Valid` 新增字段；`create`/`update` 方法透传 |
| `src/admin/types.rs` | `CreateApiKeyRequest` / `UpdateApiKeyRequest` 新增字段 |
| `src/admin/api_keys.rs` | `create_api_key` / `update_api_key` 透传新字段 |
| `src/anthropic/middleware.rs` | `ApiKeyContext` 新增字段；认证逻辑透传 |
| `src/anthropic/handlers.rs` | `post_messages` 取出 pinned ID 传给 provider |
| `src/kiro/token_manager.rs` | 新增 `acquire_context_for` 方法 |
| `src/kiro/provider.rs` | `call_api` / `call_api_stream` 新增 `pinned_credential_id` 参数 |
| `admin-ui/src/types/api.ts` | `ApiKeyItem` / `CreateApiKeyRequest` / `UpdateApiKeyRequest` 新增字段 |
| `admin-ui/src/api/credentials.ts` | `createApiKey` / `updateApiKey` 透传新字段 |
| `admin-ui/src/components/api-keys-panel.tsx` | 创建/编辑对话框新增下拉；卡片新增 badge |

---

### Task 1: 数据模型 — `ApiKey` 和 `ApiKeyAuthResult`

**Files:**
- Modify: `src/model/api_key.rs`

- [ ] **Step 1: 在 `ApiKey` struct 中新增字段**

在 `activated_at` 字段后添加：

```rust
/// 绑定的凭据 ID（None 表示不绑定，使用全局调度）
#[serde(default)]
#[serde(skip_serializing_if = "Option::is_none")]
pub pinned_credential_id: Option<u64>,
```

- [ ] **Step 2: 更新 `ApiKeyAuthResult::Valid`**

将：
```rust
Valid { id: u32, name: String, spending_limit: Option<f64> },
```
改为：
```rust
Valid { id: u32, name: String, spending_limit: Option<f64>, pinned_credential_id: Option<u64> },
```

- [ ] **Step 3: 更新 `authenticate` 方法中的 `Valid` 构造**

在 `authenticate` 方法中，将：
```rust
ApiKeyAuthResult::Valid {
    id: api_key.id,
    name: api_key.name.clone(),
    spending_limit: api_key.spending_limit,
}
```
改为：
```rust
ApiKeyAuthResult::Valid {
    id: api_key.id,
    name: api_key.name.clone(),
    spending_limit: api_key.spending_limit,
    pinned_credential_id: api_key.pinned_credential_id,
}
```

- [ ] **Step 4: 更新 `authenticate_readonly` 方法中的 `Valid` 构造**

同样将：
```rust
ApiKeyAuthResult::Valid {
    id: api_key.id,
    name: api_key.name.clone(),
    spending_limit: api_key.spending_limit,
}
```
改为：
```rust
ApiKeyAuthResult::Valid {
    id: api_key.id,
    name: api_key.name.clone(),
    spending_limit: api_key.spending_limit,
    pinned_credential_id: api_key.pinned_credential_id,
}
```

- [ ] **Step 5: 更新 `ApiKey::new` 和 `create` 方法**

`ApiKey::new` 签名新增参数：
```rust
pub fn new(
    id: u32,
    name: String,
    expires_at: Option<DateTime<Utc>>,
    spending_limit: Option<f64>,
    duration_days: Option<f64>,
    pinned_credential_id: Option<u64>,
) -> Self {
    Self {
        id,
        key: generate_api_key(),
        name,
        enabled: true,
        created_at: Utc::now(),
        expires_at,
        spending_limit,
        duration_days,
        activated_at: None,
        pinned_credential_id,
    }
}
```

`ApiKeyManager::create` 签名新增参数：
```rust
pub fn create(
    &self,
    name: String,
    expires_at: Option<DateTime<Utc>>,
    spending_limit: Option<f64>,
    duration_days: Option<f64>,
    pinned_credential_id: Option<u64>,
) -> anyhow::Result<ApiKey> {
    let mut keys = self.keys.write();
    let next_id = keys.iter().map(|k| k.id).max().unwrap_or(0) + 1;
    let api_key = ApiKey::new(next_id, name, expires_at, spending_limit, duration_days, pinned_credential_id);
    keys.push(api_key.clone());
    drop(keys);
    self.save()?;
    Ok(api_key)
}
```

- [ ] **Step 6: 更新 `update` 方法**

在 `update` 方法签名中新增参数 `pinned_credential_id: Option<Option<u64>>`（外层 None = 不修改，内层 None = 解除绑定），并在方法体末尾 `let updated = api_key.clone();` 之前添加：

```rust
if let Some(pinned) = pinned_credential_id {
    api_key.pinned_credential_id = pinned;
}
```

完整新签名：
```rust
pub fn update(
    &self,
    id: u32,
    name: Option<String>,
    enabled: Option<bool>,
    expires_at: Option<Option<DateTime<Utc>>>,
    spending_limit: Option<Option<f64>>,
    duration_days: Option<Option<f64>>,
    pinned_credential_id: Option<Option<u64>>,
) -> anyhow::Result<Option<ApiKey>>
```

- [ ] **Step 7: 编译验证**

```bash
cd "/Users/MacBook/My Files/Code/sourcetree/kiro2cc-proxy-local"
cargo check 2>&1 | head -50
```

预期：编译错误（`create`/`update` 调用方参数不匹配），这是正常的，后续任务会修复。

- [ ] **Step 8: Commit**

```bash
git add src/model/api_key.rs
git commit -m "feat: add pinned_credential_id to ApiKey model and auth result"
```

---

### Task 2: Admin 请求类型 + Handler 透传

**Files:**
- Modify: `src/admin/types.rs`
- Modify: `src/admin/api_keys.rs`

- [ ] **Step 1: `CreateApiKeyRequest` 新增字段**

在 `src/admin/types.rs` 的 `CreateApiKeyRequest` 中，在 `duration_days` 字段后添加：

```rust
/// 绑定的凭据 ID（None 表示不绑定）
#[serde(default)]
pub pinned_credential_id: Option<u64>,
```

- [ ] **Step 2: `UpdateApiKeyRequest` 新增字段**

在 `UpdateApiKeyRequest` 中，在 `duration_days` 字段后添加：

```rust
/// 绑定的凭据 ID（外层 None = 不修改，内层 None = 解除绑定）
#[serde(default, deserialize_with = "deserialize_optional_u64")]
pub pinned_credential_id: Option<Option<u64>>,
```

并在文件中添加对应的反序列化辅助函数（与 `deserialize_optional_f64` 同位置）：

```rust
fn deserialize_optional_u64<'de, D>(
    deserializer: D,
) -> Result<Option<Option<u64>>, D::Error>
where
    D: serde::Deserializer<'de>,
{
    use serde::Deserialize;
    let opt: Option<Option<u64>> = Option::deserialize(deserializer)?;
    Ok(opt)
}
```

- [ ] **Step 3: 更新 `create_api_key` handler**

在 `src/admin/api_keys.rs` 的 `create_api_key` 函数中，将：
```rust
match manager.create(payload.name, payload.expires_at, payload.spending_limit, payload.duration_days) {
```
改为：
```rust
match manager.create(payload.name, payload.expires_at, payload.spending_limit, payload.duration_days, payload.pinned_credential_id) {
```

- [ ] **Step 4: 更新 `update_api_key` handler**

在 `update_api_key` 函数中，将：
```rust
match manager.update(id, payload.name, payload.enabled, payload.expires_at, payload.spending_limit, payload.duration_days) {
```
改为：
```rust
match manager.update(id, payload.name, payload.enabled, payload.expires_at, payload.spending_limit, payload.duration_days, payload.pinned_credential_id) {
```

- [ ] **Step 5: 编译验证**

```bash
cargo check 2>&1 | head -50
```

预期：`ApiKeyAuthResult::Valid` 相关的编译错误（middleware 还未更新），其余错误应已消除。

- [ ] **Step 6: Commit**

```bash
git add src/admin/types.rs src/admin/api_keys.rs
git commit -m "feat: add pinned_credential_id to create/update API key request types"
```

---

### Task 3: 中间件 `ApiKeyContext` 透传

**Files:**
- Modify: `src/anthropic/middleware.rs`

- [ ] **Step 1: `ApiKeyContext` 新增字段**

将：
```rust
pub struct ApiKeyContext {
    pub id: u32,
    pub spending_limit: Option<f64>,
}
```
改为：
```rust
pub struct ApiKeyContext {
    pub id: u32,
    pub spending_limit: Option<f64>,
    pub pinned_credential_id: Option<u64>,
}
```

- [ ] **Step 2: 更新主密钥路径的 `ApiKeyContext` 构造**

将：
```rust
request.extensions_mut().insert(ApiKeyContext {
    id: 0,
    spending_limit: None,
});
```
改为：
```rust
request.extensions_mut().insert(ApiKeyContext {
    id: 0,
    spending_limit: None,
    pinned_credential_id: None,
});
```

- [ ] **Step 3: 更新子 API Key 路径的 `ApiKeyContext` 构造**

将：
```rust
request.extensions_mut().insert(ApiKeyContext {
    id,
    spending_limit,
});
```
改为：
```rust
request.extensions_mut().insert(ApiKeyContext {
    id,
    spending_limit,
    pinned_credential_id,
});
```

并在 `ApiKeyAuthResult::Valid { id, name, spending_limit }` 的模式匹配中同步解构新字段：
```rust
ApiKeyAuthResult::Valid { id, name, spending_limit, pinned_credential_id } => {
```

- [ ] **Step 4: 编译验证**

```bash
cargo check 2>&1 | head -50
```

预期：只剩 `token_manager.rs` 和 `provider.rs` 相关错误。

- [ ] **Step 5: Commit**

```bash
git add src/anthropic/middleware.rs
git commit -m "feat: propagate pinned_credential_id through ApiKeyContext"
```

---

### Task 4: `MultiTokenManager::acquire_context_for`

**Files:**
- Modify: `src/kiro/token_manager.rs`

- [ ] **Step 1: 新增 `acquire_context_for` 方法**

在 `MultiTokenManager` 的 `impl` 块中，在 `acquire_context` 方法之后添加：

```rust
/// 按指定凭据 ID 直接获取 CallContext，不走正常调度
///
/// 凭据不存在或已禁用时返回 Err，不重试其他凭据
pub async fn acquire_context_for(&self, credential_id: u64) -> anyhow::Result<CallContext> {
    let credentials = {
        let entries = self.entries.lock();
        let entry = entries
            .iter()
            .find(|e| e.id == credential_id)
            .ok_or_else(|| anyhow::anyhow!("Pinned credential #{} not found", credential_id))?;
        if entry.disabled {
            anyhow::bail!("Pinned credential #{} is disabled", credential_id);
        }
        entry.credentials.clone()
    };
    self.try_ensure_token(credential_id, &credentials).await
}
```

- [ ] **Step 2: 编译验证**

```bash
cargo check 2>&1 | head -50
```

预期：`token_manager.rs` 无新错误。

- [ ] **Step 3: Commit**

```bash
git add src/kiro/token_manager.rs
git commit -m "feat: add acquire_context_for to MultiTokenManager for pinned credential dispatch"
```

---

### Task 5: `KiroProvider` 支持 pinned 调度

**Files:**
- Modify: `src/kiro/provider.rs`

- [ ] **Step 1: 更新 `call_api` 签名**

将：
```rust
pub async fn call_api(&self, request_body: &str) -> anyhow::Result<reqwest::Response> {
    self.call_api_with_retry(request_body, false).await
}
```
改为：
```rust
pub async fn call_api(&self, request_body: &str, pinned_credential_id: Option<u64>) -> anyhow::Result<reqwest::Response> {
    self.call_api_with_retry(request_body, false, pinned_credential_id).await
}
```

- [ ] **Step 2: 更新 `call_api_stream` 签名**

将：
```rust
pub async fn call_api_stream(&self, request_body: &str) -> anyhow::Result<reqwest::Response> {
    self.call_api_with_retry(request_body, true).await
}
```
改为：
```rust
pub async fn call_api_stream(&self, request_body: &str, pinned_credential_id: Option<u64>) -> anyhow::Result<reqwest::Response> {
    self.call_api_with_retry(request_body, true, pinned_credential_id).await
}
```

- [ ] **Step 3: 更新 `call_api_with_retry` 签名和逻辑**

将方法签名改为：
```rust
async fn call_api_with_retry(
    &self,
    request_body: &str,
    is_stream: bool,
    pinned_credential_id: Option<u64>,
) -> anyhow::Result<reqwest::Response>
```

在方法体中，将获取 `ctx` 的代码：
```rust
let ctx = match self.token_manager.acquire_context(model.as_deref()).await {
    Ok(c) => c,
    Err(e) => {
        last_error = Some(e);
        continue;
    }
};
```
改为：
```rust
let ctx = if let Some(pinned_id) = pinned_credential_id {
    // pinned 模式：直接使用指定凭据，失败不重试
    match self.token_manager.acquire_context_for(pinned_id).await {
        Ok(c) => c,
        Err(e) => {
            return Err(e);
        }
    }
} else {
    match self.token_manager.acquire_context(model.as_deref()).await {
        Ok(c) => c,
        Err(e) => {
            last_error = Some(e);
            continue;
        }
    }
};
```

- [ ] **Step 4: 编译验证**

```bash
cargo check 2>&1 | head -50
```

预期：`handlers.rs` 中 `call_api` / `call_api_stream` 调用参数不匹配的错误。

- [ ] **Step 5: Commit**

```bash
git add src/kiro/provider.rs
git commit -m "feat: add pinned_credential_id param to KiroProvider call methods"
```

---

### Task 6: Handler 取出 pinned ID 并传给 provider

**Files:**
- Modify: `src/anthropic/handlers.rs`

- [ ] **Step 1: 从 `ApiKeyContext` 取出 `pinned_credential_id`**

在 `post_messages` 函数中，找到：
```rust
let api_key_id = identity.map(|ext| ext.0.id);
```
改为：
```rust
let pinned_credential_id = identity.as_ref().map(|ext| ext.0.pinned_credential_id).flatten();
let api_key_id = identity.map(|ext| ext.0.id);
```

- [ ] **Step 2: 更新流式调用**

找到 `handle_stream_request` 调用，新增参数：
```rust
handle_stream_request(
    provider,
    &request_body,
    &payload.model,
    input_tokens,
    thinking_enabled,
    usage_tracker,
    api_key_id,
    prompt_cache_usage,
    pinned_credential_id,
)
.await
```

- [ ] **Step 3: 更新非流式调用**

找到 `handle_non_stream_request` 调用，新增参数：
```rust
handle_non_stream_request(
    provider,
    &request_body,
    &payload.model,
    input_tokens,
    usage_tracker,
    api_key_id,
    prompt_cache_usage,
    pinned_credential_id,
)
.await
```

- [ ] **Step 4: 更新 `handle_stream_request` 函数签名和内部调用**

函数签名新增参数：
```rust
async fn handle_stream_request(
    provider: std::sync::Arc<crate::kiro::provider::KiroProvider>,
    request_body: &str,
    model: &str,
    input_tokens: i32,
    thinking_enabled: bool,
    usage_tracker: Option<std::sync::Arc<crate::model::usage::UsageTracker>>,
    api_key_id: Option<u32>,
    prompt_cache_usage: crate::cache::PromptCacheUsage,
    pinned_credential_id: Option<u64>,
) -> Response
```

将内部调用：
```rust
let response = match provider.call_api_stream(request_body).await {
```
改为：
```rust
let response = match provider.call_api_stream(request_body, pinned_credential_id).await {
```

- [ ] **Step 5: 更新 `handle_non_stream_request` 函数签名和内部调用**

找到 `handle_non_stream_request` 函数，同样新增 `pinned_credential_id: Option<u64>` 参数，并将内部的 `provider.call_api(request_body)` 改为 `provider.call_api(request_body, pinned_credential_id)`。

- [ ] **Step 6: 完整编译**

```bash
cargo build 2>&1 | head -80
```

预期：编译成功，无错误。

- [ ] **Step 7: Commit**

```bash
git add src/anthropic/handlers.rs
git commit -m "feat: pass pinned_credential_id from ApiKeyContext to KiroProvider"
```

---

### Task 7: 前端类型和 API 层

**Files:**
- Modify: `admin-ui/src/types/api.ts`
- Modify: `admin-ui/src/api/credentials.ts`

- [ ] **Step 1: 更新 `ApiKeyItem` 类型**

在 `admin-ui/src/types/api.ts` 的 `ApiKeyItem` 接口中，在 `activatedAt` 后添加：
```typescript
pinnedCredentialId?: number | null
```

- [ ] **Step 2: 更新 `CreateApiKeyRequest` 类型**

在 `CreateApiKeyRequest` 接口中，在 `durationDays` 后添加：
```typescript
pinnedCredentialId?: number | null
```

- [ ] **Step 3: 更新 `UpdateApiKeyRequest` 类型**

在 `UpdateApiKeyRequest` 接口中，在 `durationDays` 后添加：
```typescript
pinnedCredentialId?: number | null
```

- [ ] **Step 4: Commit**

```bash
git add admin-ui/src/types/api.ts admin-ui/src/api/credentials.ts
git commit -m "feat: add pinnedCredentialId to frontend API key types"
```

---

### Task 8: 前端 UI — 创建/编辑对话框 + 卡片 badge

**Files:**
- Modify: `admin-ui/src/components/api-keys-panel.tsx`

- [ ] **Step 1: 新增 state 变量**

在现有 state 声明区域（`newName`, `newMode` 等附近）添加：
```typescript
const [newPinnedCredentialId, setNewPinnedCredentialId] = useState<number | null>(null)
const [editPinnedCredentialId, setEditPinnedCredentialId] = useState<number | null>(null)
```

- [ ] **Step 2: 引入凭据数据**

在 `useApiKeys()` 等 hook 调用附近添加：
```typescript
const { data: credentialsData } = useCredentials()
```

确认 `useCredentials` 已从 `@/hooks/use-credentials` 导出（查看该文件确认 hook 名称）。

- [ ] **Step 3: 更新 `handleCreate` 函数**

将：
```typescript
createKey(
  {
    name: newName,
    ...(newMode === 'date'
      ? newDuration !== null
        ? { durationDays: toDays(newDuration, newDurationUnit) }
        : {}
      : { spendingLimit: newSpendingLimit }),
  },
```
改为：
```typescript
createKey(
  {
    name: newName,
    ...(newMode === 'date'
      ? newDuration !== null
        ? { durationDays: toDays(newDuration, newDurationUnit) }
        : {}
      : { spendingLimit: newSpendingLimit }),
    ...(newPinnedCredentialId !== null ? { pinnedCredentialId: newPinnedCredentialId } : {}),
  },
```

并在 `onSuccess` 回调中重置：
```typescript
setNewPinnedCredentialId(null)
```

- [ ] **Step 4: 更新编辑对话框打开逻辑**

找到 `setEditingKey(key)` 调用处，在其后添加：
```typescript
setEditPinnedCredentialId(key.pinnedCredentialId ?? null)
```

- [ ] **Step 5: 更新编辑提交逻辑**

找到 `updateKey` 调用，在传入的对象中添加：
```typescript
pinnedCredentialId: editPinnedCredentialId,
```

- [ ] **Step 6: 在创建对话框中添加凭据下拉**

在创建对话框的名称输入框 `<Input>` 之后、有效期/额度设置之前，添加：

```tsx
<div className="space-y-2">
  <label className="text-sm font-medium">绑定凭据</label>
  <select
    className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm"
    value={newPinnedCredentialId ?? ''}
    onChange={(e) => setNewPinnedCredentialId(e.target.value ? Number(e.target.value) : null)}
  >
    <option value="">不绑定（使用全局调度）</option>
    {credentialsData?.credentials.map((c) => (
      <option key={c.id} value={c.id}>
        凭据 #{c.id}{c.email ? ` (${c.email})` : ''}
      </option>
    ))}
  </select>
</div>
```

- [ ] **Step 7: 在编辑对话框中添加凭据下拉**

在编辑对话框的名称输入框之后添加相同结构，但绑定 `editPinnedCredentialId` / `setEditPinnedCredentialId`：

```tsx
<div className="space-y-2">
  <label className="text-sm font-medium">绑定凭据</label>
  <select
    className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm"
    value={editPinnedCredentialId ?? ''}
    onChange={(e) => setEditPinnedCredentialId(e.target.value ? Number(e.target.value) : null)}
  >
    <option value="">不绑定（使用全局调度）</option>
    {credentialsData?.credentials.map((c) => (
      <option key={c.id} value={c.id}>
        凭据 #{c.id}{c.email ? ` (${c.email})` : ''}
      </option>
    ))}
  </select>
</div>
```

- [ ] **Step 8: 在 Key 卡片中添加 badge**

找到 Key 卡片中显示 Key 名称的位置，在名称旁添加：

```tsx
{key.pinnedCredentialId != null && (
  <span className="inline-flex items-center rounded-full bg-blue-100 px-2 py-0.5 text-xs font-medium text-blue-800 dark:bg-blue-900 dark:text-blue-200">
    📌 凭据 #{key.pinnedCredentialId}
  </span>
)}
```

- [ ] **Step 9: 前端类型检查**

```bash
cd "/Users/MacBook/My Files/Code/sourcetree/kiro2cc-proxy-local/admin-ui"
npm run build 2>&1 | tail -30
```

预期：构建成功，无 TypeScript 错误。

- [ ] **Step 10: Commit**

```bash
cd "/Users/MacBook/My Files/Code/sourcetree/kiro2cc-proxy-local"
git add admin-ui/src/components/api-keys-panel.tsx
git commit -m "feat: add credential binding UI to API key create/edit dialogs and card badge"
```

---

### Task 9: 集成验证

- [ ] **Step 1: 完整后端编译**

```bash
cd "/Users/MacBook/My Files/Code/sourcetree/kiro2cc-proxy-local"
cargo build --release 2>&1 | tail -20
```

预期：编译成功。

- [ ] **Step 2: 前端构建**

```bash
cd admin-ui && npm run build 2>&1 | tail -20
```

预期：构建成功。

- [ ] **Step 3: 功能验证清单**

手动验证以下场景：
1. 创建 API Key 时选择绑定凭据 → Key 卡片显示 `📌 凭据 #N`
2. 编辑 API Key 修改绑定凭据 → 卡片 badge 更新
3. 编辑 API Key 选「不绑定」→ 卡片 badge 消失
4. 使用绑定了凭据 #1 的 Key 发请求 → 后端日志显示使用凭据 #1
5. 禁用凭据 #1 后，使用绑定该凭据的 Key 发请求 → 返回 503 + 错误信息

- [ ] **Step 4: 最终 Commit**

```bash
git add -A
git commit -m "chore: finalize api-key credential binding feature"
```
