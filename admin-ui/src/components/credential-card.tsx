import { useState } from 'react'
import { toast } from 'sonner'
import { RefreshCw, ChevronUp, ChevronDown, Wallet, Trash2, Loader2, Pencil, FileText, KeyRound } from 'lucide-react'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { Switch } from '@/components/ui/switch'
import { Input } from '@/components/ui/input'
import { Checkbox } from '@/components/ui/checkbox'
import { Progress } from '@/components/ui/progress'
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { cn } from '@/lib/utils'
import type { BalanceResponse, CredentialStatusItem } from '@/types/api'
import {
  useSetDisabled,
  useSetPriority,
  useResetFailure,
  useRefreshCredentialToken,
  useDeleteCredential,
} from '@/hooks/use-credentials'
import { EditCredentialDialog } from './edit-credential-dialog'

interface CredentialCardProps {
  credential: CredentialStatusItem
  onViewBalance: (id: number) => void
  onViewLog: (id: number) => void
  selected: boolean
  onToggleSelect: () => void
  balance: BalanceResponse | null
  loadingBalance: boolean
  rpm?: number
  variant?: 'card' | 'list'
}

function formatLastUsed(lastUsedAt: string | null): string {
  if (!lastUsedAt) return '从未使用'
  const date = new Date(lastUsedAt)
  const now = new Date()
  const diff = now.getTime() - date.getTime()
  if (diff < 0) return '刚刚'
  const seconds = Math.floor(diff / 1000)
  if (seconds < 60) return `${seconds} 秒前`
  const minutes = Math.floor(seconds / 60)
  if (minutes < 60) return `${minutes} 分钟前`
  const hours = Math.floor(minutes / 60)
  if (hours < 24) return `${hours} 小时前`
  const days = Math.floor(hours / 24)
  return `${days} 天前`
}

function formatBalanceNumber(num: number) {
  return num.toLocaleString('zh-CN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
}

function formatResetDate(timestamp: number | null) {
  if (!timestamp) return '未知'
  return new Date(timestamp * 1000).toLocaleString('zh-CN')
}

export function CredentialCard({
  credential,
  onViewBalance,
  onViewLog,
  selected,
  onToggleSelect,
  balance,
  loadingBalance,
  rpm = 0,
  variant = 'card',
}: CredentialCardProps) {
  const [editingPriority, setEditingPriority] = useState(false)
  const [priorityValue, setPriorityValue] = useState(String(credential.priority))
  const [showDeleteDialog, setShowDeleteDialog] = useState(false)
  const [showEditDialog, setShowEditDialog] = useState(false)

  const setDisabled = useSetDisabled()
  const setPriority = useSetPriority()
  const resetFailure = useResetFailure()
  const refreshToken = useRefreshCredentialToken()
  const deleteCredential = useDeleteCredential()
  const isQuotaExceeded = credential.disabledReason === 'quotaExceeded'
  const isList = variant === 'list'

  const handleToggleDisabled = () => {
    setDisabled.mutate(
      { id: credential.id, disabled: !credential.disabled },
      {
        onSuccess: (res) => toast.success(res.message),
        onError: (err) => toast.error('操作失败: ' + (err as Error).message),
      }
    )
  }

  const handlePriorityChange = () => {
    const newPriority = parseInt(priorityValue, 10)
    if (isNaN(newPriority) || newPriority < 0) {
      toast.error('优先级必须是非负整数')
      return
    }
    setPriority.mutate(
      { id: credential.id, priority: newPriority },
      {
        onSuccess: (res) => {
          toast.success(res.message)
          setEditingPriority(false)
        },
        onError: (err) => toast.error('操作失败: ' + (err as Error).message),
      }
    )
  }

  const handleReset = () => {
    resetFailure.mutate(credential.id, {
      onSuccess: (res) => toast.success(res.message),
      onError: (err) => toast.error('操作失败: ' + (err as Error).message),
    })
  }

  const handleRefreshToken = () => {
    refreshToken.mutate(credential.id, {
      onSuccess: (res) => toast.success(res.message),
      onError: (err) => toast.error('刷新 Token 失败: ' + (err as Error).message),
    })
  }

  const handleDelete = () => {
    if (!credential.disabled) {
      toast.error('请先禁用凭据再删除')
      setShowDeleteDialog(false)
      return
    }

    deleteCredential.mutate(credential.id, {
      onSuccess: (res) => {
        toast.success(res.message)
        setShowDeleteDialog(false)
      },
      onError: (err) => toast.error('删除失败: ' + (err as Error).message),
    })
  }

  return (
    <>
      <Card className={cn(credential.isCurrent && 'ring-2 ring-primary', isList && 'overflow-hidden')}>
        <CardHeader className={cn(isList ? 'pb-3' : 'pb-2')}>
          <div className={cn('flex items-start justify-between gap-3', isList && 'flex-wrap')}>
            <div className="flex items-start gap-2 min-w-0">
              <Checkbox checked={selected} onCheckedChange={onToggleSelect} className="mt-1" />
              <div className="min-w-0">
                <CardTitle className={cn('flex flex-wrap items-center gap-2', isList ? 'text-base' : 'text-lg')}>
                  <span className="truncate max-w-[18rem]">
                    {credential.nickname || credential.email || `凭据 #${credential.id}`}
                  </span>
                  {credential.isCurrent && <Badge variant="success">当前</Badge>}
                  {credential.disabled && (
                    <Badge variant="destructive">{isQuotaExceeded ? '额度超额' : '已禁用'}</Badge>
                  )}
                  {credential.cooldownRemainingSecs > 0 && !credential.disabled && (
                    <Badge variant="secondary">冷却 {credential.cooldownRemainingSecs}s</Badge>
                  )}
                </CardTitle>
                <div className="mt-1 flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
                  <span>#{credential.id}</span>
                  <span>优先级 {credential.priority}</span>
                  <span>失败 {credential.failureCount}</span>
                  <span>RPM {rpm}</span>
                  <span>{formatLastUsed(credential.lastUsedAt)}</span>
                  {credential.hasProxy && (
                    <Badge variant="outline" className="rounded-full">
                      代理 {credential.proxyUrl || '已配置'}
                    </Badge>
                  )}
                </div>
              </div>
            </div>
            <div className="flex items-center gap-2 shrink-0">
              <span className="text-sm text-muted-foreground">启用</span>
              <Switch checked={!credential.disabled} onCheckedChange={handleToggleDisabled} disabled={setDisabled.isPending} />
            </div>
          </div>
        </CardHeader>
        <CardContent className={cn(isList ? 'space-y-3 pt-0' : 'space-y-4')}>
          {isList ? (
            <>
              <div className="grid gap-3 text-sm md:grid-cols-[1.2fr_0.8fr]">
                <div className="space-y-2">
                  <div className="flex flex-wrap gap-2">
                    <Badge variant="secondary">订阅 {loadingBalance ? '加载中' : balance?.subscriptionTitle || '未知'}</Badge>
                    <Badge variant="outline">成功 {credential.successCount}</Badge>
                    {credential.hasProfileArn && <Badge variant="secondary">Profile ARN</Badge>}
                    {isQuotaExceeded && <Badge variant="destructive">月度超额</Badge>}
                  </div>
                  <div className="text-xs text-muted-foreground">
                    {credential.email && <span className="mr-3">账号 {credential.email}</span>}
                    <span className="mr-3">最近使用 {formatLastUsed(credential.lastUsedAt)}</span>
                    <span>优先级可直接点数值编辑</span>
                  </div>
                  {credential.hasProxy && (
                    <div className="rounded-md border bg-muted/30 px-3 py-2">
                      <div className="text-xs text-muted-foreground">账号代理</div>
                      <div className="font-medium break-all">{credential.proxyUrl || '已配置'}</div>
                    </div>
                  )}
                </div>
                <div className="space-y-2">
                  <div className="rounded-md border bg-muted/20 p-3">
                    {loadingBalance ? (
                      <span className="text-sm text-muted-foreground">
                        <Loader2 className="inline h-3 w-3 animate-spin" /> 余额加载中...
                      </span>
                    ) : balance ? (
                      <>
                        <div className="flex items-center justify-between gap-3 text-xs text-muted-foreground">
                          <span>已使用 ${formatBalanceNumber(balance.currentUsage)}</span>
                          <span>限额 ${formatBalanceNumber(balance.usageLimit)}</span>
                        </div>
                        <Progress value={balance.usagePercentage} className="mt-2 h-2" />
                        <div className="mt-2 flex items-center justify-between text-xs">
                          <span>剩余 ${formatBalanceNumber(balance.remaining)}</span>
                          <span>{balance.usagePercentage.toFixed(1)}%</span>
                        </div>
                      </>
                    ) : (
                      <span className="text-sm text-muted-foreground">未知</span>
                    )}
                  </div>
                </div>
              </div>
              <div className="flex flex-wrap items-center gap-2 pt-1">
                <Button size="sm" variant="default" onClick={() => onViewBalance(credential.id)}>
                  <Wallet className="h-4 w-4 mr-1" />
                  余额
                </Button>
                <Button variant="ghost" size="sm" onClick={() => onViewLog(credential.id)} title="查看使用日志">
                  <FileText className="h-4 w-4 mr-1" />
                  日志
                </Button>
                <Button
                  size="sm"
                  variant="outline"
                  onClick={handleRefreshToken}
                  disabled={refreshToken.isPending || credential.hasKiroApiKey}
                  title={credential.hasKiroApiKey ? 'Kiro API Key 凭据无需刷新 Token' : undefined}
                >
                  {refreshToken.isPending ? <Loader2 className="h-4 w-4 mr-1 animate-spin" /> : <KeyRound className="h-4 w-4 mr-1" />}
                  刷新 Token
                </Button>
                <Button size="sm" variant="outline" onClick={() => setShowEditDialog(true)}>
                  <Pencil className="h-4 w-4 mr-1" />
                  编辑
                </Button>
                <Button size="sm" variant="destructive" onClick={() => setShowDeleteDialog(true)} disabled={!credential.disabled}>
                  <Trash2 className="h-4 w-4 mr-1" />
                  删除
                </Button>
              </div>
            </>
          ) : (
            <>
              <div className="grid grid-cols-2 gap-4 text-sm">
                {credential.email && (
                  <div className="col-span-2 flex items-center gap-1.5 rounded-md bg-muted/50 px-2 py-1.5">
                    <span className="text-muted-foreground">账号：</span>
                    <span className="font-medium text-foreground">{credential.email}</span>
                  </div>
                )}
                <div>
                  <span className="text-muted-foreground">优先级：</span>
                  {editingPriority ? (
                    <div className="inline-flex items-center gap-1 ml-1">
                      <Input
                        type="number"
                        value={priorityValue}
                        onChange={(e) => setPriorityValue(e.target.value)}
                        className="w-16 h-7 text-sm"
                        min="0"
                      />
                      <Button size="sm" variant="ghost" className="h-7 w-7 p-0" onClick={handlePriorityChange} disabled={setPriority.isPending}>
                        ✓
                      </Button>
                      <Button
                        size="sm"
                        variant="ghost"
                        className="h-7 w-7 p-0"
                        onClick={() => {
                          setEditingPriority(false)
                          setPriorityValue(String(credential.priority))
                        }}
                      >
                        ×
                      </Button>
                    </div>
                  ) : (
                    <span className="font-medium cursor-pointer hover:underline ml-1" onClick={() => setEditingPriority(true)}>
                      {credential.priority}
                      <span className="text-xs text-muted-foreground ml-1">(点击编辑)</span>
                    </span>
                  )}
                </div>
                <div>
                  <span className="text-muted-foreground">失败次数：</span>
                  <span className={credential.failureCount > 0 ? 'text-red-500 font-medium' : ''}>{credential.failureCount}</span>
                </div>
                {isQuotaExceeded && (
                  <div className="col-span-2 rounded-md border border-destructive/30 bg-destructive/10 px-2 py-1.5 text-sm text-destructive">
                    该账号已触发月度额度超额，已自动禁用，不会参与请求调度。
                  </div>
                )}
                <div>
                  <span className="text-muted-foreground">订阅等级：</span>
                  <span className="font-medium">{loadingBalance ? <Loader2 className="inline w-3 h-3 animate-spin" /> : balance?.subscriptionTitle || '未知'}</span>
                </div>
                <div>
                  <span className="text-muted-foreground">成功次数：</span>
                  <span className="font-medium">{credential.successCount}</span>
                </div>
                <div>
                  <span className="text-muted-foreground">RPM：</span>
                  <span className="font-medium text-blue-600">{rpm}</span>
                </div>
                <div className="col-span-2">
                  <span className="text-muted-foreground">最后调用：</span>
                  <span className="font-medium">{formatLastUsed(credential.lastUsedAt)}</span>
                </div>
                <div className="col-span-2">
                  <span className="text-muted-foreground">剩余用量：</span>
                  {loadingBalance ? (
                    <span className="text-sm ml-1">
                      <Loader2 className="inline w-3 h-3 animate-spin" /> 加载中...
                    </span>
                  ) : balance ? (
                    <div className="mt-2 rounded-md border bg-muted/20 p-3">
                      <div className="flex items-center justify-between gap-3 text-xs text-muted-foreground">
                        <span>已使用 ${formatBalanceNumber(balance.currentUsage)}</span>
                        <span>限额 ${formatBalanceNumber(balance.usageLimit)}</span>
                      </div>
                      <Progress value={balance.usagePercentage} className="mt-2 h-2" />
                      <div className="mt-2 grid grid-cols-2 gap-2 text-xs">
                        <div>
                          <span className="text-muted-foreground">剩余 </span>
                          <span className="font-semibold text-green-600">
                            ${formatBalanceNumber(balance.remaining)}
                          </span>
                        </div>
                        <div className="text-right">
                          <span className="text-muted-foreground">已用 </span>
                          <span className="font-medium">{balance.usagePercentage.toFixed(1)}%</span>
                        </div>
                        <div className="col-span-2 text-muted-foreground">
                          下次重置：{formatResetDate(balance.nextResetAt)}
                        </div>
                      </div>
                    </div>
                  ) : (
                    <span className="text-sm text-muted-foreground ml-1">未知</span>
                  )}
                </div>
                {credential.hasProxy && (
                  <div className="col-span-2">
                    <span className="text-muted-foreground">代理：</span>
                    <span className="font-medium">{credential.proxyUrl}</span>
                  </div>
                )}
                {credential.hasProfileArn && (
                  <div className="col-span-2">
                    <Badge variant="secondary">有 Profile ARN</Badge>
                  </div>
                )}
              </div>

              <div className="space-y-2 pt-2 border-t">
                <div className="grid grid-cols-1 gap-2 sm:grid-cols-3">
                  <Button
                    size="sm"
                    variant="outline"
                    onClick={handleReset}
                    disabled={resetFailure.isPending || credential.failureCount === 0}
                    className="justify-center"
                  >
                    <RefreshCw className="h-4 w-4 mr-1" />
                    重置失败
                  </Button>
                  <Button
                    size="sm"
                    variant="outline"
                    onClick={() => {
                      const newPriority = Math.max(0, credential.priority - 1)
                      setPriority.mutate(
                        { id: credential.id, priority: newPriority },
                        {
                          onSuccess: (res) => toast.success(res.message),
                          onError: (err) => toast.error('操作失败: ' + (err as Error).message),
                        }
                      )
                    }}
                    disabled={setPriority.isPending || credential.priority === 0}
                    className="justify-center"
                  >
                    <ChevronUp className="h-4 w-4 mr-1" />
                    提高优先级
                  </Button>
                  <Button
                    size="sm"
                    variant="outline"
                    onClick={() => {
                      const newPriority = credential.priority + 1
                      setPriority.mutate(
                        { id: credential.id, priority: newPriority },
                        {
                          onSuccess: (res) => toast.success(res.message),
                          onError: (err) => toast.error('操作失败: ' + (err as Error).message),
                        }
                      )
                    }}
                    disabled={setPriority.isPending}
                    className="justify-center"
                  >
                    <ChevronDown className="h-4 w-4 mr-1" />
                    降低优先级
                  </Button>
                </div>
                <div className="flex flex-wrap items-center gap-2">
                  <Button size="sm" variant="default" onClick={() => onViewBalance(credential.id)}>
                    <Wallet className="h-4 w-4 mr-1" />
                    查看余额
                  </Button>
                  <Button variant="ghost" size="sm" onClick={() => onViewLog(credential.id)} title="查看使用日志">
                    <FileText className="h-4 w-4 mr-1" />
                    日志
                  </Button>
                  <Button
                    size="sm"
                    variant="outline"
                    onClick={handleRefreshToken}
                    disabled={refreshToken.isPending || credential.hasKiroApiKey}
                    title={credential.hasKiroApiKey ? 'Kiro API Key 凭据无需刷新 Token' : undefined}
                  >
                    {refreshToken.isPending ? (
                      <Loader2 className="h-4 w-4 mr-1 animate-spin" />
                    ) : (
                      <KeyRound className="h-4 w-4 mr-1" />
                    )}
                    刷新 Token
                  </Button>
                  <Button size="sm" variant="outline" onClick={() => setShowEditDialog(true)}>
                    <Pencil className="h-4 w-4 mr-1" />
                    编辑
                  </Button>
                  <Button
                    size="sm"
                    variant="destructive"
                    onClick={() => setShowDeleteDialog(true)}
                    disabled={!credential.disabled}
                    title={!credential.disabled ? '需要先禁用凭据才能删除' : undefined}
                  >
                    <Trash2 className="h-4 w-4 mr-1" />
                    删除
                  </Button>
                </div>
              </div>
            </>
          )}
        </CardContent>
      </Card>

      <Dialog open={showDeleteDialog} onOpenChange={setShowDeleteDialog}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>确认删除凭据</DialogTitle>
            <DialogDescription>
              您确定要删除凭据 #{credential.id} 吗？此操作无法撤销。
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" onClick={() => setShowDeleteDialog(false)} disabled={deleteCredential.isPending}>
              取消
            </Button>
            <Button variant="destructive" onClick={handleDelete} disabled={deleteCredential.isPending || !credential.disabled}>
              确认删除
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <EditCredentialDialog open={showEditDialog} onOpenChange={setShowEditDialog} credential={credential} />
    </>
  )
}
