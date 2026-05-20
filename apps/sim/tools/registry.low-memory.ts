import { fileAppendTool } from '@/tools/file/append'
import { fileParserTool, fileParserV2Tool, fileParserV3Tool } from '@/tools/file/parser'
import { fileWriteTool } from '@/tools/file/write'
import { httpRequestTool, webhookRequestTool } from '@/tools/http'
import { searchTool } from '@/tools/search'
import type { ToolConfig } from '@/tools/types'

export const ALL_TOOLS: Record<string, ToolConfig> = {
  file_append: fileAppendTool,
  file_parser: fileParserTool,
  file_parser_v2: fileParserV2Tool,
  file_parser_v3: fileParserV3Tool,
  file_write: fileWriteTool,
  http_request: httpRequestTool,
  search_tool: searchTool,
  webhook_request: webhookRequestTool,
}

export const tools: Record<string, ToolConfig> = ALL_TOOLS
