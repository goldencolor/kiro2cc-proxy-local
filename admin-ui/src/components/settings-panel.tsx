import { useEffect, useState } from 'react'
import { toast } from 'sonner'
import { AlertTriangle, Bell, KeyRound, Network, Save, Timer, Zap } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import {
  useAlertConfig,
  useAuthKeys,
  useKvCacheConfig,
  useLoadBalancingMode,
  useSetAlertConfig,
  useSetAuthKeys,
  useSetKvCacheConfig,
  useSetLoadBalancingMode,
} from '@/hooks/use-credentials'
import { extractErrorMessage } from '@/lib/utils'

export function SettingsPanel() {
  const { data: loadBalancingData, isLoading: isLoadingMode } = useLoadBalancingMode()
  const { mutate: setLoadBalancingMode, isPending: isSettingMode } = useSetLoadBalancingMode()
  const { data: authKeysData, isLoading: isLoadingAuthKeys } = useAuthKeys()
  const { mutate: setAuthKeysMut, isPending: isSettingAuthKeys } = useSetAuthKeys()
  const { data: kvCacheConfig } = useKvCacheConfig()
  const { mutate: setKvCacheConfig, isPending: isSettingKvCache } = useSetKvCacheConfig()
  const { data: alertConfig } = useAlertConfig()
  const { mutate: setAlertConfig, isPending: isSettingAlert } = useSetAlertConfig()

  const [apiKeyDraft, setApiKeyDraft] = useState('')
  const [adminApiKeyDraft, setAdminApiKeyDraft] = useState('')
  const [editingApiKey, setEditingApiKey] = useState(false)
  const [editingAdminApiKey, setEditingAdminApiKey] = useState(false)
  const [cacheEfficiencyDraft, setCacheEfficiencyDraft] = useState<number | null>(null)
  const [cacheTtlDraft, setCacheTtlDraft] = useState<number | null>(null)
  const [wecomWebhookUrl, setWecomWebhookUrl] = useState('')
  const [alertCooldown, setAlertCooldown] = useState(1800)

  const cacheEfficiency = cacheEfficiencyDraft ?? Math.round((kvCacheConfig?.cacheReadEfficiency ?? 0.87) * 100)
  const cacheTtl = cacheTtlDraft ?? kvCacheConfig?.kvCacheTtlSecs ?? 3600

  useEffect(() => {
    if (!alertConfig) return
    setWecomWebhookUrl(alertConfig.wecomWebhookUrl ?? '')
    setAlertCooldown(alertConfig.allCredentialsUnavailableAlertCooldownSecs)
  }, [alertConfig])

  const saveAlertConfig = () => {
    setAlertConfig({
      wecomWebhookUrl: wecomWebhookUrl.trim() ? wecomWebhookUrl.trim() : null,
      allCredentialsUnavailableAlertCooldownSecs: Math.max(60, alertCooldown),
    }, {
      onSuccess: () => toast.success('预警配置已保存'),
      onError: (e) => toast.error(extractErrorMessage(e)),
    })
  }

  return (
    <div className="space-y-6">
      <h2 className="text-xl font-semibold">设置</h2>

      <div className="grid gap-4 md:grid-cols-2">
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="flex items-center gap-2 text-sm font-medium">
              <KeyRound className="h-4 w-4" />
              认证密钥
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="space-y-2">
              <div className="flex items-center justify-between">
                <span className="text-sm font-medium">主 API Key</span>
                {!editingApiKey && (
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => { setApiKeyDraft(''); setEditingApiKey(true) }}
                    disabled={isLoadingAuthKeys}
                  >
                    修改
                  </Button>
                )}
              </div>
              {editingApiKey ? (
                <div className="flex gap-2">
                  <Input
                    type="text"
                    placeholder="输入新的 API Key"
                    value={apiKeyDraft}
                    onChange={(e) => setApiKeyDraft(e.target.value)}
                    className="text-sm"
                  />
                  <Button
                    size="sm"
                    disabled={!apiKeyDraft.trim() || isSettingAuthKeys}
                    onClick={() => {
                      setAuthKeysMut({ apiKey: apiKeyDraft.trim() }, {
                        onSuccess: () => {
                          toast.success('主 API Key 已更新')
                          setEditingApiKey(false)
                          setApiKeyDraft('')
                        },
                        onError: (e) => toast.error(extractErrorMessage(e)),
                      })
                    }}
                  >
                    保存
                  </Button>
                  <Button variant="ghost" size="sm" onClick={() => setEditingApiKey(false)}>
                    取消
                  </Button>
                </div>
              ) : (
                <p className="font-mono text-xs text-muted-foreground">
                  {isLoadingAuthKeys ? '加载中...' : authKeysData?.apiKey ?? '-'}
                </p>
              )}
            </div>

            <div className="space-y-2">
              <div className="flex items-center justify-between">
                <span className="text-sm font-medium">Admin API Key</span>
                {!editingAdminApiKey && (
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => { setAdminApiKeyDraft(''); setEditingAdminApiKey(true) }}
                    disabled={isLoadingAuthKeys}
                  >
                    修改
                  </Button>
                )}
              </div>
              {editingAdminApiKey ? (
                <div className="flex gap-2">
                  <Input
                    type="text"
                    placeholder="输入新的 Admin API Key"
                    value={adminApiKeyDraft}
                    onChange={(e) => setAdminApiKeyDraft(e.target.value)}
                    className="text-sm"
                  />
                  <Button
                    size="sm"
                    disabled={!adminApiKeyDraft.trim() || isSettingAuthKeys}
                    onClick={() => {
                      setAuthKeysMut({ adminApiKey: adminApiKeyDraft.trim() }, {
                        onSuccess: () => {
                          toast.success('Admin API Key 已更新，请使用新密钥重新登录')
                          setEditingAdminApiKey(false)
                          setAdminApiKeyDraft('')
                        },
                        onError: (e) => toast.error(extractErrorMessage(e)),
                      })
                    }}
                  >
                    保存
                  </Button>
                  <Button variant="ghost" size="sm" onClick={() => setEditingAdminApiKey(false)}>
                    取消
                  </Button>
                </div>
              ) : (
                <p className="font-mono text-xs text-muted-foreground">
                  {isLoadingAuthKeys ? '加载中...' : authKeysData?.adminApiKey ?? '-'}
                </p>
              )}
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="flex items-center gap-2 text-sm font-medium">
              <Network className="h-4 w-4" />
              负载均衡
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="flex items-center justify-between py-3">
              <span className="text-sm font-medium">均衡模式</span>
              <Button
                variant="outline"
                size="sm"
                onClick={() => {
                  const newMode = loadBalancingData?.mode === 'priority' ? 'balanced' : 'priority'
                  setLoadBalancingMode(newMode, {
                    onSuccess: () => toast.success(`已切换为${newMode === 'priority' ? '优先级模式' : '均衡负载'}`),
                    onError: (e) => toast.error(extractErrorMessage(e)),
                  })
                }}
                disabled={isLoadingMode || isSettingMode}
              >
                {isLoadingMode ? '加载中...' : loadBalancingData?.mode === 'priority' ? '优先级模式' : '均衡负载'}
              </Button>
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="flex items-center gap-2 text-sm font-medium">
              <Zap className="h-4 w-4" />
              KV Cache
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-5">
            <div className="space-y-2">
              <div className="flex items-center justify-between">
                <span className="text-sm font-medium">缓存效率</span>
                <span className="text-sm font-semibold tabular-nums">{cacheEfficiency}%</span>
              </div>
              <input
                type="range"
                min="50"
                max="100"
                step="1"
                value={cacheEfficiency}
                onChange={(e) => setCacheEfficiencyDraft(parseInt(e.target.value, 10))}
                className="h-2 w-full cursor-pointer appearance-none rounded-lg bg-secondary accent-primary"
              />
            </div>
            <div className="space-y-2">
              <span className="text-sm font-medium">缓存 TTL</span>
              <div className="flex items-center gap-2">
                <Input
                  type="number"
                  min="60"
                  step="60"
                  value={cacheTtl}
                  onChange={(e) => setCacheTtlDraft(parseInt(e.target.value, 10) || 3600)}
                  className="text-sm"
                />
                <span className="whitespace-nowrap text-sm text-muted-foreground">秒</span>
              </div>
            </div>
            <Button
              size="sm"
              disabled={isSettingKvCache}
              onClick={() => {
                setKvCacheConfig({
                  cacheReadEfficiency: cacheEfficiency / 100,
                  kvCacheTtlSecs: Math.max(60, cacheTtl),
                }, {
                  onSuccess: () => {
                    toast.success('KV Cache 配置已保存')
                    setCacheEfficiencyDraft(null)
                    setCacheTtlDraft(null)
                  },
                  onError: (e) => toast.error(extractErrorMessage(e)),
                })
              }}
            >
              <Save className="h-4 w-4" />
              {isSettingKvCache ? '保存中...' : '保存 KV Cache'}
            </Button>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="flex items-center gap-2 text-sm font-medium">
              <Bell className="h-4 w-4" />
              预警推送
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="space-y-2">
              <span className="text-sm font-medium">企业微信 Webhook</span>
              <Input
                type="url"
                value={wecomWebhookUrl}
                onChange={(e) => setWecomWebhookUrl(e.target.value)}
                placeholder="https://qyapi.weixin.qq.com/cgi-bin/webhook/send?key=..."
                className="text-sm"
              />
            </div>
            <div className="space-y-2">
              <span className="flex items-center gap-2 text-sm font-medium">
                <Timer className="h-4 w-4" />
                全部账号不可用预警冷却
              </span>
              <div className="flex items-center gap-2">
                <Input
                  type="number"
                  min="60"
                  step="60"
                  value={alertCooldown}
                  onChange={(e) => setAlertCooldown(parseInt(e.target.value, 10) || 1800)}
                  className="text-sm"
                />
                <span className="whitespace-nowrap text-sm text-muted-foreground">秒</span>
              </div>
            </div>
            <div className="flex items-start gap-2 rounded-md border border-amber-200 bg-amber-50 p-3 text-xs text-amber-800 dark:border-amber-900/50 dark:bg-amber-950/30 dark:text-amber-200">
              <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
              <span>当最后一个可用账号因为连续失败或额度用尽被禁用时，会推送企业微信提醒。</span>
            </div>
            <Button size="sm" disabled={isSettingAlert} onClick={saveAlertConfig}>
              <Save className="h-4 w-4" />
              {isSettingAlert ? '保存中...' : '保存预警配置'}
            </Button>
          </CardContent>
        </Card>
      </div>
    </div>
  )
}
