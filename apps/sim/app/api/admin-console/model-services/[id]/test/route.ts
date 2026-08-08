import { db, platformModelServiceConfig } from '@sim/db'
import { eq } from 'drizzle-orm'
import type { NextRequest } from 'next/server'
import { NextResponse } from 'next/server'
import { requirePlatformAdmin } from '@/lib/admin/auth'
import { getPlatformProviderApiKey } from '@/lib/api-key/platform'
import { adminConsoleTestModelServiceContract } from '@/lib/api/contracts/admin-console'
import { parseRequest } from '@/lib/api/server'
import { withRouteHandler } from '@/lib/core/utils/with-route-handler'

export const POST = withRouteHandler(
  async (request: NextRequest, context: { params: Promise<{ id: string }> }) => {
    const auth = await requirePlatformAdmin()
    if (!auth.success) return auth.response
    const parsed = await parseRequest(adminConsoleTestModelServiceContract, request, context)
    if (!parsed.success) return parsed.response
    const [service] = await db
      .select()
      .from(platformModelServiceConfig)
      .where(eq(platformModelServiceConfig.id, parsed.data.params.id))
      .limit(1)
    if (!service)
      return NextResponse.json({ success: false, message: '模型服务不存在' }, { status: 404 })
    const key = await getPlatformProviderApiKey(service.providerId)
    if (!key) return NextResponse.json({ success: false, message: '没有可用的平台 Key' })
    if (service.serviceKind !== 'cohere-native')
      return NextResponse.json({ success: false, message: '该服务类型尚未提供连通性测试' })
    const model = service.defaultModelId ?? (service.enabledModelIds as string[])[0]
    const response = await fetch('https://api.cohere.ai/v2/chat', {
      method: 'POST',
      headers: { Authorization: `Bearer ${key.apiKey}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model,
        stream: false,
        messages: [{ role: 'user', content: 'Reply with OK.' }],
      }),
    })
    if (!response.ok)
      return NextResponse.json({ success: false, message: `Cohere 返回 HTTP ${response.status}` })
    return NextResponse.json({ success: true, message: '连接成功' })
  }
)
