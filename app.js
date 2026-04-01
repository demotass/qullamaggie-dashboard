/* ============================================================
   Qullamaggie Scanner — Dashboard JavaScript
   ============================================================ */

const REFRESH_INTERVAL = 30000; // 30 seconds
let refreshTimer = null;

// ── Initialization ──────────────────────────────────────────

document.addEventListener('DOMContentLoaded', () => {
    loadAll();
    startAutoRefresh();
});

function loadAll() {
    loadStats();
    loadPositions();
    loadSignals();
    loadHistory();
    loadEquityCurve();
    loadAnalytics();
    checkScanStatus();
    updateTimestamp();
}

function startAutoRefresh() {
    if (refreshTimer) clearInterval(refreshTimer);
    refreshTimer = setInterval(loadAll, REFRESH_INTERVAL);
}

function updateTimestamp() {
    const el = document.getElementById('last-update');
    if (el) {
        const now = new Date();
        el.textContent = `Actualizado: ${now.toLocaleTimeString('es-ES')}`;
    }
}

// ── API Helpers ─────────────────────────────────────────────

async function api(url) {
    try {
        const res = await fetch(url);
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        return await res.json();
    } catch (err) {
        console.error(`API error (${url}):`, err);
        return null;
    }
}

// ── Stats ───────────────────────────────────────────────────

async function loadStats() {
    const stats = await api('api/stats.json');
    if (!stats) return;

    setText('stat-equity', formatCurrency(stats.total_equity));
    setText('stat-cash', formatCurrency(stats.cash));

    const unrealizedEl = document.getElementById('stat-unrealized');
    if (unrealizedEl) {
        unrealizedEl.textContent = formatCurrency(stats.unrealized_pnl);
        unrealizedEl.className = 'stat-value ' + pnlClass(stats.unrealized_pnl);
    }

    const returnEl = document.getElementById('stat-return');
    if (returnEl) {
        const pct = stats.total_return_pct || 0;
        returnEl.textContent = `${pct >= 0 ? '+' : ''}${pct.toFixed(2)}%`;
        returnEl.className = 'stat-change ' + pnlClass(pct);
    }

    setText('stat-winrate', `${(stats.win_rate || 0).toFixed(0)}%`);
    setText('stat-ravg', `${(stats.avg_r_multiple || 0).toFixed(1)}R`);
    setText('stat-trades', stats.total_trades || 0);
}

// ── Positions ───────────────────────────────────────────────

async function loadPositions() {
    const positions = await api('api/portfolio.json');
    if (!positions) return;

    const count = document.getElementById('positions-count');
    if (count) count.textContent = positions.length;

    const body = document.getElementById('positions-body');
    if (!body) return;

    if (positions.length === 0) {
        body.innerHTML = '<div class="empty-state">No hay posiciones abiertas</div>';
        return;
    }

    body.innerHTML = positions.map(pos => {
        const pnl = pos.pnl_pct || 0;
        const rec = pos.recommendation || 'HOLD';
        const recLabels = {
            'HOLD': 'MANTENER', 'WATCH': 'VIGILAR', 'ADD': 'AÑADIR',
            'SELL_PARTIAL': 'VENTA PARCIAL', 'SELL_ALL': 'VENDER TODO',
            'STOPPED': 'STOP LOSS', 'CLOSED': 'CERRADO'
        };
        const recClass = {
            'HOLD': 'badge-hold', 'WATCH': 'badge-watch', 'ADD': 'badge-hold',
            'SELL_PARTIAL': 'badge-watch', 'SELL_ALL': 'badge-sell', 'STOPPED': 'badge-sell'
        };

        const daysSinceEntry = pos.entry_date ?
            Math.floor((Date.now() - new Date(pos.entry_date).getTime()) / 86400000) : 0;

        const shares = pos.shares || 0;
        const invested = (pos.entry_price || 0) * shares;
        const pnlAbs = pos.pnl_abs || ((pos.last_close || 0) - (pos.entry_price || 0)) * shares;
        const riskPerShare = (pos.entry_price || 0) - (pos.initial_stop || pos.current_stop || 0);
        const riskTotal = riskPerShare * shares;

        return `
            <div class="position-card">
                <div class="pos-header">
                    <div>
                        <span class="pos-symbol">${pos.symbol}</span>
                        <span class="badge ${setupBadgeClass(pos.setup_type)}" style="margin-left:8px">${pos.setup_type}</span>
                    </div>
                    <div style="text-align:right">
                        <span class="pos-pnl ${pnlClass(pnl)}">${pnl >= 0 ? '+' : ''}${pnl.toFixed(2)}%</span>
                        <div style="font-size:12px;font-family:var(--font-mono);color:var(--text-muted)">${formatCurrency(pnlAbs)}</div>
                    </div>
                </div>
                <div class="pos-details" style="grid-template-columns:repeat(6,1fr)">
                    <div class="pos-detail">
                        <div class="pos-detail-label">Acciones</div>
                        <div class="pos-detail-value">${shares}</div>
                    </div>
                    <div class="pos-detail">
                        <div class="pos-detail-label">Entrada</div>
                        <div class="pos-detail-value">$${(pos.entry_price || 0).toFixed(2)}</div>
                    </div>
                    <div class="pos-detail">
                        <div class="pos-detail-label">Actual</div>
                        <div class="pos-detail-value ${pnlClass(pnl)}">$${(pos.last_close || 0).toFixed(2)}</div>
                    </div>
                    <div class="pos-detail">
                        <div class="pos-detail-label">Stop</div>
                        <div class="pos-detail-value" style="color:var(--negative)">$${(pos.current_stop || 0).toFixed(2)}</div>
                    </div>
                    <div class="pos-detail">
                        <div class="pos-detail-label">Invertido</div>
                        <div class="pos-detail-value">${formatCurrency(invested)}</div>
                    </div>
                    <div class="pos-detail">
                        <div class="pos-detail-label">Dias</div>
                        <div class="pos-detail-value">${daysSinceEntry}</div>
                    </div>
                </div>
                <div class="pos-rec">
                    <span class="badge ${recClass[rec] || 'badge-hold'}">${recLabels[rec] || rec}</span>
                    ${pos.partial_sold ? '<span class="badge badge-watch" style="margin-left:6px">PARCIAL VENDIDO</span>' : ''}
                    ${pos.notes ? `<span style="margin-left:8px;color:var(--text-muted);font-size:11px">${pos.notes}</span>` : ''}
                </div>
            </div>
        `;
    }).join('');
}

// ── Signals ─────────────────────────────────────────────────

async function loadSignals() {
    const filter = document.getElementById('signal-filter');
    const setupType = filter ? filter.value.toLowerCase() : '';
    
    let allSignals = await api('api/signals.json');
    if (!allSignals) return;

    // Static site filtering
    if (setupType) {
        allSignals = allSignals.filter(sig => sig.setup_type && sig.setup_type.toLowerCase() === setupType);
    }
    
    // Status sorting: ready first, then near
    allSignals.sort((a, b) => {
        const statusA = a.status || 'near';
        const statusB = b.status || 'near';
        if (statusA === statusB) return (b.score || 0) - (a.score || 0);
        return statusA === 'ready' ? -1 : 1;
    });

    const body = document.getElementById('signals-body');
    if (!body) return;

    if (allSignals.length === 0) {
        body.innerHTML = '<div class="empty-state">Sin señales detectadas hoy</div>';
        return;
    }

    body.innerHTML = allSignals.map(sig => {
        const status = sig.status || 'near';
        const score = (sig.score || 0) * 100;
        const guidance = Array.isArray(sig.guidance) ? sig.guidance : [];
        const guidanceText = guidance.slice(0, 2).join(' · ');

        return `
            <div class="signal-card ${status}">
                <div class="signal-left">
                    <span class="signal-symbol">${sig.symbol}</span>
                    <span class="badge ${setupBadgeClass(sig.setup_type)}">${sig.setup_type}</span>
                    ${status === 'ready' ? '<span class="badge badge-hold">READY</span>' : '<span class="badge badge-watch">NEAR</span>'}
                </div>
                <div class="signal-right">
                    <div class="signal-score" style="color:${score >= 85 ? 'var(--positive)' : score >= 50 ? 'var(--warning)' : 'var(--text-muted)'}">${score.toFixed(0)}%</div>
                    ${guidanceText ? `<div class="signal-guidance">${guidanceText}</div>` : ''}
                </div>
            </div>
        `;
    }).join('');
}

// ── History ─────────────────────────────────────────────────

async function loadHistory() {
    const trades = await api('api/history.json');
    if (!trades) return;

    const count = document.getElementById('history-count');
    if (count) count.textContent = trades.length;

    const tbody = document.getElementById('history-tbody');
    if (!tbody) return;

    if (trades.length === 0) {
        tbody.innerHTML = '<tr><td colspan="11" style="text-align:center;color:var(--text-dim);padding:32px">Sin trades registrados</td></tr>';
        return;
    }

    tbody.innerHTML = trades.map(t => {
        const pnlPct = t.pnl_pct || 0;
        const pnlAbs = t.pnl_abs || 0;
        const rMult = t.r_multiple || 0;
        return `
            <tr>
                <td style="font-weight:600;color:var(--text-primary)">${t.symbol}</td>
                <td><span class="badge ${setupBadgeClass(t.setup_type)}">${t.setup_type}</span></td>
                <td>${t.entry_date || ''}</td>
                <td>${t.exit_date || ''}</td>
                <td>$${(t.entry_price || 0).toFixed(2)}</td>
                <td>$${(t.exit_price || 0).toFixed(2)}</td>
                <td class="${pnlClass(pnlPct)}">${pnlPct >= 0 ? '+' : ''}${pnlPct.toFixed(2)}%</td>
                <td class="${pnlClass(pnlAbs)}">${formatCurrency(pnlAbs)}</td>
                <td class="${pnlClass(rMult)}">${rMult >= 0 ? '+' : ''}${rMult.toFixed(1)}R</td>
                <td>${t.hold_days || 0}</td>
                <td style="color:var(--text-muted);font-family:var(--font-sans);font-size:11px">${t.exit_reason || ''}</td>
            </tr>
        `;
    }).join('');
}

// ── Scan Trigger ────────────────────────────────────────────

async function triggerScan() {
    showToast('El escaneo ocurre automáticamente en GitHub Actions (Lun-Vie 22:30 UTC).', 'info');
}

async function checkScanStatus() {
    const data = await api('api/scan_status.json');
    if (!data) return;

    const dot = document.querySelector('.status-dot');
    const text = document.querySelector('.status-text');
    const btn = document.getElementById('btn-scan');

    if (data.running) {
        if (dot) dot.classList.add('running');
        if (text) text.textContent = 'Escaneando...';
        if (btn) {
            btn.disabled = true;
            btn.innerHTML = '<span class="spinner"></span> Escaneando...';
        }
    } else {
        if (dot) dot.classList.remove('running');
        if (text) text.textContent = 'En espera';
        if (btn) {
            btn.disabled = false;
            btn.innerHTML = '<span class="btn-icon">⟳</span> Escanear Ahora';
        }
    }
}

function pollScanStatus() {
    // Disabled in static mode
}

// ── Utilities ───────────────────────────────────────────────

function setText(id, value) {
    const el = document.getElementById(id);
    if (el) el.textContent = value;
}

function formatCurrency(value) {
    if (value == null) return '$0.00';
    const sign = value < 0 ? '-' : '';
    const abs = Math.abs(value);
    return `${sign}$${abs.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

function pnlClass(value) {
    if (value > 0) return 'positive';
    if (value < 0) return 'negative';
    return '';
}

function setupBadgeClass(setup) {
    const map = {
        'breakout': 'badge-breakout',
        'ep': 'badge-ep',
        'parabolic': 'badge-parabolic',
        'vcp': 'badge-breakout',
    };
    return map[setup] || 'badge-count';
}

function showToast(message, type = 'info') {
    const container = document.getElementById('toast-container');
    if (!container) return;

    const toast = document.createElement('div');
    toast.className = `toast ${type}`;
    toast.textContent = message;
    container.appendChild(toast);

    setTimeout(() => {
        toast.style.opacity = '0';
        toast.style.transform = 'translateY(16px)';
        toast.style.transition = 'all 0.3s ease';
        setTimeout(() => toast.remove(), 300);
    }, 4000);
}

// ── Equity Curve Chart ─────────────────────────────────────

let equityChart = null;

async function loadEquityCurve() {
    const data = await api('api/equity.json');
    const canvas = document.getElementById('equity-chart');
    const emptyMsg = document.getElementById('equity-empty');
    if (!canvas) return;

    if (!data || data.length === 0) {
        canvas.style.display = 'none';
        if (emptyMsg) emptyMsg.style.display = 'block';
        return;
    }

    canvas.style.display = 'block';
    if (emptyMsg) emptyMsg.style.display = 'none';

    const labels = data.map(d => d.snap_date);
    const equityValues = data.map(d => d.total_equity);
    const initialCapital = equityValues.length > 0 ? equityValues[0] : 10000;

    // Determine gradient colors based on last vs first
    const lastVal = equityValues[equityValues.length - 1];
    const isPositive = lastVal >= initialCapital;

    if (equityChart) {
        equityChart.destroy();
    }

    const ctx = canvas.getContext('2d');
    const gradient = ctx.createLinearGradient(0, 0, 0, canvas.height * 2);
    if (isPositive) {
        gradient.addColorStop(0, 'rgba(63, 185, 80, 0.3)');
        gradient.addColorStop(1, 'rgba(63, 185, 80, 0.0)');
    } else {
        gradient.addColorStop(0, 'rgba(248, 81, 73, 0.3)');
        gradient.addColorStop(1, 'rgba(248, 81, 73, 0.0)');
    }

    equityChart = new Chart(ctx, {
        type: 'line',
        data: {
            labels: labels,
            datasets: [{
                label: 'Equity',
                data: equityValues,
                borderColor: isPositive ? '#3fb950' : '#f85149',
                backgroundColor: gradient,
                borderWidth: 2,
                fill: true,
                tension: 0.3,
                pointRadius: data.length > 30 ? 0 : 3,
                pointHoverRadius: 5,
            }]
        },
        options: {
            responsive: true,
            maintainAspectRatio: false,
            interaction: {
                intersect: false,
                mode: 'index',
            },
            plugins: {
                legend: { display: false },
                tooltip: {
                    callbacks: {
                        label: function(ctx) {
                            const val = ctx.raw;
                            const ret = ((val / initialCapital - 1) * 100).toFixed(2);
                            return `$${val.toLocaleString('en-US', {minimumFractionDigits: 2})} (${ret >= 0 ? '+' : ''}${ret}%)`;
                        }
                    }
                }
            },
            scales: {
                x: {
                    grid: { color: 'rgba(48, 54, 61, 0.5)' },
                    ticks: {
                        color: '#8b949e',
                        maxTicksLimit: 10,
                        font: { size: 10 },
                    }
                },
                y: {
                    grid: { color: 'rgba(48, 54, 61, 0.5)' },
                    ticks: {
                        color: '#8b949e',
                        callback: function(value) {
                            return '$' + value.toLocaleString();
                        },
                        font: { size: 10 },
                    }
                }
            }
        }
    });
}

// ── Analytics Forward Returns Chart ──────────────────────────

let analyticsChart = null;

async function loadAnalytics() {
    const data = await api('api/analytics.json');
    const canvas = document.getElementById('analytics-chart');
    const emptyMsg = document.getElementById('analytics-empty');
    if (!canvas) return;

    if (!data || data.length === 0) {
        canvas.style.display = 'none';
        if (emptyMsg) emptyMsg.style.display = 'block';
        return;
    }

    canvas.style.display = 'block';
    if (emptyMsg) emptyMsg.style.display = 'none';

    setText('stat-signals-evaluated', data.length);

    let mfeSum = 0;
    let maeSum = 0;
    let hits = 0;

    const setupStats = {};

    data.forEach(d => {
        mfeSum += d.mfe_pct;
        maeSum += d.mae_pct;
        const isHit = d.mfe_pct >= 0.10; // Hit if it goes +10% 
        if (isHit) hits++;

        if (!setupStats[d.setup_type]) {
            setupStats[d.setup_type] = { count: 0, hits: 0 };
        }
        setupStats[d.setup_type].count++;
        if (isHit) setupStats[d.setup_type].hits++;
    });

    const avgMfe = (mfeSum / data.length) * 100;
    const avgMae = (maeSum / data.length) * 100;
    const hitRate = (hits / data.length) * 100;

    setText('stat-mfe-avg', `+${avgMfe.toFixed(2)}%`);
    setText('stat-mae-avg', `${avgMae.toFixed(2)}%`);
    setText('stat-hit-rate', `${hitRate.toFixed(1)}%`);

    const labels = Object.keys(setupStats);
    const chartData = labels.map(l => (setupStats[l].hits / setupStats[l].count) * 100);

    if (analyticsChart) {
        analyticsChart.destroy();
    }

    const ctx = canvas.getContext('2d');
    analyticsChart = new Chart(ctx, {
        type: 'bar',
        data: {
            labels: labels.map(l => l.toUpperCase()),
            datasets: [{
                label: 'Hit Rate (>10% MFE)',
                data: chartData,
                backgroundColor: 'rgba(63, 185, 80, 0.8)',
                borderRadius: 4,
            }]
        },
        options: {
            responsive: true,
            maintainAspectRatio: false,
            plugins: {
                legend: { display: false },
                tooltip: {
                    callbacks: {
                        label: function(ctx) {
                            return ctx.raw.toFixed(1) + '%';
                        }
                    }
                }
            },
            scales: {
                y: {
                    beginAtZero: true,
                    max: 100,
                    grid: { color: 'rgba(48, 54, 61, 0.5)' },
                    ticks: {
                        color: '#8b949e',
                        font: { size: 10 },
                        callback: function(value) { return value + '%'; }
                    }
                },
                x: {
                    grid: { display: false },
                    ticks: { color: '#8b949e', font: { size: 11, weight: 'bold' } }
                }
            }
        }
    });
}
