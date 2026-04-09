export function PageLoader() {
  return (
    <div className="flex flex-col items-center justify-center h-full min-h-screen bg-zinc-950">
      <div className="flex flex-col items-center gap-4">
        {/* Brand wordmark */}
        <span className="text-2xl font-bold tracking-tight text-indigo-400 select-none">
          Sahay
        </span>

        {/* Spinner */}
        <div className="relative w-10 h-10">
          <div className="absolute inset-0 rounded-full border-2 border-zinc-800" />
          <div className="absolute inset-0 rounded-full border-2 border-transparent border-t-indigo-500 animate-spin" />
        </div>

        {/* Pulsing dots */}
        <div className="flex items-center gap-1.5 mt-1">
          <span className="w-1.5 h-1.5 rounded-full bg-indigo-500 animate-pulse [animation-delay:-0.3s]" />
          <span className="w-1.5 h-1.5 rounded-full bg-indigo-500 animate-pulse [animation-delay:-0.15s]" />
          <span className="w-1.5 h-1.5 rounded-full bg-indigo-500 animate-pulse" />
        </div>
      </div>
    </div>
  )
}
