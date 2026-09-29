/**
 * app.js — Main application controller & Toast notification system.
 */

const Toast = {
    container: null,
    _ensureContainer() {
        if (!this.container) {
            this.container = document.getElementById('toast-container');
            if (!this.container) {
                this.container = document.createElement('div');
                this.container.id = 'toast-container';
                this.container.className = 'toast-container';
                document.body.appendChild(this.container);
            }
        }
        return this.container;
    },
    show(message, type = 'info', duration = 3500) {
        const container = this._ensureContainer();
        const toast = document.createElement('div');
        toast.className = `toast toast-${type}`;
        
        const icons = {
            success: '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><path d="M9 12l2 2 4-4"/></svg>',
            error: '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><circle cx="12" cy="12" r="10"/><line x1="15" y1="9" x2="9" y2="15"/><line x1="9" y1="9" x2="15" y2="15"/></svg>',
            warning: '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z"/><line x1="12" y1="9" x2="12" y2="13"/><line x1="12" y1="17" x2="12.01" y2="17"/></svg>',
            info: '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><circle cx="12" cy="12" r="10"/><line x1="12" y1="16" x2="12" y2="12"/><line x1="12" y1="8" x2="12.01" y2="8"/></svg>',
        };
        
        toast.innerHTML = `
            <span class="toast-icon">${icons[type] || icons.info}</span>
            <span class="toast-msg">${this._escape(message)}</span>
            <button class="toast-close" onclick="this.parentElement.remove()">&times;</button>
        `;
        container.appendChild(toast);
        
        setTimeout(() => {
            toast.classList.add('toast-fadeout');
            setTimeout(() => toast.remove(), 350);
        }, duration);
    },
    success(msg, dur) { this.show(msg, 'success', dur); },
    error(msg, dur) { this.show(msg, 'error', dur); },
    warning(msg, dur) { this.show(msg, 'warning', dur); },
    info(msg, dur) { this.show(msg, 'info', dur); },
    _escape(s) {
        if (!s) return '';
        const d = document.createElement('div');
        d.textContent = s;
        return d.innerHTML;
    }
};

const App = {
    _currentSessionId: null,

    async init() {
        console.log('[APP] init');
        try {
            await MonacoSetup.init('editor-container', 'python');
        } catch (e) {
            console.error('[APP] Monaco failed:', e);
        }
        await this.refreshSidebar();
        await this._loadProblemDropdowns();
        
        // Handle hash navigation
        window.addEventListener('hashchange', () => this._handleRoute());
        this._handleRoute();
    },

    switchView(viewName) {
        window.location.hash = viewName;
    },

    _handleRoute() {
        const hash = (window.location.hash || '#home').replace('#', '');
        const validViews = ['home', 'recommendation', 'evaluation', 'history', 'about'];
        const activeView = validViews.includes(hash) ? hash : 'home';

        // Update nav item active states
        document.querySelectorAll('.nav-link').forEach(link => {
            const view = link.dataset.view;
            link.classList.toggle('active-nav', view === activeView);
        });

        // Hide all views, show active view
        validViews.forEach(v => {
            const el = document.getElementById(`view-${v}`);
            if (el) {
                el.classList.toggle('hidden', v !== activeView);
            }
        });

        // Trigger view initializations
        if (activeView === 'home' || activeView === 'about') {
            this.loadStats();
        } else if (activeView === 'history') {
            HistoryUI.init();
        } else if (activeView === 'recommendation') {
            RecommendationUI.init();
        } else if (activeView === 'evaluation') {
            this._loadEvaluationView();
        }
    },

    async loadStats() {
        try {
            const stats = await ApiClient.getPlatformStats();
            const statEls = {
                'stat-problems': stats.total_problems,
                'stat-sessions': stats.total_sessions,
                'stat-recommendations': stats.total_recommendations,
                'stat-score': `${stats.average_score}/100`,
            };
            for (const [id, val] of Object.entries(statEls)) {
                const el = document.getElementById(id);
                if (el) el.textContent = val;
            }
        } catch (e) {
            console.error('[APP] Error loading stats:', e);
        }
    },

    async _loadEvaluationView() {
        if (this._currentSessionId) {
            await SessionView.loadSession(this._currentSessionId);
        } else {
            try {
                const sessions = await ApiClient.getSessions();
                if (sessions && sessions.length > 0) {
                    await this.openSession(sessions[0].session_id);
                }
            } catch (e) {
                console.error('[APP] Error auto-loading evaluation session:', e);
            }
        }
    },

    async refreshSidebar() {
        try {
            const sessions = await ApiClient.getSessions();
            const problems = await ApiClient.getProblems();
            const sessionList = document.getElementById('session-list');
            const emptyState = document.getElementById('session-list-empty');

            if (!sessions || sessions.length === 0) {
                if (emptyState) emptyState.classList.remove('hidden');
                return;
            }
            if (emptyState) emptyState.classList.add('hidden');

            const problemMap = {};
            for (const p of problems) problemMap[p.problem_id] = p.title;

            const grouped = {};
            for (const s of sessions) {
                const pid = s.problem_id;
                if (!grouped[pid]) grouped[pid] = [];
                grouped[pid].push(s);
            }

            let html = '';
            for (const [problemId, problemSessions] of Object.entries(grouped)) {
                // Apply problem filter
                if (this._filterProblemId && this._filterProblemId !== 'all' && String(problemId) !== String(this._filterProblemId)) continue;
                const problemTitle = problemMap[problemId] || `Problem ${problemId}`;
                html += `<div class="px-3 py-2 text-[11px] font-semibold text-text-tertiary uppercase tracking-wider border-b border-border-subtle font-mono">${this._esc(problemTitle)}</div>`;

                for (const s of problemSessions) {
                    const isActive = s.session_id === this._currentSessionId;
                    const langTag = { python: '[PY]', cpp: '[CPP]', java: '[JAVA]' }[s.language.toLowerCase()] || `[${s.language.substring(0,3).toUpperCase()}]`;
                    const statusTag = { complete: '✓ DONE', failed: '✗ FAIL', dry_run_failed: '✗ ERR', draft: '• READY' }[s.status] || '⋯ RUN';
                    const statusCls = s.status === 'complete' ? 'text-success' : (s.status.includes('failed') ? 'text-danger' : (s.status === 'draft' ? 'text-text-tertiary' : 'text-warning'));

                    html += `
                        <div class="sess-item ${isActive ? 'active' : ''}" data-session-id="${s.session_id}" onclick="App.openSession(${s.session_id})">
                            <div class="flex-1 min-w-0">
                                <div class="sess-title font-mono"><span class="text-text-tertiary text-2xs mr-1">${langTag}</span>${this._esc(s.submission_label)}</div>
                                <div class="sess-meta font-mono">${this._fmtDate(s.created_at)}</div>
                            </div>
                            <span class="font-mono text-2xs font-semibold ${statusCls}">${statusTag}</span>
                        </div>`;
                }
            }
            sessionList.innerHTML = html;
            this._updateProblemFilter(problems);
        } catch (e) {
            console.error('[APP] sidebar error:', e);
        }
    },

    async openSession(sessionId) {
        this.switchView('evaluation');
        this._currentSessionId = sessionId;
        await SessionView.loadSession(sessionId);
        document.querySelectorAll('.sess-item').forEach(el => {
            el.classList.toggle('active', parseInt(el.dataset.sessionId, 10) === sessionId);
        });
    },

    _filterProblemId: 'all',

    async filterSessions(value) {
        this._filterProblemId = value;
        await this.refreshSidebar();
    },

    switchBottomTab(name) {
        // Handle both old `.btm-tab` and new `.eval-btm-tab` selectors
        document.querySelectorAll('.btm-tab, .eval-btm-tab').forEach(t => t.classList.toggle('active', t.dataset.panel === name));
        document.querySelectorAll('.btm-content').forEach(p => {
            p.classList.toggle('active', p.id === `panel-${name}`);
            p.classList.toggle('hidden', p.id !== `panel-${name}`);
        });
    },

    async showLeaderboard() {
        document.getElementById('leaderboard-modal').classList.remove('hidden');
        try {
            const problems = await ApiClient.getProblems();
            const sel = document.getElementById('leaderboard-problem-select');
            sel.innerHTML = '<option value="">Select a problem</option>';
            for (const p of problems) {
                const o = document.createElement('option');
                o.value = p.problem_id;
                o.textContent = `${p.title} (${p.session_count || 0})`;
                sel.appendChild(o);
            }
        } catch (e) { console.error(e); }
    },

    closeLeaderboard() {
        document.getElementById('leaderboard-modal').classList.add('hidden');
    },

    // -- helpers --
    async _loadProblemDropdowns() {
        try {
            const problems = await ApiClient.getProblems();
            this._updateProblemFilter(problems);
        } catch (e) {}
    },

    _updateProblemFilter(problems) {
        const sel = document.getElementById('sidebar-problem-filter');
        if (!sel) return;
        sel.innerHTML = '<option value="all">All Problems</option>';
        for (const p of problems) {
            const o = document.createElement('option');
            o.value = p.problem_id;
            o.textContent = p.title;
            sel.appendChild(o);
        }
    },

    _statusColor(s) {
        return { draft: '#6a6a62', pending:'#6b7385', generating_tests:'#d4a574', executing:'#d4a574', analyzing:'#d4a574', complete:'#7fb069', failed:'#c97b6b', dry_run_failed:'#c97b6b' }[s] || '#6b7385';
    },

    _fmtDate(iso) {
        if (!iso) return '';
        return new Date(iso).toLocaleDateString('en-US', { month:'short', day:'numeric' });
    },

    _esc(s) {
        if (!s) return '';
        const d = document.createElement('div');
        d.textContent = s;
        return d.innerHTML;
    },
};

document.addEventListener('DOMContentLoaded', () => App.init());

