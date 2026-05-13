/// <reference types="vite/client" />

// Strongly-typed Vite env vars exposed to the browser bundle.
// Anything declared here is available as `import.meta.env.VITE_*`.
interface ImportMetaEnv {
  readonly VITE_API_URL: string;
  readonly VITE_SENTRY_DSN: string;
  readonly VITE_PUSHER_KEY: string;
  readonly VITE_PUSHER_CLUSTER: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
