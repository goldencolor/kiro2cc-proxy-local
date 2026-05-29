import { useState } from 'react'
import { Clock, Database, RefreshCw, Trash2, Zap } from 'lucide-react'
import { toast } from 'sonner'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { useClearRequestDetails, useRequestDetails } from '@/hooks/use-credentials'
import { extractErrorMessage } from '@/lib/utils'

function formatTime(isoString: string): string {
  const d = new Date(isoString)
  const pad = (n: number) => String(n).padStart(2, '0')
  return `${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`
}

function formatCost(usd: number): string {
  if (usd < 0.001) return `$${usd.toFixed(6)}`
  if (usd < 0.01) return `$${usd.toFixed(4)}`
  return `$${usd.toFixed(3)}`
}

function formatTokens(n: number): string {
  if (n >= 1000000) return `${(n / 1000000).toFixed(1)}M`
  if (n >= 1000) return `${(n / 1000).toFixed(1)}K`
  return String(n)
}

function modelShortName(model: string): string {
  if (model.includes('opus')) return 'Opus'
  if (model.includes('sonnet')) return 'Sonnet'
  if (model.includes('haiku')) return 'Haiku'
  return model
}

function cacheRatioBar(ratio: number) {
  const pct = Math.round(ratio * 100)
  const color = pct > 70 ? 'bg-emerald-500' : pct > 30 ? 'bg-amber-500' : 'bg-muted-foreground'
  return (
    <div className="flex items-center gap-2">
      <div className="h-1.5 w-14 overflow-hidden rounded-full bg-muted">
        <div className={`h-full rounded-full ${color}`} style={{ width: `${pct}%` }} />
      </div>
      <span className="text-xs tabular-nums">{pct}%</span>
    </div>
  )
}

export function RequestDetailsPanel() {
  const [limit, setLimit] = useState(100)
  const { data, isLoading, refetch } = useRequestDetails(limit)
  const { mutate: clearDetails, isPending: isClearing } = useClearRequestDetails()

  const records = data?.records || []
  const totalCost = records.reduce((sum, r) => sum + r.costUsd, 0)
  const totalInput = records.reduce((sum, r) => sum + r.inputTokens + r.cachedTokens, 0)
  const totalOutput = records.reduce((sum, r) => sum + r.outputTokens, 0)
  const totalCached = records.reduce((sum, r) => sum + r.cachedTokens, 0)
  const avgCacheRatio = totalInput > 0 ? totalCached / totalInput : 0
  const cacheHitCount = records.filter((r) => r.cacheHit).length

  const handleClear = () => {
    if (!confirm('确定要清空所有请求记录吗？此操作无法撤销。')) return
    clearDetails(undefined, {
      onSuccess: () => toast.success('请求记录已清空'),
      onError: (err) => toast.error('清空失败: ' + extractErrorMessage(err)),
    })
  }

  return (
    <div className="space-y-4">
      <div className="grid gap-3 grid-cols-2 md:grid-cols-4">
        <Card>
          <CardHeader className="px-4 pb-1 pt-3">
            <CardTitle className="flex items-center gap-1 text-xs font-medium text-muted-foreground">
              <Database className="h-3 w-3" /> 记录数
            </CardTitle>
          </CardHeader>
          <CardContent className="px-4 pb-3">
            <div className="text-xl font-bold tabular-nums">{data?.total ?? '-'}</div>
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="px-4 pb-1 pt-3">
            <CardTitle className="flex items-center gap-1 text-xs font-medium text-muted-foreground">
              <Zap className="h-3 w-3" /> 缓存命中
            </CardTitle>
          </CardHeader>
          <CardContent className="px-4 pb-3">
            <div className="text-xl font-bold tabular-nums">
              {cacheHitCount}<span className="text-sm font-normal text-muted-foreground">/{records.length}</span>
            </div>
            <div className="text-xs text-muted-foreground">平均 {(avgCacheRatio * 100).toFixed(1)}%</div>
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="px-4 pb-1 pt-3">
            <CardTitle className="flex items-center gap-1 text-xs font-medium text-muted-foreground">
              <Clock className="h-3 w-3" /> Token
            </CardTitle>
          </CardHeader>
          <CardContent className="px-4 pb-3">
            <div className="text-xl font-bold tabular-nums">{formatTokens(totalInput + totalOutput)}</div>
            <div className="text-xs text-muted-foreground">入 {formatTokens(totalInput)} / 出 {formatTokens(totalOutput)}</div>
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="px-4 pb-1 pt-3">
            <CardTitle className="text-xs font-medium text-muted-foreground">估算费用</CardTitle>
          </CardHeader>
          <CardContent className="px-4 pb-3">
            <div className="text-xl font-bold tabular-nums">{formatCost(totalCost)}</div>
          </CardContent>
        </Card>
      </div>

      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex items-center gap-2">
          <span className="text-sm text-muted-foreground">显示</span>
          {[50, 100, 200, 500].map((n) => (
            <Button key={n} size="sm" variant={limit === n ? 'default' : 'outline'} className="h-7 px-2 text-xs" onClick={() => setLimit(n)}>
              {n}
            </Button>
          ))}
        </div>
        <div className="flex gap-2">
          <Button size="sm" variant="outline" onClick={() => refetch()} disabled={isLoading}>
            <RefreshCw className={`mr-1 h-3.5 w-3.5 ${isLoading ? 'animate-spin' : ''}`} />
            刷新
          </Button>
          <Button size="sm" variant="outline" className="text-destructive hover:text-destructive" onClick={handleClear} disabled={isClearing || !data?.total}>
            <Trash2 className="mr-1 h-3.5 w-3.5" />
            清空
          </Button>
        </div>
      </div>

      {isLoading ? (
        <Card>
          <CardContent className="py-12 text-center text-muted-foreground">
            <RefreshCw className="mx-auto mb-2 h-6 w-6 animate-spin" />
            加载中...
          </CardContent>
        </Card>
      ) : records.length === 0 ? (
        <Card>
          <CardContent className="py-12 text-center text-muted-foreground">暂无请求记录</CardContent>
        </Card>
      ) : (
        <div className="overflow-hidden rounded-lg border">
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b bg-muted/50">
                  <th className="px-3 py-2 text-left font-medium text-muted-foreground">时间</th>
                  <th className="px-3 py-2 text-left font-medium text-muted-foreground">模型</th>
                  <th className="px-3 py-2 text-left font-medium text-muted-foreground">端点</th>
                  <th className="px-3 py-2 text-right font-medium text-muted-foreground">输入</th>
                  <th className="px-3 py-2 text-right font-medium text-muted-foreground">缓存读取</th>
                  <th className="px-3 py-2 text-right font-medium text-muted-foreground">输出</th>
                  <th className="px-3 py-2 text-left font-medium text-muted-foreground">缓存率</th>
                  <th className="px-3 py-2 text-right font-medium text-muted-foreground">费用</th>
                  <th className="px-3 py-2 text-center font-medium text-muted-foreground">模式</th>
                </tr>
              </thead>
              <tbody>
                {records.map((r, i) => (
                  <tr key={r.requestId + i} className="border-b last:border-0 hover:bg-muted/30">
                    <td className="whitespace-nowrap px-3 py-1.5 text-xs tabular-nums text-muted-foreground">{formatTime(r.recordedAt)}</td>
                    <td className="px-3 py-1.5 text-xs font-medium">{modelShortName(r.model)}</td>
                    <td className="px-3 py-1.5 text-xs text-muted-foreground">{r.endpoint.replace('/v1/', '')}</td>
                    <td className="px-3 py-1.5 text-right text-xs tabular-nums">{formatTokens(r.inputTokens)}</td>
                    <td className="px-3 py-1.5 text-right text-xs tabular-nums text-emerald-600">{r.cachedTokens > 0 ? formatTokens(r.cachedTokens) : '-'}</td>
                    <td className="px-3 py-1.5 text-right text-xs tabular-nums">{formatTokens(r.outputTokens)}</td>
                    <td className="px-3 py-1.5">{cacheRatioBar(r.cacheRatio)}</td>
                    <td className="px-3 py-1.5 text-right text-xs tabular-nums">{formatCost(r.costUsd)}</td>
                    <td className="px-3 py-1.5 text-center">
                      <Badge variant={r.stream ? 'secondary' : 'outline'} className="px-1.5 py-0 text-[10px]">
                        {r.stream ? 'SSE' : 'Sync'}
                      </Badge>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  )
}
