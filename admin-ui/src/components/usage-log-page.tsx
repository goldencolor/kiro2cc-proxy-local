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
