/**
 * session-view.js — UI controller for the evaluation IDE view.
 * Manages Monaco editor, session state, dry-run, submission, polling, and result rendering.
 */

const SessionView = {
    _sessionId: null,
    _language: 'python',
    _currentProblemId: null,

    async init() {
        console.log('[SessionView] Initialized');
    },

    async loadSession(sessionId) {
        this._sessionId = sessionId;
        try {
            const session = await ApiClient.getSession(sessionId);
            this._language = session.language;
            this._currentProblemId = session.problem_id;

            // Update sidebar active state
            document.querySelectorAll('.sess-item').forEach(el => {
                const sId = parseInt(el.dataset.sessionId, 10);
                el.classList.toggle('active', sId === sessionId);
            });

            // Update problem description
            const problemDesc = document.getElementById('problem-description');
            if (problemDesc && session.problem) {
                problemDesc.innerHTML = `<p class="text-text-primary font-medium mb-2">${this._esc(session.problem.title)}</p><p class="text-text-secondary">${this._esc(session.problem.description)}</p>`;
            }

            // Always update language and tab state first
            MonacoSetup.switchLanguage(session.language);
            MonacoSetup.showOnlyTab(session.language);

            // Set editor content if editor is ready
            const editor = MonacoSetup.getEditor();
            if (editor) {
                editor.setValue(session.code || '');
            }

            // Reset panels
            document.getElementById('panel-problems').innerHTML = '<p class="text-text-secondary text-[13px]">No diagnostics. Write code and submit.</p>';
            document.getElementById('output-content').textContent = 'No output.';
            document.getElementById('panel-test-results').innerHTML = '<p class="text-text-secondary text-[13px]">Submit code to generate and execute test cases.</p>';

            // If session already has analysis result, render it
            if (session.analysis) {
                this._renderEvaluation(session);
                document.getElementById('btn-export-pdf')?.classList.remove('hidden');
            } else if (['generating_tests', 'executing', 'analyzing', 'pending'].includes(session.status)) {
                // Resume polling if session is actively processing
                this._pollPipeline(sessionId);
            } else {
                // Reset chat thread for new/unsubmitted session
                const chatThread = document.getElementById('chat-thread');
                if (chatThread) {
                    chatThread.innerHTML = `
                        <div class="feed-card">
                            <p class="text-[13px] text-text-secondary">Welcome to <span class="font-semibold text-text-primary">Solution Evaluation</span>.</p>
                            <p class="text-[12px] text-text-tertiary mt-1.5 leading-relaxed">Submit your code to execute against verified AI-generated test cases and receive a score breakdown.</p>
                        </div>
                    `;
                }
                document.getElementById('btn-export-pdf')?.classList.add('hidden');
            }

        } catch (err) {
            console.error('[SessionView] Failed to load session:', err);
            alert(`Failed to load session: ${err.message}`);
        }
    },

    getEditorCode() {
        return MonacoSetup.getCode() || (window.monacoEditor ? window.monacoEditor.getValue() : '');
    },

    async dryRun() {
        if (!this._sessionId) return alert('No active session. Please select or create a session.');
        const code = this.getEditorCode();
        if (!code.trim()) return alert('Editor is empty.');

        const btn = document.getElementById('btn-dry-run');
        btn.disabled = true;
        btn.innerHTML = `<span class="animate-spin inline-block w-3 h-3 border-2 border-current border-t-transparent rounded-full mr-1"></span> Running...`;

        try {
            const result = await ApiClient.dryRunSession(this._sessionId, code);
            this._renderDryRun(result);
            App.switchBottomTab('output');
        } catch (err) {
            alert(`Dry run failed: ${err.message}`);
        } finally {
            btn.disabled = false;
            btn.innerHTML = `<svg width="12" height="12" viewBox="0 0 24 24" fill="currentColor"><polygon points="5,3 19,12 5,21"/></svg> Run`;
        }
    },

    _renderDryRun(result) {
        const outputPanel = document.getElementById('output-content');
        const problemsPanel = document.getElementById('panel-problems');

        let output = '';
        if (result.stdout) output += `=== STDOUT ===\n${result.stdout}\n`;
        if (result.stderr) output += `${result.stdout ? '\n' : ''}=== STDERR ===\n${result.stderr}\n`;
        if (!output) output = result.passed ? 'Dry run completed successfully with no output.' : 'Dry run failed.';

        outputPanel.textContent = output;

        // Problems panel
        let problemsHtml = '';
        if (!result.passed && result.stderr) {
            const errLine = result.error_line ? ` (Line ${result.error_line})` : '';
            problemsHtml += `
                <div class="quality-issue">
                    <span class="qi-sev qi-high">ERROR${errLine}</span>
                    <span class="text-text-secondary font-mono text-[12px]">${this._esc(result.stderr)}</span>
                </div>`;
            if (result.error_line) {
                MonacoSetup.setGutterMarker(result.error_line, result.stderr);
            }
        } else {
            problemsHtml = '<p class="text-text-secondary text-[13px]">No compilation or runtime errors detected.</p>';
            MonacoSetup.clearMarkers();
        }
        problemsPanel.innerHTML = problemsHtml;
    },

    async submit() {
        if (!this._sessionId) return alert('No active session. Please select or create a session.');
        const code = this.getEditorCode();
        if (!code.trim()) return alert('Editor is empty.');

        const btn = document.getElementById('btn-submit');
        btn.disabled = true;
        btn.innerHTML = `<span class="animate-spin inline-block w-4 h-4 border-2 border-current border-t-transparent rounded-full mr-2"></span> Evaluating...`;

        const statusEl = document.getElementById('pipeline-status');
        const statusText = document.getElementById('pipeline-status-text');
        if (statusEl) { statusEl.classList.remove('hidden'); statusEl.classList.add('flex'); }
        if (statusText) statusText.textContent = 'Pipeline started...';

        try {
            await ApiClient.submitSession(this._sessionId, code);
            this._pollPipeline(this._sessionId);
        } catch (err) {
            alert(`Evaluation failed to start: ${err.message}`);
            btn.disabled = false;
            btn.innerHTML = 'Submit Evaluation';
            if (statusEl) { statusEl.classList.add('hidden'); statusEl.classList.remove('flex'); }
        }
    },

    _pollPipeline(sessionId) {
        const statusMap = {
            pending: 'Initializing evaluation...',
            generating_tests: 'AI generating verified test cases...',
            executing: 'Executing test cases via Piston...',
            analyzing: 'AI analyzing code performance & quality...'
        };

        const pollInterval = setInterval(async () => {
            if (this._sessionId !== sessionId) {
                clearInterval(pollInterval);
                return;
            }

            try {
                const session = await ApiClient.getSession(sessionId);
                const statusText = document.getElementById('pipeline-status-text');
                if (statusText) {
                    statusText.textContent = statusMap[session.status] || 'Evaluating...';
                }

                if (session.status === 'complete' || session.status.includes('failed')) {
                    clearInterval(pollInterval);
                    const statusEl = document.getElementById('pipeline-status');
                    if (statusEl) { statusEl.classList.add('hidden'); statusEl.classList.remove('flex'); }

                    const btn = document.getElementById('btn-submit');
                    if (btn) {
                        btn.disabled = false;
                        btn.innerHTML = 'Submit Evaluation';
                    }

                    if (session.status === 'complete') {
                        this._renderEvaluation(session);
                        App.switchBottomTab('test-results');
                        document.getElementById('btn-export-pdf')?.classList.remove('hidden');
                    } else {
                        alert(`Evaluation halted (${session.status}). Check Output tab for compiler/runtime logs.`);
                    }

                    await App.refreshSidebar();
                }
            } catch (err) {
                console.error('[SessionView] Poll error:', err);
            }
        }, 1500);
    },

    _renderEvaluation(session) {
        const chatThread = document.getElementById('chat-thread');
        const testPanel = document.getElementById('panel-test-results');

        const analysis = session.analysis;
        if (!analysis) {
            if (testPanel) testPanel.innerHTML = '<p class="text-text-secondary text-[13px]">Evaluation in progress or incomplete.</p>';
            return;
        }

        const verdict = analysis.verdict || 'unknown';
        const score = analysis.final_score ?? '--';

        const verdictClass = { optimal: 'verdict-pass', needs_improvement: 'verdict-warn', incorrect: 'verdict-fail' }[verdict] || '';
        const verdictLabel = { optimal: 'OPTIMAL', needs_improvement: 'NEEDS WORK', incorrect: 'INCORRECT' }[verdict] || verdict.toUpperCase();

        let html = `
            <div class="feed-card feed-card-analysis">
                <div class="flex items-center justify-between mb-3">
                    <span class="verdict ${verdictClass}">${verdictLabel}</span>
                    <span class="text-[12px] font-mono text-text-tertiary">Score: <strong class="text-text-primary text-[14px]">${score}</strong>/100</span>
                </div>
        `;

        if (analysis.correctness_summary) {
            html += `<div class="mb-3 p-2.5 bg-void/50 rounded border border-border-subtle"><p class="text-[12px] text-text-secondary leading-relaxed">${this._esc(analysis.correctness_summary)}</p></div>`;
        }

        html += `<div class="mb-3 space-y-1.5">`;
        const labels = ['Correctness','Performance','Optimization','Quality','Readability','Docs'];
        const values = [
            analysis.correctness_score ?? 0,
            analysis.performance_score ?? 0,
            analysis.optimization_score ?? 0,
            analysis.quality_score ?? 0,
            analysis.readability_score ?? 0,
            analysis.documentation_score ?? 0
        ];
        for (let i = 0; i < labels.length; i++) {
            html += `
                <div class="score-bar-row !mb-1.5">
                    <span class="score-bar-lbl !w-[90px] !text-[11px]">${labels[i]}</span>
                    <div class="score-bar-bg"><div class="score-bar-fill" style="width:${values[i]}%"></div></div>
                    <span class="score-bar-val !text-[11px]">${values[i]}</span>
                </div>`;
        }
        html += `</div>`;

        if (analysis.code_explanation) {
            html += `<div class="mb-3"><div class="feed-section-label">Code Explanation</div><p class="text-[12px] text-text-secondary leading-relaxed">${this._esc(analysis.code_explanation)}</p></div>`;
        }

        if (analysis.time_complexity || analysis.space_complexity) {
            html += `<div class="grid grid-cols-2 gap-2 mb-3 text-[11px] font-mono">`;
            if (analysis.time_complexity) html += `<div class="p-2 bg-void rounded border border-border-subtle"><span class="text-text-tertiary">Time:</span> <span class="text-success font-semibold">${this._esc(analysis.time_complexity)}</span></div>`;
            if (analysis.space_complexity) html += `<div class="p-2 bg-void rounded border border-border-subtle"><span class="text-text-tertiary">Space:</span> <span class="text-success font-semibold">${this._esc(analysis.space_complexity)}</span></div>`;
            html += `</div>`;
        }

        if (analysis.quality_issues && analysis.quality_issues.length > 0) {
            html += `<div class="mb-3"><div class="feed-section-label">Quality Issues</div>`;
            for (const qi of analysis.quality_issues) {
                const sev = qi.severity || 'low';
                const sevClass = { high: 'qi-high', medium: 'qi-medium', low: 'qi-low' }[sev] || 'qi-low';
                const desc = qi.issue || qi.description || '';
                html += `<div class="quality-issue mb-1"><span class="qi-sev ${sevClass}">${sev.toUpperCase()}</span><span class="text-text-secondary text-[12px]">${this._esc(desc)}</span></div>`;
            }
            html += `</div>`;
        }

        if (analysis.optimization_suggestions && analysis.optimization_suggestions.length > 0) {
            html += `<div class="mb-3"><div class="feed-section-label">Optimization Suggestions</div><ul class="space-y-1">`;
            for (const s of analysis.optimization_suggestions) {
                html += `<li class="suggestion-item text-[12px] text-text-secondary">${this._esc(s)}</li>`;
            }
            html += `</ul></div>`;
        }

        html += `</div>`;

        let testHtml = '';
        if (session.test_results && session.test_results.length > 0) {
            testHtml += `<div class="space-y-2">`;
            for (let i = 0; i < session.test_results.length; i++) {
                const tr = session.test_results[i];
                const passed = tr.passed;
                const statusIcon = passed
                    ? `<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="var(--success)" stroke-width="2.5"><path d="M9 12l2 2 4-4"/></svg>`
                    : `<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="var(--danger)" stroke-width="2.5"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>`;
                testHtml += `
                    <div class="p-3 rounded-lg border ${passed ? 'border-success/20 bg-success/5' : 'border-danger/20 bg-danger/5'}">
                        <div class="flex items-center justify-between mb-1.5">
                            <div class="flex items-center gap-2">
                                <span>${statusIcon}</span>
                                <span class="text-[12px] font-medium text-text-primary">Test ${i+1}${tr.is_edge_case ? ' [EDGE CASE]' : ''}</span>
                            </div>
                            <span class="text-[11px] font-mono text-text-tertiary">${tr.time_ms ? tr.time_ms.toFixed(1) : '--'}ms</span>
                        </div>
                        <div class="text-[11px] font-mono text-text-tertiary mt-1"><span class="text-text-secondary">Input:</span> ${this._esc(tr.stdin)}</div>
                        ${!passed && tr.actual_stdout ? `<div class="text-[11px] font-mono text-text-tertiary"><span class="text-danger">Got:</span> ${this._esc(tr.actual_stdout)}</div>` : ''}
                        ${!passed && tr.expected_stdout ? `<div class="text-[11px] font-mono text-text-tertiary"><span class="text-success">Expected:</span> ${this._esc(tr.expected_stdout)}</div>` : ''}
                        ${tr.stderr ? `<div class="text-[11px] font-mono text-danger mt-1">${this._esc(tr.stderr)}</div>` : ''}
                    </div>
                `;
            }
            testHtml += `</div>`;
        } else {
            testHtml = '<p class="text-text-secondary text-[13px]">No test results available.</p>';
        }

        testPanel.innerHTML = testHtml;

        chatThread.innerHTML = html;
        chatThread.scrollTop = chatThread.scrollHeight;
    },

    async exportPdf() {
        if (!this._sessionId) return;
        try {
            const blob = await ApiClient.exportSessionPdf(this._sessionId);
            downloadBlob(blob, `verdict_session_${this._sessionId}.pdf`);
        } catch (e) { alert(`Export failed: ${e.message}`); }
    },

    _esc(s) { if (!s) return ''; const d = document.createElement('div'); d.textContent = s; return d.innerHTML; },
};