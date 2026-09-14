/// <reference types="vite/client" />
interface ImportMetaEnv {
  readonly VITE_SUPABASE_URL: string
  readonly VITE_SUPABASE_ANON_KEY: string
  readonly VITE_DATA_SOURCE?: 'demo' | 'supabase'
  /** Optional Sentry DSN (spec §5.9); error tracking is disabled entirely when unset. */
  readonly VITE_SENTRY_DSN?: string
}
interface ImportMeta {
  readonly env: ImportMetaEnv
}
declare module '*.vue' {
  import type { DefineComponent } from 'vue'
  const component: DefineComponent<object, object, unknown>
  export default component
}
