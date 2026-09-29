/**
 * session-view.js — UI controller for the evaluation IDE view.
 * Manages Monaco editor, session state, dry-run, submission, polling, and result rendering.
 */

const SessionView = {
    _sessionId: null,
    _language: 'python',
    _currentProblemId: null,
    _bottomPanelCollapsed: false,

    async init() {
        console.log('[SessionView] Initialized');
    },

    // ======================================================================
    // Session Info Bar — update language badge, label, and status
    // ======================================================================
    _updateInfoBar(session) {
        const langBadge = document.getElementById('session-lang-badge');
        const infoLabel = document.getElementById('session-info-label');
        const statusChip = document.getElementById('session-info-status');
        const statusText = document.getElementById('session-info-status-text');

        if (langBadge) {
            const langNames = { python: 'Python', cpp: 'C++', java: 'Java' };
            const langDotColors = { python: '#3572A5', cpp: '#f34b7d', java: '#b07219' };
            langBadge.dataset.lang = session.language;
            langBadge.innerHTML = `<span class="eval-lang-dot" style="background:${langDotColors[session.language] || '#3572A5'}"></span>${langNames[session.language] || session.language}`;
        }
        if (infoLabel) {
            infoLabel.textContent = session.submission_label || `Session #${session.session_id}`;
        }
        this._updateStatusChip(session.status);
    },

    _updateStatusChip(status) {
        const statusChip = document.getElementById('session-info-status');
        const statusText = document.getElementById('session-info-status-text');

        if (!statusChip || !statusText) return;

        // Reset classes
        statusChip.className = 'eval-status-chip';

        const statusMap = {
            draft: { text: 'Ready', cls: '' },
            pending: { text: 'Pending', cls: 'status-running' },
            dry_run_passed: { text: 'Dry Run OK', cls: 'status-complete' },
            generating_tests: { text: 'Generating', cls: 'status-running' },
            executing: { text: 'Executing', cls: 'status-running' },
            analyzing: { text: 'Analyzing', cls: 'status-running' },
            complete: { text: 'Complete', cls: 'status-complete' },
            failed: { text: 'Failed', cls: 'status-failed' },
            dry_run_failed: { text: 'Error', cls: 'status-failed' },
        };

        const info = statusMap[status] || { text: status, cls: '' };
        statusText.textContent = info.text;
        if (info.cls) statusChip.classList.add(info.cls);
    },

    // ======================================================================
    // Toggle helpers
    // ======================================================================
    toggleProblem() {
        const header = document.getElementById('problem-header');
        if (header) header.classList.toggle('collapsed');
    },

    toggleBottomPanel() {
        const panel = document.getElementById('bottom-panel');
        if (panel) {
            this._bottomPanelCollapsed = !this._bottomPanelCollapsed;
            panel.classList.toggle('collapsed', this._bottomPanelCollapsed);
        }
    },

    // ======================================================================
    // Load Session
    // ======================================================================
    async loadSession(sessionId) {
        this._sessionId = sessionId;
        try {
            const session = await ApiClient.getSession(sessionId);
            this._language = session.language;
            this._currentProblemId = session.problem_id;

            // Update info bar
            this._updateInfoBar(session);

            // Update sidebar active state
            document.querySelectorAll('.sess-item').forEach(el => {
                const sId = parseInt(el.dataset.sessionId, 10);
                el.classList.toggle('active', sId === sessionId);
            });

            // Update problem description
            const problemDesc = document.getElementById('problem-description');
            if (problemDesc && session.problem) {
                problemDesc.innerHTML = `
                    <p class="text-text-primary font-medium text-[14px] mb-2">${this._esc(session.problem.title)}</p>
                    <p class="text-text-secondary text-[13px] leading-relaxed whitespace-pre-line">${this._esc(session.problem.description)}</p>
                `;
                // Ensure problem panel is expanded
                const header = document.getElementById('problem-header');
                if (header) header.classList.remove('collapsed');
            }

            // Always update language and tab state
            MonacoSetup.switchLanguage(session.language);
            MonacoSetup.showOnlyTab(session.language);

            // Set editor content
            const editor = MonacoSetup.getEditor();
            if (editor) {
                editor.setValue(session.code || '');
            }

            // Reset bottom panel to problems tab
            App.switchBottomTab('problems');

            // If session already has analysis result, render it
            if (session.analysis) {
                this._renderEvaluation(session);
                document.getElementById('btn-export-pdf')?.classList.remove('hidden');
            } else if (['generating_tests', 'executing', 'analyzing', 'pending'].includes(session.status)) {
                // Show pipeline status and resume polling
                const statusEl = document.getElementById('pipeline-status');
                const statusTextEl = document.getElementById('pipeline-status-text');
                if (statusEl) { statusEl.classList.remove('hidden'); statusEl.classList.add('flex'); }
                if (statusTextEl) statusTextEl.textContent = 'Pipeline running...';
                const btn = document.getElementById('btn-submit');
                if (btn) {
                    btn.disabled = true;
                    btn.innerHTML = `<span class="animate-spin inline-block w-4 h-4 border-2 border-current border-t-transparent rounded-full mr-2"></span> Evaluating...`;
                }
                this._pollPipeline(sessionId);
            } else if (session.status === 'dry_run_failed' && session.dry_run) {
                // Show the dry-run error in the output panel
                this._renderDryRun(session.dry_run);
                App.switchBottomTab('output');
                document.getElementById('btn-export-pdf')?.classList.add('hidden');
            } else {
                // Reset analysis panel for new/draft session
                const chatThread = document.getElementById('chat-thread');
                if (chatThread) {
                    chatThread.innerHTML = `
                        <div class="eval-welcome-card">
                            <div class="eval-welcome-icon">
                                <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5"><path d="M22 11.08V12a10 10 0 1 1-5.93-9.14"/><path d="M22 4L12 14.01l-3-3"/></svg>
                            </div>
                            <h4 class="text-[14px] font-medium text-text-primary mb-1.5">Ready to Evaluate</h4>
                            <p class="text-[12px] text-text-tertiary leading-relaxed">Write your solution for <strong class="text-text-secondary">${this._esc(session.problem?.title || 'this problem')}</strong>, then click <strong class="text-accent">Submit Evaluation</strong> for full AI analysis.</p>
                        </div>
                    `;
                }
                document.getElementById('btn-export-pdf')?.classList.add('hidden');
            }

            // Auto-focus editor
            if (editor) setTimeout(() => editor.focus(), 100);

        } catch (err) {
            console.error('[SessionView] Failed to load session:', err);
            Toast.error(`Failed to load session: ${err.message}`);
        }
    },

    getEditorCode() {
        return MonacoSetup.getCode() || (window.monacoEditor ? window.monacoEditor.getValue() : '');
    },

    // ======================================================================
    // Dry Run
    // ======================================================================
    async dryRun() {
        if (!this._sessionId) {
            Toast.warning('No active session. Please create or select a session first.');
            return;
        }
        const code = this.getEditorCode();
        if (!code.trim()) {
            Toast.warning('Editor is empty. Write some code first.');
            return;
        }

        const btn = document.getElementById('btn-dry-run');
        btn.disabled = true;
        btn.innerHTML = `<span class="animate-spin inline-block w-3 h-3 border-2 border-current border-t-transparent rounded-full mr-1"></span> Running...`;

        try {
            const result = await ApiClient.dryRunSession(this._sessionId, code);
            this._renderDryRun(result);
            App.switchBottomTab('output');

            // Expand bottom panel if collapsed
            if (this._bottomPanelCollapsed) this.toggleBottomPanel();

            if (result.passed) {
                this._updateStatusChip('dry_run_passed');
                Toast.success('Dry run passed! No syntax or runtime errors.');
            } else {
                this._updateStatusChip('dry_run_failed');
                Toast.error('Dry run failed. See error output below.');
            }
        } catch (err) {
            Toast.error(`Dry run failed: ${err.message}`);
        } finally {
            btn.disabled = false;
            btn.innerHTML = `<svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor"><polygon points="5,3 19,12 5,21"/></svg> ▶ Run`;
        }
    },

    _renderDryRun(result) {
        const outputPanel = document.getElementById('output-content');
        const problemsPanel = document.getElementById('panel-problems');

        let output = '';
        if (result.stdout) output += `=== STDOUT ===\n${result.stdout}\n`;
        if (result.stderr) output += `${result.stdout ? '\n' : ''}=== STDERR ===\n${result.stderr}\n`;
        if (!output) output = result.passed ? '✓ Dry run completed successfully with no output.' : '✗ Dry run failed.';

        outputPanel.textContent = output;

        // Apply success/error styling to the output panel
        outputPanel.classList.remove('text-success', 'text-danger');
        if (!result.stderr && result.passed) {
            outputPanel.classList.add('text-success');
        } else if (!result.passed) {
            outputPanel.classList.add('text-danger');
        }

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
        } else if (result.passed) {
            problemsHtml = `<div class="eval-panel-empty">
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="var(--success)" stroke-width="2"><path d="M9 12l2 2 4-4"/><circle cx="12" cy="12" r="10"/></svg>
                <span class="text-success text-[13px]">No compilation or runtime errors detected.</span>
            </div>`;
            MonacoSetup.clearMarkers();
        } else {
            problemsHtml = `<div class="eval-panel-empty">
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" class="text-text-dim"><circle cx="12" cy="12" r="10"/><path d="M9 12l2 2 4-4"/></svg>
                <span>No compilation or runtime errors detected.</span>
            </div>`;
            MonacoSetup.clearMarkers();
        }
        problemsPanel.innerHTML = problemsHtml;
    },

    // ======================================================================
    // Submit Evaluation
    // ======================================================================
    async submit() {
        if (!this._sessionId) {
            Toast.warning('No active session. Please create or select a session first.');
            return;
        }
        const code = this.getEditorCode();
        if (!code.trim()) {
            Toast.warning('Editor is empty. Please enter your code before submitting.');
            return;
        }

        const btn = document.getElementById('btn-submit');
        btn.disabled = true;
        btn.innerHTML = `<span class="animate-spin inline-block w-4 h-4 border-2 border-current border-t-transparent rounded-full mr-2"></span> Evaluating...`;

        const statusEl = document.getElementById('pipeline-status');
        const statusTextEl = document.getElementById('pipeline-status-text');
        if (statusEl) { statusEl.classList.remove('hidden'); statusEl.classList.add('flex'); }
        if (statusTextEl) statusTextEl.textContent = 'Pipeline started...';

        this._updateStatusChip('pending');

        try {
            await ApiClient.submitSession(this._sessionId, code);
            Toast.info('Evaluation pipeline launched! Running verification...');
            this._pollPipeline(this._sessionId);
        } catch (err) {
            Toast.error(`Evaluation failed to start: ${err.message}`);
            btn.disabled = false;
            btn.innerHTML = `<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M22 2L11 13"/><path d="M22 2l-7 20-4-9-9-4 20-7z"/></svg> Submit Evaluation`;
            if (statusEl) { statusEl.classList.add('hidden'); statusEl.classList.remove('flex'); }
            this._updateStatusChip('draft');
        }
    },

    _pollPipeline(sessionId) {
        const statusMap = {
            pending: 'Initializing evaluation...',
            dry_run_passed: 'Dry run passed, generating tests...',
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
                const statusTextEl = document.getElementById('pipeline-status-text');
                if (statusTextEl) {
                    statusTextEl.textContent = statusMap[session.status] || 'Evaluating...';
                }

                // Update info bar status
                this._updateStatusChip(session.status);

                if (session.status === 'complete' || session.status === 'failed' || session.status === 'dry_run_failed') {
                    clearInterval(pollInterval);
                    const statusEl = document.getElementById('pipeline-status');
                    if (statusEl) { statusEl.classList.add('hidden'); statusEl.classList.remove('flex'); }

                    const btn = document.getElementById('btn-submit');
                    if (btn) {
                        btn.disabled = false;
                        btn.innerHTML = `<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M22 2L11 13"/><path d="M22 2l-7 20-4-9-9-4 20-7z"/></svg> Submit Evaluation`;
                    }

                    if (session.status === 'complete') {
                        this._renderEvaluation(session);
                        App.switchBottomTab('test-results');

                        // Expand bottom panel if collapsed
                        if (this._bottomPanelCollapsed) this.toggleBottomPanel();

                        document.getElementById('btn-export-pdf')?.classList.remove('hidden');
                        Toast.success(`Evaluation complete! Score: ${session.analysis?.final_score || 0}/100`);
                    } else if (session.status === 'dry_run_failed') {
                        if (session.dry_run) {
                            this._renderDryRun(session.dry_run);
                        }
                        App.switchBottomTab('output');
                        if (this._bottomPanelCollapsed) this.toggleBottomPanel();
                        const chatThread = document.getElementById('chat-thread');
                        if (chatThread) {
                            chatThread.innerHTML += `
                                <div class="feed-card" style="border-left: 3px solid var(--danger, #c97b6b);">
                                    <p class="text-[13px] text-danger font-medium">Dry Run Failed</p>
                                    <p class="text-[12px] text-text-tertiary mt-1">Your code has compilation or runtime errors. Fix the issues shown in the Output tab and resubmit.</p>
                                </div>
                            `;
                        }
                        Toast.error('Dry run failed. Check diagnostics in Output tab.');
                    } else {
                        // Show detailed failure reason
                        const chatThread = document.getElementById('chat-thread');
                        let failReason = session.history_summary || 'An unexpected error occurred during evaluation.';
                        if (failReason.startsWith('Pipeline halted:')) {
                            failReason = failReason.replace('Pipeline halted: ', '');
                        }
                        if (chatThread) {
                            chatThread.innerHTML += `
                                <div class="feed-card" style="border-left: 3px solid var(--danger, #c97b6b);">
                                    <p class="text-[13px] text-danger font-medium mb-1">Evaluation Failed</p>
                                    <p class="text-[12px] text-text-tertiary leading-relaxed">${this._esc(failReason)}</p>
                                    <button onclick="SessionView.submit()" class="eval-run-btn !h-8 !px-4 !text-[12px] mt-3" style="color:var(--accent);background:var(--accent-ghost);border-color:rgba(201,169,110,0.2);">
                                        <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M23 4v6h-6"/><path d="M1 20v-6h6"/><path d="M3.51 9a9 9 0 0 1 14.85-3.36L23 10M1 14l4.64 4.36A9 9 0 0 0 20.49 15"/></svg>
                                        Retry Evaluation
                                    </button>
                                </div>
                            `;
                        }
                        App.switchBottomTab('output');
                        Toast.error('Evaluation pipeline failed. See details in the analysis panel.');
                    }

                    await App.refreshSidebar();
                }
            } catch (err) {
                console.error('[SessionView] Poll error:', err);
            }
        }, 2000);
    },

    // ======================================================================
    // Render Evaluation Results
    // ======================================================================
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

        // Build score ring
        const ringPercent = typeof score === 'number' ? score : 0;
        const ringColor = ringPercent >= 75 ? 'var(--success)' : (ringPercent >= 50 ? 'var(--warning)' : 'var(--danger)');

        let html = `
            <div class="feed-card feed-card-analysis">
                <div class="flex items-center justify-between mb-4">
                    <span class="verdict ${verdictClass}">${verdictLabel}</span>
                    <div class="flex items-center gap-3">
                        <div class="text-right">
                            <div class="text-[10px] font-mono text-text-dim uppercase tracking-wider">Score</div>
                            <div class="text-[22px] font-display font-semibold text-text-primary leading-none" style="color:${ringColor}">${score}</div>
                        </div>
                        <div class="text-[11px] font-mono text-text-dim">/100</div>
                    </div>
                </div>
        `;

        if (analysis.correctness_summary) {
            html += `<div class="mb-4 p-3 bg-void/50 rounded-lg border border-border-subtle"><p class="text-[12px] text-text-secondary leading-relaxed">${this._esc(analysis.correctness_summary)}</p></div>`;
        }

        html += `<div class="mb-4 space-y-2">`;
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
            const barColor = values[i] >= 75 ? 'var(--success)' : (values[i] >= 50 ? 'var(--warning)' : 'var(--danger)');
            html += `
                <div class="score-bar-row !mb-1.5">
                    <span class="score-bar-lbl !w-[90px] !text-[11px]">${labels[i]}</span>
                    <div class="score-bar-bg"><div class="score-bar-fill" style="width:${values[i]}%;background:linear-gradient(90deg, ${barColor}88, ${barColor})"></div></div>
                    <span class="score-bar-val !text-[11px]">${values[i]}</span>
                </div>`;
        }
        html += `</div>`;

        // Chart.js Complexity Visualization
        if (analysis.complexity_chart && analysis.complexity_chart.labels && analysis.complexity_chart.labels.length > 0) {
            html += `
                <div class="mb-4">
                    <div class="feed-section-label">Complexity Visualizer</div>
                    <div class="chart-card">
                        <canvas id="complexity-chart-canvas"></canvas>
                    </div>
                </div>
            `;
        }

        if (analysis.code_explanation) {
            html += `<div class="mb-4"><div class="feed-section-label">Code Explanation</div><p class="text-[12px] text-text-secondary leading-relaxed">${this._esc(analysis.code_explanation)}</p></div>`;
        }

        if (analysis.time_complexity || analysis.space_complexity) {
            html += `<div class="grid grid-cols-2 gap-2 mb-4 text-[11px] font-mono">`;
            if (analysis.time_complexity) html += `<div class="p-2.5 bg-void rounded-lg border border-border-subtle"><span class="text-text-dim block text-[10px] mb-0.5">Time</span><span class="text-success font-semibold text-[12px]">${this._esc(analysis.time_complexity)}</span></div>`;
            if (analysis.space_complexity) html += `<div class="p-2.5 bg-void rounded-lg border border-border-subtle"><span class="text-text-dim block text-[10px] mb-0.5">Space</span><span class="text-success font-semibold text-[12px]">${this._esc(analysis.space_complexity)}</span></div>`;
            html += `</div>`;
        }

        if (analysis.quality_issues && analysis.quality_issues.length > 0) {
            html += `<div class="mb-4"><div class="feed-section-label">Quality Issues</div>`;
            for (const qi of analysis.quality_issues) {
                const sev = qi.severity || 'low';
                const sevClass = { high: 'qi-high', medium: 'qi-medium', low: 'qi-low' }[sev] || 'qi-low';
                const desc = qi.issue || qi.description || '';
                html += `<div class="quality-issue mb-1.5"><span class="qi-sev ${sevClass}">${sev.toUpperCase()}</span><span class="text-text-secondary text-[12px]">${this._esc(desc)}</span></div>`;
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

        // Test Results Panel
        let testHtml = '';
        let passCount = 0;
        let totalCount = 0;
        if (session.test_results && session.test_results.length > 0) {
            totalCount = session.test_results.length;
            passCount = session.test_results.filter(t => t.passed).length;

            // Summary bar
            testHtml += `
                <div class="flex items-center justify-between mb-3 pb-3 border-b border-border-subtle">
                    <div class="flex items-center gap-2">
                        <span class="text-[13px] font-medium text-text-primary">${passCount}/${totalCount} Passed</span>
                        <span class="text-[11px] font-mono text-text-dim">(${Math.round(passCount/totalCount*100)}%)</span>
                    </div>
                    <div class="flex gap-1">
                        ${session.test_results.map((tr, i) =>
                            `<div class="w-3 h-3 rounded-sm ${tr.passed ? 'bg-success/50' : 'bg-danger/50'}" title="Test ${i+1}"></div>`
                        ).join('')}
                    </div>
                </div>
            `;

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

        // Update test count badge
        const testCountBadge = document.getElementById('test-results-count');
        if (testCountBadge && totalCount > 0) {
            testCountBadge.textContent = `${passCount}/${totalCount}`;
            testCountBadge.classList.remove('hidden');
        }

        chatThread.innerHTML = html;
        chatThread.scrollTop = chatThread.scrollHeight;

        // Render Chart.js complexity chart if canvas exists
        setTimeout(() => {
            if (analysis.complexity_chart && typeof Charts !== 'undefined') {
                Charts.renderComplexityChart('complexity-chart-canvas', analysis.complexity_chart);
            }
        }, 50);
    },

    async exportPdf() {
        if (!this._sessionId) return;
        try {
            Toast.info('Generating session PDF report...');
            const blob = await ApiClient.exportSessionPdf(this._sessionId);
            downloadBlob(blob, `verdict_session_${this._sessionId}.pdf`);
            Toast.success('PDF report downloaded successfully.');
        } catch (e) {
            Toast.error(`Export failed: ${e.message}`);
        }
    },

    _esc(s) { if (!s) return ''; const d = document.createElement('div'); d.textContent = s; return d.innerHTML; },
};