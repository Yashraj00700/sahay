import { Link } from 'react-router-dom'

export default function NotFoundPage() {
  return (
    <div className="flex flex-col items-center justify-center min-h-screen bg-gray-50">
      <h1 className="text-6xl font-bold text-violet-600">404</h1>
      <p className="text-xl text-gray-600 mt-4">Page not found</p>
      <Link to="/dashboard" className="mt-6 px-4 py-2 bg-violet-600 text-white rounded-lg hover:bg-violet-700">
        Go to Dashboard
      </Link>
    </div>
  )
}
