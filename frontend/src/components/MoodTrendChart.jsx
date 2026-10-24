import {
  ResponsiveContainer,
  LineChart,
  Line,
  XAxis,
  YAxis,
  Tooltip,
  CartesianGrid,
} from 'recharts'

// Custom Tooltip for Recharts Line Chart
function CustomChartTooltip({ active, payload }) {
  if (!active || !payload || !payload.length) return null
  const item = payload[0].payload
  const mood = item.parsedMood

  return (
    <div className="bg-white/95 backdrop-blur-md p-3.5 rounded-2xl shadow-xl border-2 border-purple-200 text-xs text-slate-800 space-y-1.5 max-w-xs break-words">
      <div className="flex items-center space-x-2">
        <span className="text-2xl select-none">{mood.emoji}</span>
        <div>
          <div className="font-extrabold text-sm text-slate-900">{mood.label}</div>
          <div className="text-[11px] text-slate-500">{item.fullTime}</div>
        </div>
      </div>
      <div className="pt-1 border-t border-slate-100 text-slate-700 italic break-words">
        "{item.status}"
      </div>
    </div>
  )
}

// Custom Dot for Recharts
function CustomChartDot(props) {
  const { cx, cy, payload } = props
  if (!cx || !cy) return null
  const mood = payload.parsedMood
  return (
    <g transform={`translate(${cx},${cy})`}>
      <circle r="14" fill="#ffffff" stroke={mood.color} strokeWidth="2.5" />
      <text
        x="0"
        y="4"
        textAnchor="middle"
        fontSize="12"
        className="select-none"
        style={{ cursor: 'pointer' }}
      >
        {mood.emoji}
      </text>
    </g>
  )
}

export default function MoodTrendChart({ chronologicalMoods = [] }) {
  return (
    <div data-testid="mood-chart-view" className="space-y-3 min-w-0 w-full">
      <div className="text-xs font-bold uppercase tracking-wider text-slate-500">
        Mood Trajectory Graph (1: Low 😔 to 5: Energized 😄)
      </div>

      <div className="h-64 w-full min-w-0 bg-slate-50/70 p-3 rounded-2xl border border-slate-200 overflow-hidden">
        <ResponsiveContainer width="100%" height="100%" minWidth={0} debounce={50}>
          <LineChart
            data={chronologicalMoods}
            margin={{ top: 15, right: 25, left: -10, bottom: 5 }}
          >
            <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" />
            <XAxis
              dataKey="shortTime"
              tick={{ fontSize: 11, fill: '#64748b' }}
              tickLine={false}
              padding={{ left: 24, right: 24 }}
            />
            <YAxis
              domain={[1, 5]}
              ticks={[1, 2, 3, 4, 5]}
              tick={{ fontSize: 11, fill: '#64748b' }}
              tickLine={false}
            />
            <Tooltip content={<CustomChartTooltip />} />
            <Line
              type="monotone"
              dataKey="score"
              stroke="#8b5cf6"
              strokeWidth={3}
              dot={<CustomChartDot />}
              activeDot={{ r: 16, stroke: '#6d28d9', strokeWidth: 3 }}
            />
          </LineChart>
        </ResponsiveContainer>
      </div>
    </div>
  )
}
