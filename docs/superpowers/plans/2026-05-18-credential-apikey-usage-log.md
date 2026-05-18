# 凭据 & API Key 使用日志详情页 实现计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 在 Admin Web 的凭据管理和 API Key 管理页面，支持点击进入独立详情页查看逐条请求日志（模型、token、费用、时间），并精确追踪每次请求实际使用的凭据。

**Architecture:** 后端在 `UsageRecord` 新增 `credential_id` 字段并在记录时写入，新增两个分页查询端点；前端扩展 App.tsx 状态路由，新增两个详情页组件（左右分栏布局），在凭据卡片和 API Key 卡片上各加一个「日志」入口按钮。

**Tech Stack:** Rust (axum, serde, parking_lot), React 18 + TypeScript, TanStack Query, shadcn/ui, TailwindCSS

---

## 文件变更清单

| 操作 | 文件 | 说明 |
|------|------|------|
| 修改 | `src/model/usage.rs` | UsageRecord 新增 credential_id；新增分页查询方法 |
| 修改 | `src/anthropic/stream.rs` | StreamContext 新增 credential_id 字段，record 时传入 |
| 修改 | `src/anthropic/handlers.rs` | handle_stream/non_stream 传入 credential_id 给 tracker |
| 修改 | `src/admin/api_keys.rs` | 新增 get_credential_usage、get_key_usage_records 处理器 |
| 修改 | `src/admin/router.rs` | 注册两个新端点 |
| 修改 | `admin-ui/src/types/api.ts` | 新增 UsageRecord、UsageRecordsResponse 类型 |
| 修改 | `admin-ui/src/api/credentials.ts` | 新增两个 API 函数 |
| 修改 | `admin-ui/src/hooks/use-credentials.ts` | 新增两个 Query Hook |
| 新增 | `admin-ui/src/components/usage-log-page.tsx` | 通用日志详情页组件（凭据/Key 共用） |
| 修改 | `admin-ui/src/components/dashboard.tsx` | 新增 view 状态路由，渲染详情页 |
| 修改 | `admin-ui/src/components/credential-card.tsx` | 新增「日志」按钮 |
| 修改 | `admin-ui/src/components/api-keys-panel.tsx` | 新增「日志」按钮 |

---

## Task 1: UsageRecord 新增 credential_id 字段与分页查询

**Files:**
- Modify: `src/model/usage.rs`

- [ ] **Step 1: 修改 UsageRecord 结构体**

在 `src/model/usage.rs` 的 `UsageRecord` 结构体中，在 `api_key_id` 字段后新增：

```rust
#[serde(default)]
pub credential_id: Option<u64>,
```

- [ ] **Step 2: 修改 record 方法签名**

将 `record` 方法改为接受 `credential_id: Option<u64>` 参数：

```rust
pub fn record(
    &self,
    api_key_id: u32,
    credential_id: Option<u64>,
    model: String,
    input_tokens: i32,
    output_tokens: i32,
) {
    let cost = calculate_cost(&model, input_tokens, output_tokens);
    let record = UsageRecord {
        api_key_id,
        credential_id,
        model,
        input_tokens,
        output_tokens,
        estimated_cost: cost,
        created_at: Utc::now(),
    };
    self.records.write().push(record);
    if let Err(e) = self.save() {
        tracing::warn!("保存用量记录失败: {}", e);
    }
}
```

- [ ] **Step 3: 新增两个分页查询方法**

在 `get_total_cost` 方法后追加：

```rust
pub fn get_records_by_credential(
    &self,
    credential_id: u64,
    page: usize,
    page_size: usize,
) -> (Vec<UsageRecord>, usize) {
    let records = self.records.read();
    let mut filtered: Vec<&UsageRecord> = records
        .iter()
        .filter(|r| r.credential_id == Some(credential_id))
        .collect();
    filtered.sort_by(|a, b| b.created_at.cmp(&a.created_at));
    let total = filtered.len();
    let start = page.saturating_sub(1) * page_size;
    let page_records = filtered.into_iter().skip(start).take(page_size).cloned().collect();
    (page_records, total)
}

pub fn get_records_by_api_key(
    &self,
    api_key_id: u32,
    page: usize,
    page_size: usize,
) -> (Vec<UsageRecord>, usize) {
    let records = self.records.read();
    let mut filtered: Vec<&UsageRecord> = records
        .iter()
        .filter(|r| r.api_key_id == api_key_id)
        .collect();
    filtered.sort_by(|a, b| b.created_at.cmp(&a.created_at));
    let total = filtered.len();
    let start = page.saturating_sub(1) * page_size;
    let page_records = filtered.into_iter().skip(start).take(page_size).cloned().collect();
    (page_records, total)
}
```

- [ ] **Step 4: 编译检查（预期有调用方错误）**

```bash
cd "/Users/MacBook/My Files/Code/sourcetree/kiro2cc-proxy-local"
cargo check 2>&1 | grep "error\[" | head -20
```

预期：`record` 调用方参数不匹配错误，说明字段已正确添加。

- [ ] **Step 5: Commit**

```bash
git add src/model/usage.rs
git commit -m "feat(usage): add credential_id field and paginated query methods"
```

---

## Task 2: 更新 record 调用方传入 credential_id

**Files:**
- Modify: `src/anthropic/stream.rs`
- Modify: `src/anthropic/handlers.rs`

- [ ] **Step 1: StreamContext 新增 credential_id 字段**

在 `src/anthropic/stream.rs` 的 `StreamContext` 结构体中，在 `api_key_id` 字段后新增：

```rust
/// 凭据 ID（用于用量记录）
credential_id: Option<u64>,
```

在 `new_with_thinking` 的 `Self { ... }` 初始化块中加入：

```rust
credential_id: None,
```

- [ ] **Step 2: 更新 with_usage_tracking 方法**

将 `StreamContext::with_usage_tracking` 改为：

```rust
pub fn with_usage_tracking(
    mut self,
    tracker: Option<Arc<UsageTracker>>,
    api_key_id: Option<u32>,
    credential_id: Option<u64>,
) -> Self {
    self.usage_tracker = tracker;
    self.api_key_id = api_key_id;
    self.credential_id = credential_id;
    self
}
```

- [ ] **Step 3: StreamContext 内部 record 调用传入 credential_id**

在 `stream.rs` 中找到 `tracker.record(key_id, ...)` 的调用（在 `generate_final_events` 或 `finish_and_get_all_events` 中），改为：

```rust
tracker.record(key_id, self.credential_id, self.model.clone(), final_input_tokens, output_tokens);
```

- [ ] **Step 4: BufferedStreamContext 同步更新**

在 `BufferedStreamContext` 结构体中同样新增 `credential_id: Option<u64>` 字段，并在其 `with_usage_tracking` 方法中同步更新（与 Step 2 相同模式）。

- [ ] **Step 5: handle_stream_request 新增 credential_id 参数**

在 `src/anthropic/handlers.rs` 的 `handle_stream_request` 函数签名中新增参数：

```rust
async fn handle_stream_request(
    provider: std::sync::Arc<crate::kiro::provider::KiroProvider>,
    request_body: &str,
    model: &str,
    input_tokens: i32,
    thinking_enabled: bool,
    usage_tracker: Option<std::sync::Arc<crate::model::usage::UsageTracker>>,
    api_key_id: Option<u32>,
    credential_id: Option<u64>,  // 新增
    prompt_cache_usage: crate::cache::PromptCacheUsage,
    pinned_credential_id: Option<u64>,
) -> Response
```

函数体内将 `.with_usage_tracking(usage_tracker, api_key_id)` 改为：

```rust
.with_usage_tracking(usage_tracker, api_key_id, credential_id)
```

- [ ] **Step 6: handle_non_stream_request 同步更新**

同 Step 5，新增 `credential_id: Option<u64>` 参数，并将内部 `tracker.record` 调用改为：

```rust
tracker.record(key_id, credential_id, model.to_string(), final_input_tokens, output_tokens);
```

- [ ] **Step 7: handle_stream_request_buffered 同步更新**

同 Step 5，新增 `credential_id` 参数并传入 `.with_usage_tracking`。

- [ ] **Step 8: post_messages 和 post_messages_cc 更新调用**

在两个处理函数中，`pinned_credential_id` 已从 identity 提取，将其作为 `credential_id` 传入三个 handle 函数：

```rust
handle_stream_request(
    provider,
    &request_body,
    &payload.model,
    input_tokens,
    thinking_enabled,
    usage_tracker,
    api_key_id,
    pinned_credential_id,  // 新增参数
    prompt_cache_usage,
    pinned_credential_id,
).await
```

`handle_non_stream_request` 和 `handle_stream_request_buffered` 调用同理。

- [ ] **Step 9: 编译验证**

```bash
cd "/Users/MacBook/My Files/Code/sourcetree/kiro2cc-proxy-local"
cargo check 2>&1 | grep "error\["
```

预期：无编译错误。

- [ ] **Step 10: Commit**

```bash
git add src/anthropic/stream.rs src/anthropic/handlers.rs
git commit -m "feat(usage): pass credential_id when recording usage"
```

---

## Task 3: 新增后端 API 端点

**Files:**
- Modify: `src/admin/api_keys.rs`
- Modify: `src/admin/router.rs`

- [ ] **Step 1: 新增分页响应类型**

在 `src/admin/api_keys.rs` 顶部 use 块后，新增：

```rust
#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct UsageRecordsResponse {
    records: Vec<crate::model::usage::UsageRecord>,
    total: usize,
    page: usize,
    page_size: usize,
    total_pages: usize,
}
```

- [ ] **Step 2: 新增 get_credential_usage 处理器**

在 `src/admin/api_keys.rs` 末尾追加：

```rust
/// GET /api/admin/credentials/:id/usage?page=1&page_size=50
pub async fn get_credential_usage(
    State(state): State<AdminState>,
    Path(id): Path<u64>,
    axum::extract::Query(params): axum::extract::Query<std::collections::HashMap<String, String>>,
) -> impl IntoResponse {
    let Some(tracker) = &state.usage_tracker else {
        let error = AdminErrorResponse::internal_error("用量追踪未启用");
        return (StatusCode::SERVICE_UNAVAILABLE, Json(error)).into_response();
    };
    let page = params.get("page").and_then(|v| v.parse().ok()).unwrap_or(1usize);
    let page_size = params.get("page_size").and_then(|v| v.parse().ok()).unwrap_or(50usize);
    let (records, total) = tracker.get_records_by_credential(id, page, page_size);
    let total_pages = if page_size == 0 { 1 } else { (total + page_size - 1) / page_size };
    Json(UsageRecordsResponse { records, total, page, page_size, total_pages }).into_response()
}
```

- [ ] **Step 3: 新增 get_api_key_usage_records 处理器**

继续在末尾追加：

```rust
/// GET /api/admin/api-keys/:id/usage/records?page=1&page_size=50
pub async fn get_api_key_usage_records(
    State(state): State<AdminState>,
    Path(id): Path<u32>,
    axum::extract::Query(params): axum::extract::Query<std::collections::HashMap<String, String>>,
) -> impl IntoResponse {
    let Some(tracker) = &state.usage_tracker else {
        let error = AdminErrorResponse::internal_error("用量追踪未启用");
        return (StatusCode::SERVICE_UNAVAILABLE, Json(error)).into_response();
    };
    let page = params.get("page").and_then(|v| v.parse().ok()).unwrap_or(1usize);
    let page_size = params.get("page_size").and_then(|v| v.parse().ok()).unwrap_or(50usize);
    let (records, total) = tracker.get_records_by_api_key(id, page, page_size);
    let total_pages = if page_size == 0 { 1 } else { (total + page_size - 1) / page_size };
    Json(UsageRecordsResponse { records, total, page, page_size, total_pages }).into_response()
}
```

- [ ] **Step 4: 注册路由**

在 `src/admin/router.rs` 中，import 新增两个处理器：

```rust
use super::api_keys::{
    create_api_key, delete_api_key, get_all_usage, get_api_key_usage_records,
    get_credential_usage, get_key_usage, get_rpm, get_server_info,
    list_api_keys, reset_key_usage, update_api_key,
};
```

在路由注册中新增两条：

```rust
.route("/credentials/{id}/usage", get(get_credential_usage))
.route("/api-keys/{id}/usage/records", get(get_api_key_usage_records))
```

放在现有 `.route("/credentials/{id}/balance", get(get_credential_balance))` 之后。

- [ ] **Step 5: 编译验证**

```bash
cd "/Users/MacBook/My Files/Code/sourcetree/kiro2cc-proxy-local"
cargo check 2>&1 | grep "error\["
```

预期：无编译错误。

- [ ] **Step 6: Commit**

```bash
git add src/admin/api_keys.rs src/admin/router.rs
git commit -m "feat(admin): add credential usage and api-key usage records endpoints"
```

---

## Task 4: 前端类型、API 函数、Hook

**Files:**
- Modify: `admin-ui/src/types/api.ts`
- Modify: `admin-ui/src/api/credentials.ts`
- Modify: `admin-ui/src/hooks/use-credentials.ts`

- [ ] **Step 1: 新增前端类型**

在 `admin-ui/src/types/api.ts` 末尾追加：

```typescript
export interface UsageRecord {
  apiKeyId: number
  credentialId: number | null
  model: string
  inputTokens: number
  outputTokens: number
  estimatedCost: number
  createdAt: string
}

export interface UsageRecordsResponse {
  records: UsageRecord[]
  total: number
  page: number
  pageSize: number
  totalPages: number
}
```

- [ ] **Step 2: 新增 API 函数**

在 `admin-ui/src/api/credentials.ts` 末尾追加：

```typescript
// 获取凭据逐条使用日志（分页）
export async function getCredentialUsageRecords(
  id: number,
  page: number,
  pageSize: number
): Promise<UsageRecordsResponse> {
  const { data } = await api.get<UsageRecordsResponse>(
    `/credentials/${id}/usage`,
    { params: { page, page_size: pageSize } }
  )
  return data
}

// 获取 API Key 逐条使用日志（分页）
export async function getApiKeyUsageRecords(
  id: number,
  page: number,
  pageSize: number
): Promise<UsageRecordsResponse> {
  const { data } = await api.get<UsageRecordsResponse>(
    `/api-keys/${id}/usage/records`,
    { params: { page, page_size: pageSize } }
  )
  return data
}
```

同时在文件顶部 import 中加入 `UsageRecordsResponse`：

```typescript
import type {
  // ...existing imports...
  UsageRecordsResponse,
} from '@/types/api'
```

- [ ] **Step 3: 新增 Query Hook**

在 `admin-ui/src/hooks/use-credentials.ts` 末尾追加：

```typescript
// 查询凭据逐条使用日志
export function useCredentialUsageRecords(id: number, page: number) {
  return useQuery({
    queryKey: ['credentialUsageRecords', id, page],
    queryFn: () => getCredentialUsageRecords(id, page, 50),
    enabled: id > 0,
  })
}

// 查询 API Key 逐条使用日志
export function useApiKeyUsageRecords(id: number, page: number) {
  return useQuery({
    queryKey: ['apiKeyUsageRecords', id, page],
    queryFn: () => getApiKeyUsageRecords(id, page, 50),
    enabled: id > 0,
  })
}
```

同时在文件顶部 import 中加入新函数：

```typescript
import {
  // ...existing imports...
  getCredentialUsageRecords,
  getApiKeyUsageRecords,
} from '@/api/credentials'
```

- [ ] **Step 4: TypeScript 编译检查**

```bash
cd "/Users/MacBook/My Files/Code/sourcetree/kiro2cc-proxy-local/admin-ui"
npx tsc --noEmit 2>&1 | head -30
```

预期：无类型错误。

- [ ] **Step 5: Commit**

```bash
git add admin-ui/src/types/api.ts admin-ui/src/api/credentials.ts admin-ui/src/hooks/use-credentials.ts
git commit -m "feat(admin-ui): add usage records types, api functions, and hooks"
```

---

## Task 5: 新增通用日志详情页组件

**Files:**
- Create: `admin-ui/src/components/usage-log-page.tsx`

- [ ] **Step 1: 创建组件文件**

创建 `admin-ui/src/components/usage-log-page.tsx`，内容如下：

```tsx
import { useState } from 'react'
import { ArrowLeft, FileText, ChevronLeft, ChevronRight } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { useCredentialUsageRecords, useApiKeyUsageRecords } from '@/hooks/use-credentials'
import type { CredentialStatusItem, ApiKeyItem, UsageSummary } from '@/types/api'

interface CredentialUsagePageProps {
  mode: 'credential'
  credential: CredentialStatusItem
  summary?: UsageSummary
  onBack: () => void
}

interface ApiKeyUsagePageProps {
  mode: 'apikey'
  apiKey: ApiKeyItem
  summary?: UsageSummary
  onBack: () => void
}

type UsageLogPageProps = CredentialUsagePageProps | ApiKeyUsagePageProps

const MODEL_COLORS: Record<string, string> = {
  sonnet: 'bg-blue-100 text-blue-700 dark:bg-blue-900/60 dark:text-blue-300',
  haiku: 'bg-pink-100 text-pink-700 dark:bg-pink-900/60 dark:text-pink-300',
  opus: 'bg-purple-100 text-purple-700 dark:bg-purple-900/60 dark:text-purple-300',
}

function getModelColor(model: string): string {
  const lower = model.toLowerCase()
  for (const [key, cls] of Object.entries(MODEL_COLORS)) {
    if (lower.includes(key)) return cls
  }
  return 'bg-gray-100 text-gray-700 dark:bg-gray-800 dark:text-gray-300'
}

function formatTokens(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`
  if (n >= 1_000) return `${(n / 1_000).toFixed(1)}K`
  return String(n)
}

function formatDate(iso: string): string {
  return new Date(iso).toLocaleString('zh-CN', {
    month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', second: '2-digit',
  })
}

function Pagination({ page, totalPages, onChange }: { page: number; totalPages: number; onChange: (p: number) => void }) {
  if (totalPages <= 1) return null
  return (
    <div className="flex items-center justify-center gap-1 mt-4">
      <Button variant="ghost" size="sm" disabled={page <= 1} onClick={() => onChange(page - 1)}>
        <ChevronLeft className="h-4 w-4" />
      </Button>
      {Array.from({ length: Math.min(totalPages, 7) }, (_, i) => {
        const p = totalPages <= 7 ? i + 1 : page <= 4 ? i + 1 : page >= totalPages - 3 ? totalPages - 6 + i : page - 3 + i
        return (
          <Button key={p} size="sm" variant={p === page ? 'default' : 'outline'} className="w-8 h-8 p-0" onClick={() => onChange(p)}>
            {p}
          </Button>
        )
      })}
      <Button variant="ghost" size="sm" disabled={page >= totalPages} onClick={() => onChange(page + 1)}>
        <ChevronRight className="h-4 w-4" />
      </Button>
    </div>
  )
}

export function UsageLogPage(props: UsageLogPageProps) {
  const [page, setPage] = useState(1)
  const isCredential = props.mode === 'credential'

  const credResult = useCredentialUsageRecords(
    isCredential ? (props as CredentialUsagePageProps).credential.id : 0,
    page
  )
  const keyResult = useApiKeyUsageRecords(
    !isCredential ? (props as ApiKeyUsagePageProps).apiKey.id : 0,
    page
  )

  const result = isCredential ? credResult : keyResult
  const { data, isLoading, isError, refetch } = result

  const title = isCredential
    ? `凭据 #${(props as CredentialUsagePageProps).credential.id}${(props as CredentialUsagePageProps).credential.email ? ` · ${(props as CredentialUsagePageProps).credential.email}` : ''}`
    : `Key #${String((props as ApiKeyUsagePageProps).apiKey.id).padStart(3, '0')} · ${(props as ApiKeyUsagePageProps).apiKey.name}`

  const summary = props.summary

  return (
    <div className="space-y-4">
      {/* 顶部导航 */}
      <div className="flex items-center gap-3">
        <Button variant="ghost" size="sm" onClick={props.onBack}>
          <ArrowLeft className="h-4 w-4 mr-1" />
          返回
        </Button>
        <div className="flex items-center gap-2">
          <FileText className="h-4 w-4 text-muted-foreground" />
          <span className="font-semibold">{title}</span>
        </div>
      </div>

      {/* 主体：左右分栏 */}
      <div className="flex gap-4 items-start">
        {/* 左侧：信息面板 */}
        <div className="w-52 shrink-0 space-y-3">
          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-xs font-medium text-muted-foreground">用量汇总</CardTitle>
            </CardHeader>
            <CardContent className="space-y-1 text-sm">
              <div className="flex justify-between">
                <span className="text-muted-foreground">总请求</span>
                <span className="font-medium">{summary?.totalRequests ?? data?.total ?? 0}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-muted-foreground">输入</span>
                <span>{formatTokens(summary?.totalInputTokens ?? 0)}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-muted-foreground">输出</span>
                <span>{formatTokens(summary?.totalOutputTokens ?? 0)}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-muted-foreground">费用</span>
                <span className="font-semibold text-orange-600">${(summary?.totalCost ?? 0).toFixed(4)}</span>
              </div>
            </CardContent>
          </Card>

          {summary && summary.byModel.length > 0 && (
            <Card>
              <CardHeader className="pb-2">
                <CardTitle className="text-xs font-medium text-muted-foreground">模型分布</CardTitle>
              </CardHeader>
              <CardContent className="space-y-1.5">
                {summary.byModel.map((m) => (
                  <div key={m.model} className="space-y-0.5">
                    <div className="flex justify-between text-xs">
                      <Badge className={`text-xs px-1.5 py-0 ${getModelColor(m.model)}`}>
                        {m.model.replace('claude-', '').replace(/-\d{8}$/, '')}
                      </Badge>
                      <span className="text-muted-foreground">{m.requests}次</span>
                    </div>
                  </div>
                ))}
              </CardContent>
            </Card>
          )}
        </div>

        {/* 右侧：日志列表 */}
        <div className="flex-1 min-w-0">
          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-sm font-medium">
                请求日志
                {data && <span className="ml-2 text-xs text-muted-foreground font-normal">共 {data.total} 条</span>}
              </CardTitle>
            </CardHeader>
            <CardContent className="p-0">
              {isLoading ? (
                <div className="py-12 text-center text-muted-foreground text-sm">加载中...</div>
              ) : isError ? (
                <div className="py-12 text-center space-y-2">
                  <p className="text-sm text-destructive">加载失败</p>
                  <Button size="sm" variant="outline" onClick={() => refetch()}>重试</Button>
                </div>
              ) : !data || data.records.length === 0 ? (
                <div className="py-12 text-center text-muted-foreground text-sm">暂无请求记录</div>
              ) : (
                <div className="overflow-x-auto">
                  <table className="w-full text-sm">
                    <thead>
                      <tr className="border-b bg-muted/50">
                        <th className="text-left px-4 py-2 text-xs text-muted-foreground font-medium">时间</th>
                        <th className="text-left px-4 py-2 text-xs text-muted-foreground font-medium">模型</th>
                        <th className="text-right px-4 py-2 text-xs text-muted-foreground font-medium">输入</th>
                        <th className="text-right px-4 py-2 text-xs text-muted-foreground font-medium">输出</th>
                        <th className="text-right px-4 py-2 text-xs text-muted-foreground font-medium">费用</th>
                      </tr>
                    </thead>
                    <tbody>
                      {data.records.map((r, i) => (
                        <tr key={i} className="border-b last:border-0 hover:bg-muted/30">
                          <td className="px-4 py-2 text-xs text-muted-foreground whitespace-nowrap">{formatDate(r.createdAt)}</td>
                          <td className="px-4 py-2">
                            <Badge className={`text-xs px-1.5 py-0 ${getModelColor(r.model)}`}>
                              {r.model.replace('claude-', '').replace(/-\d{8}$/, '')}
                            </Badge>
                          </td>
                          <td className="px-4 py-2 text-right text-xs">{formatTokens(r.inputTokens)}</td>
                          <td className="px-4 py-2 text-right text-xs">{formatTokens(r.outputTokens)}</td>
                          <td className="px-4 py-2 text-right text-xs font-medium text-orange-600">${r.estimatedCost.toFixed(4)}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                  <div className="px-4 pb-4">
                    <Pagination page={page} totalPages={data.totalPages} onChange={setPage} />
                  </div>
                </div>
              )}
            </CardContent>
          </Card>
        </div>
      </div>
    </div>
  )
}
```

- [ ] **Step 2: TypeScript 编译检查**

```bash
cd "/Users/MacBook/My Files/Code/sourcetree/kiro2cc-proxy-local/admin-ui"
npx tsc --noEmit 2>&1 | head -30
```

预期：无类型错误。

- [ ] **Step 3: Commit**

```bash
git add admin-ui/src/components/usage-log-page.tsx
git commit -m "feat(admin-ui): add UsageLogPage component with left-right layout"
```

---

## Task 6: 凭据卡片新增「日志」入口

**Files:**
- Modify: `admin-ui/src/components/credential-card.tsx`
- Modify: `admin-ui/src/components/dashboard.tsx`

- [ ] **Step 1: CredentialCard 新增 onViewLog 回调 prop**

在 `admin-ui/src/components/credential-card.tsx` 的 `CredentialCardProps` 接口中新增：

```typescript
onViewLog: (id: number) => void
```

- [ ] **Step 2: 在卡片操作区新增「日志」按钮**

在 `credential-card.tsx` 中，找到 `onViewBalance` 按钮（`Wallet` 图标）附近，在其后新增：

```tsx
import { RefreshCw, ChevronUp, ChevronDown, Wallet, Trash2, Loader2, Pencil, FileText } from 'lucide-react'
```

在操作按钮区域（`Wallet` 按钮之后）新增：

```tsx
<Button
  variant="ghost"
  size="sm"
  onClick={() => onViewLog(credential.id)}
  title="查看使用日志"
>
  <FileText className="h-4 w-4" />
</Button>
```

- [ ] **Step 3: Dashboard 新增 view 状态和 selectedCredentialId**

在 `admin-ui/src/components/dashboard.tsx` 中，在现有 `activeTab` state 附近新增：

```typescript
const [view, setView] = useState<'list' | 'credential-detail' | 'apikey-detail'>('list')
const [detailCredentialId, setDetailCredentialId] = useState<number | null>(null)
const [detailApiKeyId, setDetailApiKeyId] = useState<number | null>(null)
```

- [ ] **Step 4: Dashboard 引入 UsageLogPage 并在凭据 tab 渲染详情页**

在 `dashboard.tsx` 顶部 import 新增：

```typescript
import { UsageLogPage } from '@/components/usage-log-page'
```

在凭据管理 tab 的渲染逻辑中，在 `currentCredentials.map(...)` 外层包裹条件：

```tsx
{view === 'credential-detail' && detailCredentialId !== null ? (
  <UsageLogPage
    mode="credential"
    credential={data!.credentials.find(c => c.id === detailCredentialId)!}
    summary={usageData?.find(u => u.apiKeyId === detailCredentialId)}
    onBack={() => setView('list')}
  />
) : (
  // 原有凭据列表渲染
  <>
    {currentCredentials.map((credential) => (
      <CredentialCard
        key={credential.id}
        credential={credential}
        onViewBalance={(id) => { setSelectedCredentialId(id); setBalanceDialogOpen(true) }}
        onViewLog={(id) => { setDetailCredentialId(id); setView('credential-detail') }}
        selected={selectedIds.has(credential.id)}
        onToggleSelect={() => { /* existing logic */ }}
        balance={balanceMap.get(credential.id) ?? null}
        loadingBalance={loadingBalanceIds.has(credential.id)}
        rpm={rpmData?.byCredential?.[String(credential.id)] ?? 0}
      />
    ))}
  </>
)}
```

- [ ] **Step 5: TypeScript 编译检查**

```bash
cd "/Users/MacBook/My Files/Code/sourcetree/kiro2cc-proxy-local/admin-ui"
npx tsc --noEmit 2>&1 | head -30
```

预期：无类型错误。

- [ ] **Step 6: Commit**

```bash
git add admin-ui/src/components/credential-card.tsx admin-ui/src/components/dashboard.tsx
git commit -m "feat(admin-ui): add log entry button to credential card and wire detail view"
```

---

## Task 7: API Key 卡片新增「日志」入口

**Files:**
- Modify: `admin-ui/src/components/api-keys-panel.tsx`

- [ ] **Step 1: 在 api-keys-panel.tsx 顶部 import 新增图标和组件**

```typescript
import { Copy, Plus, Pencil, Trash2, Key, Check, Clock, BarChart3, RotateCcw,
  DollarSign, ArrowDownWideNarrow, Search, Loader2, Pin, Globe, ChevronDown,
  X, FileText } from 'lucide-react'
import { UsageLogPage } from '@/components/usage-log-page'
```

- [ ] **Step 2: 新增 view 状态**

在 `ApiKeysPanel` 组件顶部 state 声明区新增：

```typescript
const [view, setView] = useState<'list' | 'detail'>('list')
const [detailKeyId, setDetailKeyId] = useState<number | null>(null)
```

- [ ] **Step 3: 在 Key 卡片操作区新增「日志」按钮**

在 `renderCard` 函数中，找到 `<Button variant="ghost" size="sm" onClick={() => openEdit(apiKey)}` 之前，新增：

```tsx
<Button
  variant="ghost"
  size="sm"
  onClick={() => { setDetailKeyId(apiKey.id); setView('detail') }}
  title="查看使用日志"
>
  <FileText className="h-4 w-4" />
</Button>
```

- [ ] **Step 4: 在组件 return 顶层添加详情页条件渲染**

将 `ApiKeysPanel` 的 `return (` 改为：

```tsx
if (view === 'detail' && detailKeyId !== null) {
  const apiKey = apiKeys?.find(k => k.id === detailKeyId)
  if (apiKey) {
    return (
      <UsageLogPage
        mode="apikey"
        apiKey={apiKey}
        summary={usageMap.get(apiKey.id)}
        onBack={() => setView('list')}
      />
    )
  }
}

return (
  <div className="space-y-4">
  // ...existing JSX unchanged...
```

- [ ] **Step 5: TypeScript 编译检查**

```bash
cd "/Users/MacBook/My Files/Code/sourcetree/kiro2cc-proxy-local/admin-ui"
npx tsc --noEmit 2>&1 | head -30
```

预期：无类型错误。

- [ ] **Step 6: Commit**

```bash
git add admin-ui/src/components/api-keys-panel.tsx
git commit -m "feat(admin-ui): add log entry button to api key card and wire detail view"
```

---

## Task 8: 构建前端并验证

**Files:**
- No file changes

- [ ] **Step 1: 构建前端**

```bash
cd "/Users/MacBook/My Files/Code/sourcetree/kiro2cc-proxy-local/admin-ui"
npm run build 2>&1 | tail -20
```

预期：`dist/` 目录生成，无构建错误。

- [ ] **Step 2: 构建后端**

```bash
cd "/Users/MacBook/My Files/Code/sourcetree/kiro2cc-proxy-local"
cargo build 2>&1 | grep "error\["
```

预期：无编译错误。

- [ ] **Step 3: 启动服务验证**

```bash
cd "/Users/MacBook/My Files/Code/sourcetree/kiro2cc-proxy-local"
bash run-local-service-mac.sh &
sleep 3
curl -s http://localhost:3000/v1/ping | python3 -m json.tool
```

预期：返回 `{"status": "ok", ...}`。

- [ ] **Step 4: 验证新端点可访问**

```bash
ADMIN_KEY=$(cat app/config/config.json | python3 -c "import sys,json; print(json.load(sys.stdin).get('admin_api_key',''))")
curl -s -H "x-api-key: $ADMIN_KEY" "http://localhost:3000/api/admin/credentials/1/usage?page=1&page_size=10" | python3 -m json.tool
```

预期：返回 `{"records": [...], "total": ..., "page": 1, "pageSize": 10, "totalPages": ...}`。

- [ ] **Step 5: 最终 Commit**

```bash
git add -A
git commit -m "chore: rebuild admin-ui dist for usage log feature"
```

