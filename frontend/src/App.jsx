import { useState } from 'react'

export default function App() {
  const [activeTab, setActiveTab] = useState('overview')

  return (
    <div className="min-h-screen bg-slate-50 text-slate-900 font-sans">
      <header className="bg-white border-b border-slate-200 px-6 py-4 shadow-sm">
        <div className="max-w-6xl mx-auto flex items-center justify-between">
          <div className="flex items-center space-x-3">
            <div className="w-10 h-10 rounded-full bg-emerald-600 flex items-center justify-center text-white font-bold text-lg shadow-sm">
              CC
            </div>
            <div>
              <h1 className="text-xl font-bold text-slate-900 leading-tight">CareCircle</h1>
              <p className="text-xs text-slate-500">Elderly Care & Family Check-In System</p>
            </div>
          </div>
          <span className="inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium bg-emerald-100 text-emerald-800">
            System Online
          </span>
        </div>
      </header>

      <main className="max-w-6xl mx-auto px-6 py-8">
        <div className="mb-8">
          <h2 className="text-2xl font-semibold text-slate-800">Family Dashboard Preview</h2>
          <p className="text-slate-600 mt-1">
            CareCircle frontend powered by React + Vite + Tailwind CSS.
          </p>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
          <div className="bg-white p-6 rounded-xl border border-slate-200 shadow-xs">
            <div className="flex items-center justify-between pb-3 border-b border-slate-100">
              <h3 className="font-semibold text-slate-800">Senior Profile</h3>
              <span className="text-xs font-semibold px-2 py-0.5 rounded bg-blue-100 text-blue-700">SENIOR</span>
            </div>
            <div className="mt-4 space-y-2 text-sm text-slate-600">
              <p><span className="font-medium text-slate-700">Name:</span> Eleanor Vance</p>
              <p><span className="font-medium text-slate-700">Phone:</span> +1-555-0143</p>
              <p><span className="font-medium text-slate-700">Group ID:</span> fam-grp-001</p>
            </div>
          </div>

          <div className="bg-white p-6 rounded-xl border border-slate-200 shadow-xs">
            <div className="flex items-center justify-between pb-3 border-b border-slate-100">
              <h3 className="font-semibold text-slate-800">Latest Check-In</h3>
              <span className="text-xs font-semibold px-2 py-0.5 rounded bg-emerald-100 text-emerald-700">COMPLETED</span>
            </div>
            <div className="mt-4 space-y-2 text-sm text-slate-600">
              <p><span className="font-medium text-slate-700">Type:</span> PILLS</p>
              <p><span className="font-medium text-slate-700">Status:</span> Morning Medication Taken</p>
              <p><span className="font-medium text-slate-700">Logged:</span> Today, 08:30 AM</p>
            </div>
          </div>

          <div className="bg-white p-6 rounded-xl border border-slate-200 shadow-xs">
            <div className="flex items-center justify-between pb-3 border-b border-slate-100">
              <h3 className="font-semibold text-slate-800">Alert Center</h3>
              <span className="text-xs font-semibold px-2 py-0.5 rounded bg-amber-100 text-amber-700">ACTIVE</span>
            </div>
            <div className="mt-4 space-y-2 text-sm text-slate-600">
              <p><span className="font-medium text-slate-700">Type:</span> NO_CHECKIN</p>
              <p><span className="font-medium text-slate-700">Status:</span> ACTIVE</p>
              <p className="text-xs text-slate-400 mt-2">Family members notified automatically.</p>
            </div>
          </div>
        </div>
      </main>
    </div>
  )
}
