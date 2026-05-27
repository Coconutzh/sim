import { type ComponentType, type LazyExoticComponent, lazy } from 'react'

/**
 * Props every `type: 'modal'` sub-block component must accept. The sub-block
 * dispatcher passes these through from the surrounding editor shell.
 */
export interface ModalSubBlockProps {
  blockId: string
  isPreview?: boolean
  disabled?: boolean
}

type ModalSubBlockComponent =
  | ComponentType<ModalSubBlockProps>
  | LazyExoticComponent<ComponentType<ModalSubBlockProps>>

/**
 * Registry of available modal sub-block components keyed by the `modalId`
 * string that trigger / block configs pass in their `SubBlockConfig`.
 *
 * @remarks
 * Adding a new modal sub-block is two lines: import the component, then
 * register it under a unique id. The id travels through config and
 * persistence as a plain string, so nothing here leaks into serialization.
 * Keep this file client-only — it imports React components and must not be
 * pulled into trigger / block config modules.
 */
export const MODAL_REGISTRY: Readonly<Record<string, ModalSubBlockComponent>> = {
  'slack-setup-wizard': lazy(() =>
    import(
      '@/app/workspace/[workspaceId]/w/[workflowId]/components/panel/components/editor/components/sub-block/components/slack-setup-wizard/slack-setup-wizard'
    ).then((module) => ({ default: module.SlackSetupWizard }))
  ),
}

export type ModalId = keyof typeof MODAL_REGISTRY
