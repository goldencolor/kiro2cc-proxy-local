> **注：** 本文档由 **claude-sonnet-4-6** 模型自动生成。

# 凭据 & API Key 使用日志详情页 — 设计文档

## 概述

在 Admin Web 页面的「凭据管理」和「API Key 管理」两个 Tab 中，分别支持点击某个凭据/API Key 进入独立详情页，查看逐条请求日志（模型、token 消耗、费用、时间）。

---

## 需求确认

| 维度 | 决策 |
|------|------|
| 入口 | 凭据管理页 + API Key 管理页，两处都要 |
| 日志粒度 | 逐条请求记录（非仅汇总） |
| 展示方式 | 独立详情页（URL 变化，支持浏览器前进/后退） |
| 凭据日志来源 | 后端 UsageRecord 新增 `credential_id` 字段，精确追踪每次请求实际使用的凭据 |
| 分页方式 | 传统分页（每页 50 条） |
| UI 布局 | 方案 B：左右分栏（左侧固定信息+汇总，右侧日志列表） |

---

## 架构设计

### 1. 后端变更

#### 1.1 UsageRecord 新增 credential_id 字段

```rust
pub struct UsageRecord {
    pub api_key_id: u32,
    pub credential_id: Option<u64>,  // 新增：实际使用的凭据 ID，None = 主密钥直接调用
    pub model: String,
    pub input_tokens: i32,
    pub output_tokens: i32,
    pub estimated_cost: f64,
    pub created_at: DateTime<Utc>,
}
```

旧数据中 `credential_id` 为 `null`，向后兼容。

#### 1.2 UsageTracker 新增查询方法

```rust
// 按凭据 ID 查询日志（分页）
pub fn get_records_by_credential(
    &self,
    credential_id: u64,
    page: usize,
    page_size: usize,
) -> (Vec<UsageRecord>, usize); // (records, total_count)

// 按 API Key ID 查询日志（分页）
pub fn get_records_by_api_key(
    &self,
    api_key_id: u32,
    page: usize,
    page_size: usize,
) -> (Vec<UsageRecord>, usize);
```

结果按 `created_at` 倒序排列（最新在前）。

#### 1.3 新增 Admin API 端点

| 方法 | 路径 | 说明 |
|------|------|------|
| GET | `/api/admin/credentials/{id}/usage` | 凭据使用日志（分页） |
| GET | `/api/admin/api-keys/{id}/usage/records` | API Key 逐条日志（分页） |

查询参数：`?page=1&page_size=50`

响应结构：

```json
{
  "records": [
    {
      "apiKeyId": 1,
      "credentialId": 3,
      "model": "claude-sonnet-4-6",
      "inputTokens": 52600,
      "outputTokens": 550,
      "estimatedCost": 0.166050,
      "createdAt": "2026-05-18T14:32:01Z"
    }
  ],
  "total": 142,
  "page": 1,
  "pageSize": 50,
  "totalPages": 3
}
```

#### 1.4 记录时写入 credential_id

在 `anthropic/handlers.rs` 调用 `usage_tracker.record()` 时，从请求上下文中取出当前使用的凭据 ID 并传入。

---

### 2. 前端变更

#### 2.1 路由

使用 React 状态路由（无需引入 react-router，用 App.tsx 中已有的 view state 模式扩展）：

```
view = 'dashboard'           → 凭据管理列表
view = 'credential-detail'   → 凭据使用日志详情（带 selectedCredentialId）
view = 'api-keys'            → API Key 管理列表
view = 'api-key-detail'      → API Key 使用日志详情（带 selectedApiKeyId）
```

#### 2.2 新增页面组件

**`credential-usage-page.tsx`** — 凭据使用日志详情页

**`api-key-usage-page.tsx`** — API Key 使用日志详情页

两个页面共用同一布局结构（方案 B 左右分栏）：

```
┌─────────────────────────────────────────────────────┐
│ ← 返回  凭据 #3 · user@example.com                   │
├──────────────┬──────────────────────────────────────┤
│ 基本信息      │ 请求日志                              │
│              │ ┌──────────────────────────────────┐ │
│ 邮箱/名称    │ │ 时间 │ 模型 │ 输入 │ 输出 │ 费用  │ │
│ 状态         │ ├──────────────────────────────────┤ │
│ 优先级       │ │ ...  │ ...  │ ...  │ ...  │ ...   │ │
│              │ └──────────────────────────────────┘ │
│ 用量汇总     │ ← 1  2  3 →                          │
│              │                                      │
│ 总请求       │                                      │
│ 输入 Token   │                                      │
│ 输出 Token   │                                      │
│ 总费用       │                                      │
│              │                                      │
│ 模型分布     │                                      │
│ [bar chart]  │                                      │
└──────────────┴──────────────────────────────────────┘
```

左侧宽度固定约 220px，右侧自适应。左侧内容来自已有的 credentials/api-keys 数据（无需额外请求）。

#### 2.3 新增 API 函数

```typescript
// api/credentials.ts 新增
export async function getCredentialUsageRecords(
  id: number,
  page: number,
  pageSize: number
): Promise<UsageRecordsResponse>

export async function getApiKeyUsageRecords(
  id: number,
  page: number,
  pageSize: number
): Promise<UsageRecordsResponse>
```

#### 2.4 新增类型

```typescript
// types/api.ts 新增
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

#### 2.5 新增 Hook

```typescript
// hooks/use-credentials.ts 新增
export function useCredentialUsageRecords(id: number, page: number)
export function useApiKeyUsageRecords(id: number, page: number)
```

#### 2.6 入口触发

- 凭据管理页：凭据卡片右上角新增「日志」按钮（`FileText` 图标），点击切换到 `credential-detail` 视图
- API Key 管理页：每个 Key 卡片操作区新增「日志」按钮，点击切换到 `api-key-detail` 视图

---

### 3. 数据流

```
用户点击「日志」按钮
  → App.tsx 切换 view + 设置 selectedId
  → 渲染 CredentialUsagePage / ApiKeyUsagePage
  → 左侧：从已缓存的 credentials/apiKeys 数据中取基本信息
  → 右侧：调用 GET /api/admin/credentials/{id}/usage?page=1&page_size=50
  → 展示逐条记录表格 + 分页控件
```

---

## 错误处理

- 日志接口失败：右侧显示错误提示 + 重试按钮
- 空数据：右侧显示「暂无请求记录」空状态
- 分页越界：后端返回空 records 数组，前端显示空状态

---

## 向后兼容

- 旧 `UsageRecord` 数据中 `credential_id` 为 `null`，查询时正常展示，`credentialId` 列显示「—」
- 现有 `/api/admin/api-keys/{id}/usage`（汇总接口）保持不变，新增 `/usage/records` 为逐条接口

---

## 不在本次范围内

- 日志导出（CSV/JSON）
- 日志时间范围筛选
- 按模型筛选
- 日志清除功能（已有 reset 接口，不在详情页暴露）
