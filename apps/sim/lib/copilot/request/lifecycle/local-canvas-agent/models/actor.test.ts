/**
 * @vitest-environment node
 */
import { describe, expect, it, vi } from 'vitest'
import {
  buildDeterministicLocalAgentAnswer,
  buildLocalAgentAnswer,
  hasInternalFieldLeak,
  selectLocalAgentNextToolCall,
} from '@/lib/copilot/request/lifecycle/local-canvas-agent/models/actor'
import type {
  LocalAgentContext,
  LocalAgentObservation,
  LocalAgentPlan,
} from '@/lib/copilot/request/lifecycle/local-canvas-agent/types'

vi.mock('@/lib/copilot/request/lifecycle/local-canvas-agent/models/config', () => ({
  executeLocalAgentModelRequest: vi.fn(async () => ({
    content: '各组注意，我是总导演 Agent，这次画布已经改好了。',
  })),
}))

function buildContext(message: string): LocalAgentContext {
  return {
    userId: 'user-1',
    workspaceId: 'workspace-1',
    workflowId: 'workflow-1',
    message,
    sessionScope: 'personal',
    agent: {
      code: 'chief_director',
      name: 'Chief Director',
      description: '',
      systemPrompt: '',
    },
    discipline: { id: '', code: 'chief_director', name: '总导演' },
    workgroup: {
      id: '',
      name: 'Workspace',
      organizationId: '',
      teamWorkspaceId: null,
    },
    permissions: { canRead: true, canWrite: true, canPublish: false },
    selectedNodeIds: [],
    conversationHistory: [],
    skills: [],
    model: { model: 'test-model', mode: 'structured' },
    confirmationMode: 'auto',
    thinkingLevel: 'standard',
    requestPayload: {},
    execContext: {
      userId: 'user-1',
      workflowId: 'workflow-1',
      workspaceId: 'workspace-1',
    },
    streamContext: {} as LocalAgentContext['streamContext'],
    options: {},
  }
}

describe('local canvas actor', () => {
  it('does not select mutation tools after a failed observation', () => {
    const observations: LocalAgentObservation[] = [
      {
        toolName: 'canvas.read_node',
        success: false,
        timestamp: '2026-06-06T00:00:00.000Z',
        summary: 'Node was not found',
      },
    ]

    expect(
      selectLocalAgentNextToolCall({
        observations,
        candidates: [{ name: 'canvas.apply_patch', input: { patch: { operations: [] } } }],
      })
    ).toBeNull()

    expect(
      selectLocalAgentNextToolCall({
        observations,
        candidates: [{ name: 'canvas.read_summary', input: {} }],
      })
    ).toEqual({ name: 'canvas.read_summary', input: {} })
  })

  it('answers consult-design requests without summarizing current canvas', async () => {
    const plan: LocalAgentPlan = {
      goal: 'Discuss a Xiaohongshu cat AI video workflow',
      risk: 'low',
      userIntent: 'consult_design',
      mutationPolicy: 'read_only',
      canvasReadPolicy: 'none',
      requiresClarification: false,
      steps: [],
      successCriteria: ['Discuss before changing canvas'],
    }

    const answer = await buildLocalAgentAnswer({
      context: buildContext(
        '你好，我想做一个小红书的小猫ai视频生成工作流，先告诉我工作流如何设计，和我讨论一下'
      ),
      plan,
      observations: [
        {
          toolName: 'planner',
          success: true,
          timestamp: '2026-06-06T00:00:00.000Z',
          summary: plan.goal,
        },
      ],
    })

    expect(answer).toContain('先不改画布')
    expect(answer).toContain('脚本')
    expect(answer).toContain('主视觉')
    expect(answer).toContain('配乐')
    expect(answer).not.toContain('当前画布内容节点如下')
    expect(answer).not.toContain('总导演')
  })

  it('answers canvas summary questions without leaking raw tool JSON', () => {
    const answer = buildDeterministicLocalAgentAnswer({
      context: buildContext('总结当前画布里有哪些内容节点，以及它们之间的关系。'),
      observations: [
        {
          toolName: 'canvas.read_summary',
          success: true,
          timestamp: '2026-06-06T00:00:00.000Z',
          summary: 'read canvas',
          output: {
            workflowId: 'workflow-1',
            workspaceId: 'workspace-1',
            nodes: [
              {
                id: 'text-1',
                name: 'Text 1',
                blockType: 'content',
                kind: 'text',
                position: { x: 0, y: 0 },
                selected: false,
                summary: '春季发布会主视觉脚本',
                capabilities: {
                  canRead: true,
                  canWrite: true,
                  canGenerate: true,
                  canReferenceFile: false,
                },
              },
              {
                id: 'image-1',
                name: 'Image 1',
                blockType: 'content',
                kind: 'image',
                position: { x: 360, y: 0 },
                selected: false,
                summary: '明亮舞台灯光主视觉',
                capabilities: {
                  canRead: true,
                  canWrite: true,
                  canGenerate: true,
                  canReferenceFile: true,
                },
              },
            ],
            edges: [{ source: 'text-1', target: 'image-1' }],
          },
        },
      ] satisfies LocalAgentObservation[],
    })

    expect(answer).toContain('Text 1（文本）')
    expect(answer).toContain('Image 1（图片）')
    expect(answer).toContain('Text 1（文本） -> Image 1（图片）')
    expect(hasInternalFieldLeak(answer)).toBe(false)
  })

  it('extracts selling points from selected text detail', () => {
    const answer = buildDeterministicLocalAgentAnswer({
      context: buildContext('基于我选中的节点，提炼 3 个关键卖点。'),
      observations: [
        {
          toolName: 'canvas.read_selected_nodes',
          success: true,
          timestamp: '2026-06-06T00:00:00.000Z',
          summary: 'read selected',
          output: [
            {
              id: 'text-1',
              name: 'Text 1',
              blockType: 'content',
              kind: 'text',
              position: { x: 0, y: 0 },
              selected: true,
              summary: '广告词',
              capabilities: {
                canRead: true,
                canWrite: true,
                canGenerate: true,
                canReferenceFile: false,
              },
              fields: { contentHtml: '<p>探索未知，触手可及。</p>' },
              textContent:
                '探索未知，触手可及。超乎寻常的处理性能，搭配极简美学设计。它不仅是工具，更是驱动高效生活的不竭引擎。',
            },
          ],
        },
      ] satisfies LocalAgentObservation[],
    })

    expect(answer).toContain('3 个关键卖点')
    expect(answer).toContain('1.')
    expect(answer).toContain('探索未知')
    expect(hasInternalFieldLeak(answer)).toBe(false)
  })

  it('still returns three selling points when selected text is one long paragraph', () => {
    const answer = buildDeterministicLocalAgentAnswer({
      context: buildContext('基于我选中的节点，提炼 3 个关键卖点。'),
      observations: [
        {
          toolName: 'canvas.read_selected_nodes',
          success: true,
          timestamp: '2026-06-06T00:00:00.000Z',
          summary: 'read selected',
          output: [
            {
              id: 'text-1',
              name: 'Text 1',
              blockType: 'content',
              kind: 'text',
              position: { x: 0, y: 0 },
              selected: true,
              summary: '短视频文案',
              capabilities: {
                canRead: true,
                canWrite: true,
                canGenerate: true,
                canReferenceFile: false,
              },
              fields: { contentHtml: '<p>long copy</p>' },
              textContent:
                '春季发布会主视觉 面向年轻用户的明亮舞台灯光 科技产品的轻薄设计 高效生活方式 城市夜景中的自信表达 适合短视频快速传播',
            },
          ],
        },
      ] satisfies LocalAgentObservation[],
    })

    expect(answer).toContain('3 个关键卖点')
    expect(answer).toContain('1.')
    expect(answer).toContain('2.')
    expect(answer).toContain('3.')
    expect(answer).toContain('春季发布会主视觉')
    expect(hasInternalFieldLeak(answer)).toBe(false)
  })

  it('checks selected video generation settings in user-facing language', () => {
    const fullPrompt =
      '镜头从主视觉缓慢推进，先展示产品轮廓，再切到年轻用户在城市夜景中使用产品，最后以明亮舞台灯光收束。'
    const answer = buildDeterministicLocalAgentAnswer({
      context: buildContext('检查这个视频节点的生成设置是否完整。'),
      observations: [
        {
          toolName: 'canvas.read_selected_nodes',
          success: true,
          timestamp: '2026-06-06T00:00:00.000Z',
          summary: 'read selected',
          output: [
            {
              id: 'video-1',
              name: 'Video 1',
              blockType: 'content',
              kind: 'video',
              position: { x: 0, y: 0 },
              selected: true,
              summary: 'generated-video.mp4',
              capabilities: {
                canRead: true,
                canWrite: true,
                canGenerate: true,
                canReferenceFile: true,
              },
              fields: {
                videoPrompt: fullPrompt,
                videoModelFamily: 'wan2.7',
                videoParameters: {
                  duration: 5,
                  resolution: '720p',
                  cameraMovement: 'push-in',
                  watermark: false,
                },
              },
              file: { name: 'generated-video.mp4' },
            },
          ],
        },
      ] satisfies LocalAgentObservation[],
    })

    expect(answer).toContain('视频提示词')
    expect(answer).toContain(fullPrompt)
    expect(answer).toContain('模型族')
    expect(answer).toContain('cameraMovement=push-in')
    expect(answer).toContain('watermark=false')
    expect(answer).toContain('已有生成文件')
    expect(hasInternalFieldLeak(answer)).toBe(false)
  })

  it('explains search matches with source and target connections', () => {
    const textNode = {
      id: 'text-1',
      name: 'Text 1',
      blockType: 'content',
      kind: 'text',
      position: { x: 0, y: 0 },
      selected: false,
      summary: '春季发布会主视觉脚本',
      capabilities: {
        canRead: true,
        canWrite: true,
        canGenerate: true,
        canReferenceFile: false,
      },
    }
    const imageNode = {
      id: 'image-1',
      name: 'Image 1',
      blockType: 'content',
      kind: 'image',
      position: { x: 360, y: 0 },
      selected: false,
      summary: '舞台灯光主视觉',
      capabilities: {
        canRead: true,
        canWrite: true,
        canGenerate: true,
        canReferenceFile: true,
      },
    }
    const answer = buildDeterministicLocalAgentAnswer({
      context: buildContext('找到包含“春季发布会主视觉”的节点，并说明它连接到了哪里。'),
      observations: [
        {
          toolName: 'canvas.read_summary',
          success: true,
          timestamp: '2026-06-06T00:00:00.000Z',
          summary: 'read canvas',
          output: {
            nodes: [textNode, imageNode],
            edges: [{ source: 'text-1', target: 'image-1' }],
          },
        },
        {
          toolName: 'canvas.search_nodes',
          success: true,
          timestamp: '2026-06-06T00:00:00.000Z',
          summary: 'search canvas',
          output: [textNode],
        },
      ] satisfies LocalAgentObservation[],
    })

    expect(answer).toContain('找到 1 个匹配节点')
    expect(answer).toContain('Text 1（文本）')
    expect(answer).toContain('作为 source，连接到 Image 1（图片）')
  })

  it('explains downstream nodes from the selected image node', () => {
    const answer = buildDeterministicLocalAgentAnswer({
      context: {
        ...buildContext('找出图片节点后面的所有节点，并说明它们各自承担什么作用。'),
        selectedNodeIds: ['image-1'],
      },
      observations: [
        {
          toolName: 'canvas.read_selected_nodes',
          success: true,
          timestamp: '2026-06-06T00:00:00.000Z',
          summary: 'read selected',
          output: [
            {
              id: 'image-1',
              name: 'Image 1',
              blockType: 'content',
              kind: 'image',
              position: { x: 360, y: 0 },
              selected: true,
              summary: '舞台灯光主视觉',
              capabilities: {
                canRead: true,
                canWrite: true,
                canGenerate: true,
                canReferenceFile: true,
              },
              fields: { aiPrompt: '舞台灯光主视觉' },
              file: null,
            },
          ],
        },
        {
          toolName: 'canvas.read_summary',
          success: true,
          timestamp: '2026-06-06T00:00:00.000Z',
          summary: 'read canvas',
          output: {
            nodes: [
              {
                id: 'image-1',
                name: 'Image 1',
                blockType: 'content',
                kind: 'image',
                position: { x: 360, y: 0 },
                selected: true,
                summary: '舞台灯光主视觉',
                capabilities: {
                  canRead: true,
                  canWrite: true,
                  canGenerate: true,
                  canReferenceFile: true,
                },
              },
              {
                id: 'video-1',
                name: 'Video 1',
                blockType: 'content',
                kind: 'video',
                position: { x: 720, y: 0 },
                selected: false,
                summary: '负责把主视觉延展成动态镜头',
                capabilities: {
                  canRead: true,
                  canWrite: true,
                  canGenerate: true,
                  canReferenceFile: true,
                },
              },
              {
                id: 'audio-1',
                name: 'Audio 1',
                blockType: 'content',
                kind: 'audio',
                position: { x: 1080, y: 0 },
                selected: false,
                summary: '负责补充节奏和氛围',
                capabilities: {
                  canRead: true,
                  canWrite: true,
                  canGenerate: true,
                  canReferenceFile: true,
                },
              },
            ],
            edges: [
              { source: 'image-1', target: 'video-1' },
              { source: 'video-1', target: 'audio-1' },
            ],
          },
        },
      ] satisfies LocalAgentObservation[],
    })

    expect(answer).toContain('Image 1（图片）')
    expect(answer).toContain('Video 1（视频）')
    expect(answer).toContain('Audio 1（音频）')
    expect(answer).toContain('没有修改画布')
  })

  it('checks selected audio settings against an upstream video node', () => {
    const answer = buildDeterministicLocalAgentAnswer({
      context: {
        ...buildContext('这个音频节点适合当前视频吗？需要怎么改？'),
        selectedNodeIds: ['audio-1'],
      },
      observations: [
        {
          toolName: 'canvas.read_selected_nodes',
          success: true,
          timestamp: '2026-06-06T00:00:00.000Z',
          summary: 'read selected',
          output: [
            {
              id: 'audio-1',
              name: 'Audio 1',
              blockType: 'content',
              kind: 'audio',
              position: { x: 1080, y: 0 },
              selected: true,
              summary: '电子节奏，年轻动感',
              capabilities: {
                canRead: true,
                canWrite: true,
                canGenerate: true,
                canReferenceFile: true,
              },
              fields: {
                audioPrompt: '电子节奏，年轻动感，适合快切短视频',
                audioModel: 'stable-audio',
                audioParameters: { duration: 8, intensity: 'high', bpm: 128 },
              },
              file: { name: 'beat.wav' },
            },
          ],
        },
        {
          toolName: 'canvas.read_summary',
          success: true,
          timestamp: '2026-06-06T00:00:00.000Z',
          summary: 'read canvas',
          output: {
            nodes: [
              {
                id: 'video-1',
                name: 'Video 1',
                blockType: 'content',
                kind: 'video',
                position: { x: 720, y: 0 },
                selected: false,
                summary: '快节奏产品展示视频',
                capabilities: {
                  canRead: true,
                  canWrite: true,
                  canGenerate: true,
                  canReferenceFile: true,
                },
              },
              {
                id: 'audio-1',
                name: 'Audio 1',
                blockType: 'content',
                kind: 'audio',
                position: { x: 1080, y: 0 },
                selected: true,
                summary: '电子节奏，年轻动感',
                capabilities: {
                  canRead: true,
                  canWrite: true,
                  canGenerate: true,
                  canReferenceFile: true,
                },
              },
            ],
            edges: [{ source: 'video-1', target: 'audio-1' }],
          },
        },
      ] satisfies LocalAgentObservation[],
    })

    expect(answer).toContain('音频提示词：电子节奏，年轻动感，适合快切短视频')
    expect(answer).toContain('模型：stable-audio')
    expect(answer).toContain('duration=8')
    expect(answer).toContain('intensity=high')
    expect(answer).toContain('bpm=128')
    expect(answer).toContain('已有生成文件：beat.wav')
    expect(answer).toContain('上游视频：Video 1（视频）')
    expect(answer).toContain('节奏和氛围补充')
  })

  it('answers for the requested selected audio node when selected details are misordered', () => {
    const answer = buildDeterministicLocalAgentAnswer({
      context: {
        ...buildContext('这个音频节点适合当前视频吗？需要怎么改？'),
        selectedNodeIds: ['video-1', 'audio-1'],
      },
      observations: [
        {
          toolName: 'canvas.read_selected_nodes',
          success: true,
          timestamp: '2026-06-06T00:00:00.000Z',
          summary: 'read selected',
          output: [
            {
              id: 'video-1',
              name: 'Video 1',
              blockType: 'content',
              kind: 'video',
              position: { x: 720, y: 0 },
              selected: true,
              summary: '快节奏产品展示视频',
              capabilities: {
                canRead: true,
                canWrite: true,
                canGenerate: true,
                canReferenceFile: true,
              },
              fields: {
                videoPrompt: '快节奏产品展示视频',
                videoModelFamily: 'wan',
                videoParameters: { duration: 5 },
              },
              file: { name: 'video.mp4' },
            },
            {
              id: 'audio-1',
              name: 'Audio 1',
              blockType: 'content',
              kind: 'audio',
              position: { x: 1080, y: 0 },
              selected: true,
              summary: '电子节奏，年轻动感',
              capabilities: {
                canRead: true,
                canWrite: true,
                canGenerate: true,
                canReferenceFile: true,
              },
              fields: {
                audioPrompt: '电子节奏，年轻动感，适合快切短视频',
                audioModel: 'stable-audio',
                audioParameters: { bpm: 128 },
              },
              file: { name: 'beat.wav' },
            },
          ],
        },
        {
          toolName: 'canvas.read_summary',
          success: true,
          timestamp: '2026-06-06T00:00:00.000Z',
          summary: 'read canvas',
          output: {
            nodes: [
              {
                id: 'video-1',
                name: 'Video 1',
                blockType: 'content',
                kind: 'video',
                position: { x: 720, y: 0 },
                selected: true,
                summary: '快节奏产品展示视频',
                capabilities: {
                  canRead: true,
                  canWrite: true,
                  canGenerate: true,
                  canReferenceFile: true,
                },
              },
              {
                id: 'audio-1',
                name: 'Audio 1',
                blockType: 'content',
                kind: 'audio',
                position: { x: 1080, y: 0 },
                selected: true,
                summary: '电子节奏，年轻动感',
                capabilities: {
                  canRead: true,
                  canWrite: true,
                  canGenerate: true,
                  canReferenceFile: true,
                },
              },
            ],
            edges: [{ source: 'video-1', target: 'audio-1' }],
          },
        },
      ] satisfies LocalAgentObservation[],
    })

    expect(answer).toContain('选中的 Audio 1（音频）')
    expect(answer).toContain('音频提示词：电子节奏，年轻动感，适合快切短视频')
    expect(answer).toContain('上游视频：Video 1（视频）')
    expect(answer).not.toContain('视频提示词：已填写')
  })

  it('identifies isolated nodes without modifying the canvas', () => {
    const answer = buildDeterministicLocalAgentAnswer({
      context: buildContext('当前画布有没有孤立节点？如果有，请说明它们可能应该连到哪里。'),
      observations: [
        {
          toolName: 'canvas.read_summary',
          success: true,
          timestamp: '2026-06-06T00:00:00.000Z',
          summary: 'read canvas',
          output: {
            nodes: [
              {
                id: 'text-1',
                name: 'Text 1',
                blockType: 'content',
                kind: 'text',
                position: { x: 0, y: 0 },
                selected: false,
                summary: '脚本',
                capabilities: {
                  canRead: true,
                  canWrite: true,
                  canGenerate: true,
                  canReferenceFile: false,
                },
              },
              {
                id: 'audio-1',
                name: 'Audio 1',
                blockType: 'content',
                kind: 'audio',
                position: { x: 0, y: 240 },
                selected: false,
                summary: '独立配乐',
                capabilities: {
                  canRead: true,
                  canWrite: true,
                  canGenerate: true,
                  canReferenceFile: true,
                },
              },
            ],
            edges: [],
          },
        },
      ] satisfies LocalAgentObservation[],
    })

    expect(answer).toContain('孤立节点')
    expect(answer).toContain('Text 1（文本）')
    expect(answer).toContain('Audio 1（音频）')
    expect(answer).toContain('不会')
  })

  it('returns a concise completion answer after a verified patch', () => {
    const answer = buildDeterministicLocalAgentAnswer({
      context: buildContext('根据当前画布做一个完整短视频内容链。'),
      observations: [
        {
          toolName: 'canvas.apply_patch',
          success: true,
          timestamp: '2026-06-06T00:00:00.000Z',
          summary: 'Patch applied',
        },
        {
          toolName: 'canvas.verify_patch',
          success: true,
          timestamp: '2026-06-06T00:00:00.000Z',
          summary: 'Verified',
        },
      ] satisfies LocalAgentObservation[],
    })

    expect(answer).toBe('已完成画布修改，并完成验证。')
    expect(hasInternalFieldLeak(answer)).toBe(false)
  })

  it('returns a proposal answer without claiming the canvas was modified', () => {
    const answer = buildDeterministicLocalAgentAnswer({
      context: buildContext('重新整理整个画布，补齐缺失节点并连接。'),
      observations: [
        {
          toolName: 'canvas.propose_patch',
          success: true,
          timestamp: '2026-06-06T00:00:00.000Z',
          summary: 'Prepared canvas patch proposal',
        },
      ] satisfies LocalAgentObservation[],
    })

    expect(answer).toContain('已准备好画布修改方案')
    expect(answer).toContain('还没有修改画布')
    expect(answer).not.toContain('已完成画布修改')
    expect(hasInternalFieldLeak(answer)).toBe(false)
  })

  it('does not claim verified completion when a patch has not been verified', () => {
    const answer = buildDeterministicLocalAgentAnswer({
      context: buildContext('根据当前画布做一个完整短视频内容链。'),
      observations: [
        {
          toolName: 'canvas.apply_patch',
          success: true,
          timestamp: '2026-06-06T00:00:00.000Z',
          summary: 'Patch applied',
        },
      ] satisfies LocalAgentObservation[],
    })

    expect(answer).toContain('还没有完成二次验证')
    expect(answer).not.toContain('已完成画布修改')
  })

  it('answers local context tool reads without pretending to read canvas nodes', () => {
    const answer = buildDeterministicLocalAgentAnswer({
      context: buildContext('读取我附加的 brief 文件和任务状态。'),
      observations: [
        {
          toolName: 'read_file',
          success: true,
          timestamp: '2026-06-06T00:00:00.000Z',
          summary: 'Read 1 attached file context(s)',
          output: {
            contexts: [
              {
                tag: '@brief.pdf',
                content: 'Brief content for the spring launch visual direction.',
              },
            ],
            files: [{ name: 'brief.pdf' }],
          },
        },
        {
          toolName: 'read_tasks',
          success: true,
          timestamp: '2026-06-06T00:00:00.000Z',
          summary: 'Read 1 production task(s) for the current workflow',
          output: {
            tasks: [
              {
                title: '补齐视频节点',
                status: 'todo',
                assigneeWorkgroup: '视频组',
                dueAt: null,
              },
            ],
          },
        },
      ] satisfies LocalAgentObservation[],
    })

    expect(answer).toContain('我已读取相关上下文，摘要如下')
    expect(answer).toContain('文件 @brief.pdf')
    expect(answer).toContain('spring launch visual direction')
    expect(answer).toContain('任务 补齐视频节点')
    expect(answer).toContain('状态 todo')
    expect(answer).toContain('负责组：视频组')
    expect(answer).toContain('没有修改画布')
    expect(answer).not.toContain('没有拿到可解释的节点结构')
  })

  it('reports materialized files and task writes in user-facing language', () => {
    const answer = buildDeterministicLocalAgentAnswer({
      context: buildContext('保存附件 brief，并提交任务 task-1。'),
      observations: [
        {
          toolName: 'materialize_file',
          success: true,
          timestamp: '2026-06-06T00:00:00.000Z',
          summary: 'Saved uploaded file context into workspace storage',
          output: {
            output: { succeeded: ['brief.pdf'], failed: [] },
            resources: [{ type: 'file', id: 'file-1', title: 'brief.pdf' }],
          },
        },
        {
          toolName: 'submit_task_result',
          success: true,
          timestamp: '2026-06-06T00:00:00.000Z',
          summary: 'Submitted production task "补齐视频节点" with status submitted',
          output: {
            task: {
              title: '补齐视频节点',
              status: 'submitted',
              resultNodeId: 'text-1',
            },
          },
        },
      ] satisfies LocalAgentObservation[],
    })

    expect(answer).toContain('文件 brief.pdf：已保存到工作区')
    expect(answer).toContain('已提交任务 补齐视频节点')
    expect(answer).toContain('状态 submitted')
    expect(answer).toContain('结果节点：text-1')
    expect(answer).toContain('没有修改画布')
  })

  it('returns a concise completion answer after generated output is written back', () => {
    const answer = buildDeterministicLocalAgentAnswer({
      context: buildContext('根据这个节点的 aiPrompt 生成正文并写回。'),
      observations: [
        {
          toolName: 'canvas.read_selected_nodes',
          success: true,
          timestamp: '2026-06-06T00:00:00.000Z',
          summary: 'Read selected node',
          output: [],
        },
        {
          toolName: 'canvas.generate_node_output',
          success: true,
          timestamp: '2026-06-06T00:00:00.000Z',
          summary: 'Generated output for text node',
          output: { nodeId: 'text-1', kind: 'text', contentHtml: '<p>生成正文</p>' },
        },
        {
          toolName: 'canvas.verify_patch',
          success: true,
          timestamp: '2026-06-06T00:00:00.000Z',
          summary: 'Verified canvas patch',
        },
      ] satisfies LocalAgentObservation[],
    })

    expect(answer).toBe('已生成内容并写回选中节点，验证也已完成。')
    expect(hasInternalFieldLeak(answer)).toBe(false)
  })

  it('uses deterministic read-only answers instead of role-playing the fallback agent profile', async () => {
    const context = buildContext('总结当前画布里有哪些内容节点，以及它们之间的关系。')
    context.agent.systemPrompt = '你是总导演 Agent，需要以总导演身份发言。'
    const plan: LocalAgentPlan = {
      goal: context.message,
      risk: 'low',
      requiresClarification: false,
      steps: [],
      successCriteria: ['Answer based on current canvas'],
    }

    const answer = await buildLocalAgentAnswer({
      context,
      plan,
      observations: [
        {
          toolName: 'canvas.read_summary',
          success: true,
          timestamp: '2026-06-06T00:00:00.000Z',
          summary: 'read canvas',
          output: {
            nodes: [
              {
                id: 'text-1',
                name: 'Text 1',
                blockType: 'content',
                kind: 'text',
                position: { x: 0, y: 0 },
                selected: false,
                summary: '春季发布会脚本',
                capabilities: {
                  canRead: true,
                  canWrite: true,
                  canGenerate: true,
                  canReferenceFile: false,
                },
              },
            ],
            edges: [],
          },
        },
      ] satisfies LocalAgentObservation[],
    })

    expect(answer).toContain('Text 1（文本）')
    expect(answer).not.toContain('总导演')
    expect(answer).not.toContain('Agent')
  })

  it('uses deterministic completion reports after patch success instead of role-playing model rewrites', async () => {
    const context = buildContext('把选中文案改成更适合年轻用户的短视频口吻。')
    context.agent.systemPrompt = '你是总导演 Agent，需要以总导演身份发言。'
    const plan: LocalAgentPlan = {
      goal: context.message,
      risk: 'low',
      requiresClarification: false,
      steps: [],
      successCriteria: ['Canvas reflects the requested change'],
      patch: {
        operations: [
          {
            type: 'update_node',
            nodeId: 'text-1',
            fields: { contentHtml: '<p>新文案</p>' },
          },
        ],
      },
    }

    const answer = await buildLocalAgentAnswer({
      context,
      plan,
      observations: [
        {
          toolName: 'canvas.apply_patch',
          success: true,
          timestamp: '2026-06-06T00:00:00.000Z',
          summary: 'Patch applied',
        },
        {
          toolName: 'canvas.verify_patch',
          success: true,
          timestamp: '2026-06-06T00:00:00.000Z',
          summary: 'Patch verified',
        },
      ] satisfies LocalAgentObservation[],
    })

    expect(answer).toBe('已完成画布修改，并完成验证。')
    expect(answer).not.toContain('总导演')
    expect(answer).not.toContain('Agent')
  })
})
