/* ============================================================
   Qullamaggie Scanner — Dashboard JavaScript
   Supports both LOCAL (Flask) and STATIC (GitHub Pages) modes.
   ============================================================ */

const REFRESH_INTERVAL = 30000;
let refreshTimer = null;
let IS_LOCAL = window.IS_LOCAL = false;
let _sellPositionId = null;
let _stopPositionId = null;
let _stopPositionShares = 0;
let _stopPositionEntry = 0;
let _equityEur = 0;
let _fxRate = 1.0;

// ── Initialization ──────────────────────────────────────────

document.addEventListener('DOMContentLoaded', async () => {
    await detectMode();
    loadAll();
    startAutoRefresh();
});

async function detectMode() {
    const isLocal = location.hostname === 'localhost' 
        || location.hostname === '127.0.0.1' 
        || location.hostname.startsWith('192.168.')
        || location.hostname.startsWith('10.')
        || location.hostname.startsWith('172.');
    IS_LOCAL = isLocal;
    
    if (IS_LOCAL) {
        // Hide PIN overlay immediately on local network
        const overlay = document.getElementById('auth-overlay');
        if (overlay) overlay.style.display = 'none';
        // Show interactive buttons
        const btnCapital = document.getElementById('btn-capital');
        if (btnCapital) btnCapital.style.display = '';
    }
}

function loadAll() {
    if (IS_LOCAL) loadPendingActions();
    loadStats();
    loadPositions();
    loadSignals();
    loadHistory();
    loadEquityCurve();
    loadAnalytics();
    loadWatchlist();
    loadNotifications();
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

async function apiGet(endpoint) {
    const url = IS_LOCAL ? `/api/${endpoint}` : `api/${endpoint}.json`;
    try {
        const res = await fetch(url);
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        return await res.json();
    } catch (err) {
        console.error(`API error (${url}):`, err);
        return null;
    }
}

async function apiPost(endpoint, data) {
    try {
        const res = await fetch(`/api/${endpoint}`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(data),
        });
        return await res.json();
    } catch (err) {
        console.error(`POST error:`, err);
        return null;
    }
}

async function apiDelete(endpoint) {
    try {
        const res = await fetch(`/api/${endpoint}`, { method: 'DELETE' });
        return await res.json();
    } catch (err) {
        console.error(`DELETE error:`, err);
        return null;
    }
}

// ── Stats ───────────────────────────────────────────────────

async function loadStats() {
    const stats = await apiGet('stats');
    if (!stats) return;

    // Store globally for risk calculations in position cards and stop modal
    _equityEur = stats.total_equity || 0;
    _fxRate = stats.fx_rate || 1.0;

    setText('stat-equity', formatEUR(stats.total_equity));
    setText('stat-cash', formatEUR(stats.cash));

    const unrealizedEl = document.getElementById('stat-unrealized');
    if (unrealizedEl) {
        unrealizedEl.textContent = formatCurrency(stats.unrealized_pnl) + " (USD)";
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

    // Risk summary
    const riskEl = document.getElementById('stat-risk');
    if (riskEl) {
        const riskPct = stats.risk_pct || 0;
        riskEl.textContent = `$${(stats.total_risk_usd || 0).toFixed(0)} (${riskPct.toFixed(1)}%)`;
        riskEl.className = 'stat-value ' + (riskPct > 5 ? 'negative' : riskPct > 3 ? 'warning' : 'positive');
    }
}

// ── Pending Actions (Copilot) ───────────────────────────────

async function loadPendingActions() {
    const actions = await apiGet('pending');
    const panel = document.getElementById('pending-panel');
    const countEl = document.getElementById('pending-count');
    const body = document.getElementById('pending-body');
    
    if (!panel || !body) return;

    if (!actions || actions.length === 0) {
        panel.style.display = 'none';
        if (countEl) countEl.textContent = '0';
        return;
    }

    panel.style.display = 'block';
    if (countEl) countEl.textContent = actions.length;

    body.innerHTML = actions.map(act => {
        let actionBadge = '';
        let colorClass = '';
        
        switch(act.action_type) {
            case 'BUY':
                actionBadge = 'COMPRAR'; colorClass = 'positive'; break;
            case 'SELL_ALL':
            case 'STOPPED':
                actionBadge = 'VENDER TODO'; colorClass = 'negative'; break;
            case 'SELL_PARTIAL':
                actionBadge = 'VENTA PARCIAL'; colorClass = 'warning'; break;
            case 'UPDATE_STOP':
                actionBadge = 'NUEVO STOP'; colorClass = 'accent-blue'; break;
            default:
                actionBadge = act.action_type;
        }

        const details = act.action_type === 'BUY' 
            ? `${act.shares} accs @ $${act.price.toFixed(2)} (Stop: $${act.stop_price.toFixed(2)})`
            : `${act.shares > 0 ? act.shares + ' accs @ ' : ''}$${act.price.toFixed(2)}`;

        return `
            <div style="background:var(--bg-card-hover); padding:12px 16px; border-radius:var(--radius-sm); border-left:3px solid var(--${colorClass}); display:flex; justify-content:space-between; align-items:center;">
                <div>
                    <div style="margin-bottom:6px;">
                        <span style="font-weight:bold; font-size:16px;">${act.symbol}</span>
                        <span class="badge" style="background:var(--${colorClass}-bg); color:var(--${colorClass}); margin-left:8px;">${actionBadge}</span>
                    </div>
                    <div style="font-size:13px; color:var(--text-secondary); margin-bottom:4px;">${act.reason}</div>
                    <div style="font-family:var(--font-mono); font-size:12px; color:var(--text-muted);">${details}</div>
                </div>
                <div style="display:flex; gap:8px;">
                    <button class="btn-action" style="border-color:var(--positive); color:var(--positive);" onclick="approvePendingAction(${act.id}, '${act.symbol}')">✅ Aprobar</button>
                    <button class="btn-action" style="border-color:var(--negative); color:var(--negative);" onclick="rejectPendingAction(${act.id}, '${act.symbol}')">❌ Rechazar</button>
                </div>
            </div>
        `;
    }).join('');
}

async function approvePendingAction(id, symbol) {
    // Fetch the pending action details to check if it has valid sizing
    const actions = await apiGet('pending');
    const action = actions ? actions.find(a => a.id === id) : null;

    if (action && action.action_type === 'BUY' && (action.shares <= 0 || action.price <= 0)) {
        // Missing sizing — fetch it and show modal, then approve after confirm
        showToast('Calculando sizing...', 'info');
        const sizing = await apiGet(`sizing/${symbol}?setup_type=${action.setup_type || 'breakout'}&score=0.8`);
        if (!sizing || sizing.error) {
            showToast(sizing?.error || 'Error calculando sizing', 'error');
            return;
        }
        // Reject the old incomplete action and create a proper one via modal
        await apiPost(`pending/${id}/reject`, {});
        showSizingModal(symbol, action.setup_type || 'breakout', sizing);
        return;
    }

    // Action has valid data — show review modal for BUY actions
    if (action && action.action_type === 'BUY' && action.shares > 0 && action.price > 0) {
        const fxRate = action.fx_rate || 1.0;
        showSizingModal(symbol, action.setup_type || 'breakout', {
            shares: action.shares,
            entry_price: action.price,
            stop_price: action.stop_price,
            fx_rate: fxRate,
            cost_usd: action.shares * action.price,
            cost_eur: (action.shares * action.price) / fxRate,
            risk_amount_usd: action.shares * (action.price - action.stop_price),
        });
        // Override the confirm button to approve instead of creating new pending
        document.getElementById('sizing-confirm-btn').onclick = async () => {
            const shares = parseInt(document.getElementById('sizing-shares').value) || 0;
            const stopFromInput = parseFloat(document.getElementById('sizing-stop').value) || action.stop_price;
            if (shares !== action.shares || true) {
                // User may have adjusted shares/stop — reject old, create new with correct values
                await apiPost(`pending/${id}/reject`, {});
                const result = await apiPost('pending', {
                    symbol, action_type: 'BUY', setup_type: action.setup_type,
                    reason: action.reason || `Compra manual (${(action.setup_type || '').toUpperCase()})`,
                    shares: shares, price: action.price, stop_price: stopFromInput,
                });
                if (result && result.id) {
                    const approveRes = await apiPost(`pending/${result.id}/approve`, {});
                    closeModal('sizing-modal');
                    if (approveRes && approveRes.status === 'approved') {
                        showToast(`Compra aprobada: ${symbol} x${shares}`, 'success');
                    } else {
                        showToast(approveRes?.error || `Error al aprobar ${symbol}`, 'error');
                    }
                } else {
                    closeModal('sizing-modal');
                    showToast('Error creando accion', 'error');
                }
            }
            _sizingData = null;
            loadAll();
        };
        return;
    }

    // Non-BUY actions: approve directly
    const res = await apiPost(`pending/${id}/approve`, {});
    if (res && res.status === 'approved') {
        showToast(`Accion aprobada para ${symbol}`, 'success');
        loadAll();
    } else {
        showToast(res?.error || `Error al aprobar ${symbol}`, 'error');
    }
}

async function rejectPendingAction(id, symbol) {
    const res = await apiPost(`pending/${id}/reject`, {});
    if (res && res.status === 'rejected') {
        showToast(`Acción rechazada para ${symbol}`, 'info');
        loadAll();
    } else {
        showToast(`Error al rechazar ${symbol}`, 'error');
    }
}

// ── Positions ───────────────────────────────────────────────

async function loadPositions() {
    const positions = await apiGet('portfolio');
    if (!positions) return;

    const count = document.getElementById('positions-count');
    if (count) count.textContent = positions.length;

    const body = document.getElementById('positions-body');
    if (!body) return;

    if (positions.length === 0) {
        body.innerHTML = '<div class="empty-state">No hay posiciones abiertas</div>';
        return;
    }

    // Populate global map for chart modal access
    positions.forEach(pos => { _positionMap[pos.id] = pos; });

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

        // FIX: Use entry_date from DB and show it
        const entryDate = pos.entry_date || '';
        const daysSinceEntry = entryDate ?
            Math.max(0, Math.floor((Date.now() - new Date(entryDate + 'T12:00:00').getTime()) / 86400000)) : 0;

        const shares = pos.shares || 0;
        const invested = (pos.entry_price || 0) * shares;
        const pnlAbs = pos.pnl_abs || ((pos.last_close || 0) - (pos.entry_price || 0)) * shares;

        // Risk calculation for this position
        const stopPrice = pos.current_stop || pos.initial_stop || 0;
        const riskUsd = Math.max(0, (pos.entry_price - stopPrice) * shares);
        const stopDistPct = pos.entry_price > 0 ? ((pos.entry_price - stopPrice) / pos.entry_price * 100) : 0;
        const equityUsd = _equityEur * _fxRate;
        const riskAccPct = equityUsd > 0 ? (riskUsd / equityUsd * 100) : null;
        const riskLabel = riskAccPct !== null
            ? `$${riskUsd.toFixed(0)} · ${riskAccPct.toFixed(2)}%`
            : `$${riskUsd.toFixed(0)} · ${stopDistPct.toFixed(1)}%↓`;

        // Action buttons
        const chartBtn = `<button class="btn-action btn-action-chart" onclick="openChartModal('${pos.symbol}', null, _positionMap[${pos.id}])">📈 Gráfico / IA</button>`;
        const actions = IS_LOCAL ? `
            <div class="pos-actions">
                ${chartBtn}
                <button class="btn-action btn-action-sell" onclick="openSellModal(${pos.id}, '${pos.symbol}', ${shares}, ${pos.last_close || pos.entry_price})">🔴 Vender</button>
                <button class="btn-action btn-action-edit" onclick="openStopModal(${pos.id}, '${pos.symbol}', ${stopPrice}, ${shares}, ${pos.entry_price || 0})">✏️ Stop</button>
                <button class="btn-action btn-action-delete" onclick="deletePosition(${pos.id}, '${pos.symbol}')">🗑️</button>
            </div>
        ` : `<div class="pos-actions">${chartBtn}</div>`;

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
                <div class="pos-details" style="grid-template-columns:repeat(7,1fr)">
                    <div class="pos-detail">
                        <div class="pos-detail-label">Fecha</div>
                        <div class="pos-detail-value">${entryDate}</div>
                    </div>
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
                        <div class="pos-detail-value" style="color:var(--negative)">$${stopPrice.toFixed(2)}</div>
                    </div>
                    <div class="pos-detail">
                        <div class="pos-detail-label">Riesgo</div>
                        <div class="pos-detail-value" style="color:var(--negative)">${riskLabel}</div>
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
                ${actions}
            </div>
        `;
    }).join('');
}

// ── Signals ─────────────────────────────────────────────────

async function loadSignals() {
    const filter = document.getElementById('signal-filter');
    const setupType = filter ? filter.value.toLowerCase() : '';

    let allSignals = await apiGet('signals');
    if (!allSignals) return;

    if (setupType) {
        allSignals = allSignals.filter(sig => sig.setup_type && sig.setup_type.toLowerCase() === setupType);
    }

    // Group signals by symbol — same stock can have EP + Breakout simultaneously
    const symbolMap = {};
    allSignals.forEach(sig => {
        if (!symbolMap[sig.symbol]) symbolMap[sig.symbol] = [];
        // Avoid duplicating same setup_type
        if (!symbolMap[sig.symbol].some(s => s.setup_type === sig.setup_type)) {
            symbolMap[sig.symbol].push(sig);
        }
    });

    // Store globally for openChartModal to access
    Object.assign(_signalGroups, symbolMap);

    // Sort groups: composite score = ready(+2.0) + bestScore(0–1) + multi(+0.3)
    // READY always beats NEAR regardless of multi-setup
    const groups = Object.entries(symbolMap).map(([symbol, signals]) => {
        const hasReady = signals.some(s => s.status === 'ready');
        const bestScore = Math.max(...signals.map(s => s.score || 0));
        const isMulti = signals.length > 1;
        const composite = (hasReady ? 2.0 : 0.0) + bestScore + (isMulti ? 0.3 : 0.0);
        return { symbol, signals, hasReady, bestScore, isMulti, composite };
    }).sort((a, b) => b.composite - a.composite);

    const body = document.getElementById('signals-body');
    if (!body) return;

    if (groups.length === 0) {
        body.innerHTML = '<div class="empty-state">Sin señales detectadas</div>';
        return;
    }

    body.innerHTML = groups.map(({ symbol, signals, hasReady, bestScore, isMulti }) => {
        const score = bestScore * 100;
        const status = hasReady ? 'ready' : 'near';

        // Combine guidance from all signals (deduplicated)
        const allGuidance = [...new Set(signals.flatMap(s => Array.isArray(s.guidance) ? s.guidance : []))];
        const guidanceText = allGuidance.slice(0, 2).join(' · ');

        const scanDate = signals[0]?.scan_date
            ? `<span style="font-size:10px;color:var(--text-dim);margin-left:6px">${signals[0].scan_date}</span>`
            : '';

        const multiBadge = isMulti
            ? `<span class="badge" style="background:rgba(251,191,36,0.2);color:#fbbf24;margin-left:4px;font-weight:bold;">⚡ MULTI-SETUP</span>`
            : '';

        return `
            <div class="signal-card ${status}" style="${isMulti ? 'border-left:3px solid #fbbf24;' : ''}"
                 onclick="openChartModal('${symbol}')" style="cursor:pointer;">
                <div class="signal-left">
                    <span class="signal-symbol" style="cursor:pointer;text-decoration:underline;">${symbol}</span>
                    ${signals.map(s => `<span class="badge ${setupBadgeClass(s.setup_type)}">${s.setup_type.toUpperCase()}</span>`).join('')}
                    ${status === 'ready' ? '<span class="badge badge-hold">READY</span>' : '<span class="badge badge-watch">NEAR</span>'}
                    ${multiBadge}
                    ${scanDate}
                </div>
                <div class="signal-right">
                    <div class="signal-score" style="color:${score >= 85 ? 'var(--positive)' : score >= 50 ? 'var(--warning)' : 'var(--text-muted)'}">${score.toFixed(0)}%</div>
                    ${guidanceText ? `<div class="signal-guidance">${guidanceText}</div>` : ''}
                </div>
            </div>
        `;
    }).join('');
}

let chartState = {
    symbol: '',
    period: '365d',
    setupType: '',
    signals: [],   // array of signal objects for current symbol
    data: [],
    charts: { main: null, vol: null, rsi: null, macd: null, stoch: null },
    series: {},
    indicators: {
        ema10: true, ema20: true, ema50: true,
        sma150: false, sma200: false,
        volume: true, rsi: false, macd: false, stoch: false
    }
};

let _currentSignal = null;
let _currentPositionData = null;  // populated when chart opened from a position
const _signalGroups = {};  // symbol -> [signalObjects] — populated by loadSignals()
const _positionMap = {};   // id -> position object — populated by loadPositions()

async function openChartModal(symbol, signalsOrSetup, positionData = null) {
    const modal = document.getElementById('chart-modal');
    if (!modal) return;
    modal.style.display = 'flex';

    // Store position context globally
    _currentPositionData = positionData || null;

    // Resolve signals: from _signalGroups map, passed array, or legacy string
    let signals = [];
    if (signalsOrSetup === undefined || signalsOrSetup === null) {
        signals = _signalGroups[symbol] || [];
    } else if (typeof signalsOrSetup === 'string') {
        signals = [{ symbol, setup_type: signalsOrSetup }];
    } else if (Array.isArray(signalsOrSetup)) {
        signals = signalsOrSetup;
    }

    chartState.symbol = symbol;
    chartState.signals = signals;

    const setupTypes = signals.map(s => s.setup_type).filter(Boolean);
    const primarySetup = setupTypes[0] || (positionData ? positionData.setup_type : 'breakout');

    // Position mode: show position info bar, hide signal-only buttons
    const posInfoEl  = document.getElementById('chart-position-info');
    const btnBuy     = document.getElementById('chart-btn-buy');
    const btnWait    = document.getElementById('chart-btn-wait');
    const btnDiscard = document.getElementById('chart-btn-discard');

    if (positionData) {
        const pnl = positionData.pnl_pct || 0;
        const pnlColor = pnl >= 0 ? '#4ade80' : '#f87171';
        const days = positionData.entry_date
            ? Math.max(0, Math.floor((Date.now() - new Date(positionData.entry_date + 'T12:00:00').getTime()) / 86400000))
            : 0;
        posInfoEl.style.display = 'flex';
        posInfoEl.innerHTML = `
            <span style="color:#94a3b8">📌 POSICIÓN ABIERTA</span>
            <span>Entrada: <strong>$${(positionData.entry_price || 0).toFixed(2)}</strong></span>
            <span>Actual: <strong>$${(positionData.last_close || 0).toFixed(2)}</strong></span>
            <span>P&L: <strong style="color:${pnlColor}">${pnl >= 0 ? '+' : ''}${pnl.toFixed(2)}%</strong></span>
            <span>Stop: <strong style="color:#f87171">$${(positionData.current_stop || 0).toFixed(2)}</strong></span>
            <span>Días: <strong>${days}</strong></span>
        `;
        document.getElementById('chart-modal-title').textContent = `${symbol} — ${(positionData.setup_type || 'POSICIÓN').toUpperCase()} (Posición)`;
        if (btnBuy)     btnBuy.style.display     = 'none';
        if (btnWait)    btnWait.style.display    = 'none';
        if (btnDiscard) btnDiscard.style.display = 'none';
    } else {
        posInfoEl.style.display = 'none';
        const setupLabel = setupTypes.length > 0 ? setupTypes.map(s => s.toUpperCase()).join(' + ') : 'CHART';
        document.getElementById('chart-modal-title').textContent = `${symbol} — ${setupLabel}`;
        if (btnBuy)     btnBuy.style.display     = '';
        if (btnWait)    btnWait.style.display    = '';
        if (btnDiscard) btnDiscard.style.display = '';
        document.getElementById('chart-btn-buy').onclick = () => confirmSignalFromChart(symbol, primarySetup);
        document.getElementById('chart-btn-wait').onclick = () => {
            addToWatchlist(symbol, `Desde grafico (${setupLabel})`);
            showToast(`${symbol} agregado a watchlist`, 'info');
            hideChartModal();
        };
        document.getElementById('chart-btn-discard').onclick = () => hideChartModal();
    }

    _currentSignal = signals[0] || { symbol, setup_type: primarySetup };

    // Reset Copilot UI
    const copilotArea    = document.getElementById('chart-copilot-area');
    const copilotBtn     = document.getElementById('chart-btn-copilot');
    const resumenEl      = document.getElementById('copilot-resumen');
    const historyBtn     = document.getElementById('copilot-history-btn');
    const historyArea    = document.getElementById('copilot-history-area');
    if (copilotArea)  copilotArea.style.display  = 'none';
    if (resumenEl)    resumenEl.style.display    = 'none';
    if (historyBtn)   historyBtn.style.display   = 'none';
    if (historyArea)  historyArea.style.display  = 'none';
    if (copilotBtn) {
        copilotBtn.innerHTML = '🧠 Analizar con IA';
        copilotBtn.disabled = false;
        if (positionData) {
            copilotBtn.onclick = () => requestCopilotAnalysis(symbol, [positionData.setup_type || 'general'], positionData.id);
        } else {
            copilotBtn.onclick = () => requestCopilotAnalysis(symbol, setupTypes);
        }
    }

    await loadChartData();
}

async function loadChartData() {
    const panels = document.getElementById('chart-panels');
    panels.innerHTML = `
        <div id="tv-chart-main" class="chart-panel-main"></div>
        <div id="tv-chart-vol" class="chart-panel-osc" style="display:none;"></div>
        <div id="tv-chart-rsi" class="chart-panel-osc" style="display:none;"></div>
        <div id="tv-chart-macd" class="chart-panel-osc" style="display:none;"></div>
        <div id="tv-chart-stoch" class="chart-panel-osc" style="display:none;"></div>
    `;

    document.getElementById('tv-chart-main').innerHTML = '<div style="display:flex;align-items:center;justify-content:center;height:100%;color:var(--text-muted);font-size:14px">⏳ Cargando gráfico...</div>';

    const data = await apiGet(`chart/${chartState.symbol}?period=${chartState.period}`);
    if (!data || !Array.isArray(data) || data.length === 0) {
        document.getElementById('tv-chart-main').innerHTML = '<div style="display:flex;align-items:center;justify-content:center;height:100%;color:var(--negative);font-size:14px">⚠️ Error cargando datos de ' + chartState.symbol + '</div>';
        return;
    }
    chartState.data = data;
    renderCharts();
}

async function requestCopilotAnalysis(symbol, setupTypes, positionId = null) {
    const btn = document.getElementById('chart-btn-copilot');
    const area = document.getElementById('chart-copilot-area');
    const decisionEl = document.getElementById('copilot-decision');
    const valoracionEl = document.getElementById('copilot-valoracion');
    const confianzaEl = document.getElementById('copilot-confianza');
    const resumenEl = document.getElementById('copilot-resumen');
    const historyBtn = document.getElementById('copilot-history-btn');

    if (!btn || !area) return;

    const isPositionMode = !!positionId;
    const types = Array.isArray(setupTypes) ? setupTypes : (setupTypes ? [setupTypes] : []);

    btn.disabled = true;
    btn.innerHTML = '<span class="spinner"></span> Consultando a la IA...';
    area.style.display = 'block';
    if (resumenEl) resumenEl.style.display = 'none';
    if (historyBtn) historyBtn.style.display = 'none';
    decisionEl.textContent = 'ESPERANDO';
    decisionEl.style.backgroundColor = 'rgba(255, 255, 255, 0.1)';
    decisionEl.style.color = '#fff';
    valoracionEl.textContent = isPositionMode
        ? 'Evaluando la posición según las reglas de gestión de Qullamaggie...'
        : 'El Copiloto está analizando el contexto, métricas y la estructura de precios según las reglas de Qullamaggie. Por favor espera...';
    confianzaEl.textContent = '-';

    try {
        const body = { symbol, setup_types: types };
        if (positionId) body.position_id = positionId;

        const res = await fetch('/api/copilot/analyze', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(body)
        });

        btn.innerHTML = '🧠 Re-analizar';
        btn.disabled = false;

        if (!res.ok) throw new Error('Error en la API');
        const data = await res.json();

        const confianzaNum = parseInt((data.confianza || '0%').replace('%', '')) || 0;
        valoracionEl.textContent = data.valoracion || 'Sin valoración';
        confianzaEl.textContent = data.confianza || '0%';

        const decisionText = (data.decision || '').trim().toUpperCase();
        decisionEl.textContent = decisionText;

        if (isPositionMode) {
            // Position mode: color by MANTENER/VENDER/AÑADIR/REDUCIR
            const colors = {
                'MANTENER': ['rgba(59,130,246,0.2)', '#60a5fa'],
                'AÑADIR':   ['rgba(34,197,94,0.2)',  '#4ade80'],
                'REDUCIR':  ['rgba(234,179,8,0.2)',  '#facc15'],
                'VENDER':   ['rgba(239,68,68,0.2)',  '#f87171'],
            };
            const [bg, color] = colors[decisionText] || ['rgba(234,179,8,0.2)', '#facc15'];
            decisionEl.style.backgroundColor = bg;
            decisionEl.style.color = color;

            // Show "Ver historial IA" button for positions
            if (historyBtn) {
                historyBtn.style.display = 'flex';
                historyBtn.onclick = () => loadPositionCopilotHistory(positionId);
            }
        } else {
            // Signal mode: INVERTIR/NO INVERTIR colors
            if (decisionText === 'INVERTIR') {
                decisionEl.style.backgroundColor = 'rgba(34, 197, 94, 0.2)';
                decisionEl.style.color = '#4ade80';
            } else if (decisionText === 'NO INVERTIR') {
                decisionEl.style.backgroundColor = 'rgba(239, 68, 68, 0.2)';
                decisionEl.style.color = '#f87171';
            } else {
                decisionEl.style.backgroundColor = 'rgba(234, 179, 8, 0.2)';
                decisionEl.style.color = '#facc15';
            }
        }

        // Resumen banner (both modes)
        if (resumenEl && data.resumen) {
            const resumenText = data.resumen.trim();
            const upper = resumenText.toUpperCase();
            resumenEl.textContent = resumenText;
            resumenEl.style.display = 'block';
            if (upper.startsWith('COMPRAR') || upper.startsWith('AÑADIR') || upper.startsWith('MANTENER')) {
                resumenEl.style.background = 'rgba(16,185,129,0.1)';
                resumenEl.style.borderColor = '#10b981';
                resumenEl.style.color = '#4ade80';
            } else if (upper.startsWith('ESPERAR') || upper.startsWith('REDUCIR')) {
                resumenEl.style.background = 'rgba(234,179,8,0.1)';
                resumenEl.style.borderColor = '#f59e0b';
                resumenEl.style.color = '#facc15';
            } else {
                resumenEl.style.background = 'rgba(239,68,68,0.1)';
                resumenEl.style.borderColor = '#ef4444';
                resumenEl.style.color = '#f87171';
            }
        }

        // Show sizing only for signal mode with INVERTIR + confidence
        if (!isPositionMode && data.sizing && confianzaNum > 0 && decisionText === 'INVERTIR') {
            const s = data.sizing;
            const primarySetup = types[0] || 'breakout';
            let sizingHtml = `<div style="margin-top:10px;padding:8px 12px;background:rgba(16,185,129,0.1);border:1px solid rgba(16,185,129,0.3);border-radius:6px;font-size:12px;">`;
            sizingHtml += `<strong>Sizing:</strong> ${s.shares} accs @ $${s.entry_price.toFixed(2)} | Stop: $${s.stop_price.toFixed(2)} | Riesgo: $${s.risk_amount_usd.toFixed(2)} | Coste: $${s.cost_usd.toFixed(2)} (€${s.cost_eur.toFixed(2)})`;
            sizingHtml += ` <button onclick="showSizingModal('${symbol}','${primarySetup}',${JSON.stringify(s).replace(/"/g, '&quot;')})" style="margin-left:8px;padding:4px 10px;background:var(--positive);color:#000;border:none;border-radius:4px;cursor:pointer;font-weight:bold;font-size:11px;">Comprar ${s.shares} accs</button>`;
            sizingHtml += `</div>`;
            valoracionEl.innerHTML = valoracionEl.textContent + sizingHtml;
        }

    } catch (err) {
        btn.innerHTML = '🧠 Re-analizar';
        btn.disabled = false;
        valoracionEl.textContent = 'Error al contactar con el Copiloto IA: ' + err.message;
        decisionEl.textContent = 'ERROR';
    }
}

async function loadPositionCopilotHistory(positionId) {
    const historyArea = document.getElementById('copilot-history-area');
    const historyList = document.getElementById('copilot-history-list');
    const historyBtn  = document.getElementById('copilot-history-btn');
    if (!historyArea || !historyList) return;

    historyList.innerHTML = '<div style="color:#94a3b8;font-size:12px;padding:4px 0">Cargando...</div>';
    historyArea.style.display = 'block';
    if (historyBtn) historyBtn.style.display = 'none';

    const history = await apiGet(`position/${positionId}/copilot_history`);
    if (!history || history.length === 0) {
        historyList.innerHTML = '<div style="color:#64748b;font-size:12px;padding:4px 0">Sin análisis previos.</div>';
        return;
    }

    const decisionColors = {
        'MANTENER': '#60a5fa', 'AÑADIR': '#4ade80', 'REDUCIR': '#facc15',
        'VENDER': '#f87171', 'INVERTIR': '#4ade80', 'NO INVERTIR': '#f87171',
    };

    historyList.innerHTML = history.map(h => {
        const color = decisionColors[h.decision] || '#94a3b8';
        const ts = h.ts ? h.ts.replace('T', ' ').substring(0, 16) : '';
        const mode = h.analysis_mode === 'position' ? '📊' : '🔍';
        return `
            <div style="padding:6px 0; border-bottom:1px solid rgba(255,255,255,0.05); font-size:12px;">
                <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:3px;">
                    <span style="color:#94a3b8">${mode} ${ts}</span>
                    <span style="color:${color}; font-weight:bold;">${h.decision}</span>
                    <span style="color:#64748b">${h.confianza}</span>
                </div>
                ${h.resumen ? `<div style="color:#94a3b8; font-style:italic;">${h.resumen}</div>` : ''}
            </div>
        `;
    }).join('');
}



function renderCharts() {
    Object.values(chartState.charts).forEach(c => { if(c) { try{c.remove()}catch(e){} } });
    chartState.charts = { main: null, vol: null, rsi: null, macd: null, stoch: null };
    chartState.series = {};

    const data = chartState.data;
    const commonOpt = {
        layout: { background: { type: 'solid', color: '#0d1117' }, textColor: '#e2e8f0' },
        grid: { vertLines: { color: 'rgba(255,255,255,0.04)' }, horzLines: { color: 'rgba(255,255,255,0.04)' } },
        crosshair: { mode: 1 },
        timeScale: { borderColor: 'rgba(255,255,255,0.1)', timeVisible: true }
    };

    const showVol = chartState.indicators.volume;
    const showRsi = chartState.indicators.rsi;
    const showMacd = chartState.indicators.macd;
    const showStoch = chartState.indicators.stoch;

    document.getElementById('tv-chart-vol').style.display = showVol ? 'block' : 'none';
    document.getElementById('tv-chart-rsi').style.display = showRsi ? 'block' : 'none';
    document.getElementById('tv-chart-macd').style.display = showMacd ? 'block' : 'none';
    document.getElementById('tv-chart-stoch').style.display = showStoch ? 'block' : 'none';

    // Main Chart
    const mainC = document.getElementById('tv-chart-main');
    mainC.innerHTML = '';
    const mainChart = LightweightCharts.createChart(mainC, {
        ...commonOpt, width: mainC.clientWidth, height: mainC.clientHeight
    });
    chartState.charts.main = mainChart;

    const candleSeries = mainChart.addCandlestickSeries({
        upColor: '#10b981', downColor: '#ef4444', borderVisible: false,
        wickUpColor: '#10b981', wickDownColor: '#ef4444'
    });
    candleSeries.setData(data.map(d => ({time: d.time, open: d.open, high: d.high, low: d.low, close: d.close})));

    // Signal markers — one per detected setup, colored by type
    const signalMarkerColors = {
        'ep':        '#f59e0b',
        'breakout':  '#10b981',
        'vcp':       '#3b82f6',
        'parabolic': '#ef4444',
    };
    const signals = chartState.signals || [];
    if (signals.length > 0) {
        const markers = signals
            .filter(s => s.scan_date)
            .map(s => ({
                time: s.scan_date,
                position: 'belowBar',
                color: signalMarkerColors[s.setup_type] || '#8b5cf6',
                shape: 'arrowUp',
                text: s.setup_type ? s.setup_type.toUpperCase() : '',
            }))
            .sort((a, b) => a.time < b.time ? -1 : 1);
        if (markers.length > 0) {
            try { candleSeries.setMarkers(markers); } catch(e) {}
        }
    }

    // Moving Averages
    const addMA = (key, color, width, style) => {
        const sData = data.filter(d => d[key] != null).map(d => ({time: d.time, value: d[key]}));
        if(sData.length > 0) {
            const series = mainChart.addLineSeries({ color, lineWidth: width, lineStyle: style, title: key.toUpperCase(), visible: chartState.indicators[key] });
            series.setData(sData);
            chartState.series[key] = series;
        }
    };
    addMA('ema10', '#3b82f6', 2, 0); // Blue solid
    addMA('ema20', '#10b981', 2, 0); // Green solid
    addMA('ema50', '#f59e0b', 2, 0); // Orange solid
    addMA('sma150', '#ec4899', 2, 2); // Pink dashed
    addMA('sma200', '#8b5cf6', 2, 2); // Purple dashed

    // Vol
    if (showVol) {
        const c = document.getElementById('tv-chart-vol');
        c.innerHTML = '';
        const ch = LightweightCharts.createChart(c, { ...commonOpt, width: c.clientWidth, height: c.clientHeight });
        chartState.charts.vol = ch;
        const volSeries = ch.addHistogramSeries({ color: 'rgba(59,130,246,0.5)', priceFormat: { type: 'volume' } });
        volSeries.setData(data.map(d => ({ time: d.time, value: d.volume, color: d.close >= d.open ? 'rgba(16,185,129,0.5)' : 'rgba(239,68,68,0.5)' })));
        
        const volMaData = data.filter(d => d.vol_ma20 != null).map(d => ({time: d.time, value: d.vol_ma20}));
        if(volMaData.length > 0) {
            ch.addLineSeries({ color: 'rgba(255,255,255,0.4)', lineWidth: 1, title: 'SMA20' }).setData(volMaData);
        }
    }

    // RSI
    if (showRsi) {
        const c = document.getElementById('tv-chart-rsi');
        c.innerHTML = '';
        const ch = LightweightCharts.createChart(c, { ...commonOpt, width: c.clientWidth, height: c.clientHeight });
        chartState.charts.rsi = ch;
        const rsiSeries = ch.addLineSeries({ color: '#8b5cf6', lineWidth: 1, title: 'RSI 14' });
        rsiSeries.setData(data.filter(d => d.rsi != null).map(d => ({time: d.time, value: d.rsi})));
        rsiSeries.createPriceLine({ price: 70, color: 'rgba(255,255,255,0.2)', lineWidth: 1, lineStyle: 2 });
        rsiSeries.createPriceLine({ price: 30, color: 'rgba(255,255,255,0.2)', lineWidth: 1, lineStyle: 2 });
    }

    // MACD
    if (showMacd) {
        const c = document.getElementById('tv-chart-macd');
        c.innerHTML = '';
        const ch = LightweightCharts.createChart(c, { ...commonOpt, width: c.clientWidth, height: c.clientHeight });
        chartState.charts.macd = ch;
        const macdLine = ch.addLineSeries({ color: '#3b82f6', lineWidth: 1, title: 'MACD' });
        const signalLine = ch.addLineSeries({ color: '#f59e0b', lineWidth: 1, title: 'Sig' });
        const histLine = ch.addHistogramSeries({ title: 'Hist' });
        macdLine.setData(data.filter(d => d.macd != null).map(d => ({time: d.time, value: d.macd})));
        signalLine.setData(data.filter(d => d.macd_signal != null).map(d => ({time: d.time, value: d.macd_signal})));
        histLine.setData(data.filter(d => d.macd_hist != null).map(d => ({time: d.time, value: d.macd_hist, color: d.macd_hist >= 0 ? '#10b981' : '#ef4444'})));
    }

    // STOCH
    if (showStoch) {
        const c = document.getElementById('tv-chart-stoch');
        c.innerHTML = '';
        const ch = LightweightCharts.createChart(c, { ...commonOpt, width: c.clientWidth, height: c.clientHeight });
        chartState.charts.stoch = ch;
        const kLine = ch.addLineSeries({ color: '#3b82f6', lineWidth: 1, title: '%K' });
        const dLine = ch.addLineSeries({ color: '#f59e0b', lineWidth: 1, title: '%D' });
        kLine.setData(data.filter(d => d.stoch_k != null).map(d => ({time: d.time, value: d.stoch_k})));
        dLine.setData(data.filter(d => d.stoch_d != null).map(d => ({time: d.time, value: d.stoch_d})));
        kLine.createPriceLine({ price: 80, color: 'rgba(255,255,255,0.2)', lineWidth: 1, lineStyle: 2 });
        kLine.createPriceLine({ price: 20, color: 'rgba(255,255,255,0.2)', lineWidth: 1, lineStyle: 2 });
    }

    // Sync charts
    const chartsArr = Object.values(chartState.charts).filter(c => c !== null);
    if (chartsArr.length > 1) {
        let isSyncing = false;
        chartsArr.forEach((chart) => {
            chart.timeScale().subscribeVisibleLogicalRangeChange(range => {
                if (isSyncing || !range) return;
                isSyncing = true;
                chartsArr.forEach(c => {
                    if (c !== chart) c.timeScale().setVisibleLogicalRange(range);
                });
                isSyncing = false;
            });
            chart.subscribeCrosshairMove(param => {
                if(isSyncing || !param.time) return;
                isSyncing = true;
                chartsArr.forEach(c => {
                    if (c !== chart && param.point) {
                        try { c.setCrosshairPosition(param.point.x, param.point.y, param.series); } catch(e){}
                    }
                });
                isSyncing = false;
            });
        });
    }

    mainChart.timeScale().fitContent();

    // Meta display
    const last = data[data.length-1];
    if (last) {
        document.getElementById('chart-meta').textContent = `Volume: ${last.volume ? (last.volume/1e6).toFixed(2)+'M' : 'N/A'} · ADR: ${last.adr ? last.adr.toFixed(2)+'%' : 'N/A'}`;
    }
}

// UI Setup for Chart
document.addEventListener('DOMContentLoaded', () => {
    // Period clicks
    document.querySelectorAll('.period-btn').forEach(btn => {
        btn.addEventListener('click', (e) => {
            document.querySelectorAll('.period-btn').forEach(b => b.classList.remove('active'));
            btn.classList.add('active');
            chartState.period = btn.dataset.period;
            loadChartData();
        });
    });

    // Indicator clicks
    document.querySelectorAll('.ind-btn').forEach(btn => {
        btn.addEventListener('click', (e) => {
            const ind = btn.dataset.ind;
            chartState.indicators[ind] = !chartState.indicators[ind];
            
            if (chartState.indicators[ind]) btn.classList.add('active');
            else btn.classList.remove('active');

            if (['volume', 'rsi', 'macd', 'stoch'].includes(ind)) {
                renderCharts(); // complete rebuild for layout changes
            } else {
                if (chartState.series[ind]) {
                    chartState.series[ind].applyOptions({ visible: chartState.indicators[ind] });
                }
            }
        });
    });

    // Resize handler
    window.addEventListener('resize', () => {
        const panels = {
            main: 'tv-chart-main',
            vol: 'tv-chart-vol',
            rsi: 'tv-chart-rsi',
            macd: 'tv-chart-macd',
            stoch: 'tv-chart-stoch'
        };
        for(const [key, ch] of Object.entries(chartState.charts)) {
            if(ch) {
                const el = document.getElementById(panels[key]);
                if(el) ch.applyOptions({ width: el.clientWidth, height: el.clientHeight });
            }
        }
    });

    const chartModal = document.getElementById('chart-modal');
    if (chartModal) {
        chartModal.addEventListener('click', (e) => {
            if (e.target.classList.contains('chart-modal-overlay')) hideChartModal();
        });
    }
});

function hideChartModal() {
    const modal = document.getElementById('chart-modal');
    if (modal) modal.style.display = 'none';
    Object.values(chartState.charts).forEach(c => { if(c) { try{c.remove()}catch(e){} } });
    chartState.charts = { main: null, vol: null, rsi: null, macd: null, stoch: null };
}

let _sizingData = null;

async function confirmSignalFromChart(symbol, setupType) {
    showToast('Calculando sizing...', 'info');
    const sizing = await apiGet(`sizing/${symbol}?setup_type=${setupType}&score=0.8`);
    if (!sizing || sizing.error) {
        showToast(sizing?.error || 'Error calculando sizing', 'error');
        return;
    }
    showSizingModal(symbol, setupType, sizing);
}

function showSizingModal(symbol, setupType, sizing) {
    _sizingData = { symbol, setupType, ...sizing };

    setText('sizing-symbol', symbol);
    setText('sizing-setup', setupType.toUpperCase());
    setText('sizing-price', `$${sizing.entry_price.toFixed(2)}`);

    const stopInput = document.getElementById('sizing-stop');
    stopInput.value = sizing.stop_price.toFixed(2);

    const riskPctInput = document.getElementById('sizing-risk-pct');
    riskPctInput.value = (sizing.risk_pct != null ? sizing.risk_pct : 1.0).toFixed(1);
    riskPctInput.disabled = !sizing.equity_usd;
    riskPctInput.title = sizing.equity_usd ? '' : 'Sin datos de equity — edita acciones manualmente';

    const sharesInput = document.getElementById('sizing-shares');
    sharesInput.value = sizing.shares;

    stopInput.oninput = _recalcSizingFromRiskOrStop;
    riskPctInput.oninput = _recalcSizingFromRiskOrStop;
    sharesInput.oninput = _updateSizingCalc;

    document.getElementById('sizing-confirm-btn').onclick = executeSizingBuy;

    _updateSizingCalc();
    document.getElementById('sizing-modal').style.display = 'flex';
}

// When risk% or stop changes → recalculate shares
function _recalcSizingFromRiskOrStop() {
    if (!_sizingData || !_sizingData.equity_usd) return;
    const riskPct = parseFloat(document.getElementById('sizing-risk-pct').value) || 1.0;
    const stop = parseFloat(document.getElementById('sizing-stop').value) || _sizingData.stop_price;
    const entry = _sizingData.entry_price;
    const riskPerShare = entry - stop;
    if (riskPerShare <= 0) return;
    const shares = Math.max(1, Math.floor(_sizingData.equity_usd * riskPct / 100 / riskPerShare));
    document.getElementById('sizing-shares').value = shares;
    _updateSizingCalc();
}

function _updateSizingCalc() {
    if (!_sizingData) return;
    const shares = parseInt(document.getElementById('sizing-shares').value) || 0;
    const stop = parseFloat(document.getElementById('sizing-stop').value) || _sizingData.stop_price;
    const entry = _sizingData.entry_price;
    const equityUsd = _sizingData.equity_usd || 0;

    const costUsd = shares * entry;
    const costEur = costUsd / _sizingData.fx_rate;
    const riskPerShare = Math.max(0, entry - stop);
    const riskUsd = shares * riskPerShare;
    const riskPct = equityUsd > 0 ? (riskUsd / equityUsd * 100) : 0;

    setText('sizing-cost-usd', `$${costUsd.toLocaleString('en-US', {minimumFractionDigits:2, maximumFractionDigits:2})}`);
    setText('sizing-cost-eur', `€${costEur.toLocaleString('en-US', {minimumFractionDigits:2, maximumFractionDigits:2})}`);
    const riskLabel = riskPct > 0
        ? `$${riskUsd.toLocaleString('en-US', {minimumFractionDigits:2, maximumFractionDigits:2})} (${riskPct.toFixed(2)}%)`
        : `$${riskUsd.toLocaleString('en-US', {minimumFractionDigits:2, maximumFractionDigits:2})}`;
    setText('sizing-risk', riskLabel);
    setText('sizing-fx', _sizingData.fx_rate.toFixed(4));

    // If user is editing shares manually, sync risk% display
    if (equityUsd > 0 && document.activeElement === document.getElementById('sizing-shares')) {
        document.getElementById('sizing-risk-pct').value = riskPct.toFixed(2);
    }
}

async function executeSizingBuy() {
    if (!_sizingData) return;
    const shares = parseInt(document.getElementById('sizing-shares').value) || 0;
    const stop = parseFloat(document.getElementById('sizing-stop').value) || _sizingData.stop_price;
    if (shares <= 0) {
        showToast('Numero de acciones invalido', 'error');
        return;
    }

    const result = await apiPost('pending', {
        symbol: _sizingData.symbol,
        action_type: 'BUY',
        setup_type: _sizingData.setupType,
        reason: `Compra manual (${_sizingData.setupType.toUpperCase()}) - ${shares} accs`,
        shares: shares,
        price: _sizingData.entry_price,
        stop_price: stop,
    });

    closeModal('sizing-modal');
    if (result && result.status === 'created') {
        showToast(`Orden de compra creada para ${_sizingData.symbol} (${shares} accs)`, 'success');
        // Close chart modal only if it is currently open
        const chartModal = document.getElementById('chart-modal');
        if (chartModal && chartModal.style.display !== 'none') hideChartModal();
        loadAll();
    } else {
        showToast(`Error creando orden para ${_sizingData.symbol}`, 'error');
    }
    _sizingData = null;
}


// ── History ─────────────────────────────────────────────────

async function loadHistory() {
    const trades = await apiGet('history');
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
                <td>€${(t.entry_price || 0).toFixed(2)}</td>
                <td>€${(t.exit_price || 0).toFixed(2)}</td>
                <td class="${pnlClass(pnlPct)}">${pnlPct >= 0 ? '+' : ''}${pnlPct.toFixed(2)}%</td>
                <td class="${pnlClass(pnlAbs)}">${formatCurrency(pnlAbs)}</td>
                <td class="${pnlClass(rMult)}">${rMult >= 0 ? '+' : ''}${rMult.toFixed(1)}R</td>
                <td>${t.hold_days || 0}</td>
                <td style="color:var(--text-muted);font-family:var(--font-sans);font-size:11px">${t.exit_reason || ''}</td>
            </tr>
        `;
    }).join('');
}

// ── Scan ────────────────────────────────────────────────────

async function triggerScan() {
    if (!IS_LOCAL) {
        showToast('El escaneo se ejecuta automáticamente vía GitHub Actions (L-V 22:30 UTC).', 'info');
        return;
    }
    const result = await apiPost('scan', {});
    if (result && result.status === 'started') {
        showToast('Escaneo iniciado... puede tardar unos minutos.', 'success');
        pollScanStatus();
    } else if (result && result.status === 'already_running') {
        showToast('Ya hay un escaneo en curso.', 'info');
    } else {
        showToast('Error al iniciar el escaneo.', 'error');
    }
}
window.triggerScan = triggerScan;

async function checkScanStatus() {
    const data = IS_LOCAL ? await apiGet('scan/status') : { running: false };
    if (!data) return;

    const dot = document.querySelector('.status-dot');
    const text = document.querySelector('.status-text');
    const btn = document.getElementById('btn-scan');

    if (data.running) {
        if (dot) dot.classList.add('running');
        if (text) text.textContent = 'Escaneando...';
        if (btn) { btn.disabled = true; btn.innerHTML = '<span class="spinner"></span> Escaneando...'; }
    } else {
        if (dot) dot.classList.remove('running');
        if (text) text.textContent = IS_LOCAL ? 'Servidor activo' : 'En espera';
        if (btn) { btn.disabled = false; btn.innerHTML = '<span class="btn-icon">⟳</span> Escanear Ahora'; }
    }
}

function pollScanStatus() {
    const interval = setInterval(async () => {
        const data = await apiGet('scan/status');
        if (data && !data.running) {
            clearInterval(interval);
            showToast('Escaneo completado.', 'success');
            loadAll();
        }
    }, 5000);
}

// ── Interactive Actions (Local only) ────────────────────────

function openSellModal(positionId, symbol, shares, price) {
    _sellPositionId = positionId;
    setText('sell-symbol', symbol);
    setText('sell-shares', shares);
    setText('sell-price', `€${price.toFixed(2)}`);
    document.getElementById('sell-type').value = 'full';
    document.getElementById('partial-field').style.display = 'none';
    document.getElementById('sell-modal').style.display = 'flex';
}

function togglePartialInput() {
    const type = document.getElementById('sell-type').value;
    document.getElementById('partial-field').style.display = type === 'partial' ? 'block' : 'none';
}

async function executeSell() {
    const type = document.getElementById('sell-type').value;
    const priceText = document.getElementById('sell-price').textContent.replace('€', '');
    const price = parseFloat(priceText);
    const data = { position_id: _sellPositionId, exit_price: price, sell_type: type };
    if (type === 'partial') {
        data.shares = parseInt(document.getElementById('sell-partial-shares').value);
    }
    const result = await apiPost('portfolio/sell', data);
    closeModal('sell-modal');
    if (result && result.status) {
        showToast(`${result.symbol}: Vendido (${result.pnl_pct ? result.pnl_pct.toFixed(2) + '%' : 'OK'})`, result.pnl_pct >= 0 ? 'success' : 'error');
        loadAll();
    } else {
        showToast('Error al vender.', 'error');
    }
}

function openStopModal(positionId, symbol, currentStop, shares, entryPrice) {
    _stopPositionId = positionId;
    _stopPositionShares = shares || 0;
    _stopPositionEntry = entryPrice || 0;
    setText('stop-symbol', symbol);
    setText('stop-current', `$${currentStop.toFixed(2)}`);
    document.getElementById('stop-new').value = currentStop.toFixed(2);
    document.getElementById('stop-modal').style.display = 'flex';
    _updateStopRiskDisplay();
}

function _updateStopRiskDisplay() {
    const newStop = parseFloat(document.getElementById('stop-new').value) || 0;
    const entry = _stopPositionEntry;
    const shares = _stopPositionShares;
    const preview = document.getElementById('stop-risk-preview');
    if (!preview) return;

    if (!entry || !shares || newStop <= 0) {
        preview.style.display = 'none';
        return;
    }

    preview.style.display = 'block';
    const riskPerShare = entry - newStop;
    const riskUsd = riskPerShare * shares;
    const stopDistPct = (riskPerShare / entry * 100);
    const equityUsd = _equityEur * _fxRate;
    const riskAccPct = equityUsd > 0 ? (riskUsd / equityUsd * 100) : null;

    setText('stop-risk-usd', `$${Math.max(0, riskUsd).toFixed(2)} USD`);
    setText('stop-risk-dist', `${Math.max(0, stopDistPct).toFixed(2)}% por debajo de entrada`);
    setText('stop-risk-acct', riskAccPct !== null ? `${Math.max(0, riskAccPct).toFixed(2)}%` : 'N/A');

    // Color the preview based on risk level
    const acct = riskAccPct || 0;
    preview.style.borderColor = acct > 2 ? 'rgba(239,68,68,0.5)' : acct > 1 ? 'rgba(234,179,8,0.4)' : 'rgba(239,68,68,0.25)';
}

async function executeStopChange() {
    const newStop = parseFloat(document.getElementById('stop-new').value);
    const result = await apiPost(`portfolio/${_stopPositionId}/stop`, { stop_price: newStop });
    closeModal('stop-modal');
    if (result && result.status === 'updated') {
        showToast(`Stop actualizado a €${newStop.toFixed(2)}`, 'success');
        loadAll();
    } else {
        showToast('Error al actualizar stop.', 'error');
    }
}

async function deletePosition(positionId, symbol) {
    if (!confirm(`¿Eliminar la posición de ${symbol}? (Se devuelve el capital invertido)`)) return;
    const result = await apiDelete(`portfolio/${positionId}`);
    if (result && result.status === 'deleted') {
        showToast(`${symbol} eliminado.`, 'success');
        loadAll();
    } else {
        showToast('Error al eliminar.', 'error');
    }
}

function openCapitalModal() {
    const cashEl = document.getElementById('stat-cash');
    const current = cashEl ? cashEl.textContent : '€0.00';
    setText('capital-current', current);
    document.getElementById('capital-new').value = parseFloat(current.replace(/[^0-9.-]/g, '')) || 0;
    document.getElementById('capital-modal').style.display = 'flex';
}

async function executeCapitalChange() {
    const newCash = parseFloat(document.getElementById('capital-new').value);
    const result = await apiPost('settings/capital', { cash: newCash });
    closeModal('capital-modal');
    if (result && result.status === 'updated') {
        showToast(`Capital actualizado a ${formatCurrency(newCash)}`, 'success');
        loadAll();
    } else {
        showToast('Error al actualizar capital.', 'error');
    }
}

function closeModal(id) {
    document.getElementById(id).style.display = 'none';
}

// ── Utilities ───────────────────────────────────────────────

function setText(id, value) {
    const el = document.getElementById(id);
    if (el) el.textContent = value;
}

function formatCurrency(value) {
    if (value === null || value === undefined) return '$0.00';
    const sign = value < 0 ? '-' : '';
    const abs = Math.abs(value);
    return `${sign}$${abs.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

function formatEUR(value) {
    if (value === null || value === undefined) return '€0.00';
    const sign = value < 0 ? '-' : '';
    const abs = Math.abs(value);
    return `${sign}€${abs.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

function pnlClass(value) {
    if (value > 0) return 'positive';
    if (value < 0) return 'negative';
    return 'neutral';
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
    const data = await apiGet('equity');
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
    const lastVal = equityValues[equityValues.length - 1];
    const isPositive = lastVal >= initialCapital;

    if (equityChart) equityChart.destroy();

    const ctx = canvas.getContext('2d');
    const gradient = ctx.createLinearGradient(0, 0, 0, canvas.height * 2);
    gradient.addColorStop(0, isPositive ? 'rgba(63, 185, 80, 0.3)' : 'rgba(248, 81, 73, 0.3)');
    gradient.addColorStop(1, 'rgba(0, 0, 0, 0)');

    equityChart = new Chart(ctx, {
        type: 'line',
        data: {
            labels,
            datasets: [{
                label: 'Equity', data: equityValues,
                borderColor: isPositive ? '#3fb950' : '#f85149',
                backgroundColor: gradient, borderWidth: 2, fill: true, tension: 0.3,
                pointRadius: data.length > 30 ? 0 : 3, pointHoverRadius: 5,
            }]
        },
        options: {
            responsive: true, maintainAspectRatio: false,
            interaction: { intersect: false, mode: 'index' },
            plugins: {
                legend: { display: false },
                tooltip: { callbacks: { label: ctx => {
                    const val = ctx.raw;
                    const ret = ((val / initialCapital - 1) * 100).toFixed(2);
                    return `$${val.toLocaleString('en-US', {minimumFractionDigits: 2})} (${ret >= 0 ? '+' : ''}${ret}%)`;
                }}}
            },
            scales: {
                x: { grid: { color: 'rgba(48,54,61,0.5)' }, ticks: { color: '#8b949e', maxTicksLimit: 10, font: { size: 10 } } },
                y: { grid: { color: 'rgba(48,54,61,0.5)' }, ticks: { color: '#8b949e', callback: v => '$' + v.toLocaleString(), font: { size: 10 } } }
            }
        }
    });
}

// ── Analytics Chart ────────────────────────────────────────

let analyticsChart = null;

async function loadAnalytics() {
    const data = await apiGet('analytics');
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

    let mfeSum = 0, maeSum = 0, hits = 0;
    const setupStats = {};

    data.forEach(d => {
        mfeSum += d.mfe_pct;
        maeSum += d.mae_pct;
        if (d.mfe_pct >= 0.10) hits++;
        if (!setupStats[d.setup_type]) setupStats[d.setup_type] = { count: 0, hits: 0 };
        setupStats[d.setup_type].count++;
        if (d.mfe_pct >= 0.10) setupStats[d.setup_type].hits++;
    });

    setText('stat-mfe-avg', `+${(mfeSum / data.length * 100).toFixed(2)}%`);
    setText('stat-mae-avg', `${(maeSum / data.length * 100).toFixed(2)}%`);
    setText('stat-hit-rate', `${(hits / data.length * 100).toFixed(1)}%`);

    const labels = Object.keys(setupStats);
    const chartData = labels.map(l => (setupStats[l].hits / setupStats[l].count) * 100);

    if (analyticsChart) analyticsChart.destroy();

    analyticsChart = new Chart(canvas.getContext('2d'), {
        type: 'bar',
        data: {
            labels: labels.map(l => l.toUpperCase()),
            datasets: [{ label: 'Hit Rate (>10% MFE)', data: chartData, backgroundColor: 'rgba(63, 185, 80, 0.8)', borderRadius: 4 }]
        },
        options: {
            responsive: true, maintainAspectRatio: false,
            plugins: { legend: { display: false }, tooltip: { callbacks: { label: ctx => ctx.raw.toFixed(1) + '%' } } },
            scales: {
                y: { beginAtZero: true, max: 100, grid: { color: 'rgba(48,54,61,0.5)' }, ticks: { color: '#8b949e', font: { size: 10 }, callback: v => v + '%' } },
                x: { grid: { display: false }, ticks: { color: '#8b949e', font: { size: 11, weight: 'bold' } } }
            }
        }
    });
}

// ── Watchlist ───────────────────────────────────────────────

async function loadWatchlist() {
    const items = await apiGet('watchlist');
    const body = document.getElementById('watchlist-body');
    const countEl = document.getElementById('watchlist-count');
    if (!body) return;

    if (!items || items.length === 0) {
        body.innerHTML = '<div class="empty-state">Sin simbolos en watchlist</div>';
        if (countEl) countEl.textContent = '0';
        return;
    }

    if (countEl) countEl.textContent = items.length;

    body.innerHTML = items.map(item => `
        <div style="display:flex;justify-content:space-between;align-items:center;padding:8px 12px;background:var(--bg-card-hover);border-radius:var(--radius-sm);margin-bottom:4px;">
            <div>
                <span style="font-weight:bold;cursor:pointer;text-decoration:underline;" onclick="openChartModal('${item.symbol}','breakout')">${item.symbol}</span>
                ${item.notes ? `<span style="margin-left:8px;color:var(--text-muted);font-size:11px;">${item.notes}</span>` : ''}
            </div>
            <div style="display:flex;gap:6px;align-items:center;">
                <span style="font-size:11px;color:var(--text-muted);">${item.added_date ? item.added_date.split('T')[0] : ''}</span>
                ${IS_LOCAL ? `<button class="btn-action" style="padding:2px 8px;font-size:11px;border-color:var(--negative);color:var(--negative);" onclick="removeFromWatchlist('${item.symbol}')">X</button>` : ''}
            </div>
        </div>
    `).join('');
}

async function addToWatchlist(symbol, notes) {
    const res = await apiPost('watchlist', { symbol, notes: notes || '' });
    if (res && res.status === 'added') {
        showToast(`${symbol} agregado a watchlist`, 'success');
        loadWatchlist();
    } else {
        showToast('Error al agregar a watchlist', 'error');
    }
}

async function removeFromWatchlist(symbol) {
    const res = await apiDelete(`watchlist/${symbol}`);
    if (res && res.status === 'removed') {
        showToast(`${symbol} eliminado de watchlist`, 'info');
        loadWatchlist();
    }
}

// ── Notifications ──────────────────────────────────────────

async function loadNotifications() {
    const items = await apiGet('notifications');
    const body = document.getElementById('notifications-body');
    const countEl = document.getElementById('notif-count');
    if (!body) return;

    if (!items || items.length === 0) {
        body.innerHTML = '<div class="empty-state">Sin notificaciones</div>';
        if (countEl) countEl.textContent = '0';
        return;
    }

    if (countEl) countEl.textContent = items.length;

    body.innerHTML = items.map(n => {
        const typeIcon = {
            'signal': '', 'stop': '', 'action': '', 'scan': '', 'error': ''
        };
        const icon = typeIcon[n.notif_type] || '';
        return `
            <div style="padding:8px 12px;border-bottom:1px solid var(--border);font-size:12px;">
                <div style="display:flex;justify-content:space-between;">
                    <span style="font-weight:600;">${icon} ${n.subject}</span>
                    <span style="color:var(--text-dim);font-size:10px;">${n.ts ? n.ts.split('T')[0] : ''}</span>
                </div>
                ${n.body_preview ? `<div style="color:var(--text-muted);margin-top:2px;">${n.body_preview.substring(0, 120)}</div>` : ''}
            </div>
        `;
    }).join('');
}

// ── Batch AI Analysis ───────────────────────────────────────

let _batchAborted = false;

async function batchAnalyzeSignals() {
    // Collect READY signal groups, sorted best first (same composite as loadSignals)
    const readyGroups = Object.entries(_signalGroups)
        .filter(([, sigs]) => sigs.some(s => s.status === 'ready'))
        .map(([symbol, sigs]) => {
            const bestScore = Math.max(...sigs.map(s => s.score || 0));
            const isMulti = sigs.length > 1;
            return { symbol, sigs, bestScore, isMulti };
        })
        .sort((a, b) => {
            const ca = a.bestScore + (a.isMulti ? 0.3 : 0);
            const cb = b.bestScore + (b.isMulti ? 0.3 : 0);
            return cb - ca;
        });

    if (readyGroups.length === 0) {
        alert('No hay señales READY para analizar. Ejecuta un escaneo primero.');
        return;
    }

    _batchAborted = false;

    const modal   = document.getElementById('batch-modal');
    const progDiv = document.getElementById('batch-progress');
    const bar     = document.getElementById('batch-progress-bar');
    const statusEl = document.getElementById('batch-status');
    const resDiv  = document.getElementById('batch-results');
    const abortBtn = document.getElementById('batch-abort-btn');
    const closeBtn = document.getElementById('batch-close-btn');

    modal.style.display = 'flex';
    progDiv.style.display = 'block';
    resDiv.style.display = 'none';
    abortBtn.style.display = 'inline-block';
    closeBtn.style.display = 'none';
    bar.style.width = '0%';

    const results = [];
    const total = readyGroups.length;

    for (let i = 0; i < total; i++) {
        if (_batchAborted) {
            statusEl.textContent = `Cancelado tras ${i} análisis.`;
            break;
        }

        const { symbol, sigs, bestScore } = readyGroups[i];
        const setupTypes = sigs.map(s => s.setup_type);

        statusEl.textContent = `Analizando ${symbol}… (${i + 1}/${total})`;
        bar.style.width = `${Math.round((i / total) * 100)}%`;

        try {
            const res = await fetch('/api/copilot/analyze', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ symbol, setup_types: setupTypes })
            });
            if (!res.ok) throw new Error(`HTTP ${res.status}`);
            const data = await res.json();
            results.push({ symbol, setupTypes, bestScore, ...data });
        } catch (err) {
            results.push({ symbol, setupTypes, bestScore, decision: 'ERROR', confianza: '0%', resumen: `Error: ${err.message}` });
        }
    }

    bar.style.width = '100%';
    abortBtn.style.display = 'none';
    closeBtn.style.display = 'inline-block';
    progDiv.style.display = 'none';
    resDiv.style.display = 'block';

    _renderBatchReport(results, total);
}

function _renderBatchReport(results, total) {
    const comprar   = results.filter(r => (r.decision || '').toUpperCase() === 'INVERTIR' && parseInt((r.confianza || '0').replace('%', '')) > 0);
    const descartar = results.filter(r => (r.decision || '').toUpperCase() === 'NO INVERTIR' || r.decision === 'ERROR');
    const esperar   = results.filter(r => !comprar.includes(r) && !descartar.includes(r));

    const renderGroup = (title, color, border, items, showBuyBtn = false) => {
        if (!items.length) return '';
        return `
            <div style="margin-bottom:18px;">
                <div style="font-weight:700;color:${color};margin-bottom:8px;font-size:12px;text-transform:uppercase;letter-spacing:.05em;">${title} — ${items.length}</div>
                ${items.map(r => {
                    const conf = r.confianza || '0%';
                    const score = (r.bestScore * 100).toFixed(0);
                    const setups = (r.setupTypes || []).map(s => s.toUpperCase()).join(' + ');
                    const primarySetup = (r.setupTypes || [])[0] || 'breakout';
                    return `
                        <div onclick="closeModal('batch-modal');openChartModal('${r.symbol}')"
                             style="padding:10px 12px;background:rgba(0,0,0,0.25);border-left:3px solid ${border};
                                    border-radius:4px;margin-bottom:6px;cursor:pointer;transition:background .15s;"
                             onmouseover="this.style.background='rgba(255,255,255,0.05)'"
                             onmouseout="this.style.background='rgba(0,0,0,0.25)'">
                            <div style="display:flex;justify-content:space-between;align-items:center;">
                                <strong style="color:#e2e8f0;font-size:14px;">${r.symbol}</strong>
                                <div style="display:flex;gap:8px;align-items:center;">
                                    <span style="font-size:12px;color:${color};font-weight:600;">${conf}</span>
                                    ${showBuyBtn ? `
                                        <button onclick="event.stopPropagation(); buyFromBatch('${r.symbol}','${primarySetup}')"
                                            style="padding:3px 10px;background:rgba(16,185,129,0.2);border:1px solid #10b981;
                                                   border-radius:4px;color:#4ade80;cursor:pointer;font-weight:bold;font-size:11px;white-space:nowrap;">
                                            💰 Comprar
                                        </button>` : ''}
                                </div>
                            </div>
                            <div style="font-size:11px;color:var(--text-muted);margin-top:2px;">${setups} · Score ${score}%</div>
                            ${r.resumen ? `<div style="font-size:11px;color:#94a3b8;margin-top:4px;font-style:italic;">${r.resumen}</div>` : ''}
                        </div>`;
                }).join('')}
            </div>`;
    };

    document.getElementById('batch-results').innerHTML = `
        <div style="font-size:11px;color:var(--text-dim);margin-bottom:14px;">
            ${results.length} de ${total} señales READY analizadas
        </div>
        ${renderGroup('🟢 Comprar', '#4ade80', '#22c55e', comprar, true)}
        ${renderGroup('🟡 Esperar', '#facc15', '#eab308', esperar)}
        ${renderGroup('🔴 Descartar', '#f87171', '#ef4444', descartar)}
    `;
}

async function buyFromBatch(symbol, setupType) {
    showToast(`Calculando sizing para ${symbol}...`, 'info');
    const sizing = await apiGet(`sizing/${symbol}?setup_type=${setupType}&score=0.8`);
    if (!sizing || sizing.error) {
        showToast(sizing?.error || `Error calculando sizing para ${symbol}`, 'error');
        return;
    }
    showSizingModal(symbol, setupType, sizing);
}

function abortBatchAnalysis() {
    _batchAborted = true;
}
