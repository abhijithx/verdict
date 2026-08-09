/**
 * session-view.js — UI controller for the evaluation IDE view.
 * Manages Monaco editor, session state, dry-run, submission, and result rendering.
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
            document.querySelectorAll('.sess-item').forEach(el => el.classList.toggle('active', parseInt(el.dataset.id) === sessionId));

            // Update problem description
            const problemDesc = document.getElementById('problem-description');
            if (problemDesc) {
                problemDesc.innerHTML = `<p class="text-text-primary font-medium mb-2">${this._esc(session.problem_title)}</p><p class="text-text-secondary">${this._esc(session.problem_statement)}</p>`;
            }

            // Set editor content
            if (window.monacoEditor) {
                MonacoSetup.switchLanguage(session.language);
                window.monacoEditor.setValue(session.code_template || '');
            }

            // Reset panels
            document.getElementById('panel-problems').innerHTML = '<p class="text-text-secondary text-[13px]">No diagnostics. Write code and submit.</p>';
            document.getElementById('output-content').textContent = 'No output.';
            document.getElementById('panel-test-results').innerHTML = '<p class="text-text-secondary text-[13px]">Submit code to generate and execute test cases.</p>';

            // Reset chat thread
            const chatThread = document.getElementById('chat-thread');
            chatThread.innerHTML = `
                <div class="feed-card">
                    <p class="text-[13px] text-text-secondary">Welcome to <span class="font-semibold text-text-primary">Solution Evaluation</span>.</p>
                    <p class="text-[12px] text-text-tertiary mt-1.5 leading-relaxed">Submit your code to execute against verified AI-generated test cases and receive a score breakdown.</p>
                </div>
            `;

            // Hide export button
            document.getElementById('btn-export-pdf')?.classList.add('hidden');

        } catch (err) {
            console.error('[SessionView] Failed to load session:', err);
            alert(`Failed to load session: ${err.message}`);
        }
    },

    getEditorCode() {
        return window.monacoEditor ? window.monacoEditor.getValue() : '';
    },

    async dryRun() {
        if (!this._sessionId) return alert('No active session.');
        const code = this.getEditorCode();
        if (!code.trim()) return alert('Editor is empty.');

        const btn = document.getElementById('btn-dry-run');
        btn.disabled = true;
        btn.innerHTML = `<span class="animate-spin inline-block w-3 h-3 border-2 border-current border-t-transparent rounded-full mr-1"></span> Running...`;

        try {
            const result = await ApiClient.dryRun(this._sessionId, code);
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
        if (result.compilation_error) {
            output += `=== COMPILATION ERROR ===\n${result.compilation_error}\n\n`;
        }
        if (result.runtime_error) {
            output += `=== RUNTIME ERROR ===\n${result.runtime_error}\n\n`;
        }
        if (result.stdout) output += `=== STDOUT ===\n${result.stdout}\n`;
        if (result.stderr) output += `\n=== STDERR ===\n${result.stderr}\n`;
        if (!output) output = 'Dry run completed with no output.';

        outputPanel.textContent = output;

        // Problems panel
        let problemsHtml = '';
        if (result.compilation_error) {
            problemsHtml += `<div class="quality-issue"><span class="qi-sev qi-high">ERROR</span><span class="text-text-secondary">${this._esc(result.compilation_error.substring(0,200))}</span></div>`;
        }
        if (result.runtime_error) {
            problemsHtml += `<div class="quality-issue"><span class="qi-sev qi-medium">WARN</span><span class="text-text-secondary">${this._esc(result.runtime_error.substring(0,200))}</span></div>`;
        }
        if (!problemsHtml) problemsHtml = '<p class="text-text-secondary text-[13px]">No compilation or runtime errors detected.</p>';
        problemsPanel.innerHTML = problemsHtml;
    },

    async submit() {
        if (!this._sessionId) return alert('No active session.');
        const code = this.getEditorCode();
        if (!code.trim()) return alert('Editor is empty.');

        const btn = document.getElementById('btn-submit');
        btn.disabled = true;
        const originalText = btn.innerHTML;
        btn.innerHTML = `<span class="animate-spin inline-block w-4 h-4 border-2 border-current border-t-transparent rounded-full mr-2"></span> Evaluating...`;

        // Show pipeline status
        const statusEl = document.getElementById('pipeline-status');
        const statusText = document.getElementById('pipeline-status-text');
        if (statusEl) { statusEl.classList.remove('hidden'); statusEl.classList.add('flex'); }
        if (statusText) statusText.textContent = 'Evaluating...';

        try {
            const result = await ApiClient.submit(this._sessionId, code);
            this._renderEvaluation(result);
            App.switchBottomTab('test-results');
            document.getElementById('btn-export-pdf')?.classList.remove('hidden');
        } catch (err) {
            alert(`Evaluation failed: ${err.message}`);
        } finally {
            btn.disabled = false;
            btn.innerHTML = originalText;
            if (statusEl) { statusEl.classList.add('hidden'); statusEl.classList.remove('flex'); }
        }
    },

    _renderEvaluation(result) {
        const chatThread = document.getElementById('chat-thread');
        const testPanel = document.getElementById('panel-test-results');

        // Build evaluation card
        const analysis = result.evaluation?.analysis || {};
        const verdict = analysis.verdict || 'unknown';
        const score = analysis.final_score ?? '--';

        const verdictClass = { optimal: 'verdict-pass', needs_improvement: 'verdict-warn', incorrect: 'verdict-fail' }[verdict] || '';
        const verdictLabel = { optimal: 'OPTIMAL', needs_improvement: 'NEEDS WORK', incorrect: 'INCORRECT' }[verdict] || verdict.toUpperCase();

        let html = `
            <div class="feed-card feed-card-analysis">
                <div class="flex items-center justify-between mb-3">
                    <span class="verdict ${verdictClass}">${verdictLabel}</span>
                    <span class="text-[12px] font-mono text-text-tertiary">Score: ${score}/100</span>
                </div>
        `;

        // Score breakdown
        if (analysis.signals) {
            html += `<div class="mb-3 space-y-1.5">`;
            const signals = analysis.signals;
            const labels = ['Correctness','Performance','Optimization','Quality','Readability','Docs'];
            const keys = ['correctness_score','performance_score','optimization_score','quality_score','readability_score','documentation_score'];
            for (let i=0; i<labels.length; i++) {
                const val = signals[keys[i]] ?? 0;
                html += `<div class="score-bar-row !mb-1.5"><span class="score-bar-lbl !w-[90px] !text-[11px]">${labels[i]}</span><div class="score-bar-bg"><div class="score-bar-fill" style="width:${val}%"></div></div><span class="score-bar-val !text-[11px]">${val}</span></div>`;
            }
            html += `</div>`;
        }

        // Code explanation
        if (analysis.code_explanation) {
            html += `<div class="mb-3"><p class="text-[12px] text-text-secondary leading-relaxed">${this._esc(analysis.code_explanation)}</p></div>`;
        }

        // Complexity
        if (analysis.complexity_analysis) {
            const ca = analysis.complexity_analysis;
            html += `<div class="grid grid-cols-2 gap-2 mb-3 text-[11px] font-mono">`;
            if (ca.time_complexity) html += `<div class="p-2 bg-void rounded border border-border-subtle"><span class="text-text-tertiary">Time:</span> <span class="text-success">${this._esc(ca.time_complexity)}</span></div>`;
            if (ca.space_complexity) html += `<div class="p-2 bg-void rounded border border-border-subtle"><span class="text-text-tertiary">Space:</span> <span class="text-success">${this._esc(ca.space_complexity)}</span></div>`;
            html += `</div>`;
        }

        // Quality issues
        if (analysis.quality_issues && analysis.quality_issues.length > 0) {
            html += `<div class="mb-3"><div class="feed-section-label">Quality Issues</div>`;
            for (const issue of analysis.quality_issues) {
                const sevClass = { high: 'qi-high', medium: 'qi-medium', low: 'qi-low' }[issue.severity] || 'qi-low';
                html += `<div class="quality-issue"><span class="qi-sev ${sevClass}">${issue.severity}</span><span class="text-text-secondary">${this._esc(issue.description)}</span></div>`;
            }
            html += `</div>`;
        }

        // Suggestions
        if (analysis.suggestions && analysis.suggestions.length > 0) {
            html += `<div class="mb-3"><div class="feed-section-label">Suggestions</div><ul class="space-y-1">`;
            for (const s of analysis.suggestions) {
                html += `<li class="suggestion-item">${this._esc(s)}</li>`;
            }
            html += `</ul></div>`;
        }

        // Reference solution
        if (analysis.reference_solution) {
            html += `<div class="mb-3"><div class="feed-section-label">Reference Solution</div><pre class="code-block text-[11px]">${this._esc(analysis.reference_solution)}</pre></div>`;
        }

        html += `</div>`;

        // Test results panel
        let testHtml = '';
        if (result.test_results && result.test_results.length > 0) {
            testHtml += `<div class="space-y-2">`;
            for (const tr of result.test_results) {
                const passed = tr.passed;
                const statusIcon = passed
                    ? `<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="var(--success)" stroke-width="2.5"><path d="M9 12l2 2 4-4"/></svg>`
                    : `<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="var(--danger)" stroke-width="2.5"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>`;
                testHtml += `
                    <div class="p-3 rounded-lg border ${passed ? 'border-success/20 bg-success/5' : 'border-danger/20 bg-danger/5'}">
                        <div class="flex items-center justify-between mb-1.5">
                            <div class="flex items-center gap-2"><span>${statusIcon}</span><span class="text-[12px] font-medium text-text-primary">Test ${tr.test_number}</span></div>
                            <span class="text-[11px] font-mono text-text-tertiary">${tr.execution_time_ms ?? '--'}ms</span>
                        </div>
                        ${!passed && tr.actual_output ? `<div class="text-[11px] font-mono text-text-tertiary mt-1"><span class="text-danger">Got:</span> ${this._esc(tr.actual_output.substring(0,100))}</div>` : ''}
                        ${!passed && tr.expected_output ? `<div class="text-[11px] font-mono text-text-tertiary"><span class="text-success">Expected:</span> ${this._esc(tr.expected_output.substring(0,100))}</div>` : ''}
                    </div>
                `;
            }
            testHtml += `</div>`;
        } else {
            testHtml = '<p class="text-text-secondary text-[13px]">No test results available.</p>';
        }

        testPanel.innerHTML = testHtml;

        // Append to chat thread
        const div = document.createElement('div');
        div.innerHTML = html;
        chatThread.appendChild(div.firstElementChild);
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