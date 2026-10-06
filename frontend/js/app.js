/**
 * app.js — Main application controller, LeetCode navigation & Toast notification system.
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

        while (container.children.length > 5) {
            container.firstElementChild.remove();
        }

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
    _problems: [],
    _currentProblemIndex: 0,
    _filterProblemId: 'all',
    _lastFocus: null,
    _timerSeconds: 0,
    _timerInterval: null,
    _timerRunning: false,

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

        // Dismiss modals with Escape / overlay click, and reset panels on resize
        this._initDismissals();
        window.addEventListener('resize', () => {
            if (window.innerWidth >= 768) this.closeMobileNav();
            if (window.innerWidth >= 1024) document.body.classList.remove('sidebar-open');
            if (window.innerWidth >= 1280) document.body.classList.remove('desc-open');
        });

        this.startTimer();
    },

    // ── Timer in top navigation (LeetCode style) ──
    startTimer() {
        if (this._timerInterval) clearInterval(this._timerInterval);
        this._timerRunning = true;
        this._timerInterval = setInterval(() => {
            if (!this._timerRunning) return;
            this._timerSeconds++;
            this._updateTimerDisplay();
        }, 1000);
    },

    toggleTimer() {
        this._timerRunning = !this._timerRunning;
        const icon = document.getElementById('timer-icon');
        if (icon) {
            icon.textContent = this._timerRunning ? '⏸' : '▶';
        }
    },

    resetTimer() {
        this._timerSeconds = 0;
        this._updateTimerDisplay();
    },

    _updateTimerDisplay() {
        const el = document.getElementById('session-timer-text');
        if (!el) return;
        const mins = Math.floor(this._timerSeconds / 60);
        const secs = this._timerSeconds % 60;
        el.textContent = `${String(mins).padStart(2, '0')}:${String(secs).padStart(2, '0')}`;
    },

    switchView(viewName) {
        window.location.hash = viewName;
    },

    _handleRoute() {
        const hash = (window.location.hash || '#home').replace('#', '');
        const validViews = ['home', 'recommendation', 'evaluation', 'history', 'about'];
        const activeView = validViews.includes(hash) ? hash : 'home';

        // Update nav item active states (desktop + mobile)
        document.querySelectorAll('.nav-link').forEach(link => {
            const view = link.dataset.view;
            const isActive = view === activeView;
            link.classList.toggle('active-nav', isActive);
            if (isActive) link.setAttribute('aria-current', 'page');
            else link.removeAttribute('aria-current');
        });

        // Hide all views, show active view
        validViews.forEach(v => {
            const el = document.getElementById(`view-${v}`);
            if (el) {
                el.classList.toggle('hidden', v !== activeView);
            }
        });

        // Reveal the active view with transition
        const activeEl = document.getElementById(`view-${activeView}`);
        if (activeEl) {
            activeEl.classList.remove('view-enter-active');
            void activeEl.offsetWidth;
            activeEl.classList.add('view-enter-active');
        }

        // Document title + close transient UI
        const titles = { home: 'Home', recommendation: 'Recommend', evaluation: 'Evaluate', history: 'History', about: 'About' };
        document.title = titles[activeView] ? `${titles[activeView]} · Verdict` : 'Verdict';
        this.closeMobileNav();
        this.closeDrawers();

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
        const sessionList = document.getElementById('session-list');
        if (!sessionList) return;

        sessionList.innerHTML = `
            <div class="p-3 space-y-3" aria-hidden="true">
                <div class="skeleton h-12"></div>
                <div class="skeleton h-12"></div>
                <div class="skeleton h-12"></div>
            </div>`;

        try {
            const sessions = await ApiClient.getSessions();
            const problems = await ApiClient.getProblems();
            this._problems = problems || [];

            const emptyMarkup = `
                <div id="session-list-empty" class="flex flex-col items-center justify-center h-full px-6 py-12">
                    <div class="empty-state-icon">
                        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" class="text-text-tertiary"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/></svg>
                    </div>
                    <p class="text-text-secondary text-[14px] font-medium mb-1">No sessions yet</p>
                    <p class="text-text-tertiary text-[12px] text-center">Create a session to begin.</p>
                </div>`;

            if (!sessions || sessions.length === 0) {
                sessionList.innerHTML = emptyMarkup;
                this._updateProblemFilter([]);
                return;
            }

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
                if (this._filterProblemId && this._filterProblemId !== 'all' && String(problemId) !== String(this._filterProblemId)) continue;
                const problemTitle = problemMap[problemId] || `Problem ${problemId}`;
                html += `<div class="px-3 py-2 text-[11px] font-semibold text-text-tertiary uppercase tracking-wider border-b border-border-subtle font-mono">${this._esc(problemTitle)}</div>`;

                for (const s of problemSessions) {
                    const isActive = s.session_id === this._currentSessionId;
                    const langTag = { python: '[PY]', cpp: '[CPP]', java: '[JAVA]', javascript: '[JS]' }[s.language.toLowerCase()] || `[${s.language.substring(0,3).toUpperCase()}]`;
                    const statusTag = { complete: '✓ DONE', failed: '✗ FAIL', dry_run_failed: '✗ ERR', draft: '• READY' }[s.status] || '⋯ RUN';
                    const statusCls = s.status === 'complete' ? 'text-success' : (s.status.includes('failed') ? 'text-danger' : (s.status === 'draft' ? 'text-text-tertiary' : 'text-warning'));

                    html += `
                        <div class="sess-item group ${isActive ? 'active' : ''}" data-session-id="${s.session_id}" role="button" tabindex="0" aria-label="Open session ${this._esc(s.submission_label)}" onclick="App.openSession(${s.session_id})" onkeydown="if(event.key==='Enter'||event.key===' '){event.preventDefault();App.openSession(${s.session_id})}">
                            <div class="flex-1 min-w-0">
                                <div class="sess-title font-mono"><span class="text-text-tertiary text-2xs mr-1">${langTag}</span>${this._esc(s.submission_label)}</div>
                                <div class="sess-meta font-mono">${this._fmtDate(s.created_at)}</div>
                            </div>
                            <div class="flex items-center gap-1.5">
                                <span class="font-mono text-2xs font-semibold ${statusCls}">${statusTag}</span>
                                <button class="sess-delete-btn" onclick="App.deleteSession(${s.session_id}, event)" title="Delete session" aria-label="Delete session">&times;</button>
                            </div>
                        </div>`;
                }
            }
            sessionList.innerHTML = html || `
                <div class="flex flex-col items-center justify-center px-6 py-12 text-center">
                    <p class="text-text-secondary text-[13px] font-medium mb-1">No matching sessions</p>
                    <p class="text-text-tertiary text-[12px]">Try a different problem filter.</p>
                </div>`;
            this._updateProblemFilter(problems);
        } catch (e) {
            console.error('[APP] sidebar error:', e);
            sessionList.innerHTML = `
                <div class="flex flex-col items-center justify-center px-6 py-12 text-center gap-3">
                    <p class="text-danger text-[13px]">Couldn't load sessions.</p>
                    <button class="cmd-btn cmd-secondary text-[12px] !h-8" onclick="App.refreshSidebar()">Retry</button>
                </div>`;
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

    async deleteSession(sessionId, event) {
        if (event) event.stopPropagation();
        if (!confirm('Are you sure you want to delete this evaluation session?')) return;
        try {
            await ApiClient.deleteSession(sessionId);
            if (typeof Toast !== 'undefined') Toast.info('Session deleted.');
            if (this._currentSessionId === sessionId) {
                this._currentSessionId = null;
            }
            await this.refreshSidebar();
            if (!this._currentSessionId) {
                const sessions = await ApiClient.getSessions();
                if (sessions && sessions.length > 0) {
                    await this.openSession(sessions[0].session_id);
                } else {
                    SessionView._renderEmptyProblem();
                }
            }
        } catch (err) {
            console.error('[APP] deleteSession error:', err);
            if (typeof Toast !== 'undefined') Toast.error(`Delete failed: ${err.message}`);
        }
    },

    async filterSessions(value) {
        this._filterProblemId = value;
        await this.refreshSidebar();
    },

    // ── LeetCode Problem Navigation: Prev / Next / Random ──
    async prevProblem() {
        if (!this._problems || this._problems.length === 0) return;
        this._currentProblemIndex = (this._currentProblemIndex - 1 + this._problems.length) % this._problems.length;
        await this._switchToProblemIndex(this._currentProblemIndex);
    },

    async nextProblem() {
        if (!this._problems || this._problems.length === 0) return;
        this._currentProblemIndex = (this._currentProblemIndex + 1) % this._problems.length;
        await this._switchToProblemIndex(this._currentProblemIndex);
    },

    async randomProblem() {
        if (!this._problems || this._problems.length === 0) return;
        this._currentProblemIndex = Math.floor(Math.random() * this._problems.length);
        await this._switchToProblemIndex(this._currentProblemIndex);
    },

    async _switchToProblemIndex(index) {
        const problem = this._problems[index];
        if (!problem) return;
        try {
            const sessions = await ApiClient.getSessions();
            const matching = sessions.find(s => s.problem_id === problem.problem_id);
            if (matching) {
                await this.openSession(matching.session_id);
            } else {
                // Auto create a session for this problem
                const newSess = await ApiClient.createSession({
                    problem_id: problem.problem_id,
                    language: 'python',
                    submission_label: `${problem.title} (Draft)`
                });
                await this.refreshSidebar();
                await this.openSession(newSess.session_id);
            }
            if (typeof Toast !== 'undefined') Toast.info(`Switched to: ${problem.title}`);
        } catch (e) {
            console.error('[APP] Problem switch failed:', e);
        }
    },

    // ── Problem Catalog Modal ──
    _problemCatalogDiff: 'all',

    async openProblemList() {
        this._rememberFocus();
        const modal = document.getElementById('problem-list-modal');
        if (modal) modal.classList.remove('hidden');
        this._focusModal('problem-list-modal');
        await this._renderProblemCatalog();
    },

    closeProblemList() {
        const modal = document.getElementById('problem-list-modal');
        if (modal) modal.classList.add('hidden');
        this._restoreFocus();
    },

    setProblemCatalogDiff(diff) {
        this._problemCatalogDiff = diff;
        document.querySelectorAll('#problem-diff-filters .lc-chip').forEach(b => {
            b.classList.toggle('active', b.dataset.diff === diff);
        });
        this._renderProblemCatalog();
    },

    filterProblemCatalog() {
        this._renderProblemCatalog();
    },

    async _renderProblemCatalog() {
        const listEl = document.getElementById('problem-catalog-list');
        if (!listEl) return;

        try {
            if (!this._problems || this._problems.length === 0) {
                this._problems = await ApiClient.getProblems() || [];
            }

            const searchInput = document.getElementById('problem-catalog-search');
            const search = (searchInput && searchInput.value ? searchInput.value : '').toLowerCase();
            const diff = this._problemCatalogDiff || 'all';

            const filtered = this._problems.filter(p => {
                const matchesSearch = !search || p.title.toLowerCase().includes(search) || (p.category && p.category.toLowerCase().includes(search)) || (p.description && p.description.toLowerCase().includes(search));
                const matchesDiff = diff === 'all' || String(p.difficulty || 'medium').toLowerCase() === diff;
                return matchesSearch && matchesDiff;
            });

            if (filtered.length === 0) {
                listEl.innerHTML = `
                    <div class="py-12 text-center text-text-tertiary text-xs">
                        No problems match your query. Try a different search term or filter.
                    </div>`;
                return;
            }

            let html = '';
            for (const p of filtered) {
                const diffLower = String(p.difficulty || 'medium').toLowerCase();
                const diffCls = diffLower === 'easy' ? 'lc-diff-easy' : (diffLower === 'hard' ? 'lc-diff-hard' : 'lc-diff-medium');
                const category = p.category || 'Algorithms';

                html += `
                    <div class="bg-[#282828] p-3.5 rounded-lg border border-white/5 flex items-center justify-between hover:border-white/20 transition-all">
                        <div class="flex items-center gap-3">
                            <span class="font-mono text-xs text-text-tertiary w-6">${p.problem_id}.</span>
                            <div>
                                <div class="font-semibold text-white text-[13.5px] hover:text-[#2cbb5d] cursor-pointer transition-colors" onclick="App.selectProblemFromCatalog(${p.problem_id})">
                                    ${this._esc(p.title)}
                                </div>
                                <div class="flex items-center gap-2 mt-1">
                                    <span class="lc-diff ${diffCls}">${diffLower.toUpperCase()}</span>
                                    <span class="text-2xs font-mono text-text-tertiary bg-white/5 px-2 py-0.5 rounded">${this._esc(category)}</span>
                                </div>
                            </div>
                        </div>
                        <button class="lc-run-btn !h-7 !px-3 text-xs" onclick="App.selectProblemFromCatalog(${p.problem_id})">
                            Solve →
                        </button>
                    </div>`;
            }
            listEl.innerHTML = html;
        } catch (e) {
            console.error('[APP] Error loading problem catalog:', e);
        }
    },

    async selectProblemFromCatalog(problemId) {
        this.closeProblemList();
        this.switchView('evaluation');
        try {
            const sessions = await ApiClient.getSessions();
            const matching = sessions.find(s => s.problem_id === problemId);
            if (matching) {
                await this.openSession(matching.session_id);
            } else {
                const problem = this._problems.find(p => p.problem_id === problemId);
                const title = (problem && problem.title) ? problem.title : `Problem ${problemId}`;
                const newSess = await ApiClient.createSession(problemId, 'python', `${title} (Draft)`);
                await this.refreshSidebar();
                await this.openSession(newSess.session_id);
            }
            if (typeof Toast !== 'undefined') Toast.success(`Loaded problem #${problemId}`);
        } catch (e) {
            console.error('[APP] Problem selection error:', e);
        }
    },

    switchBottomTab(name) {
        document.querySelectorAll('.btm-tab').forEach(t => {
            const isActive = t.dataset.panel === name;
            t.classList.toggle('active', isActive);
            t.setAttribute('aria-selected', String(isActive));
        });
        document.querySelectorAll('.btm-content').forEach(p => {
            p.classList.toggle('active', p.id === `panel-${name}`);
            p.classList.toggle('hidden', p.id !== `panel-${name}`);
        });
    },

    // ── Transient UI: mobile nav, sessions drawer, description drawer ──
    toggleMobileNav() {
        const nav = document.getElementById('mobile-nav');
        const btn = document.getElementById('btn-mobile-menu');
        if (!nav) return;
        const willOpen = nav.classList.contains('hidden');
        nav.classList.toggle('hidden', !willOpen);
        if (btn) btn.setAttribute('aria-expanded', String(willOpen));
    },

    closeMobileNav() {
        const nav = document.getElementById('mobile-nav');
        const btn = document.getElementById('btn-mobile-menu');
        if (nav) nav.classList.add('hidden');
        if (btn) btn.setAttribute('aria-expanded', 'false');
    },

    toggleSidebar() {
        const willOpen = !document.body.classList.contains('sidebar-open');
        document.body.classList.toggle('sidebar-open', willOpen);
        const btn = document.querySelector('.ed-panel-toggle[onclick*="toggleSidebar"]');
        if (btn) btn.setAttribute('aria-expanded', String(willOpen));
    },

    toggleDescription() {
        const willOpen = !document.body.classList.contains('desc-open');
        document.body.classList.toggle('desc-open', willOpen);
        const btn = document.querySelector('.ed-panel-toggle[onclick*="toggleDescription"]');
        if (btn) btn.setAttribute('aria-expanded', String(willOpen));
    },

    closeDrawers() {
        document.body.classList.remove('sidebar-open', 'desc-open');
        document.querySelectorAll('.ed-panel-toggle[aria-expanded="true"]')
            .forEach(b => b.setAttribute('aria-expanded', 'false'));
    },

    // ── Modal helpers: dismissal + focus management ──
    _initDismissals() {
        const closers = {
            'problem-list-modal': () => App.closeProblemList(),
            'hist-detail-modal':  () => HistoryUI.closeModal(),
            'new-session-modal':  () => NewSessionModal.close(),
            'leaderboard-modal':  () => App.closeLeaderboard(),
        };

        document.querySelectorAll('.modal-overlay').forEach(overlay => {
            overlay.addEventListener('click', (e) => {
                if (e.target === overlay && closers[overlay.id]) closers[overlay.id]();
            });
        });

        document.addEventListener('keydown', (e) => {
            if (e.key !== 'Escape') return;
            for (const [id, close] of Object.entries(closers)) {
                const el = document.getElementById(id);
                if (el && !el.classList.contains('hidden')) { close(); return; }
            }
            if (document.body.classList.contains('sidebar-open') || document.body.classList.contains('desc-open')) {
                this.closeDrawers();
                return;
            }
            this.closeMobileNav();
        });
    },

    _focusModal(id) {
        const box = document.querySelector(`#${id} .modal-box`);
        if (box) box.focus({ preventScroll: true });
    },

    _rememberFocus() {
        this._lastFocus = document.activeElement;
    },

    _restoreFocus() {
        if (this._lastFocus && document.contains(this._lastFocus)) {
            try { this._lastFocus.focus({ preventScroll: true }); } catch (e) { /* noop */ }
        }
        this._lastFocus = null;
    },

    setBusy(btn, busy, label) {
        if (!btn) return;
        if (busy) {
            if (btn.getAttribute('aria-busy') !== 'true') btn.dataset.idleHtml = btn.innerHTML;
            btn.disabled = true;
            btn.setAttribute('aria-busy', 'true');
            btn.innerHTML = `<span class="btn-spinner" aria-hidden="true"></span> ${label || 'Working…'}`;
        } else {
            btn.disabled = false;
            btn.removeAttribute('aria-busy');
            if (btn.dataset.idleHtml) btn.innerHTML = btn.dataset.idleHtml;
        }
    },

    async showLeaderboard() {
        this._rememberFocus();
        document.getElementById('leaderboard-modal').classList.remove('hidden');
        this._focusModal('leaderboard-modal');
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
        this._restoreFocus();
    },

    async _loadProblemDropdowns() {
        try {
            const problems = await ApiClient.getProblems();
            this._problems = problems || [];
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
