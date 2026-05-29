import { useEffect, useMemo, useState } from 'react'
import { RefreshCw } from 'lucide-react'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { Badge } from '@/components/ui/badge'
import { getModels } from '@/api/credentials'
import { extractErrorMessage } from '@/lib/utils'
import type { ModelItem } from '@/types/api'

interface ModelListDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
}

export function ModelListDialog({ open, onOpenChange }: ModelListDialogProps) {
  const [models, setModels] = useState<ModelItem[]>([])
  const [loading, setLoading] = useState(false)

  const sortedModels = useMemo(() => {
    return [...models].sort((a, b) => {
      const createdDiff = b.created - a.created
      return createdDiff !== 0 ? createdDiff : a.id.localeCompare(b.id)
    })
  }, [models])

  const fetchModels = async () => {
    setLoading(true)
    try {
      const response = await getModels()
      setModels(response.data)
      toast.success(`已获取 ${response.data.length} 个模型`)
    } catch (error) {
      toast.error(extractErrorMessage(error))
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    if (open && models.length === 0 && !loading) {
      fetchModels()
    }
  }, [open])

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-4xl max-h-[85vh] overflow-hidden">
        <DialogHeader>
          <div className="flex items-start justify-between gap-3 pr-8">
            <div>
              <DialogTitle>模型列表</DialogTitle>
              <DialogDescription>
                当前服务公开的 Anthropic 兼容模型
              </DialogDescription>
            </div>
            <Button
              variant="outline"
              size="sm"
              onClick={fetchModels}
              disabled={loading}
              className="shrink-0"
            >
              <RefreshCw className={`h-4 w-4 sm:mr-2 ${loading ? 'animate-spin' : ''}`} />
              <span className="hidden sm:inline">刷新</span>
            </Button>
          </div>
        </DialogHeader>

        <div className="overflow-auto rounded-md border">
          <table className="w-full text-sm">
            <thead className="sticky top-0 bg-muted text-muted-foreground">
              <tr className="border-b">
                <th className="px-3 py-2 text-left font-medium">模型 ID</th>
                <th className="px-3 py-2 text-left font-medium">显示名</th>
                <th className="px-3 py-2 text-left font-medium">类型</th>
                <th className="px-3 py-2 text-right font-medium">Max Tokens</th>
              </tr>
            </thead>
            <tbody>
              {loading && sortedModels.length === 0 ? (
                <tr>
                  <td colSpan={4} className="px-3 py-8 text-center text-muted-foreground">
                    加载中...
                  </td>
                </tr>
              ) : sortedModels.length === 0 ? (
                <tr>
                  <td colSpan={4} className="px-3 py-8 text-center text-muted-foreground">
                    暂无模型
                  </td>
                </tr>
              ) : (
                sortedModels.map(model => (
                  <tr key={model.id} className="border-b last:border-0">
                    <td className="px-3 py-2 font-mono text-xs">{model.id}</td>
                    <td className="px-3 py-2">{model.display_name}</td>
                    <td className="px-3 py-2">
                      <Badge variant="secondary">{model.model_type ?? model.type ?? '-'}</Badge>
                    </td>
                    <td className="px-3 py-2 text-right tabular-nums">
                      {model.max_tokens.toLocaleString()}
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </DialogContent>
    </Dialog>
  )
}
