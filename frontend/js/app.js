/**
 * app.js — Main application controller.
 */

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
        if (activeView === 'history') {
            HistoryUI.init();
        } else if (activeView === 'recommendation') {
            RecommendationUI.init();
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
                const problemTitle = problemMap[problemId] || `Problem ${problemId}`;
                html += `<div class="px-2.5 py-1.5 text-2xs font-semibold text-text-3 uppercase tracking-widest border-b border-border-0">${this._esc(problemTitle)}</div>`;

                for (const s of problemSessions) {
                    const isActive = s.session_id === this._currentSessionId;
                    const statusColor = this._statusColor(s.status);
                    const langColor = { python: '#3572A5', cpp: '#f34b7d', java: '#b07219' }[s.language] || '#6b7385';
                    html += `
                        <div class="sess-item ${isActive ? 'active' : ''}" data-session-id="${s.session_id}" onclick="App.openSession(${s.session_id})">
                            <span class="lang-dot" style="background:${langColor}"></span>
                            <div class="flex-1 min-w-0">
                                <div class="sess-title">${this._esc(s.submission_label)}</div>
                                <div class="sess-meta">${s.language} &middot; ${this._fmtDate(s.created_at)}</div>
                            </div>
                            <span class="sess-dot" style="background:${statusColor}" title="${s.status}"></span>
                        </div>`;
                }
            }
            sessionList.innerHTML = html + (emptyState ? emptyState.outerHTML : '');
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
            el.classList.toggle('active', parseInt(el.dataset.sessionId) === sessionId);
        });
    },

    async filterSessions(value) {
        await this.refreshSidebar();
    },

    switchBottomTab(name) {
        document.querySelectorAll('.btm-tab').forEach(t => t.classList.toggle('active', t.dataset.panel === name));
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
        return { pending:'#6b7385', generating_tests:'#fbbf24', executing:'#fbbf24', analyzing:'#fbbf24', complete:'#4ade80', failed:'#f87171', dry_run_failed:'#f87171' }[s] || '#6b7385';
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

