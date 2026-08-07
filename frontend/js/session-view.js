/**
 * session-view.js — Session view: submit, polling, result rendering.
 */

const SessionView = {
    _currentSessionId: null,
    _pollInterval: null,
    _sessionData: null,

    async loadSession(sessionId) {
        this._stopPolling();
        this._currentSessionId = sessionId;

        try {
            const session = await ApiClient.getSession(sessionId);
            this._sessionData = session;

            MonacoSetup.switchLanguage(session.language);
            MonacoSetup.setCode(session.code);
            MonacoSetup.clearMarkers();

            this._renderProblem(session.problem);

            const titleEl = document.getElementById('current-problem-title');
            if (titleEl && session.problem) {
                titleEl.textContent = session.problem.title;
                titleEl.classList.remove('hidden');
            }

            this._clearFeed();
            this._addCard('', `Session: <strong>${session.submission_label}</strong> &middot; ${session.language.toUpperCase()}`);

            if (session.dry_run && !session.dry_run.passed) this._renderDryRunError(session.dry_run);
            if (session.test_results && session.test_results.length > 0) this._renderTestResults(session.test_results);
            if (session.analysis) this._renderAnalysis(session.analysis, session.profile);

            const active = ['generating_tests','executing','analyzing'];
            if (active.includes(session.status)) {
                this._startPolling();
                this._showStatus(session.status);
            } else {
                this._hideStatus();
            }

            const expBtn = document.getElementById('btn-export-pdf');
            if (expBtn) expBtn.classList.toggle('hidden', session.status !== 'complete');

            document.querySelectorAll('.sess-item').forEach(el => {
                el.classList.toggle('active', el.dataset.sessionId == sessionId);
            });
        } catch (e) {
            console.error('[SESSION]', e);
            this._addCard('', `Failed to load session: ${e.message}`);
        }
    },

    async dryRun() {
        if (!this._currentSessionId) return alert('Create a session first.');
        const code = MonacoSetup.getCode();
        if (!code.trim()) return alert('Write some code first.');

        MonacoSetup.clearMarkers();
        this._clearProblems();
        this._addCard('user', 'Running fast dry-run compile check...');
        this._showStatus('Compiling...');

        try {
            const dr = await ApiClient.dryRunSession(this._currentSessionId, code);
            this._hideStatus();

            if (dr.passed) {
                this._addCard('', '<span class="text-green-0 font-medium">✓ Dry-run passed.</span> Code compiled with zero errors.');
                const p = document.getElementById('panel-problems');
                if (p) p.innerHTML = '<p class="text-green-0 text-xs">✓ No compilation or runtime diagnostics found.</p>';
                App.switchBottomTab('problems');
            } else {
                this._renderDryRunError(dr);
            }
            await App.refreshSidebar();
        } catch (e) {
            this._hideStatus();
            this._addCard('', `Dry-run check failed: ${e.message}`);
        }
    },

    async submit() {
        if (!this._currentSessionId) return alert('Create a session first.');
        const code = MonacoSetup.getCode();
        if (!code.trim()) return alert('Write some code first.');

        MonacoSetup.clearMarkers();
        this._clearProblems();
        this._clearTests();
        this._setLoading(true);
        this._addCard('user', 'Submitting for evaluation...');

        try {
            await ApiClient.submitSession(this._currentSessionId, code);
            this._showStatus('Starting pipeline');
            this._startPolling();
        } catch (e) {
            this._setLoading(false);
            this._addCard('', `Submission failed: ${e.message}`);
        }
    },

    async exportPdf() {
        if (!this._currentSessionId) return;
        try {
            const blob = await ApiClient.exportSessionPdf(this._currentSessionId);
            downloadBlob(blob, `session_${this._currentSessionId}_report.pdf`);
        } catch (e) { alert(`Export failed: ${e.message}`); }
    },

    // -- Polling --
    _pollCount: 0,
    _lastPollStatus: null,
    _staleCount: 0,

    _startPolling() {
        this._stopPolling();
        this._pollCount = 0;
        this._lastPollStatus = null;
        this._staleCount = 0;

        this._pollInterval = setInterval(async () => {
            this._pollCount++;

            // Safety: stop after 80 polls (~2 minutes) to prevent infinite loops
            if (this._pollCount > 80) {
                this._stopPolling(); this._setLoading(false); this._hideStatus();
                this._addCard('', 'Pipeline timed out. The backend may have crashed.');
                return;
            }

            try {
                const s = await ApiClient.getSession(this._currentSessionId);
                this._sessionData = s;
                this._updateStatus(s.status);

                // Detect stale status (no progress after many polls)
                if (s.status === this._lastPollStatus) {
                    this._staleCount++;
                    if (this._staleCount > 40) {
                        this._stopPolling(); this._setLoading(false); this._hideStatus();
                        this._addCard('', 'No progress detected. The pipeline may have crashed. Try resubmitting.');
                        return;
                    }
                } else {
                    this._staleCount = 0;
                    this._lastPollStatus = s.status;
                }

                if (s.status === 'complete') {
                    this._stopPolling(); this._setLoading(false); this._hideStatus();
                    if (s.test_results) this._renderTestResults(s.test_results);
                    if (s.analysis) this._renderAnalysis(s.analysis, s.profile);
                    const b = document.getElementById('btn-export-pdf');
                    if (b) b.classList.remove('hidden');
                    await App.refreshSidebar();
                } else if (s.status === 'dry_run_failed') {
                    this._stopPolling(); this._setLoading(false); this._hideStatus();
                    if (s.dry_run) this._renderDryRunError(s.dry_run);
                    await App.refreshSidebar();
                } else if (s.status === 'failed') {
                    this._stopPolling(); this._setLoading(false); this._hideStatus();
                    const reason = s.history_summary || 'Pipeline failed. Check backend logs.';
                    this._addCard('', `<span class="text-red-0 font-medium">Pipeline Halted:</span> ${this._esc(reason)}`);
                    await App.refreshSidebar();
                }
            } catch (e) { console.error('[POLL]', e); }
        }, 1500);
    },

    _stopPolling() {
        if (this._pollInterval) { clearInterval(this._pollInterval); this._pollInterval = null; }
    },

    // -- Renderers --
    _renderProblem(problem) {
        const el = document.getElementById('problem-description');
        if (!el || !problem) return;
        el.innerHTML = `<p class="text-xs text-text-0 font-medium mb-1">${this._esc(problem.title)}</p>
            <p class="text-xs text-text-1 whitespace-pre-wrap">${this._esc(problem.description)}</p>`;
    },

    _renderDryRunError(dr) {
        if (dr.error_line) MonacoSetup.setGutterMarker(dr.error_line, dr.stderr, 'error');

        const p = document.getElementById('panel-problems');
        if (p) {
            p.innerHTML = `<div class="flex items-start gap-2">
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="#f87171" stroke-width="2" class="flex-shrink-0 mt-0.5"><circle cx="12" cy="12" r="10"/><line x1="15" y1="9" x2="9" y2="15"/><line x1="9" y1="9" x2="15" y2="15"/></svg>
                <div><p class="text-xs font-semibold text-red-0">Compile/Runtime Error${dr.error_line ? ` (line ${dr.error_line})` : ''}</p>
                <pre class="text-xs font-mono mt-1 text-text-2 whitespace-pre-wrap">${this._esc(dr.stderr || 'Unknown error')}</pre></div></div>`;
        }
        App.switchBottomTab('problems');
        this._addCard('', `<span class="text-red-0 font-medium">Dry-run failed</span>${dr.error_line ? ` at line ${dr.error_line}` : ''}. Fix the error and resubmit.`);

        const out = document.getElementById('output-content');
        if (out) out.textContent = dr.stderr || 'No output';
    },

    _renderTestResults(tests) {
        if (!tests || !tests.length) return;
        const passed = tests.filter(t => t.passed).length;
        const total = tests.length;

        const p = document.getElementById('panel-test-results');
        if (p) {
            let h = `<div class="mb-2 flex items-center justify-between">
                <span class="text-xs font-semibold text-text-0">Test Results</span>
                <span class="text-xs font-mono ${passed===total?'text-green-0':'text-red-0'}">${passed}/${total}</span></div>
                <table class="tbl"><thead><tr><th>#</th><th>Description</th><th>Status</th><th>Time</th><th></th></tr></thead><tbody>`;

            tests.forEach((t, i) => {
                const sc = t.passed ? 'text-green-0' : 'text-red-0';
                const si = t.passed ? 'Pass' : 'Fail';
                const edge = t.is_edge_case ? '<span class="text-amber-0 text-2xs ml-1">edge</span>' : '';
                h += `<tr><td class="font-mono text-text-2">${i+1}</td>
                    <td>${this._esc(t.description||'Test case')}${edge}</td>
                    <td class="${sc} font-semibold">${si}</td>
                    <td class="font-mono text-text-2">${t.time_ms?`${t.time_ms.toFixed(0)}ms`:'--'}</td>
                    <td>${!t.passed?`<details class="text-xs"><summary class="text-text-2 cursor-pointer hover:text-text-1">Details</summary>
                        <div class="mt-1 space-y-1 text-2xs">
                        <p class="text-text-2 font-semibold">Input</p><pre class="bg-surface-0 p-1 rounded font-mono">${this._esc(t.stdin)}</pre>
                        <p class="text-green-0 font-semibold">Expected</p><pre class="bg-surface-0 p-1 rounded font-mono">${this._esc(t.expected_stdout)}</pre>
                        <p class="text-red-0 font-semibold">Actual</p><pre class="bg-surface-0 p-1 rounded font-mono">${this._esc(t.actual_stdout||'(none)')}</pre>
                        ${t.stderr?`<p class="text-amber-0 font-semibold">Stderr</p><pre class="bg-surface-0 p-1 rounded font-mono">${this._esc(t.stderr)}</pre>`:''}</div></details>`:''}</td></tr>`;
            });
            h += '</tbody></table>';
            p.innerHTML = h;
        }

        App.switchBottomTab('test-results');
        this._addCard('', `<span class="font-semibold ${passed===total?'text-green-0':'text-amber-0'}">${passed}/${total} tests passed.</span> See Tests panel for details.`);
    },

    renderAsciiBar(score, width = 16) {
        const s = Math.max(0, Math.min(100, score || 0));
        const filledLen = Math.round((s / 100) * width);
        const emptyLen = width - filledLen;
        return `[${'█'.repeat(filledLen)}${'░'.repeat(emptyLen)}] ${String(s).padStart(3, ' ')}`;
    },

    _renderAnalysis(a, profile) {
        if (!a) return;

        const vc = { optimal:'verdict-pass', needs_improvement:'verdict-warn', incorrect:'verdict-fail' }[a.verdict] || 'verdict-warn';
        const vl = { optimal:'[ OPTIMAL ]', needs_improvement:'[ NEEDS WORK ]', incorrect:'[ INCORRECT ]' }[a.verdict] || `[ ${(a.verdict||'').toUpperCase()} ]`;

        const asciiLine = (label, score) => {
            const lbl = label.padEnd(13, ' ');
            return `<div><span class="text-text-muted">${lbl}</span> <span class="text-accent">${this.renderAsciiBar(score)}</span></div>`;
        };

        let h = `<div class="feed-section-label">Analysis</div>
            <div class="flex items-center justify-between mb-4 font-mono">
                <span class="verdict ${vc}">${vl}</span>
                <div class="text-right"><div class="text-xl font-bold text-accent">${a.final_score??'--'}</div>
                <div class="text-2xs text-text-dim uppercase tracking-wider">Score</div></div></div>

            <div class="mb-4"><div class="feed-section-label">Correctness</div>
            <p class="text-xs text-text-primary font-sans leading-relaxed">${this._esc(a.correctness_summary||'')}</p></div>

            <div class="mb-4 p-3 bg-surface-2 border border-line font-mono">
                <div class="feed-section-label">Complexity</div>
                <div class="flex gap-6 text-xs">
                    <div><span class="text-text-muted">Time</span> <span class="text-accent font-semibold ml-1">${a.time_complexity||'--'}</span></div>
                    <div><span class="text-text-muted">Space</span> <span class="text-text-primary font-semibold ml-1">${a.space_complexity||'--'}</span></div>
                </div>
                ${a.is_optimal===false?`<p class="text-xs text-warn mt-2">Optimal: ${a.optimal_time||'--'} / ${a.optimal_space||'--'}</p>`:''}</div>

            <div class="mb-4 font-mono">
                <div class="feed-section-label">Score Breakdown</div>
                <div class="ascii-score-container space-y-1">
                    ${asciiLine('CORRECTNESS', a.correctness_score)}
                    ${asciiLine('PERFORMANCE', a.performance_score)}
                    ${asciiLine('OPTIMIZATION', a.optimization_score)}
                    ${asciiLine('QUALITY', a.quality_score)}
                    ${asciiLine('READABILITY', a.readability_score)}
                    ${asciiLine('DOCUMENTATION', a.documentation_score)}
                </div>
            </div>`;

        if (a.complexity_chart) {
            h += `<div class="chart-container mb-3"><canvas id="chat-complexity-chart" height="150"></canvas></div>`;
        }
        h += `<div class="chart-container mb-3"><canvas id="chat-score-chart" height="170"></canvas></div>`;

        if (a.optimization_suggestions && a.optimization_suggestions.length) {
            h += `<div class="mb-4"><div class="feed-section-label">Suggestions</div>
                ${a.optimization_suggestions.map(s=>`<div class="suggestion-item">${this._esc(s)}</div>`).join('')}</div>`;
        }
        if (a.quality_issues && a.quality_issues.length) {
            h += `<div class="mb-4"><div class="feed-section-label">Quality</div>
                ${a.quality_issues.map(qi=>`<div class="quality-issue">
                    <span class="qi-sev qi-${qi.severity}">${qi.severity}</span>
                    <div><p class="text-xs text-text-0">${this._esc(qi.issue)}</p>
                    <p class="text-2xs text-text-2 mt-0.5">${this._esc(qi.suggestion)}</p></div></div>`).join('')}</div>`;
        }
        if (a.code_explanation) {
            h += `<div class="mb-4"><details><summary class="feed-section-label cursor-pointer hover:text-text-1">Code Walkthrough</summary>
                <p class="text-xs text-text-1 mt-2 whitespace-pre-wrap leading-relaxed">${this._esc(a.code_explanation)}</p></details></div>`;
        }
        if (a.final_notes) {
            h += `<div class="mt-2 p-2 bg-surface-0 rounded border border-border-0">
                <p class="text-xs text-text-2">${this._esc(a.final_notes)}</p></div>`;
        }

        this._addCard('analysis', h);

        setTimeout(() => {
            if (a.complexity_chart) Charts.renderComplexityChart('chat-complexity-chart', a.complexity_chart);
            Charts.renderScoreBreakdown('chat-score-chart', {
                correctness_score:a.correctness_score, performance_score:a.performance_score,
                optimization_score:a.optimization_score, quality_score:a.quality_score,
                readability_score:a.readability_score, documentation_score:a.documentation_score,
            }, profile);
        }, 80);
    },

    // -- Feed helpers --
    _addCard(type, html) {
        const feed = document.getElementById('chat-thread');
        if (!feed) return;
        const card = document.createElement('div');
        const cls = type === 'user' ? 'feed-card feed-card-user' : type === 'analysis' ? 'feed-card feed-card-analysis' : 'feed-card';
        card.className = cls;
        card.innerHTML = html;
        feed.appendChild(card);
        feed.scrollTop = feed.scrollHeight;
    },

    _clearFeed() { const f = document.getElementById('chat-thread'); if (f) f.innerHTML = ''; },
    _clearProblems() { const p = document.getElementById('panel-problems'); if (p) p.innerHTML = '<p class="text-text-2 text-xs">No diagnostics.</p>'; },
    _clearTests() { const p = document.getElementById('panel-test-results'); if (p) p.innerHTML = '<p class="text-text-2 text-xs">Submit to run tests.</p>'; },

    // -- Status --
    _showStatus(t) {
        const c = document.getElementById('pipeline-status');
        const e = document.getElementById('pipeline-status-text');
        if (c) { c.classList.remove('hidden'); c.classList.add('flex'); }
        if (e) e.textContent = t;
    },
    _updateStatus(s) {
        const m = { pending:'Starting...', generating_tests:'Generating tests...', executing:'Executing...', analyzing:'Analyzing...', complete:'Done', failed:'Failed', dry_run_failed:'Compile error' };
        this._showStatus(m[s]||s);
    },
    _hideStatus() {
        const c = document.getElementById('pipeline-status');
        if (c) { c.classList.add('hidden'); c.classList.remove('flex'); }
    },

    _setLoading(on) {
        const sb = document.getElementById('btn-submit');
        const dr = document.getElementById('btn-dry-run');
        if (sb) { sb.disabled = on; sb.innerHTML = on ? '<div class="spinner"></div> Evaluating' : 'Submit'; }
        if (dr) dr.disabled = on;
    },

    _esc(s) { if (!s) return ''; const d = document.createElement('div'); d.textContent = s; return d.innerHTML; },
};
