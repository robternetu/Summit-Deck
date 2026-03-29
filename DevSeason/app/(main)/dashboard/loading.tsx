export default function DashboardLoading() {
  return (
    <div className="min-h-screen pt-24 pb-12 px-6">
      <div className="max-w-7xl mx-auto">
        {/* Header Skeleton */}
        <div className="mb-8">
          <div className="h-10 w-80 bg-gray-800 rounded-lg animate-pulse mb-2" />
          <div className="h-5 w-60 bg-gray-800/50 rounded animate-pulse" />
        </div>

        {/* Stats Grid Skeleton */}
        <div className="grid grid-cols-1 md:grid-cols-4 gap-4 mb-8">
          {[...Array(4)].map((_, i) => (
            <div key={i} className="card p-6">
              <div className="h-4 w-24 bg-gray-800 rounded animate-pulse mb-3" />
              <div className="h-10 w-20 bg-gray-700 rounded animate-pulse" />
            </div>
          ))}
        </div>

        {/* Two Column Skeleton */}
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6 mb-8">
          <div className="card p-6">
            <div className="h-6 w-40 bg-gray-800 rounded animate-pulse mb-6" />
            <div className="space-y-3">
              {[...Array(5)].map((_, i) => (
                <div key={i} className="h-12 bg-black/30 rounded-lg animate-pulse" />
              ))}
            </div>
          </div>
          <div className="card p-6">
            <div className="h-6 w-40 bg-gray-800 rounded animate-pulse mb-6" />
            <div className="space-y-6">
              <div>
                <div className="h-4 w-20 bg-gray-800 rounded animate-pulse mb-2" />
                <div className="h-3 w-full bg-gray-700 rounded animate-pulse" />
              </div>
              <div>
                <div className="h-4 w-20 bg-gray-800 rounded animate-pulse mb-2" />
                <div className="h-3 w-full bg-gray-700 rounded animate-pulse" />
              </div>
            </div>
          </div>
        </div>

        {/* Table Skeleton */}
        <div className="card">
          <div className="px-6 py-4 border-b border-gray-800">
            <div className="h-6 w-36 bg-gray-800 rounded animate-pulse" />
          </div>
          <div className="p-6 space-y-4">
            {[...Array(5)].map((_, i) => (
              <div key={i} className="h-14 bg-black/30 rounded-lg animate-pulse" />
            ))}
          </div>
        </div>

        {/* Loading indicator */}
        <div className="fixed bottom-6 right-6 flex items-center gap-3 bg-gray-900/90 backdrop-blur px-4 py-3 rounded-lg border border-[#ffffff]/30">
          <div className="w-5 h-5 border-2 border-[#ffffff] border-t-transparent rounded-full animate-spin" />
          <span className="text-gray-300 text-sm">Loading dashboard data...</span>
        </div>
      </div>
    </div>
  )
}
