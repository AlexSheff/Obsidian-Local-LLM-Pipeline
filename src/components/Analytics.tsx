import React, { useEffect, useState } from 'react';
import { BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer, PieChart, Pie, Cell } from 'recharts';
import { Activity, BookOpen, AlertCircle, Loader2 } from 'lucide-react';
import axios from 'axios';

const COLORS = ['#171717', '#525252', '#737373', '#a3a3a3', '#d4d4d4', '#e5e5e5'];

export default function Analytics() {
  const [registry, setRegistry] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [digestLoading, setDigestLoading] = useState(false);

  useEffect(() => {
    fetchRegistry();
  }, []);

  const fetchRegistry = async () => {
    try {
      const res = await axios.get('/api/registry');
      setRegistry(res.data);
    } catch (e) {
      console.error(e);
    } finally {
      setLoading(false);
    }
  };

  const handleGenerateDigest = async () => {
    setDigestLoading(true);
    try {
      const res = await axios.post('/api/generate-digest');
      alert('Daily Digest generated successfully in 04_Journal/Daily/');
    } catch (err: any) {
      alert(err.response?.data?.error || 'Failed to generate digest');
    } finally {
      setDigestLoading(false);
    }
  };

  // Prepare data for charts
  const typeCount = registry.reduce((acc, curr) => {
    acc[curr.type] = (acc[curr.type] || 0) + 1;
    return acc;
  }, {} as Record<string, number>);

  const pieData = Object.keys(typeCount).map(key => ({
    name: key,
    value: typeCount[key]
  })).sort((a, b) => b.value - a.value);

  // Group by date (last 7 days)
  const last7Days = [...Array(7)].map((_, i) => {
    const d = new Date();
    d.setDate(d.getDate() - i);
    return d.toLocaleDateString('sv-SE');
  }).reverse();

  const activityData = last7Days.map(dateStr => {
    const count = registry.filter(r => r.processed_at && r.processed_at.startsWith(dateStr)).length;
    return { name: dateStr.slice(5), count }; // MM-DD
  });

  if (loading) return <div className="p-8 text-center text-neutral-500">Loading analytics...</div>;

  return (
    <div className="space-y-6">
      <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
        
        {/* Activity Chart */}
        <section className="bg-white rounded-2xl border border-neutral-200 p-6">
          <div className="flex items-center gap-2 mb-6">
            <Activity className="w-5 h-5 text-neutral-400" />
            <h2 className="text-sm font-semibold text-neutral-900">7-Day Activity</h2>
          </div>
          <div className="h-64">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={activityData}>
                <XAxis dataKey="name" fontSize={12} tickLine={false} axisLine={false} />
                <Tooltip cursor={{ fill: '#f5f5f5' }} contentStyle={{ borderRadius: '8px', border: 'none', boxShadow: '0 4px 6px -1px rgb(0 0 0 / 0.1)' }} />
                <Bar dataKey="count" fill="#171717" radius={[4, 4, 0, 0]} />
              </BarChart>
            </ResponsiveContainer>
          </div>
        </section>

        {/* Type Distribution */}
        <section className="bg-white rounded-2xl border border-neutral-200 p-6">
          <div className="flex items-center gap-2 mb-6">
            <BookOpen className="w-5 h-5 text-neutral-400" />
            <h2 className="text-sm font-semibold text-neutral-900">Content Distribution</h2>
          </div>
          <div className="h-64">
            {pieData.length > 0 ? (
              <ResponsiveContainer width="100%" height="100%">
                <PieChart>
                  <Pie
                    data={pieData}
                    cx="50%"
                    cy="50%"
                    innerRadius={60}
                    outerRadius={80}
                    paddingAngle={5}
                    dataKey="value"
                  >
                    {pieData.map((entry, index) => (
                      <Cell key={`cell-${index}`} fill={COLORS[index % COLORS.length]} />
                    ))}
                  </Pie>
                  <Tooltip contentStyle={{ borderRadius: '8px', border: 'none', boxShadow: '0 4px 6px -1px rgb(0 0 0 / 0.1)' }} />
                </PieChart>
              </ResponsiveContainer>
            ) : (
              <div className="h-full flex items-center justify-center text-neutral-400 text-sm">No data available</div>
            )}
          </div>
          <div className="mt-4 flex flex-wrap gap-2 justify-center">
             {pieData.map((entry, index) => (
                <div key={entry.name} className="flex items-center gap-1.5 text-xs text-neutral-600">
                  <span className="w-2 h-2 rounded-full" style={{ backgroundColor: COLORS[index % COLORS.length] }}></span>
                  {entry.name} ({entry.value})
                </div>
             ))}
          </div>
        </section>

      </div>

      <section className="bg-white rounded-2xl border border-neutral-200 p-6 flex items-center justify-between">
        <div>
          <h2 className="text-sm font-semibold text-neutral-900">Daily Digest Generator</h2>
          <p className="text-xs text-neutral-500 mt-1">Uses LLM to summarize all notes processed today into a single Journal entry.</p>
        </div>
        <button 
          onClick={handleGenerateDigest}
          disabled={digestLoading}
          className="bg-neutral-900 text-white px-4 py-2 rounded-lg text-sm font-medium hover:bg-neutral-800 transition-colors flex items-center gap-2 disabled:opacity-50"
        >
          {digestLoading && <Loader2 className="w-4 h-4 animate-spin" />}
          Generate Digest
        </button>
      </section>
    </div>
  );
}
