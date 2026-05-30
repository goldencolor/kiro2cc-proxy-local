import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'

export interface VerifyResult {
  id: number
  status: 'pending' | 'verifying' | 'success' | 'failed'
  usage?: string
  error?: string
  prompt?: string
  model?: string
  statusCode?: number
  responseText?: string
  rawResponse?: string
}

interface BatchVerifyDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  verifying: boolean
  progress: { current: number; total: number }
  results: Map<number, VerifyResult>
  onCancel: () => void
  prompt: string
  model: string
  onPromptChange: (value: string) => void
  onModelChange: (value: string) => void
  onStart: () => void
  startLabel: string
}

export function BatchVerifyDialog({
  open,
  onOpenChange,
  verifying,
  progress,
  results,
  onCancel,
  prompt,
  model,
  onPromptChange,
  onModelChange,
  onStart,
  startLabel,
}: BatchVerifyDialogProps) {
  const resultsArray = Array.from(results.values())
  const successCount = resultsArray.filter(r => r.status === 'success').length
  const failedCount = resultsArray.filter(r => r.status === 'failed').length
  const percent = progress.total > 0 ? (progress.current / progress.total) * 100 : 0

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>账号探测</DialogTitle>
        </DialogHeader>

        <div className="space-y-4 py-4">
          <div className="space-y-3">
            <div className="space-y-1.5">
              <label className="text-sm font-medium">探测文本</label>
              <textarea
                value={prompt}
                onChange={(event) => onPromptChange(event.target.value)}
                disabled={verifying}
                className="min-h-24 w-full rounded-md border bg-background px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-ring disabled:opacity-60"
                placeholder="输入要真实发送给上游模型的文本"
              />
            </div>
            <div className="space-y-1.5">
              <label className="text-sm font-medium">模型</label>
              <input
                value={model}
                onChange={(event) => onModelChange(event.target.value)}
                disabled={verifying}
                className="h-9 w-full rounded-md border bg-background px-3 text-sm outline-none focus:ring-2 focus:ring-ring disabled:opacity-60"
              />
            </div>
          </div>

          {verifying && (
            <div className="space-y-2">
              <div className="flex justify-between text-sm">
                <span>探测进度</span>
                <span>{progress.current} / {progress.total}</span>
              </div>
              <div className="h-2 w-full rounded-full bg-secondary">
                <div
                  className="h-2 rounded-full bg-primary transition-all"
                  style={{ width: `${percent}%` }}
                />
              </div>
            </div>
          )}

          {results.size > 0 && (
            <div className="flex justify-between text-sm font-medium">
              <span>探测结果</span>
              <span>成功: {successCount} / 失败: {failedCount}</span>
            </div>
          )}

          {results.size > 0 && (
            <div className="max-h-[400px] space-y-1 overflow-y-auto rounded-md border p-2">
              {resultsArray.map((result) => (
                <div
                  key={result.id}
                  className={`rounded p-2 text-sm ${
                    result.status === 'success'
                      ? 'bg-green-50 text-green-700 dark:bg-green-950 dark:text-green-300'
                      : result.status === 'failed'
                        ? 'bg-red-50 text-red-700 dark:bg-red-950 dark:text-red-300'
                        : result.status === 'verifying'
                          ? 'bg-blue-50 text-blue-700 dark:bg-blue-950 dark:text-blue-300'
                          : 'bg-gray-50 text-gray-700 dark:bg-gray-950 dark:text-gray-300'
                  }`}
                >
                  <div className="flex items-start justify-between gap-2">
                    <div className="flex items-center gap-2">
                      <span className="font-medium">账号 #{result.id}</span>
                      {result.status === 'success' && result.usage && (
                        <Badge variant="secondary" className="text-xs">
                          {result.usage}
                        </Badge>
                      )}
                    </div>
                    <span>
                      {result.status === 'success' && '成功'}
                      {result.status === 'failed' && '失败'}
                      {result.status === 'verifying' && '探测中'}
                      {result.status === 'pending' && '等待'}
                    </span>
                  </div>
                  {result.error && (
                    <div className="mt-1 text-xs opacity-90">
                      错误: {result.error}
                    </div>
                  )}
                  {result.prompt && (
                    <div className="mt-2 rounded border border-current/20 p-2 text-xs">
                      <div className="font-medium">Prompt</div>
                      <div className="mt-1 whitespace-pre-wrap opacity-90">{result.prompt}</div>
                    </div>
                  )}
                  {result.responseText && (
                    <div className="mt-2 rounded border border-current/20 p-2 text-xs">
                      <div className="font-medium">Response</div>
                      <div className="mt-1 whitespace-pre-wrap opacity-90">{result.responseText}</div>
                    </div>
                  )}
                  {result.rawResponse && (
                    <details className="mt-2 text-xs">
                      <summary className="cursor-pointer font-medium">Raw response</summary>
                      <pre className="mt-1 max-h-40 overflow-auto whitespace-pre-wrap rounded border border-current/20 p-2 opacity-90">
                        {result.rawResponse}
                      </pre>
                    </details>
                  )}
                </div>
              ))}
            </div>
          )}

          {verifying && (
            <p className="text-xs text-muted-foreground">
              探测会串行执行，默认每个账号间隔 2 秒，降低触发上游风控的风险。
            </p>
          )}
        </div>

        <div className="flex justify-end gap-2">
          {verifying ? (
            <>
              <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
                后台运行
              </Button>
              <Button type="button" variant="destructive" onClick={onCancel}>
                取消探测
              </Button>
            </>
          ) : (
            <>
              <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
                Close
              </Button>
              <Button type="button" onClick={onStart} disabled={!prompt.trim() || !model.trim()}>
                {startLabel}
              </Button>
            </>
          )}
        </div>
      </DialogContent>
    </Dialog>
  )
}
