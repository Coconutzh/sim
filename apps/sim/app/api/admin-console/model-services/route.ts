import { type NextRequest, NextResponse } from 'next/server'
import { requirePlatformAdmin } from '@/lib/admin/auth'
import { listPlatformModelServices, upsertPlatformModelService } from '@/lib/admin/console'
import { adminConsoleListModelServicesContract, adminConsoleUpsertModelServiceContract } from '@/lib/api/contracts/admin-console'
import { parseRequest } from '@/lib/api/server'
import { withRouteHandler } from '@/lib/core/utils/with-route-handler'
export const GET = withRouteHandler(async (request: NextRequest) => { const auth = await requirePlatformAdmin(); if (!auth.success) return auth.response; const parsed = await parseRequest(adminConsoleListModelServicesContract, request, {}); if (!parsed.success) return parsed.response; return NextResponse.json({ services: await listPlatformModelServices() }) })
export const POST = withRouteHandler(async (request: NextRequest) => { const auth = await requirePlatformAdmin(); if (!auth.success) return auth.response; const parsed = await parseRequest(adminConsoleUpsertModelServiceContract, request, {}); if (!parsed.success) return parsed.response; return NextResponse.json({ success: true, service: await upsertPlatformModelService({ actorUserId: auth.session.user.id, body: parsed.data.body }) }) })
