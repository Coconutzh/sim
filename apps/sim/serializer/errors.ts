/**
 * Structured validation error for pre-execution workflow validation.
 */
export class WorkflowValidationError extends Error {
  constructor(
    message: string,
    public blockId?: string,
    public blockType?: string,
    public blockName?: string
  ) {
    super(message)
    this.name = 'WorkflowValidationError'
  }
}
