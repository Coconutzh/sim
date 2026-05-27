'use client'

import { Component, type ReactNode, useEffect } from 'react'
import { createLogger } from '@sim/logger'
import { RefreshCw } from 'lucide-react'

const logger = createLogger('ErrorBoundary')

/**
 * Shared Error UI Component
 */
interface ErrorUIProps {
  title?: string
  message?: string
  onReset?: () => void
  fullScreen?: boolean
}

export function ErrorUI({
  title = 'Something went wrong',
  message = 'An unexpected error occurred. Please try again or refresh the page.',
  onReset,
  fullScreen = false,
}: ErrorUIProps) {
  if (!fullScreen) {
    return (
      <div className='flex h-full flex-1 items-center justify-center'>
        <div className='flex flex-col items-center gap-4 text-center'>
          <div className='flex flex-col gap-2'>
            <h2 className='font-semibold text-[var(--text-primary)] text-md'>{title}</h2>
            <p className='max-w-[300px] text-[var(--text-tertiary)] text-small'>{message}</p>
          </div>
          <button
            type='button'
            className='inline-flex h-8 items-center rounded-[8px] bg-[var(--brand-primary)] px-3 font-medium text-[13px] text-white'
            onClick={onReset ?? (() => window.location.reload())}
          >
            <RefreshCw className='mr-1.5 h-[14px] w-[14px]' />
            Try again
          </button>
        </div>
      </div>
    )
  }

  return (
    <div className='flex h-screen w-full items-center justify-center bg-[var(--surface-1)]'>
      <div className='flex max-w-sm flex-col items-center gap-4 text-center'>
        <h3 className='font-semibold text-[var(--text-primary)] text-md'>{title}</h3>
        <p className='font-medium text-[var(--text-tertiary)] text-sm'>{message}</p>
      </div>
    </div>
  )
}

/**
 * React Error Boundary Component
 * Catches React rendering errors and displays ErrorUI fallback
 */
interface ErrorBoundaryProps {
  children: ReactNode
  fallback?: ReactNode
}

interface ErrorBoundaryState {
  hasError: boolean
  error?: Error
}

export class ErrorBoundary extends Component<ErrorBoundaryProps, ErrorBoundaryState> {
  public state: ErrorBoundaryState = {
    hasError: false,
  }

  public static getDerivedStateFromError(error: Error): ErrorBoundaryState {
    return { hasError: true, error }
  }

  public render() {
    if (this.state.hasError) {
      return this.props.fallback || <ErrorUI />
    }

    return this.props.children
  }
}

/**
 * Next.js Error Page Component
 * Renders when a workflow-specific error occurs
 */
interface NextErrorProps {
  error: Error & { digest?: string }
  reset: () => void
}

export function NextError({ error, reset }: NextErrorProps) {
  useEffect(() => {
    logger.error('Workflow error:', { error })
  }, [error])

  return <ErrorUI onReset={reset} />
}

/**
 * Next.js Global Error Page Component
 * Renders for application-level errors
 */
export function NextGlobalError({
  error,
  reset,
}: {
  error: Error & { digest?: string }
  reset: () => void
}) {
  useEffect(() => {
    logger.error('Global workspace error:', { error })
  }, [error])

  return (
    <html lang='en'>
      <body>
        <ErrorUI
          title='Application Error'
          message='Something went wrong with the application. Please try again later.'
          onReset={reset}
          fullScreen={true}
        />
      </body>
    </html>
  )
}
