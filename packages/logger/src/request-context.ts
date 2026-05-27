export interface RequestContext {
  requestId: string
  method?: string
  path?: string
}

/**
 * AsyncLocalStorage is only available in Node.js. In Edge/browser contexts
 * we fall back to a no-op implementation so the logger import doesn't break.
 */
interface Storage<T> {
  getStore(): T | undefined
  run<R>(store: T, fn: () => R): R
}

let storage: Storage<RequestContext>

type AsyncLocalStorageConstructor = new <T>() => Storage<T>

function createNoopStorage(): Storage<RequestContext> {
  return {
    getStore: () => undefined,
    run: <R>(_store: RequestContext, fn: () => R) => fn(),
  }
}

if (typeof globalThis.process !== 'undefined' && globalThis.process.versions?.node) {
  try {
    const loadNodeModule = Function('specifier', 'return require(specifier)') as (
      specifier: string
    ) => { AsyncLocalStorage: AsyncLocalStorageConstructor }
    const { AsyncLocalStorage } = loadNodeModule('node:async_hooks')
    storage = new AsyncLocalStorage<RequestContext>()
  } catch {
    storage = createNoopStorage()
  }
} else {
  storage = createNoopStorage()
}

/**
 * Runs a callback within a request context. All loggers called inside
 * the callback (and any async functions it awaits) will automatically
 * include the request context metadata in their output.
 */
export function runWithRequestContext<T>(context: RequestContext, fn: () => T): T {
  return storage.run(context, fn)
}

/**
 * Returns the current request context, or undefined if called outside
 * of a `runWithRequestContext` scope.
 */
export function getRequestContext(): RequestContext | undefined {
  return storage.getStore()
}
