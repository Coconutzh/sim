const CODEX_PPT_STYLE_REFERENCE_SUMMARY = [
  '- 科研答辩风: academic defense, research reports, papers, experiments, thesis/project review; formal Chinese academic hierarchy, evidence-driven diagrams, blue structure with restrained red emphasis.',
  '- 麦肯锡风格: executive consulting, business strategy, growth, organization, transformation, operating model, roadmap, matrix and recommendation decks; restrained premium Swiss-grid consulting look.',
  '- 清爽专业风: product, technical, internal plan, project summary, workflow or architecture explanation; clean modern professional layout with readable structure.',
  '- 数据仪表盘风: metrics, KPI, SaaS analytics, dashboards, market data and operational monitoring; polished data product screenshot adapted for presentation.',
  '- 电子墨水杂志风: editorial insight report, industry analysis, media-style trend deck; premium magazine rhythm with restrained ink-like texture.',
  '- 创意杂志风: high-impact storytelling, brand/editorial narrative, key message covers and section dividers; more expressive but still presentation-readable.',
  '- 手绘技术解释风 / 手绘白板风: teaching, concept explanation, mechanism walkthrough and lightweight technical education; handwritten/whiteboard clarity with readable Chinese text.',
  '- 温暖手工风 / 复古扁平插画风: creative education, softer explainers, community/product storytelling; approachable illustrated presentation identity.',
].join('\n')

const SLIDE_PROMPT_RULES = [
  'For every slide, first decide the slide role: cover, agenda, section divider, key-message, evidence/data, framework, process/roadmap, comparison, case study, transition, or summary.',
  'Keep one deck-level visual identity fixed, but vary layout by slide role. Style consistency does not mean repeating one template.',
  'When primary_content exists and the user asks to generate, condense, or make a deck, content-bearing slides default to text slides, not visual-only/background-only slides.',
  'For primary_content slides, include a concise simplified Chinese title plus 2-4 short bullets, callouts, or data labels derived from the source. Preserve key numbers, names, and claims.',
  'For text slides, include a VISIBLE TEXT TO RENDER EXACTLY section with the exact title, bullets, labels, and key callouts. Require clear simplified Chinese text, large readable type, and no unrelated text.',
  'For visual-only slides, include TEXT POLICY: No readable text. Do not generate random letters, fake captions, logos, or placeholder text.',
  'Only choose visual-only for an explicitly requested transition, atmosphere, cover image, or no-text slide. Never use "No actual readable text required" or placeholder-only wording for primary_content slides.',
  'Use full-slide 16:9 image prompts. Do not ask SIM to show intermediate slide images on the canvas.',
].join('\n')

export function buildSimPresentationHermesGuidance(): string {
  return [
    'SIM presentation generation policy:',
    '- The user may generate a deck either from a PPT canvas node or by chatting with Hermes.',
    '- Frontend/node prompts and referenced canvas nodes are task evidence. Hermes is responsible for deck planning, style selection, page count, per-slide prompts, codex-ppt tool orchestration, and final artifact upload.',
    '- If a referenced text node is provided for a presentation job, treat it as primary_content unless the user clearly says it is only background. A node named like PPT最终文案, final copy, outline, proposal, script, or deck content is especially primary.',
    '- If image/video/audio references are attached, classify them as visual_reference, style_reference, or media_reference based on names and user prompt. Use them to guide slide content/style; do not ignore them.',
    '- Page count priority: user prompt explicit page count, referenced content with clear page structure, PPT node manual setting, then Hermes automatic judgment. If all are unclear, choose 6-8 pages for normal decks.',
    '- Do not require the user to choose a stylePreset. Infer the closest style from user intent, audience, source material, and codex-ppt references. Explicit user style requests override inference.',
    '- Before generating images, produce a slide outline with page index, slide purpose, text policy, visible text if any, layout, visual idea, and speaker/story role.',
    '- For SIM PPT jobs, the image backend is fixed: use sim_presentation_generate_slide_images, backed by codex-ppt scripts/image_gen.py with Evolink gpt-image-2. Do not use built-in image generation or ask the user to choose a backend.',
    '- Then call sim_presentation_assemble_deck and sim_presentation_artifact_upload. Return the final PPTX artifact, optional cover image, manifest, selectedStyle, styleBrief, and backend metadata.',
    '',
    'codex-ppt workflow summary for Hermes:',
    '- Prepare source understanding, audience, goal, outline, visual style, per-slide structured prompts, slide images, QA, speaker notes when useful, and PPT assembly.',
    '- The interactive approval gates in the standalone codex-ppt skill are compressed for SIM node generation: infer and proceed in one run unless the user explicitly asks for review/approval before generation.',
    '- Keep batch slide images internal. SIM canvas should preview the final PPT artifact, not every generated page image.',
    '',
    'codex-ppt style reference summary:',
    CODEX_PPT_STYLE_REFERENCE_SUMMARY,
    '',
    'Per-slide image prompt rules:',
    SLIDE_PROMPT_RULES,
  ].join('\n')
}
