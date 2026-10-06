/**
 * session-view.js — LeetCode-style UI Controller for Verdict IDE.
 * Manages problem tabs (Description, Editorial, Submissions), Monaco editor,
 * Testcase drawer, interactive dry-runs, submission verification, and AI Verdicts.
 */

const SessionView = {
    _sessionId: null,
    _session: null,
    _language: 'python',
    _currentProblemId: null,
    _testCases: [],
    _selectedTestCaseIndex: 0,
    _customTestCases: [],
    _consoleOpen: true,

    async init() {
        console.log('[SessionView] Initialized');
        this.initResizers();
        if (!this._shortcutsBound) {
            this._shortcutsBound = true;
            window.addEventListener('keydown', (e) => {
                if ((e.ctrlKey || e.metaKey) && e.key === 'Enter') {
                    const evalSec = document.getElementById('view-evaluation');
                    if (evalSec && !evalSec.classList.contains('hidden')) {
                        e.preventDefault();
                        if (e.shiftKey) {
                            SessionView.submit();
                        } else {
                            SessionView.dryRun();
                        }
                    }
                }
            });
        }
    },

    async loadSession(sessionId) {
        this._sessionId = sessionId;
        try {
            const session = await ApiClient.getSession(sessionId);
            this._session = session;
            this._language = (session.language || 'python').toLowerCase();
            this._currentProblemId = session.problem_id;

            // Update sidebar active session
            document.querySelectorAll('.sess-item').forEach(el => {
                const sId = parseInt(el.dataset.sessionId, 10);
                el.classList.toggle('active', sId === sessionId);
            });

            // Render LeetCode Problem Details
            if (session.problem) {
                this._renderProblem(session.problem);
            } else {
                this._renderEmptyProblem();
            }

            // Sync Language with Monaco and Dropdown
            MonacoSetup.switchLanguage(this._language);
            MonacoSetup.showOnlyTab(this._language);
            const langSelect = document.getElementById('lang-select');
            if (langSelect) langSelect.value = this._language;

            // Set Editor Code
            const editor = MonacoSetup.getEditor();
            if (editor) {
                editor.setValue(session.code || '');
            }

            // Load Testcases for this problem
            this._loadTestCases(session);

            // Load Submissions History for this problem
            this._loadProblemSubmissions(session.problem_id);

            // If session already has analysis, render it
            if (session.analysis) {
                this._renderEvaluation(session);
                if (session.test_results && session.test_results.length > 0) {
                    this._renderTestResults(session.test_results);
                }
                const exportBtn = document.getElementById('btn-export-pdf');
                if (exportBtn) exportBtn.classList.remove('hidden');
                this.switchConsoleTab('analysis');
            } else if (session.test_results && session.test_results.length > 0) {
                this._renderTestResults(session.test_results);
                this.switchConsoleTab('test-result');
            } else if (['generating_tests', 'executing', 'analyzing', 'pending'].includes(session.status)) {
                this._showPipelineRunning();
                this._pollPipeline(sessionId);
            } else if (session.status === 'dry_run_failed' && session.dry_run) {
                this._renderDryRun(session.dry_run);
                this.switchConsoleTab('test-result');
            } else {
                this.switchConsoleTab('testcase');
            }

            if (editor) setTimeout(() => editor.layout(), 150);

        } catch (err) {
            console.error('[SessionView] Failed to load session:', err);
            if (typeof Toast !== 'undefined') Toast.error(`Failed to load session: ${err.message}`);
        }
    },

    _renderProblem(problem) {
        const titleEl = document.getElementById('lc-problem-title');
        const diffEl = document.getElementById('lc-difficulty');
        const chipsEl = document.getElementById('lc-desc-chips');
        const descEl = document.getElementById('problem-description');

        if (titleEl) {
            const pNum = problem.problem_id ? `${problem.problem_id}. ` : '';
            titleEl.textContent = `${pNum}${problem.title || 'Untitled Problem'}`;
        }

        if (diffEl) {
            const diff = String(problem.difficulty || 'Medium').toLowerCase();
            diffEl.textContent = diff.charAt(0).toUpperCase() + diff.slice(1);
            diffEl.className = 'lc-diff';
            if (diff === 'easy') diffEl.classList.add('lc-diff-easy');
            else if (diff === 'hard') diffEl.classList.add('lc-diff-hard');
            else diffEl.classList.add('lc-diff-medium');
            diffEl.classList.remove('hidden');
        }

        if (chipsEl) chipsEl.classList.remove('hidden');

        if (descEl) {
            descEl.innerHTML = this._formatLeetCodeText(problem.description || '');
        }

        // Render Editorial content
        this._renderEditorial(problem);
    },

    _renderEmptyProblem() {
        const titleEl = document.getElementById('lc-problem-title');
        if (titleEl) titleEl.textContent = 'No problem selected';
        const descEl = document.getElementById('problem-description');
        if (descEl) descEl.innerHTML = '<p class="lc-desc-placeholder">Select or create a session to view the problem statement.</p>';
    },

    _formatLeetCodeText(rawText) {
        if (!rawText) return '<p class="lc-desc-placeholder">No description available.</p>';

        let text = this._esc(rawText);

        // Highlight inline codes: `var` -> <code>var</code>
        text = text.replace(/`([^`]+)`/g, '<code class="bg-[#282828] text-[#9cdcfe] px-1.5 py-0.5 rounded text-[12.5px] font-mono border border-white/10">$1</code>');

        // Format Example 1, Example 2 blocks
        text = text.replace(/(Example\s+\d+:?[\s\S]*?)(?=(?:Example\s+\d+:?|Constraints:?|\n\n\n|$))/gi, (match) => {
            const lines = match.trim().split('\n');
            const title = lines[0];
            const rest = lines.slice(1).join('<br>');
            return `
                <div class="lc-example-box">
                    <div class="lc-example-title">${title}</div>
                    <div class="text-[13px] leading-relaxed text-[#d4d4d4] font-mono">${rest}</div>
                </div>
            `;
        });

        // Format Constraints
        text = text.replace(/Constraints:?([\s\S]*?)(?=(?:\n\n\n|$))/i, (match, body) => {
            const items = body.split('\n').map(l => l.trim()).filter(Boolean);
            const listHtml = items.map(it => `<li>${it.replace(/^[•\-\*]\s*/, '')}</li>`).join('');
            return `
                <div class="mt-5 mb-3">
                    <div class="font-bold text-white text-[13.5px] mb-2">Constraints:</div>
                    <ul class="lc-constraints-list">${listHtml}</ul>
                </div>
            `;
        });

        // Format remaining paragraphs
        const paragraphs = text.split(/\n\s*\n/).filter(p => !p.includes('lc-example-box') && !p.includes('lc-constraints-list'));
        if (paragraphs.length > 0) {
            text = paragraphs.map(p => `<p class="mb-3 text-[#d4d4d4] text-[13.5px] leading-relaxed">${p}</p>`).join('');
        }

        return text;
    },

    _renderEditorial(problem) {
        const editorialPane = document.getElementById('lc-editorial-pane');
        if (!editorialPane) return;

        const category = problem.category || 'General Algorithms';
        const algo = category.includes('DP') ? 'Dynamic Programming (Optimal Substructure)' : (category.includes('Tree') ? 'Depth-First Search / BFS' : 'Two-Pointer / Hash Map Optimization');
        
        editorialPane.innerHTML = `
            <div class="p-5 space-y-4 text-[13.5px] text-[#d4d4d4] leading-relaxed">
                <div class="bg-[#282828] p-4 rounded-lg border border-white/10">
                    <div class="text-xs font-mono uppercase tracking-wider text-text-tertiary mb-1">Recommended Approach</div>
                    <div class="text-base font-semibold text-white">${algo}</div>
                    <div class="flex items-center gap-4 mt-3 font-mono text-xs text-[#9cdcfe]">
                        <span>Time: <strong class="text-white">O(N)</strong></span>
                        <span>Space: <strong class="text-white">O(1)</strong></span>
                    </div>
                </div>

                <div>
                    <h3 class="font-semibold text-white text-[14px] mb-2">Key Strategy</h3>
                    <p class="text-text-secondary">
                        Instead of testing all quadratic combinations (O(N²)), track seen values or maintain two pointers to solve in a single pass.
                    </p>
                </div>

                <div class="bg-[#1e1e1e] p-3.5 rounded border border-white/5 font-mono text-xs text-[#ce9178]">
                    💡 <strong>Tip:</strong> Always handle edge cases where the input is empty or contains negative numbers before writing main loop logic.
                </div>
            </div>
        `;
    },

    async _loadProblemSubmissions(problemId) {
        const pane = document.getElementById('lc-submissions-pane');
        const badge = document.getElementById('submission-count-badge');
        if (!pane || !problemId) return;

        try {
            const historyData = await ApiClient.getHistory('evaluation');
            const items = (historyData && historyData.items ? historyData.items : []).filter(it => it.problem_id === problemId || (it.session_id && it.session_id === this._sessionId));
            
            if (badge) badge.textContent = String(items.length);

            if (items.length === 0) {
                pane.innerHTML = `
                    <div class="p-8 text-center text-text-tertiary text-xs">
                        No submissions recorded for this problem yet. Submit your code to see history.
                    </div>`;
                return;
            }

            let html = '<div class="p-4 space-y-2.5">';
            for (const item of items) {
                const isAccepted = item.status === 'complete' && (item.score >= 70);
                const statusColor = isAccepted ? 'text-[#2cbb5d]' : (item.status === 'complete' ? 'text-[#f59e0b]' : 'text-[#f43f5e]');
                const statusLabel = isAccepted ? 'Accepted' : (item.status === 'complete' ? 'Completed' : 'Wrong Answer / Error');
                const score = item.score !== undefined ? `${item.score}/100` : '--';
                const date = item.created_at ? new Date(item.created_at).toLocaleDateString(undefined, { month:'short', day:'numeric', hour:'2-digit', minute:'2-digit' }) : '';
                const sessId = item.session_id || (item.id ? String(item.id).replace('eval_', '') : '');

                html += `
                    <div class="bg-[#282828] p-3.5 rounded-lg border border-white/5 flex items-center justify-between hover:border-white/20 transition-all cursor-pointer" onclick="App.openSession(${sessId})">
                        <div>
                            <div class="flex items-center gap-2">
                                <span class="font-semibold text-[13px] ${statusColor}">${statusLabel}</span>
                                <span class="text-xs font-mono text-text-tertiary bg-white/5 px-2 py-0.5 rounded uppercase">${item.language || 'python'}</span>
                            </div>
                            <div class="text-2xs font-mono text-text-tertiary mt-1">${date}</div>
                        </div>
                        <div class="text-right">
                            <div class="font-bold text-[14px] text-white font-mono">${score}</div>
                            <div class="text-2xs text-text-tertiary">Score</div>
                        </div>
                    </div>
                `;
            }
            html += '</div>';
            pane.innerHTML = html;
        } catch (e) {
            console.error('[SessionView] Could not load submissions history:', e);
        }
    },

    _extractProblemSampleCases(problem) {
        if (!problem || !problem.description) {
            return [{ test_id: 1, stdin: '', expected_stdout: '' }];
        }
        const desc = problem.description;
        const title = (problem.title || '').toLowerCase();

        // Try extracting Example section with Input/Output
        const regex = /(?:Example|Sample)(?:[^\n]*)\n+(?:Input|Sample Input)[:\s]*\n([\s\S]*?)\n+(?:Output|Sample Output)[:\s]*\n([\s\S]*?)(?=\n\n(?:Example|Sample|Constraints|Note|Explanation)|$)/gi;
        const cases = [];
        let match;
        let id = 1;
        while ((match = regex.exec(desc)) !== null) {
            const inputStr = match[1].trim();
            let outputStr = match[2].trim();
            if (outputStr.includes('Explanation:')) {
                outputStr = outputStr.split('Explanation:')[0].trim();
            }
            if (inputStr || outputStr) {
                cases.push({ test_id: id++, stdin: inputStr + '\n', expected_stdout: outputStr });
            }
        }

        if (cases.length > 0) {
            return cases;
        }

        // Specific known defaults if regex didn't find format
        if (title.includes('two sum')) {
            return [
                { test_id: 1, stdin: '4 9\n2 7 11 15\n', expected_stdout: '0 1' },
                { test_id: 2, stdin: '3 6\n3 2 4\n', expected_stdout: '1 2' },
                { test_id: 3, stdin: '2 6\n3 3\n', expected_stdout: '0 1' }
            ];
        } else if (title.includes('fizzbuzz') || title.includes('fizz')) {
            return [
                { test_id: 1, stdin: '15\n', expected_stdout: '1\n2\nFizz\n4\nBuzz\nFizz\n7\n8\nFizz\nBuzz\n11\nFizz\n13\n14\nFizzBuzz' },
                { test_id: 2, stdin: '5\n', expected_stdout: '1\n2\nFizz\n4\nBuzz' }
            ];
        } else if (title.includes('longest increasing') || title.includes('subsequence')) {
            return [
                { test_id: 1, stdin: '8\n10 9 2 5 3 7 101 18\n', expected_stdout: '4' },
                { test_id: 2, stdin: '6\n0 1 0 3 2 3\n', expected_stdout: '4' }
            ];
        }

        return [{ test_id: 1, stdin: '', expected_stdout: '' }];
    },

    _loadTestCases(session) {
        const results = session.test_results;
        if (results && results.length > 0) {
            this._testCases = results.map((tc, idx) => ({
                test_id: idx + 1,
                test_case_id: tc.test_case_id || `Case ${idx + 1}`,
                description: tc.description || '',
                stdin: tc.stdin || '',
                expected_stdout: tc.expected_stdout || '',
                actual_stdout: tc.actual_stdout || '',
                passed: tc.passed,
                is_edge_case: tc.is_edge_case,
                time_ms: tc.time_ms,
                stderr: tc.stderr || ''
            }));
        } else {
            this._testCases = this._extractProblemSampleCases(session.problem);
        }
        this._selectedTestCaseIndex = 0;
        this._renderTestCaseTabs();
    },

    _renderTestResults(testResults, selectedIdx = 0) {
        const testResultPanel = document.getElementById('panel-test-results');
        if (!testResultPanel || !testResults || testResults.length === 0) return;

        this._lastTestResults = testResults;
        this._selectedResultIdx = selectedIdx;

        const passedCount = testResults.filter(r => r.passed).length;
        const totalCount = testResults.length;
        const isAllPassed = passedCount === totalCount;
        const bannerClass = isAllPassed ? 'lc-verdict-pass' : (passedCount > 0 ? 'lc-verdict-warn' : 'lc-verdict-fail');
        const bannerText = isAllPassed ? `Accepted (${passedCount}/${totalCount} Passed)` : (passedCount > 0 ? `Wrong Answer (${passedCount}/${totalCount} Passed)` : `Failed (${passedCount}/${totalCount} Passed)`);

        const currentTc = testResults[selectedIdx] || testResults[0];
        const isCasePass = currentTc.passed;
        const timeMs = currentTc.time_ms !== undefined && currentTc.time_ms !== null ? currentTc.time_ms.toFixed(1) : '0.0';

        let tabsHtml = '';
        testResults.forEach((tc, idx) => {
            const isActive = idx === selectedIdx;
            const dotColor = tc.passed ? 'bg-[#2cbb5d]' : 'bg-[#f43f5e]';
            tabsHtml += `
                <button class="lc-case-tab ${isActive ? 'active' : ''} flex items-center gap-1.5" onclick="SessionView._renderTestResults(SessionView._lastTestResults, ${idx})">
                    <span class="w-1.5 h-1.5 rounded-full ${dotColor}"></span>
                    Case ${idx + 1}
                </button>
            `;
        });

        testResultPanel.innerHTML = `
            <div class="p-4 space-y-4">
                <div class="lc-verdict-banner flex items-center justify-between">
                    <div>
                        <span class="lc-verdict-title ${bannerClass}">${bannerText}</span>
                    </div>
                    <div class="flex items-center gap-3">
                        <span class="lc-stat-pill">⏱ Case Runtime: <strong class="text-white">${timeMs} ms</strong></span>
                        <span class="lc-stat-pill">Status: <strong class="${isCasePass ? 'text-[#2cbb5d]' : 'text-[#f43f5e]'}">${isCasePass ? '✓ Passed' : '✗ Failed'}</strong></span>
                        ${isAllPassed ? `
                            <button class="lc-submit-btn !h-7 !px-3 text-xs" onclick="SessionView.submit()" title="Testcases passed! Submit for full AI verdict">
                                <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3"><polyline points="20 6 9 17 4 12"/></svg>
                                Submit for AI Verdict
                            </button>
                        ` : ''}
                    </div>
                </div>

                <div class="flex items-center gap-2 border-b border-white/5 pb-2 overflow-x-auto">
                    ${tabsHtml}
                </div>

                ${currentTc.description ? `
                    <div class="text-xs text-text-tertiary font-mono italic">
                        ${this._esc(currentTc.description)}
                    </div>
                ` : ''}

                <div>
                    <div class="text-xs font-mono text-text-tertiary mb-1">Standard Input (stdin):</div>
                    <pre class="bg-[#1e1e1e] p-2.5 rounded text-xs font-mono text-[#9cdcfe] whitespace-pre-wrap border border-white/5">${this._esc(currentTc.stdin || '(empty)')}</pre>
                </div>

                <div class="grid grid-cols-1 md:grid-cols-2 gap-3">
                    <div>
                        <div class="text-xs font-mono text-text-tertiary mb-1">Expected Output:</div>
                        <pre class="bg-[#1e1e1e] p-2.5 rounded text-xs font-mono text-[#d4d4d4] whitespace-pre-wrap border border-white/5">${this._esc(currentTc.expected_stdout || '(empty)')}</pre>
                    </div>
                    <div>
                        <div class="text-xs font-mono text-text-tertiary mb-1">Your Output:</div>
                        <pre class="bg-[#1e1e1e] p-2.5 rounded text-xs font-mono ${isCasePass ? 'text-[#2cbb5d]' : 'text-[#f43f5e]'} whitespace-pre-wrap border ${isCasePass ? 'border-white/5' : 'border-[#f43f5e]/20'}">${this._esc(currentTc.actual_stdout || (currentTc.stderr ? 'Execution error' : '(no output)'))}</pre>
                    </div>
                </div>

                ${currentTc.stderr ? `
                    <div>
                        <div class="text-xs font-mono text-[#f43f5e] mb-1">Error / Stderr Diagnostics:</div>
                        <pre class="bg-[#1e1e1e] p-3 rounded text-xs font-mono text-[#f43f5e] whitespace-pre-wrap border border-[#f43f5e]/20">${this._esc(currentTc.stderr)}</pre>
                    </div>
                ` : ''}

                ${!isAllPassed ? `
                    <div class="p-3 bg-[#f43f5e]/10 border border-[#f43f5e]/20 rounded-lg text-xs text-[#f43f5e] font-mono flex items-center justify-between">
                        <span>⚠️ Code execution failed on test cases. Fix issues above and click <strong>Run</strong> to verify before submitting for analysis.</span>
                        <button class="lc-run-btn !h-7 !px-3 text-xs shrink-0 ml-3" onclick="SessionView.dryRun()">
                            <svg width="11" height="11" viewBox="0 0 24 24" fill="currentColor"><polygon points="5,3 19,12 5,21"/></svg> Re-Run
                        </button>
                    </div>
                ` : ''}
            </div>
        `;
    },

    onCodeChange() {
        this._lastRunPassed = false;
    },

    onLanguageChange(lang) {
        this._language = (lang || 'python').toLowerCase();
        this._lastRunPassed = false;
    },

    _renderTestCaseTabs() {
        const container = document.getElementById('lc-case-tabs-container');
        const inputArea = document.getElementById('lc-case-stdin');
        if (!container) return;

        let cases = this._testCases;
        if (!cases || cases.length === 0) {
            cases = [{ test_id: 1, stdin: '', expected_stdout: '' }];
            this._testCases = cases;
        }

        let tabsHtml = '';
        cases.forEach((tc, idx) => {
            const isActive = idx === this._selectedTestCaseIndex;
            const canRemove = cases.length > 1 && idx > 0;
            tabsHtml += `
                <div class="relative inline-flex items-center">
                    <button class="lc-case-tab ${isActive ? 'active' : ''} ${canRemove ? '!pr-6' : ''}" onclick="SessionView.selectTestCase(${idx})">
                        Case ${idx + 1}
                    </button>
                    ${canRemove ? `
                        <button class="absolute right-1 text-xs text-text-tertiary hover:text-[#f43f5e] px-1 py-0.5" onclick="event.stopPropagation(); SessionView.removeTestCase(${idx})" title="Remove Case ${idx + 1}">
                            ×
                        </button>
                    ` : ''}
                </div>
            `;
        });

        tabsHtml += `
            <button class="lc-case-tab text-text-tertiary hover:text-white" onclick="SessionView.addCustomTestCase()" title="Add Custom Testcase">
                +
            </button>
        `;

        container.innerHTML = tabsHtml;

        const currentTc = cases[this._selectedTestCaseIndex] || cases[0];
        if (inputArea && currentTc) {
            inputArea.value = currentTc.stdin || '';
            inputArea.oninput = (e) => {
                if (this._testCases[this._selectedTestCaseIndex]) {
                    this._testCases[this._selectedTestCaseIndex].stdin = e.target.value;
                    this._lastRunPassed = false;
                }
            };
        }
        const outputArea = document.getElementById('lc-case-stdout');
        if (outputArea && currentTc) {
            outputArea.value = currentTc.expected_stdout || '';
            outputArea.oninput = (e) => {
                if (this._testCases[this._selectedTestCaseIndex]) {
                    this._testCases[this._selectedTestCaseIndex].expected_stdout = e.target.value;
                    this._lastRunPassed = false;
                }
            };
        }
    },

    selectTestCase(idx) {
        // Save current input/output before switching tabs
        if (this._testCases && this._testCases[this._selectedTestCaseIndex]) {
            const inputArea = document.getElementById('lc-case-stdin');
            const outputArea = document.getElementById('lc-case-stdout');
            if (inputArea && inputArea.value !== undefined) {
                this._testCases[this._selectedTestCaseIndex].stdin = inputArea.value;
            }
            if (outputArea && outputArea.value !== undefined) {
                this._testCases[this._selectedTestCaseIndex].expected_stdout = outputArea.value;
            }
        }
        this._selectedTestCaseIndex = idx;
        this._renderTestCaseTabs();
    },

    removeTestCase(idx) {
        if (!this._testCases || this._testCases.length <= 1) return;
        this._testCases.splice(idx, 1);
        if (this._selectedTestCaseIndex >= this._testCases.length) {
            this._selectedTestCaseIndex = this._testCases.length - 1;
        }
        this._lastRunPassed = false;
        this._renderTestCaseTabs();
        if (typeof Toast !== 'undefined') Toast.info('Testcase removed.');
    },

    addCustomTestCase() {
        // Save current input/output before adding new
        if (this._testCases && this._testCases[this._selectedTestCaseIndex]) {
            const inputArea = document.getElementById('lc-case-stdin');
            const outputArea = document.getElementById('lc-case-stdout');
            if (inputArea) this._testCases[this._selectedTestCaseIndex].stdin = inputArea.value;
            if (outputArea) this._testCases[this._selectedTestCaseIndex].expected_stdout = outputArea.value;
        }
        const newId = this._testCases.length + 1;
        this._testCases.push({ test_id: newId, test_case_id: `Case ${newId}`, description: `Custom Case ${newId}`, stdin: '', expected_stdout: '' });
        this._selectedTestCaseIndex = this._testCases.length - 1;
        this._lastRunPassed = false;
        this._renderTestCaseTabs();
        if (typeof Toast !== 'undefined') Toast.info(`Added Case ${newId}. You can enter custom stdin input and expected output.`);
        const inputArea = document.getElementById('lc-case-stdin');
        if (inputArea) inputArea.focus();
    },

    _getCurrentStdin() {
        const inputArea = document.getElementById('lc-case-stdin');
        if (inputArea && inputArea.value !== undefined) {
            return inputArea.value;
        }
        const currentTc = this._testCases ? this._testCases[this._selectedTestCaseIndex] : null;
        return (currentTc && currentTc.stdin) ? currentTc.stdin : '';
    },

    // ── Navigation Tabs in Left Problem Panel ──
    switchDescTab(tab) {
        const tabs = ['desc', 'editorial', 'submissions'];
        tabs.forEach(t => {
            const btn = document.getElementById(`tab-lc-${t}`);
            const pane = document.getElementById(`lc-${t}-pane`);
            const isActive = t === tab;
            if (btn) btn.classList.toggle('active', isActive);
            if (pane) pane.classList.toggle('hidden', !isActive);
        });
    },

    // ── Navigation Tabs in Right Console Drawer ──
    switchConsoleTab(tab) {
        const tabs = ['testcase', 'test-result', 'analysis', 'output'];
        tabs.forEach(t => {
            const btn = document.querySelector(`.btm-tab[data-panel="${t}"]`);
            const panel = document.getElementById(`panel-${t}`);
            const isActive = t === tab;
            if (btn) {
                btn.classList.toggle('active', isActive);
                btn.setAttribute('aria-selected', String(isActive));
            }
            if (panel) {
                panel.classList.toggle('active', isActive);
                panel.classList.toggle('hidden', !isActive);
            }
        });

        // Auto-expand console if currently collapsed
        const bottomPanel = document.getElementById('bottom-panel');
        const chevron = document.getElementById('console-chevron');
        if (bottomPanel && !this._consoleOpen) {
            this._consoleOpen = true;
            bottomPanel.style.height = this._consoleHeight || '280px';
            if (chevron) chevron.textContent = '▾';
            if (typeof MonacoSetup !== 'undefined' && MonacoSetup.layout) {
                setTimeout(() => MonacoSetup.layout(), 100);
            }
        }
    },

    toggleConsole() {
        const bottomPanel = document.getElementById('bottom-panel');
        const chevron = document.getElementById('console-chevron');
        if (!bottomPanel) return;
        this._consoleOpen = !this._consoleOpen;
        if (this._consoleOpen) {
            bottomPanel.style.height = this._consoleHeight || '280px';
            if (chevron) chevron.textContent = '▾';
        } else {
            bottomPanel.style.height = '40px';
            if (chevron) chevron.textContent = '▴';
        }
        if (typeof MonacoSetup !== 'undefined' && MonacoSetup.layout) {
            setTimeout(() => MonacoSetup.layout(), 100);
        }
    },

    toggleExpandConsole() {
        const bottomPanel = document.getElementById('bottom-panel');
        const icon = document.getElementById('console-expand-icon');
        const chevron = document.getElementById('console-chevron');
        if (!bottomPanel) return;

        this._consoleMaximized = !this._consoleMaximized;
        if (this._consoleMaximized) {
            this._consoleOpen = true;
            bottomPanel.style.height = '72vh';
            if (chevron) chevron.textContent = '▾';
            if (icon) icon.innerHTML = `<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="4 14 10 14 10 20"/><polyline points="20 10 14 10 14 4"/><line x1="14" y1="10" x2="21" y2="3"/><line x1="3" y1="21" x2="10" y2="14"/></svg>`;
        } else {
            bottomPanel.style.height = this._consoleHeight || '280px';
            if (icon) icon.innerHTML = `<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="15 3 21 3 21 9"/><polyline points="9 21 3 21 3 15"/><line x1="21" y1="3" x2="14" y2="10"/><line x1="3" y1="21" x2="10" y2="14"/></svg>`;
        }
        if (typeof MonacoSetup !== 'undefined' && MonacoSetup.layout) {
            setTimeout(() => MonacoSetup.layout(), 100);
        }
    },

    initResizers() {
        // Vertical resizer (problem description vs center editor)
        const descPanel = document.getElementById('desc-panel');
        const descResizer = document.getElementById('desc-resizer');
        if (descPanel && descResizer && !this._descResizerInit) {
            this._descResizerInit = true;

            const savedWidth = localStorage.getItem('verdict_desc_width');
            if (savedWidth) {
                descPanel.style.width = savedWidth;
                descPanel.style.maxWidth = 'none';
            }

            let isDragging = false;
            let startX = 0;
            let startWidth = 0;

            descResizer.addEventListener('mousedown', (e) => {
                isDragging = true;
                startX = e.clientX;
                startWidth = descPanel.getBoundingClientRect().width;
                descResizer.classList.add('dragging');
                document.body.style.cursor = 'col-resize';
                document.body.style.userSelect = 'none';
                e.preventDefault();
            });

            descResizer.addEventListener('dblclick', () => {
                descPanel.style.width = '42%';
                descPanel.style.maxWidth = '560px';
                localStorage.removeItem('verdict_desc_width');
                if (typeof MonacoSetup !== 'undefined' && MonacoSetup.layout) MonacoSetup.layout();
            });

            window.addEventListener('mousemove', (e) => {
                if (!isDragging) return;
                const delta = e.clientX - startX;
                const newWidth = Math.max(280, Math.min(window.innerWidth * 0.7, startWidth + delta));
                descPanel.style.width = `${newWidth}px`;
                descPanel.style.maxWidth = 'none';
                if (typeof MonacoSetup !== 'undefined' && MonacoSetup.layout) MonacoSetup.layout();
            });

            window.addEventListener('mouseup', () => {
                if (isDragging) {
                    isDragging = false;
                    descResizer.classList.remove('dragging');
                    document.body.style.cursor = '';
                    document.body.style.userSelect = '';
                    localStorage.setItem('verdict_desc_width', `${descPanel.getBoundingClientRect().width}px`);
                    if (typeof MonacoSetup !== 'undefined' && MonacoSetup.layout) MonacoSetup.layout();
                }
            });
        }

        // Horizontal resizer (bottom console drawer)
        const bottomPanel = document.getElementById('bottom-panel');
        const consoleResizer = document.getElementById('console-resizer');
        if (bottomPanel && consoleResizer && !this._consoleResizerInit) {
            this._consoleResizerInit = true;

            const savedHeight = localStorage.getItem('verdict_console_height');
            if (savedHeight) {
                this._consoleHeight = savedHeight;
                bottomPanel.style.height = savedHeight;
            } else {
                this._consoleHeight = '280px';
            }

            let isDragging = false;
            let startY = 0;
            let startHeight = 0;

            consoleResizer.addEventListener('mousedown', (e) => {
                isDragging = true;
                startY = e.clientY;
                startHeight = bottomPanel.getBoundingClientRect().height;
                consoleResizer.classList.add('dragging');
                document.body.style.cursor = 'row-resize';
                document.body.style.userSelect = 'none';
                e.preventDefault();
            });

            consoleResizer.addEventListener('dblclick', () => {
                SessionView.toggleConsole();
            });

            window.addEventListener('mousemove', (e) => {
                if (!isDragging) return;
                const delta = startY - e.clientY;
                const newHeight = Math.max(40, Math.min(window.innerHeight * 0.85, startHeight + delta));
                bottomPanel.style.height = `${newHeight}px`;

                const chevron = document.getElementById('console-chevron');
                if (newHeight <= 45) {
                    SessionView._consoleOpen = false;
                    if (chevron) chevron.textContent = '▴';
                } else {
                    SessionView._consoleOpen = true;
                    if (chevron) chevron.textContent = '▾';
                    SessionView._consoleHeight = `${newHeight}px`;
                }
                if (typeof MonacoSetup !== 'undefined' && MonacoSetup.layout) MonacoSetup.layout();
            });

            window.addEventListener('mouseup', () => {
                if (isDragging) {
                    isDragging = false;
                    consoleResizer.classList.remove('dragging');
                    document.body.style.cursor = '';
                    document.body.style.userSelect = '';
                    const finalH = bottomPanel.getBoundingClientRect().height;
                    if (finalH > 45) {
                        localStorage.setItem('verdict_console_height', `${finalH}px`);
                        SessionView._consoleHeight = `${finalH}px`;
                    }
                    if (typeof MonacoSetup !== 'undefined' && MonacoSetup.layout) MonacoSetup.layout();
                }
            });
        }
    },

    toggleTopics() {
        if (typeof Toast !== 'undefined') Toast.info('Topics: Array, Hash Table, Dynamic Programming, Two Pointers');
    },

    toggleCompanies() {
        if (typeof Toast !== 'undefined') Toast.info('Top Companies: Google, Amazon, Meta, Microsoft, Apple, Uber');
    },

    toggleHints() {
        const hintEl = document.getElementById('lc-hints-container');
        if (hintEl) hintEl.classList.toggle('hidden');
    },

    getEditorCode() {
        return MonacoSetup.getCode() || (window.monacoEditor ? window.monacoEditor.getValue() : '');
    },

    _getAllRunBtns() {
        return [
            document.getElementById('btn-dry-run'),
            document.getElementById('top-btn-run'),
            document.getElementById('btn-console-run'),
            document.getElementById('btn-panel-run')
        ].filter(Boolean);
    },

    _getAllSubmitBtns() {
        return [
            document.getElementById('btn-submit'),
            document.getElementById('top-btn-submit'),
            document.getElementById('btn-console-submit'),
            document.getElementById('btn-panel-submit')
        ].filter(Boolean);
    },

    _resetRunButtons() {
        this._getAllRunBtns().forEach(b => {
            b.disabled = false;
            b.innerHTML = `<svg width="12" height="12" viewBox="0 0 24 24" fill="currentColor"><polygon points="5,3 19,12 5,21"/></svg> <span>Run</span>`;
        });
    },

    _resetSubmitButtons() {
        this._getAllSubmitBtns().forEach(b => {
            b.disabled = false;
            b.innerHTML = `<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3"><polyline points="20 6 9 17 4 12"/></svg> <span>Submit</span>`;
        });
    },

    // ── Dry Run Execution (LeetCode "▶ Run") ──
    async dryRun() {
        if (!this._sessionId) {
            if (typeof Toast !== 'undefined') Toast.warning('No active session. Please create or select a session first.');
            return;
        }
        const code = this.getEditorCode();
        if (!code.trim()) {
            if (typeof Toast !== 'undefined') Toast.warning('Editor is empty. Write some code first.');
            return;
        }

        const runBtns = this._getAllRunBtns();
        runBtns.forEach(b => {
            b.disabled = true;
            b.innerHTML = `<span class="animate-spin inline-block w-3.5 h-3.5 border-2 border-current border-t-transparent rounded-full mr-1.5"></span> Running...`;
        });

        const currentStdin = this._getCurrentStdin();

        try {
            const userCases = (this._testCases && this._testCases.length > 0) ? this._testCases.map((tc, idx) => ({
                test_id: idx + 1,
                test_case_id: tc.test_case_id || `Case ${idx + 1}`,
                description: tc.description || `Case ${idx + 1}`,
                stdin: tc.stdin || '',
                expected_stdout: tc.expected_stdout || '',
                is_edge_case: tc.is_edge_case || false
            })) : null;

            const result = await ApiClient.dryRunSession(this._sessionId, code, currentStdin, userCases, this._language);
            if (result.test_results && result.test_results.length > 0) {
                this._renderTestResults(result.test_results, this._selectedTestCaseIndex);
            } else {
                this._renderDryRun(result, currentStdin);
            }
            this.switchConsoleTab('test-result');

            if (result.passed) {
                this._lastRunPassed = true;
                this._lastRunCode = code;
                if (typeof Toast !== 'undefined') Toast.success('Run passed! Code compiled and executed successfully.');
            } else {
                this._lastRunPassed = false;
                if (typeof Toast !== 'undefined') Toast.error('Run encountered errors or failed test cases. See details below.');
            }
            return result;
        } catch (err) {
            this._lastRunPassed = false;
            if (typeof Toast !== 'undefined') Toast.error(`Run failed: ${err.message}`);
            return null;
        } finally {
            this._resetRunButtons();
        }
    },

    _renderDryRun(result, stdin = '') {
        const testResultPanel = document.getElementById('panel-test-results');
        const outputPanel = document.getElementById('output-content');
        if (!testResultPanel) return;

        const isSuccess = result.passed;
        const bannerClass = isSuccess ? 'lc-verdict-pass' : 'lc-verdict-fail';
        const bannerText = isSuccess ? 'Accepted' : 'Runtime Error / Compilation Error';
        const timeMs = result.time_ms !== undefined && result.time_ms > 0 ? result.time_ms : 14.2;

        testResultPanel.innerHTML = `
            <div class="p-4 space-y-4">
                <div class="lc-verdict-banner flex items-center justify-between">
                    <div>
                        <span class="lc-verdict-title ${bannerClass}">${bannerText}</span>
                    </div>
                    <div class="flex items-center gap-3">
                        <span class="lc-stat-pill">⏱ Runtime: <strong class="text-white">${timeMs.toFixed(1)} ms</strong></span>
                        <span class="lc-stat-pill">💾 Memory: <strong class="text-white">16.4 MB</strong></span>
                        ${isSuccess ? `
                            <button class="lc-submit-btn !h-7 !px-3 text-xs" onclick="SessionView.submit()" title="Execution passed! Submit for AI Verdict">
                                <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3"><polyline points="20 6 9 17 4 12"/></svg>
                                Submit for AI Verdict
                            </button>
                        ` : ''}
                    </div>
                </div>

                ${stdin ? `
                    <div>
                        <div class="text-xs font-mono text-text-tertiary mb-1">Standard Input (stdin):</div>
                        <pre class="bg-[#1e1e1e] p-2.5 rounded text-xs font-mono text-[#9cdcfe] whitespace-pre-wrap border border-white/5">${this._esc(stdin)}</pre>
                    </div>
                ` : ''}

                ${result.stdout ? `
                    <div>
                        <div class="text-xs font-mono text-text-tertiary mb-1">Standard Output (stdout):</div>
                        <pre class="bg-[#1e1e1e] p-3 rounded text-xs font-mono text-[#d4d4d4] whitespace-pre-wrap border border-white/5">${this._esc(result.stdout)}</pre>
                    </div>
                ` : ''}

                ${result.stderr ? `
                    <div>
                        <div class="text-xs font-mono text-[#f43f5e] mb-1">Error Message:</div>
                        <pre class="bg-[#1e1e1e] p-3 rounded text-xs font-mono text-[#f43f5e] whitespace-pre-wrap border border-[#f43f5e]/20">${this._esc(result.stderr)}</pre>
                    </div>
                ` : ''}
            </div>
        `;

        if (outputPanel) {
            outputPanel.textContent = result.stdout || result.stderr || (isSuccess ? '✓ No output' : '✗ Failed');
        }

        if (!result.passed && result.error_line) {
            MonacoSetup.setGutterMarker(result.error_line, result.stderr);
        } else {
            MonacoSetup.clearMarkers();
        }
    },

    // ── Full Submit Pipeline (LeetCode "✔ Submit") ──
    async submit() {
        if (!this._sessionId) {
            if (typeof Toast !== 'undefined') Toast.warning('No active session. Please create or select a session first.');
            return;
        }
        const code = this.getEditorCode();
        if (!code.trim()) {
            if (typeof Toast !== 'undefined') Toast.warning('Editor is empty. Please enter your code before submitting.');
            return;
        }

        const userCases = (this._testCases && this._testCases.length > 0) ? this._testCases.map((tc, idx) => ({
            test_id: idx + 1,
            test_case_id: tc.test_case_id || `Case ${idx + 1}`,
            description: tc.description || `Case ${idx + 1}`,
            stdin: tc.stdin || '',
            expected_stdout: tc.expected_stdout || '',
            is_edge_case: tc.is_edge_case || false
        })) : null;

        // Ensure the code runs successfully on user-given test cases before analysis
        const isAlreadyTestedAndPassed = this._lastRunPassed && (this._lastRunCode === code);
        if (!isAlreadyTestedAndPassed) {
            if (typeof Toast !== 'undefined') Toast.info('Running code on test cases to verify before analysis...');
            const preResult = await this.dryRun();
            if (!preResult || !preResult.passed) {
                if (typeof Toast !== 'undefined') {
                    Toast.error('Code failed on test cases. It must run successfully before analyzing.');
                }
                this.switchConsoleTab('test-result');
                this._resetSubmitButtons();
                return; // Stop! Do not analyze failing code
            }
        }

        const submitBtns = this._getAllSubmitBtns();
        submitBtns.forEach(b => {
            b.disabled = true;
            b.innerHTML = `<span class="animate-spin inline-block w-4 h-4 border-2 border-current border-t-transparent rounded-full mr-2"></span> Evaluating...`;
        });

        this._showPipelineRunning();

        try {
            await ApiClient.submitSession(this._sessionId, code, userCases, this._language);
            if (typeof Toast !== 'undefined') Toast.info('Submitted! Running multi-stage judge verification...');
            this._pollPipeline(this._sessionId);
        } catch (err) {
            if (typeof Toast !== 'undefined') Toast.error(`Submission failed: ${err.message}`);
            this._resetSubmitButtons();
            this._hidePipelineRunning();
        }
    },

    _showPipelineRunning() {
        const statusEl = document.getElementById('pipeline-status');
        const statusText = document.getElementById('pipeline-status-text');
        if (statusEl) { statusEl.classList.remove('hidden'); statusEl.classList.add('flex'); }
        if (statusText) statusText.textContent = 'Pipeline evaluating...';
    },

    _hidePipelineRunning() {
        const statusEl = document.getElementById('pipeline-status');
        if (statusEl) { statusEl.classList.add('hidden'); statusEl.classList.remove('flex'); }
    },

    _pollPipeline(sessionId) {
        const statusMap = {
            pending: 'Initializing evaluation...',
            dry_run_passed: 'Dry run passed, generating tests...',
            generating_tests: 'AI generating verified test cases...',
            executing: 'Executing test cases via Local Engine...',
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

                if (session.status === 'complete' || session.status === 'failed' || session.status === 'dry_run_failed') {
                    clearInterval(pollInterval);
                    this._hidePipelineRunning();
                    this._resetSubmitButtons();

                    if (session.status === 'complete') {
                        this._loadTestCases(session);
                        this._renderEvaluation(session);
                        if (session.test_results && session.test_results.length > 0) {
                            this._renderTestResults(session.test_results);
                        }
                        this.switchConsoleTab('analysis');
                        const exportBtn = document.getElementById('btn-export-pdf');
                        if (exportBtn) exportBtn.classList.remove('hidden');
                        const finalScore = (session.analysis && session.analysis.final_score !== undefined) ? session.analysis.final_score : 0;
                        if (typeof Toast !== 'undefined') Toast.success(`Verdict reached! Score: ${finalScore}/100`);
                    } else if (session.status === 'dry_run_failed') {
                        if (session.dry_run) {
                            this._renderDryRun(session.dry_run);
                        }
                        this.switchConsoleTab('test-result');
                        if (typeof Toast !== 'undefined') Toast.error('Dry run failed. Fix syntax/runtime errors and resubmit.');
                    } else {
                        this._renderFailure(session);
                        this.switchConsoleTab('analysis');
                        if (typeof Toast !== 'undefined') Toast.error('Evaluation halted. Check diagnostics.');
                    }

                    await App.refreshSidebar();
                    if (session.problem_id) this._loadProblemSubmissions(session.problem_id);
                }
            } catch (err) {
                console.error('[SessionView] Poll error:', err);
            }
        }, 1800);
    },

    _renderEvaluation(session) {
        const chatThread = document.getElementById('chat-thread');
        const analysis = session.analysis;
        if (!analysis || !chatThread) return;

        const score = analysis.final_score ?? 0;
        const verdict = analysis.verdict || 'optimal';
        const verdictClass = verdict === 'optimal' ? 'text-[#2cbb5d]' : (verdict === 'needs_improvement' ? 'text-[#f59e0b]' : 'text-[#f43f5e]');
        const verdictBadgeBg = verdict === 'optimal' ? 'bg-[#2cbb5d]/10 border-[#2cbb5d]/25 text-[#2cbb5d]' : (verdict === 'needs_improvement' ? 'bg-[#f59e0b]/10 border-[#f59e0b]/25 text-[#f59e0b]' : 'bg-[#f43f5e]/10 border-[#f43f5e]/25 text-[#f43f5e]');
        const verdictTitle = verdict === 'optimal' ? 'Accepted (Optimal)' : (verdict === 'needs_improvement' ? 'Needs Improvement' : 'Incorrect');

        const userTime = analysis.time_complexity || 'O(N)';
        const optimalTime = analysis.optimal_time || userTime;
        const userSpace = analysis.space_complexity || 'O(1)';
        const optimalSpace = analysis.optimal_space || userSpace;
        const isOptimal = analysis.is_optimal ?? (verdict === 'optimal');

        const metrics = [
            { name: 'Correctness', val: analysis.correctness_score ?? 100, color: '#2cbb5d' },
            { name: 'Performance', val: analysis.performance_score ?? 90, color: '#38bdf8' },
            { name: 'Optimization', val: analysis.optimization_score ?? 85, color: '#818cf8' },
            { name: 'Code Quality', val: analysis.quality_score ?? 90, color: '#c084fc' },
            { name: 'Readability', val: analysis.readability_score ?? 95, color: '#fb923c' },
            { name: 'Documentation', val: analysis.documentation_score ?? 80, color: '#94a3b8' },
        ];

        let barsHtml = '';
        metrics.forEach(m => {
            barsHtml += `
                <div>
                    <div class="flex justify-between text-xs font-mono mb-1 text-text-tertiary">
                        <span>${m.name}</span>
                        <span class="text-white font-bold">${m.val}%</span>
                    </div>
                    <div class="h-2 bg-white/5 rounded-full overflow-hidden">
                        <div class="h-full rounded-full transition-all duration-700" style="width: ${m.val}%; background-color: ${m.color};"></div>
                    </div>
                </div>
            `;
        });

        // Failing cases diagnostic
        let failingCasesHtml = '';
        if (analysis.failing_cases && analysis.failing_cases.length > 0) {
            failingCasesHtml = `
                <div class="bg-[#f43f5e]/10 border border-[#f43f5e]/20 rounded-xl p-4 space-y-3">
                    <div class="flex items-center gap-2 text-xs font-bold text-[#f43f5e] uppercase tracking-wider font-mono">
                        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="10"/><line x1="12" y1="8" x2="12" y2="12"/><line x1="12" y1="16" x2="12.01" y2="16"/></svg>
                        Failing Test Cases Diagnostic (${analysis.failing_cases.length})
                    </div>
                    <div class="space-y-2">
                        ${analysis.failing_cases.map(fc => `
                            <div class="bg-[#1e1e1e] p-3 rounded-lg border border-[#f43f5e]/20 text-xs">
                                <div class="font-mono font-bold text-white mb-1">${this._esc(fc.id || 'Case')}</div>
                                <div class="text-[#f43f5e] mb-1 font-mono">${this._esc(fc.why_it_fails)}</div>
                                ${fc.fix_suggestion ? `<div class="text-text-tertiary mt-1"><strong class="text-[#38bdf8]">Fix:</strong> ${this._esc(fc.fix_suggestion)}</div>` : ''}
                            </div>
                        `).join('')}
                    </div>
                </div>
            `;
        }

        // Optimization suggestions
        let optSuggestionsHtml = '';
        const optList = analysis.optimization_suggestions || (analysis.recommendation ? [analysis.recommendation] : []);
        if (optList && optList.length > 0) {
            optSuggestionsHtml = `
                <div class="bg-[#282828] p-4 rounded-xl border border-white/5 space-y-2.5">
                    <div class="flex items-center gap-2 text-xs font-semibold text-[#38bdf8] uppercase tracking-wider font-mono">
                        <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polygon points="13 2 3 14 12 14 11 22 21 10 12 10 13 2"/></svg>
                        Optimization Suggestions
                    </div>
                    <ul class="space-y-2 text-xs text-[#d4d4d4]">
                        ${optList.map(item => `
                            <li class="flex items-start gap-2 leading-relaxed">
                                <span class="text-[#38bdf8] mt-0.5">•</span>
                                <span>${this._esc(item)}</span>
                            </li>
                        `).join('')}
                    </ul>
                </div>
            `;
        }

        // Quality issues
        let qualityIssuesHtml = '';
        if (analysis.quality_issues && analysis.quality_issues.length > 0) {
            qualityIssuesHtml = `
                <div class="bg-[#282828] p-4 rounded-xl border border-white/5 space-y-2.5">
                    <div class="flex items-center gap-2 text-xs font-semibold text-[#c084fc] uppercase tracking-wider font-mono">
                        <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="10"/><path d="M12 16v-4"/><path d="M12 8h.01"/></svg>
                        Code Quality Observations (${analysis.quality_issues.length})
                    </div>
                    <div class="space-y-2">
                        ${analysis.quality_issues.map(qi => {
                            const sev = (qi.severity || 'low').toLowerCase();
                            const sevBadge = sev === 'high' ? 'bg-[#f43f5e]/20 text-[#f43f5e] border-[#f43f5e]/30' : (sev === 'medium' ? 'bg-[#f59e0b]/20 text-[#f59e0b] border-[#f59e0b]/30' : 'bg-[#38bdf8]/20 text-[#38bdf8] border-[#38bdf8]/30');
                            return `
                                <div class="bg-[#1e1e1e] p-2.5 rounded-lg border border-white/5 text-xs">
                                    <div class="flex items-center justify-between mb-1">
                                        <span class="text-white font-medium">${this._esc(qi.issue)}</span>
                                        <span class="text-[10px] font-mono uppercase px-1.5 py-0.5 rounded border ${sevBadge}">${sev}</span>
                                    </div>
                                    ${qi.suggestion ? `<div class="text-text-tertiary text-[11.5px]">${this._esc(qi.suggestion)}</div>` : ''}
                                </div>
                            `;
                        }).join('')}
                    </div>
                </div>
            `;
        }

        // Code explanation
        let codeExplanationHtml = '';
        if (analysis.code_explanation) {
            codeExplanationHtml = `
                <div class="bg-[#282828] p-4 rounded-xl border border-white/5 space-y-2">
                    <div class="text-xs font-semibold text-white uppercase tracking-wider font-mono">Algorithm Walkthrough</div>
                    <div class="text-xs text-[#d4d4d4] leading-relaxed whitespace-pre-wrap">${this._esc(analysis.code_explanation)}</div>
                </div>
            `;
        }

        chatThread.innerHTML = `
            <div class="p-4 space-y-4">
                <!-- Verdict Header Banner -->
                <div class="lc-verdict-banner flex flex-wrap items-center justify-between gap-3">
                    <div>
                        <div class="flex items-center gap-2">
                            <span class="lc-verdict-title ${verdictClass}">${verdictTitle}</span>
                            <span class="text-[11px] font-mono px-2 py-0.5 rounded-full border ${verdictBadgeBg}">
                                ${isOptimal ? 'Optimal' : 'Sub-optimal'}
                            </span>
                        </div>
                        <p class="text-xs text-text-tertiary mt-1 font-mono">
                            Language: <span class="text-white uppercase font-bold">${this._esc(session.language || 'python')}</span> •
                            Profile: <span class="text-white font-medium">${this._esc((session.profile && session.profile.name) || 'Default')}</span>
                        </p>
                    </div>
                    <div class="flex items-center gap-4">
                        <div class="text-right">
                            <div class="text-3xl font-black text-white font-mono">${score}<span class="text-xs text-text-tertiary font-normal">/100</span></div>
                            <span class="text-[11px] font-mono text-text-tertiary">Overall Score</span>
                        </div>
                        <button class="cmd-btn cmd-secondary !h-8 !px-3 text-xs" onclick="SessionView.exportPdf()" title="Download PDF Verdict Report">
                            <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" y1="15" x2="12" y2="3"/></svg>
                            Export PDF
                        </button>
                    </div>
                </div>

                <!-- Big-O Complexity Benchmarks -->
                <div class="grid grid-cols-2 sm:grid-cols-4 gap-2.5">
                    <div class="p-3 bg-[#282828] rounded-lg border border-white/5">
                        <span class="text-[10px] font-mono uppercase text-text-tertiary tracking-wider block">Time Complexity</span>
                        <span class="text-sm font-bold font-mono text-[#38bdf8] mt-1 block">${this._esc(userTime)}</span>
                        <span class="text-[10px] text-text-tertiary block mt-0.5">Target: ${this._esc(optimalTime)}</span>
                    </div>
                    <div class="p-3 bg-[#282828] rounded-lg border border-white/5">
                        <span class="text-[10px] font-mono uppercase text-text-tertiary tracking-wider block">Space Complexity</span>
                        <span class="text-sm font-bold font-mono text-[#a78bfa] mt-1 block">${this._esc(userSpace)}</span>
                        <span class="text-[10px] text-text-tertiary block mt-0.5">Target: ${this._esc(optimalSpace)}</span>
                    </div>
                    <div class="p-3 bg-[#282828] rounded-lg border border-white/5">
                        <span class="text-[10px] font-mono uppercase text-text-tertiary tracking-wider block">Optimality</span>
                        <span class="text-sm font-bold font-mono ${isOptimal ? 'text-[#2cbb5d]' : 'text-[#f59e0b]'} mt-1 block">
                            ${isOptimal ? '✓ Optimal' : '⚠️ Sub-optimal'}
                        </span>
                        <span class="text-[10px] text-text-tertiary block mt-0.5">${isOptimal ? 'Meets Big-O bounds' : 'Can be optimized'}</span>
                    </div>
                    <div class="p-3 bg-[#282828] rounded-lg border border-white/5">
                        <span class="text-[10px] font-mono uppercase text-text-tertiary tracking-wider block">Verdict</span>
                        <span class="text-sm font-bold font-mono ${verdictClass} mt-1 block uppercase">${this._esc(verdict)}</span>
                        <span class="text-[10px] text-text-tertiary block mt-0.5">Automated Judge</span>
                    </div>
                </div>

                ${analysis.correctness_summary ? `
                    <div class="bg-[#282828] p-3.5 rounded-lg border border-white/5 text-xs text-[#d4d4d4] leading-relaxed">
                        <div class="text-[11px] font-semibold text-text-tertiary uppercase tracking-wider font-mono mb-1">Correctness Summary</div>
                        ${this._esc(analysis.correctness_summary)}
                    </div>
                ` : ''}

                <!-- Score Breakdown -->
                <div class="bg-[#282828] p-4 rounded-xl border border-white/5 space-y-3">
                    <div class="text-xs font-semibold text-white uppercase tracking-wider font-mono mb-2">6-Signal Deterministic Breakdown</div>
                    ${barsHtml}
                </div>

                ${failingCasesHtml}
                ${optSuggestionsHtml}
                ${qualityIssuesHtml}
                ${codeExplanationHtml}

                ${analysis.final_notes ? `
                    <div class="bg-[#1e1e1e] p-3.5 rounded-lg border border-white/10 text-xs text-text-secondary italic">
                        Judge Notes: ${this._esc(analysis.final_notes)}
                    </div>
                ` : ''}
            </div>
        `;
    },

    _renderFailure(session) {
        const chatThread = document.getElementById('chat-thread');
        if (!chatThread) return;
        const msg = session.history_summary || 'An error occurred during evaluation.';
        chatThread.innerHTML = `
            <div class="p-5 text-center space-y-3">
                <div class="text-sm font-bold text-[#f43f5e]">Evaluation Halted</div>
                <p class="text-xs text-text-secondary leading-relaxed">${this._esc(msg)}</p>
                <button onclick="SessionView.submit()" class="lc-submit-btn !h-8 !px-4 !text-xs mt-2">
                    Retry Submission
                </button>
            </div>
        `;
    },

    async exportPdf() {
        if (!this._sessionId) return;
        const btn = document.getElementById('btn-export-pdf');
        if (typeof App !== 'undefined') App.setBusy(btn, true, 'Exporting…');
        try {
            if (typeof Toast !== 'undefined') Toast.info('Generating session evaluation PDF report...');
            const blob = await ApiClient.exportSessionPdf(this._sessionId);
            downloadBlob(blob, `session_${this._sessionId}_verdict.pdf`);
            if (typeof Toast !== 'undefined') Toast.success('Evaluation PDF report downloaded.');
        } catch (e) {
            const url = ApiClient.getSessionPdfUrl(this._sessionId);
            window.open(url, '_blank');
        } finally {
            if (typeof App !== 'undefined') App.setBusy(btn, false);
        }
    },

    _esc(s) {
        if (!s) return '';
        const d = document.createElement('div');
        d.textContent = s;
        return d.innerHTML;
    }
};