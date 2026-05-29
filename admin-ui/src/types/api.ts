// 凭据状态响应
export interface CredentialsStatusResponse {
  total: number
  available: number
  currentId: number
  credentials: CredentialStatusItem[]
}

// 单个凭据状态
export interface CredentialStatusItem {
  id: number
  priority: number
  disabled: boolean
  failureCount: number
  isCurrent: boolean
  expiresAt: string | null
  authMethod: string | null
  hasKiroApiKey: boolean
  hasProfileArn: boolean
  email?: string
  nickname?: string
  refreshTokenHash?: string
  successCount: number
  lastUsedAt: string | null
  hasProxy: boolean
  proxyUrl?: string
  apiRegion?: string
  runtimeEndpoint?: string
}

export interface ExportedCredential {
  id?: number
  accessToken?: string
  refreshToken?: string
  kiroApiKey?: string
  profileArn?: string
  expiresAt?: string
  authMethod?: string
  clientId?: string
  clientSecret?: string
  priority?: number
  region?: string
  authRegion?: string
  apiRegion?: string
  runtimeEndpoint?: string
  managementEndpoint?: string
  machineId?: string
  email?: string
  nickname?: string
  subscriptionTitle?: string
  proxyUrl?: string
  proxyUsername?: string
  proxyPassword?: string
  disabled?: boolean
}

// 余额响应
export interface BalanceResponse {
  id: number
  subscriptionTitle: string | null
  currentUsage: number
  usageLimit: number
  remaining: number
  usagePercentage: number
  nextResetAt: number | null
}

export interface ProbeCredentialResult {
  id: number
  success: boolean
  disabled: boolean
  durationMs: number
  message: string
  subscriptionTitle?: string
  remaining?: number
  usageLimit?: number
  error?: string
}

export interface ProbeCredentialsResponse {
  total: number
  success: number
  failed: number
  intervalMs: number
  results: ProbeCredentialResult[]
}

// 成功响应
export interface RequestDetailsResponse {
  total: number
  records: RequestDetailItem[]
}

export interface RequestDetailItem {
  recordedAt: string
  requestId: string
  endpoint: string
  model: string
  credentialId: number
  stream: boolean
  cacheHit: boolean
  inputTokens: number
  cachedTokens: number
  outputTokens: number
  cacheRatio: number
  costUsd: number
  creditsUsed: number
  specialSettings: string[]
}

export interface SuccessResponse {
  success: boolean
  message: string
}

// 错误响应
export interface AdminErrorResponse {
  error: {
    type: string
    message: string
  }
}

// 请求类型
export interface SetDisabledRequest {
  disabled: boolean
}

export interface SetPriorityRequest {
  priority: number
}

// 添加凭据请求
export interface AddCredentialRequest {
  refreshToken?: string
  kiroApiKey?: string
  email?: string
  nickname?: string
  authMethod?: 'social' | 'idc'
  clientId?: string
  clientSecret?: string
  priority?: number
  authRegion?: string
  apiRegion?: string
  runtimeEndpoint?: string
  managementEndpoint?: string
  machineId?: string
  proxyUrl?: string
  proxyUsername?: string
  proxyPassword?: string
}

// 更新凭据请求
export interface UpdateCredentialRequest {
  refreshToken?: string
  kiroApiKey?: string
  email?: string
  authMethod?: string
  clientId?: string
  clientSecret?: string
  authRegion?: string
  apiRegion?: string
  runtimeEndpoint?: string
  managementEndpoint?: string
  machineId?: string
  proxyUrl?: string
  proxyUsername?: string
  proxyPassword?: string
}

// 添加凭据响应
export interface AddCredentialResponse {
  success: boolean
  message: string
  credentialId: number
  email?: string
}

// API Key 类型
export interface ApiKeyItem {
  id: number
  key: string
  name: string
  enabled: boolean
  createdAt: string
  expiresAt: string | null
  spendingLimit: number | null
  durationDays: number | null
  activatedAt: string | null
  pinnedCredentialId?: number | null
}

export interface CreateApiKeyRequest {
  name: string
  expiresAt?: string | null
  spendingLimit?: number | null
  durationDays?: number | null
  pinnedCredentialId?: number | null
}

export interface UpdateApiKeyRequest {
  name?: string
  enabled?: boolean
  expiresAt?: string | null
  spendingLimit?: number | null
  durationDays?: number | null
  pinnedCredentialId?: number | null
}

// API Key 用量汇总
export interface UsageSummary {
  apiKeyId: number
  totalRequests: number
  totalInputTokens: number
  totalOutputTokens: number
  totalCost: number
  byModel: ModelUsage[]
}

export interface ModelUsage {
  model: string
  requests: number
  inputTokens: number
  outputTokens: number
  cost: number
}

// RPM 实时监控
export interface RpmSnapshot {
  global: number
  byCredential: Record<string, number>
  byApiKey: Record<string, number>
}

export interface UsageRecord {
  apiKeyId: number
  credentialId: number | null
  model: string
  inputTokens: number
  outputTokens: number
  estimatedCost: number
  credits?: number
  clientIp?: string
  createdAt: string
}

export interface UsageRecordsResponse {
  records: UsageRecord[]
  total: number
  page: number
  pageSize: number
  totalPages: number
}

export interface ModelItem {
  id: string
  object: string
  created: number
  owned_by: string
  display_name: string
  type?: string
  model_type?: string
  max_tokens: number
}

export interface ModelsResponse {
  object: string
  data: ModelItem[]
}
