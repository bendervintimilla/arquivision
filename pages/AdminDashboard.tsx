
import React, { useState, useEffect } from 'react';
import { backendApi } from '../services/backendApiService';

const OWNER_ID = 'b30e21bf-2aad-477f-93ef-8f6ec4b459c5';

const TIER_LABELS: Record<number, string> = { 0: 'Draft', 1: 'Standard', 2: 'HD', 3: 'Ultra' };
const TIER_COLORS: Record<number, string> = {
    0: 'text-slate-400', 1: 'text-blue-400', 2: 'text-emerald-400', 3: 'text-purple-400'
};
const MODEL_SHORT: Record<string, string> = {
    'gemini-2.5-flash-image': 'Flash',
    'gemini-3-pro-image-preview': 'Pro',
    'gemini-2.5-flash': 'Flash-text',
};

function formatCost(n: number) {
    if (n === 0) return '$0.00';
    if (n < 0.01) return `$${n.toFixed(5)}`;
    return `$${n.toFixed(4)}`;
}

function StatCard({ label, value, sub, color = 'text-emerald-400' }: any) {
    return (
        <div className="bg-slate-800/60 border border-slate-700/50 rounded-xl p-4 flex flex-col gap-1">
            <span className="text-xs text-slate-400 uppercase tracking-wide">{label}</span>
            <span className={`text-2xl font-bold ${color}`}>{value}</span>
            {sub && <span className="text-xs text-slate-500">{sub}</span>}
        </div>
    );
}

interface AdminDashboardProps {
    userId: string;
}

export const AdminDashboard: React.FC<AdminDashboardProps> = ({ userId }) => {
    const [data, setData] = useState<any>(null);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState<string | null>(null);

    useEffect(() => {
        if (userId !== OWNER_ID) return;
        backendApi.getAdminUsage()
            .then(d => { setData(d); setLoading(false); })
            .catch(e => { setError(e.message); setLoading(false); });
    }, [userId]);

    if (userId !== OWNER_ID) {
        return (
            <div className="flex items-center justify-center h-full text-slate-500">
                🔒 Access restricted
            </div>
        );
    }

    if (loading) {
        return (
            <div className="flex items-center justify-center h-full text-slate-400">
                <div className="w-6 h-6 border-2 border-emerald-500 border-t-transparent rounded-full animate-spin mr-3" />
                Loading usage data...
            </div>
        );
    }

    if (error) {
        return (
            <div className="flex items-center justify-center h-full text-red-400">
                Error: {error}
            </div>
        );
    }

    if (!data) return null;

    const { summary, by_model, daily, recent } = data;

    // Sort daily keys
    const sortedDays = Object.keys(daily).sort().slice(-30);
    const maxDailyCost = Math.max(...sortedDays.map((d: string) => daily[d].cost), 0.001);

    return (
        <div className="h-full overflow-y-auto p-6 space-y-6">
            <div className="flex items-center gap-3">
                <div className="w-8 h-8 rounded-lg bg-emerald-500/20 flex items-center justify-center">
                    <svg xmlns="http://www.w3.org/2000/svg" className="w-4 h-4 text-emerald-400" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 19v-6a2 2 0 00-2-2H5a2 2 0 00-2 2v6a2 2 0 002 2h2a2 2 0 002-2zm0 0V9a2 2 0 012-2h2a2 2 0 012 2v10m-6 0a2 2 0 002 2h2a2 2 0 002-2m0 0V5a2 2 0 012-2h2a2 2 0 012 2v14a2 2 0 01-2 2h-2a2 2 0 01-2-2z" />
                    </svg>
                </div>
                <div>
                    <h1 className="text-lg font-semibold text-white">Usage Dashboard</h1>
                    <p className="text-xs text-slate-400">Internal — ArchiVision AI</p>
                </div>
            </div>

            {/* Summary Cards */}
            <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
                <StatCard
                    label="Total Spend"
                    value={`$${summary.total_cost_usd.toFixed(3)}`}
                    sub="All time"
                    color="text-amber-400"
                />
                <StatCard
                    label="Total Calls"
                    value={summary.total_calls.toLocaleString()}
                    sub={`${summary.successful_calls} successful`}
                    color="text-emerald-400"
                />
                <StatCard
                    label="Avg Cost/Call"
                    value={formatCost(summary.avg_cost_per_call)}
                    sub="Per generation"
                    color="text-blue-400"
                />
                <StatCard
                    label="Total Tokens"
                    value={summary.total_tokens > 1000
                        ? `${(summary.total_tokens / 1000).toFixed(1)}K`
                        : summary.total_tokens}
                    sub="Input + output"
                    color="text-purple-400"
                />
            </div>

            {/* Daily Cost Chart */}
            {sortedDays.length > 0 && (
                <div className="bg-slate-800/60 border border-slate-700/50 rounded-xl p-4">
                    <h2 className="text-sm font-medium text-slate-300 mb-4">Daily Spend (last {sortedDays.length} days)</h2>
                    <div className="flex items-end gap-1 h-28">
                        {sortedDays.map((day) => {
                            const h = Math.max(4, (daily[day].cost / maxDailyCost) * 100);
                            const isToday = day === new Date().toISOString().slice(0, 10);
                            return (
                                <div key={day} className="flex-1 flex flex-col items-center gap-1 group cursor-default" title={`${day}: ${formatCost(daily[day].cost)} | ${daily[day].calls} calls`}>
                                    <div
                                        className={`w-full rounded-sm transition-all ${isToday ? 'bg-amber-500' : 'bg-emerald-600 group-hover:bg-emerald-400'}`}
                                        style={{ height: `${h}%` }}
                                    />
                                    {sortedDays.length <= 7 && (
                                        <span className="text-[9px] text-slate-500">{day.slice(5)}</span>
                                    )}
                                </div>
                            );
                        })}
                    </div>
                </div>
            )}

            {/* By Model */}
            <div className="bg-slate-800/60 border border-slate-700/50 rounded-xl p-4">
                <h2 className="text-sm font-medium text-slate-300 mb-3">By Model</h2>
                <div className="space-y-2">
                    {Object.entries(by_model).map(([model, stats]: [string, any]) => (
                        <div key={model} className="flex items-center justify-between text-sm">
                            <span className="text-slate-300 font-mono text-xs">{MODEL_SHORT[model] || model}</span>
                            <div className="flex items-center gap-4 text-slate-400 text-xs">
                                <span>{stats.calls} calls</span>
                                <span>{stats.tokens.toLocaleString()} tokens</span>
                                <span className="text-amber-400 font-medium">{formatCost(stats.cost)}</span>
                            </div>
                        </div>
                    ))}
                </div>
            </div>

            {/* Recent Calls */}
            <div className="bg-slate-800/60 border border-slate-700/50 rounded-xl p-4">
                <h2 className="text-sm font-medium text-slate-300 mb-3">Recent Calls</h2>
                <div className="overflow-x-auto">
                    <table className="w-full text-xs text-slate-400">
                        <thead>
                            <tr className="border-b border-slate-700/50 text-slate-500 uppercase tracking-wide">
                                <th className="text-left pb-2 pr-3">Time</th>
                                <th className="text-left pb-2 pr-3">Endpoint</th>
                                <th className="text-left pb-2 pr-3">Model</th>
                                <th className="text-left pb-2 pr-3">Tier</th>
                                <th className="text-right pb-2 pr-3">Tokens</th>
                                <th className="text-right pb-2 pr-3">Cost</th>
                                <th className="text-right pb-2">ms</th>
                            </tr>
                        </thead>
                        <tbody>
                            {recent.map((row: any, i: number) => (
                                <tr key={i} className={`border-b border-slate-700/20 ${!row.success ? 'opacity-40' : ''}`}>
                                    <td className="py-1.5 pr-3 font-mono whitespace-nowrap">
                                        {new Date(row.created_at).toLocaleString('en-GB', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' })}
                                    </td>
                                    <td className="pr-3 text-slate-300">{row.endpoint?.replace('/api/', '') || '—'}</td>
                                    <td className="pr-3">{MODEL_SHORT[row.model] || row.model || '—'}</td>
                                    <td className="pr-3">
                                        <span className={`font-medium ${TIER_COLORS[row.quality_tier ?? 2] || 'text-slate-400'}`}>
                                            {TIER_LABELS[row.quality_tier ?? 2] || '—'}
                                        </span>
                                    </td>
                                    <td className="text-right pr-3">{(row.total_tokens || 0).toLocaleString()}</td>
                                    <td className="text-right pr-3 text-amber-400">{formatCost(row.cost)}</td>
                                    <td className="text-right text-slate-500">{row.duration_ms ? `${row.duration_ms}ms` : '—'}</td>
                                </tr>
                            ))}
                        </tbody>
                    </table>
                </div>
            </div>
        </div>
    );
};
