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
        // Remove duplicate toasts with identical message
        const existing = Array.from(container.children).filter(t => t.querySelector('.toast-msg')?.textContent === message);
        existing.forEach(e => e.remove());

        container.appendChild(toast);

        while (container.children.length > 2) {
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
    _collapsedProblems: new Set(),

    async init() {
        console.log('[APP] init');
        this._initCollapsedProblems();
        try {
            await MonacoSetup.init('editor-container', 'python');
        } catch (e) {
            console.error('[APP] Monaco failed:', e);
        }
        await this.refreshSidebar();
        await this._loadProblemDropdowns();
        this.loadStats();
        
        // Handle hash navigation
        window.addEventListener('hashchange', () => this._handleRoute());
        this._handleRoute();

        // Initialize SessionView & Resizers
        if (typeof SessionView !== 'undefined' && SessionView.init) {
            SessionView.init();
        }

        // Initialize LeetCode Problem Explorer
        if (typeof LeetCodeModal !== 'undefined' && LeetCodeModal.init) {
            LeetCodeModal.init();
        }

        // Restore desktop panel collapse states
        if (window.innerWidth >= 1024 && localStorage.getItem('verdict_sidebar_collapsed') === '1') {
            document.body.classList.add('sidebar-collapsed');
            const btn = document.querySelector('.ed-panel-toggle[onclick*="toggleSidebar"]');
            if (btn) btn.classList.add('opacity-50');
        }
        if (window.innerWidth >= 1280 && localStorage.getItem('verdict_desc_collapsed') === '1') {
            document.body.classList.add('desc-collapsed');
            const btn = document.querySelector('.ed-panel-toggle[onclick*="toggleDescription"]');
            if (btn) btn.classList.add('opacity-50');
        }

        // Dismiss modals with Escape / overlay click, and reset panels on resize
        this._initDismissals();
        window.addEventListener('resize', () => {
            if (window.innerWidth >= 768) this.closeMobileNav();
            if (window.innerWidth >= 1024) document.body.classList.remove('sidebar-open');
            if (window.innerWidth >= 1280) document.body.classList.remove('desc-open');
            if (typeof MonacoSetup !== 'undefined' && MonacoSetup.layout) {
                MonacoSetup.layout();
            }
            if (typeof RecommendationUI !== 'undefined' && RecommendationUI.editor) {
                RecommendationUI.editor.layout();
            }
        });

        // Auto-pause timer initially until a coding session view is loaded
    },

    // ── Timer in top navigation (LeetCode style) ──
    startTimer() {
        if (this._timerInterval) clearInterval(this._timerInterval);
        this._timerRunning = true;
        const icon = document.getElementById('timer-icon');
        if (icon) icon.textContent = '⏸';
        this._timerInterval = setInterval(() => {
            if (!this._timerRunning) return;
            this._timerSeconds++;
            this._updateTimerDisplay();
        }, 1000);
    },

    pauseTimer() {
        this._timerRunning = false;
        const icon = document.getElementById('timer-icon');
        if (icon) icon.textContent = '▶';
    },

    toggleTimer() {
        if (this._timerRunning) {
            this.pauseTimer();
        } else {
            this.startTimer();
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
        const cleanView = hash.split('?')[0].split('/')[0];
        const validViews = ['home', 'recommendation', 'evaluation', 'history', 'about'];
        const activeView = validViews.includes(cleanView) ? cleanView : 'home';
        const isEval = activeView === 'evaluation';

        // Check if a session ID is specified in the URL hash: #evaluation?session=12 or #evaluation/12
        if (isEval) {
            const queryMatch = hash.match(/[?&]session=(\d+)/);
            const slashMatch = hash.match(/evaluation\/(\d+)/);
            const targetSessionId = queryMatch ? parseInt(queryMatch[1], 10) : (slashMatch ? parseInt(slashMatch[1], 10) : null);
            if (targetSessionId && targetSessionId !== this._currentSessionId) {
                this._currentSessionId = targetSessionId;
            }
        }

        // Set eval-mode on topbar to keep Home / other views ultra-clean
        const topBar = document.getElementById('top-bar');
        if (topBar) {
            topBar.classList.toggle('eval-mode', isEval);
        }

        const btnNewSession = document.getElementById('btn-top-new-session');
        if (btnNewSession) btnNewSession.style.setProperty('display', isEval ? 'none' : 'inline-flex', 'important');

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

    _initCollapsedProblems() {
        try {
            const saved = localStorage.getItem('verdict_collapsed_problems');
            if (saved) {
                const arr = JSON.parse(saved);
                if (Array.isArray(arr)) {
                    this._collapsedProblems = new Set(arr.map(String));
                }
            }
        } catch (e) {
            this._collapsedProblems = new Set();
        }
    },

    _saveCollapsedProblems() {
        try {
            localStorage.setItem('verdict_collapsed_problems', JSON.stringify(Array.from(this._collapsedProblems)));
        } catch (e) {}
    },

    toggleProblemAccordion(problemId) {
        const pid = String(problemId);
        const itemEl = document.querySelector(`.vsc-problem-accordion[data-problem-id="${pid}"]`);
        if (this._collapsedProblems.has(pid)) {
            this._collapsedProblems.delete(pid);
            if (itemEl) {
                itemEl.classList.remove('is-collapsed');
                const tree = itemEl.querySelector('.vsc-session-tree');
                const chevron = itemEl.querySelector('.vsc-chevron');
                const header = itemEl.querySelector('.vsc-accordion-header');
                if (tree) tree.classList.remove('hidden');
                if (chevron) chevron.classList.add('rotate-90');
                if (header) header.setAttribute('aria-expanded', 'true');
            }
        } else {
            this._collapsedProblems.add(pid);
            if (itemEl) {
                itemEl.classList.add('is-collapsed');
                const tree = itemEl.querySelector('.vsc-session-tree');
                const chevron = itemEl.querySelector('.vsc-chevron');
                const header = itemEl.querySelector('.vsc-accordion-header');
                if (tree) tree.classList.add('hidden');
                if (chevron) chevron.classList.remove('rotate-90');
                if (header) header.setAttribute('aria-expanded', 'false');
            }
        }
        this._saveCollapsedProblems();
    },

    expandProblemAccordion(problemId) {
        if (!problemId) return;
        const pid = String(problemId);
        if (this._collapsedProblems.has(pid)) {
            this._collapsedProblems.delete(pid);
            this._saveCollapsedProblems();
        }
        const itemEl = document.querySelector(`.vsc-problem-accordion[data-problem-id="${pid}"]`);
        if (itemEl) {
            itemEl.classList.remove('is-collapsed');
            const tree = itemEl.querySelector('.vsc-session-tree');
            const chevron = itemEl.querySelector('.vsc-chevron');
            const header = itemEl.querySelector('.vsc-accordion-header');
            if (tree) tree.classList.remove('hidden');
            if (chevron) chevron.classList.add('rotate-90');
            if (header) header.setAttribute('aria-expanded', 'true');
        }
    },

    toggleCollapseAllProblems() {
        const accordions = document.querySelectorAll('.vsc-problem-accordion');
        if (accordions.length === 0) return;
        const allCollapsed = Array.from(accordions).every(el => el.classList.contains('is-collapsed'));
        if (allCollapsed) {
            this._collapsedProblems.clear();
            accordions.forEach(el => {
                el.classList.remove('is-collapsed');
                const tree = el.querySelector('.vsc-session-tree');
                const chevron = el.querySelector('.vsc-chevron');
                const header = el.querySelector('.vsc-accordion-header');
                if (tree) tree.classList.remove('hidden');
                if (chevron) chevron.classList.add('rotate-90');
                if (header) header.setAttribute('aria-expanded', 'true');
            });
        } else {
            accordions.forEach(el => {
                const pid = el.dataset.problemId;
                if (pid) this._collapsedProblems.add(String(pid));
                el.classList.add('is-collapsed');
                const tree = el.querySelector('.vsc-session-tree');
                const chevron = el.querySelector('.vsc-chevron');
                const header = el.querySelector('.vsc-accordion-header');
                if (tree) tree.classList.add('hidden');
                if (chevron) chevron.classList.remove('rotate-90');
                if (header) header.setAttribute('aria-expanded', 'false');
            });
        }
        this._saveCollapsedProblems();
    },

    newSessionForProblem(problemId, event) {
        if (event) {
            event.stopPropagation();
            event.preventDefault();
        }
        if (typeof NewSessionModal !== 'undefined') {
            NewSessionModal.open(problemId);
        }
    },

    async refreshSidebar() {
        const sessionList = document.getElementById('session-list');
        if (!sessionList) return;

        sessionList.innerHTML = `
            <div class="p-3 space-y-3" aria-hidden="true">
                <div class="skeleton h-10"></div>
                <div class="skeleton h-10"></div>
                <div class="skeleton h-10"></div>
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
            for (const p of problems) problemMap[p.problem_id] = p;

            const grouped = {};
            for (const s of sessions) {
                const pid = s.problem_id;
                if (!grouped[pid]) grouped[pid] = [];
                grouped[pid].push(s);
            }

            let html = '';
            for (const [problemId, problemSessions] of Object.entries(grouped)) {
                if (this._filterProblemId && this._filterProblemId !== 'all' && String(problemId) !== String(this._filterProblemId)) continue;
                const problemObj = problemMap[problemId] || { title: `Problem ${problemId}`, difficulty: 'Medium' };
                const problemTitle = problemObj.title || `Problem ${problemId}`;
                const diff = String(problemObj.difficulty || 'Medium').toLowerCase();
                const isCollapsed = this._collapsedProblems.has(String(problemId));

                let sessionsHtml = '';
                for (const s of problemSessions) {
                    const isActive = s.session_id === this._currentSessionId;
                    const lang = (s.language || 'python').toLowerCase();
                    const langClass = { python: 'vsc-file-py', javascript: 'vsc-file-js', cpp: 'vsc-file-cpp', java: 'vsc-file-java' }[lang] || 'vsc-file-py';
                    const langShort = { python: 'py', javascript: 'js', cpp: 'c++', java: 'java' }[lang] || lang.substring(0, 3);

                    let statusBadge = '';
                    if (s.status === 'complete') {
                        const scoreVal = (s.final_score !== undefined && s.final_score !== null) ? Number(s.final_score) :
                                         (s.analysis && s.analysis.final_score !== undefined) ? Number(s.analysis.final_score) : null;
                        if (scoreVal !== null) {
                            const score = Math.round(scoreVal);
                            const scoreCol = score >= 80 ? 'text-[#2cbb5d]' : (score >= 60 ? 'text-[#f59e0b]' : 'text-[#f43f5e]');
                            statusBadge = `<span class="vsc-score-badge ${scoreCol}" title="Verdict Score: ${score}/100">${score}</span>`;
                        } else {
                            statusBadge = `<span class="vsc-status-badge text-[#2cbb5d]" title="Completed">✓</span>`;
                        }
                    } else if (s.status.includes('failed')) {
                        statusBadge = `<span class="vsc-status-badge text-[#f43f5e]" title="Failed">✗</span>`;
                    } else if (s.status === 'draft') {
                        statusBadge = `<span class="vsc-status-badge text-text-tertiary" title="Draft">•</span>`;
                    } else {
                        statusBadge = `<span class="vsc-status-badge text-[#f59e0b] animate-pulse" title="Evaluating">⋯</span>`;
                    }

                    const label = s.submission_label || `Attempt #${s.session_id}`;
                    sessionsHtml += `
                        <div class="vsc-session-item sess-item group ${isActive ? 'active' : ''}" data-session-id="${s.session_id}" role="button" tabindex="0" aria-label="Open session ${this._esc(label)}" onclick="App.openSession(${s.session_id})" onkeydown="if(event.key==='Enter'||event.key===' '){event.preventDefault();App.openSession(${s.session_id})}">
                            <span class="vsc-file-icon ${langClass}" title="${s.language}">${langShort}</span>
                            <span class="vsc-session-label truncate" title="${this._esc(label)}">${this._esc(label)}</span>
                            ${statusBadge}
                            <button class="vsc-delete-btn" onclick="App.deleteSession(${s.session_id}, event)" title="Delete session" aria-label="Delete session">&times;</button>
                        </div>`;
                }

                html += `
                    <div class="vsc-problem-accordion ${isCollapsed ? 'is-collapsed' : ''}" data-problem-id="${problemId}">
                        <div class="vsc-accordion-header group" onclick="App.toggleProblemAccordion('${problemId}')" role="button" tabindex="0" aria-expanded="${!isCollapsed}" onkeydown="if(event.key==='Enter'||event.key===' '){event.preventDefault();App.toggleProblemAccordion('${problemId}')}">
                            <svg class="vsc-chevron ${isCollapsed ? '' : 'rotate-90'}" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><polyline points="9 18 15 12 9 6"/></svg>
                            <svg class="vsc-folder-icon" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z"/></svg>
                            <span class="vsc-problem-title font-mono truncate" title="${this._esc(problemTitle)}">${problemId ? `${problemId}. ` : ''}${this._esc(problemTitle)}</span>
                            <span class="vsc-diff-dot vsc-diff-${diff}" title="${this._esc(problemObj.difficulty || 'Medium')}"></span>
                            <button class="vsc-action-btn" onclick="App.newSessionForProblem('${problemId}', event)" title="New Attempt for ${this._esc(problemTitle)}" aria-label="New Attempt">
                                <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/></svg>
                            </button>
                            <span class="vsc-count-badge">${problemSessions.length}</span>
                        </div>
                        <div class="vsc-session-tree ${isCollapsed ? 'hidden' : ''}">
                            ${sessionsHtml}
                        </div>
                    </div>`;
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
        this._currentSessionId = sessionId;
        const targetHash = `evaluation?session=${sessionId}`;
        if (window.location.hash.replace('#', '') !== targetHash) {
            history.replaceState(null, '', `#${targetHash}`);
        }
        this._handleRoute();
        const session = await SessionView.loadSession(sessionId);
        if (session && session.problem_id) {
            this.expandProblemAccordion(session.problem_id);
        }
        document.querySelectorAll('.vsc-session-item, .sess-item').forEach(el => {
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
        if (value && value !== 'all') {
            const probId = parseInt(value, 10);
            try {
                const sessions = await ApiClient.getSessions();
                const matching = sessions.find(s => s.problem_id === probId);
                if (matching) {
                    await this.openSession(matching.session_id);
                } else {
                    const problem = (this._problems || []).find(p => p.problem_id === probId);
                    const title = (problem && problem.title) ? problem.title : `Problem ${probId}`;
                    const newSess = await ApiClient.createSession(probId, 'python', `${title} (Draft)`);
                    await this.refreshSidebar();
                    await this.openSession(newSess.session_id);
                }
            } catch (err) {
                console.error('[APP] filterSessions direct error:', err);
            }
        }
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
                                <div class="font-semibold text-white text-[13.5px] hover:text-[#38bdf8] cursor-pointer transition-colors" onclick="App.selectProblemFromCatalog(${p.problem_id})">
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
        if (window.innerWidth < 1024) {
            const willOpen = !document.body.classList.contains('sidebar-open');
            document.body.classList.toggle('sidebar-open', willOpen);
            const btn = document.querySelector('.ed-panel-toggle[onclick*="toggleSidebar"]');
            if (btn) btn.setAttribute('aria-expanded', String(willOpen));
        } else {
            document.body.classList.toggle('sidebar-collapsed');
            const isCollapsed = document.body.classList.contains('sidebar-collapsed');
            localStorage.setItem('verdict_sidebar_collapsed', isCollapsed ? '1' : '0');
            const btn = document.querySelector('.ed-panel-toggle[onclick*="toggleSidebar"]');
            if (btn) btn.classList.toggle('opacity-50', isCollapsed);
            if (typeof MonacoSetup !== 'undefined' && MonacoSetup.layout) {
                setTimeout(() => MonacoSetup.layout(), 30);
            }
        }
    },

    toggleDescription() {
        if (window.innerWidth < 1280) {
            const willOpen = !document.body.classList.contains('desc-open');
            document.body.classList.toggle('desc-open', willOpen);
            const btn = document.querySelector('.ed-panel-toggle[onclick*="toggleDescription"]');
            if (btn) btn.setAttribute('aria-expanded', String(willOpen));
        } else {
            document.body.classList.toggle('desc-collapsed');
            const isCollapsed = document.body.classList.contains('desc-collapsed');
            localStorage.setItem('verdict_desc_collapsed', isCollapsed ? '1' : '0');
            const btn = document.querySelector('.ed-panel-toggle[onclick*="toggleDescription"]');
            if (btn) btn.classList.toggle('opacity-50', isCollapsed);
            if (typeof MonacoSetup !== 'undefined' && MonacoSetup.layout) {
                setTimeout(() => MonacoSetup.layout(), 30);
            }
        }
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

    async showLeaderboard(preferredProblemId = null) {
        this._rememberFocus();
        const modal = document.getElementById('leaderboard-modal');
        if (modal) modal.classList.remove('hidden');
        this._focusModal('leaderboard-modal');
        try {
            const problems = await ApiClient.getProblems();
            const sel = document.getElementById('leaderboard-problem-select');
            if (!sel) return;
            sel.innerHTML = '<option value="">Select a problem...</option>';
            for (const p of problems) {
                const o = document.createElement('option');
                o.value = p.problem_id;
                o.textContent = `${p.title} (${p.session_count || 0} runs)`;
                sel.appendChild(o);
            }

            // Auto-select preferred problem, active problem in SessionView, or first problem
            const targetPid = preferredProblemId || (typeof SessionView !== 'undefined' && SessionView._currentProblemId) || (problems.length > 0 ? problems[0].problem_id : null);
            if (targetPid) {
                sel.value = String(targetPid);
                Leaderboard.load(targetPid);
            }
        } catch (e) {
            console.error('[APP] showLeaderboard error:', e);
        }
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
