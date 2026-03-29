export default function MatchesLoading() {
  return (
    <div className="min-h-screen pt-24 pb-12 px-6">
      <div className="max-w-7xl mx-auto">
        {/* Header Skeleton */}
        <div className="mb-8">
          <div className="h-10 w-64 bg-gray-800 rounded-lg animate-pulse mb-2" />
          <div className="h-5 w-48 bg-gray-800/50 rounded animate-pulse" />
        </div>

        {/* Grid Skeleton */}
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
          {[...Array(6)].map((_, i) => (
            <div key={i} className="card p-6">
              <div className="flex items-center gap-4 mb-4">
                <div className="w-16 h-16 bg-gray-700 rounded-lg animate-pulse" />
                <div>
                  <div className="h-6 w-32 bg-gray-800 rounded animate-pulse mb-2" />
                  <div className="h-4 w-24 bg-gray-800/50 rounded animate-pulse" />
                </div>
              </div>
              <div className="space-y-2">
                <div className="h-4 w-full bg-gray-800/30 rounded animate-pulse" />
                <div className="h-4 w-3/4 bg-gray-800/30 rounded animate-pulse" />
              </div>
            </div>
          ))}
        </div>

        {/* Loading indicator */}
        <div className="fixed bottom-6 right-6 flex items-center gap-3 bg-gray-900/90 backdrop-blur px-4 py-3 rounded-lg border border-[#ffffff]/30">
          <div className="w-5 h-5 border-2 border-[#ffffff] border-t-transparent rounded-full animate-spin" />
          <span className="text-gray-300 text-sm">Loading matches...</span>
        </div>
      </div>
    </div>
  )
}
