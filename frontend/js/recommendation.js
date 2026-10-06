/**
 * recommendation.js — UI Handler for Solution Recommendation.
 *
 * 2-Phase UX Workflow:
 *   - Phase 1 (Default): Focused problem input card with template selector, constraints,
 *     sample I/O, and prominent "Analyze Problem" button. (NO empty editor/chat showing upfront).
 *   - Phase 2 (Post-Submission): Seamless transition into the full 3-pane AI Studio:
 *     - Left: Strategy & Complexity bounds with clean Markdown walkthrough.
 *     - Center: Interactive VS Code / Monaco editor mounted with the optimal solution.
 *     - Right: Verdict AI Copilot chat with comprehensive problem breakdown and interactive Q&A.
 */

const RecommendationUI = {
    currentResult: null,
    editor: null,
    chatHistory: [],
    _codeUpdates: {},
    _editorReadyPromise: null,

    templates: {
        two_sum: {
            problem: "Given an array of integers nums and an integer target, return indices of the two numbers such that they add up to target. You may assume that each input would have exactly one solution, and you may not use the same element twice.",
            constraints: "2 <= nums.length <= 10^4\n-10^9 <= nums[i] <= 10^9\n-10^9 <= target <= 10^9\nOnly one valid answer exists.",
            sample_input: "nums = [2,7,11,15], target = 9",
            sample_output: "[0,1]"
        },
        longest_substring: {
            problem: "Given a string s, find the length of the longest substring without duplicate characters.",
            constraints: "0 <= s.length <= 5 * 10^4\ns consists of English letters, digits, symbols and spaces.",
            sample_input: "s = \"abcabcbb\"",
            sample_output: "3"
        },
        lru_cache: {
            problem: "Design a data structure that follows the constraints of a Least Recently Used (LRU) cache with get(key) and put(key, value) operations running in O(1) average time complexity.",
            constraints: "1 <= capacity <= 3000\n0 <= key <= 10^4\n0 <= value <= 10^5\nAt most 2 * 10^5 calls will be made to get and put.",
            sample_input: "LRUCache(2), put(1, 1), put(2, 2), get(1), put(3, 3), get(2)",
            sample_output: "[null, null, null, 1, null, -1]"
        },
        score_parentheses: {
            problem: "Given a balanced parentheses string s, compute the score of the string based on the following rules:\n- \"()\" has score 1.\n- AB has score A + B, where A and B are balanced parentheses strings.\n- (A) has score 2 * A, where A is a balanced parentheses string.",
            constraints: "2 <= s.length <= 50\ns consists of only '(' and ')'.\ns is a balanced parentheses string.",
            sample_input: "(()(()))",
            sample_output: "6"
        }
    },

    async init() {
        console.log('[RecommendationUI] Initialized');
        this._setupKeybindings();

        // Default to Input View if no analysis has been run yet
        if (!this.currentResult) {
            this.showInputView();
        } else {
            this.showStudioView();
        }
    },

    showInputView() {
        const initialView = document.getElementById('rec-initial-view');
        const studioView = document.getElementById('rec-studio-workspace');

        if (initialView) {
            initialView.classList.remove('hidden');
            initialView.classList.remove('view-enter-active');
            void initialView.offsetWidth;
            initialView.classList.add('view-enter-active');
        }
        if (studioView) studioView.classList.add('hidden');

        // Focus problem textarea if empty or on user request
        const pEl = document.getElementById('rec-problem');
        if (pEl && !pEl.value) {
            setTimeout(() => pEl.focus(), 100);
        }
    },

    async showStudioView() {
        const initialView = document.getElementById('rec-initial-view');
        const studioView = document.getElementById('rec-studio-workspace');

        if (initialView) initialView.classList.add('hidden');
        if (studioView) {
            studioView.classList.remove('hidden');
            studioView.classList.remove('view-enter-active');
            void studioView.offsetWidth;
            studioView.classList.add('view-enter-active');
        }

        await this.ensureEditor();
        setTimeout(() => {
            if (this.editor) this.editor.layout();
        }, 60);
    },

    ensureEditor() {
        if (this.editor) {
            this.editor.layout();
            return Promise.resolve(this.editor);
        }

        if (this._editorReadyPromise) {
            return this._editorReadyPromise;
        }

        this._editorReadyPromise = new Promise((resolve) => {
            const container = document.getElementById('rec-monaco-container');
            if (!container) {
                console.warn('[RecommendationUI] Monaco container not found');
                resolve(null);
                return;
            }

            const createEditorInstance = () => {
                if (!window.monaco) {
                    setTimeout(createEditorInstance, 50);
                    return;
                }

                // Register leetcode-dark theme if not already defined
                try {
                    monaco.editor.defineTheme('leetcode-dark', {
                        base: 'vs-dark',
                        inherit: true,
                        rules: [
                            { token: '', background: '1e1e1e' },
                            { token: 'comment', foreground: '6a9955', fontStyle: 'italic' },
                            { token: 'keyword', foreground: 'c586c0', fontStyle: 'bold' },
                            { token: 'string', foreground: 'ce9178' },
                            { token: 'number', foreground: 'b5cea8' },
                            { token: 'type', foreground: '4ec9b0' },
                            { token: 'function', foreground: 'dcdcaa' },
                        ],
                        colors: {
                            'editor.background': '#1e1e1e',
                            'editor.foreground': '#d4d4d4',
                            'editor.lineHighlightBackground': '#282828',
                            'editorCursor.foreground': '#2cbb5d',
                            'editorWhitespace.foreground': '#333333',
                            'editorIndentGuide.background': '#333333',
                            'editorIndentGuide.activeBackground': '#555555',
                            'editorLineNumber.foreground': '#6e7681',
                            'editorLineNumber.activeForeground': '#cccccc',
                        }
                    });
                } catch (e) {
                    // Theme might already be defined
                }

                this.editor = monaco.editor.create(container, {
                    value: this.currentResult?.optimized_code || this._getStarterTemplate('python'),
                    language: this._getMonacoLang(this.currentResult?.recommended_language || 'python'),
                    theme: 'leetcode-dark',
                    fontSize: 13.5,
                    fontFamily: "'JetBrains Mono', Consolas, 'Courier New', monospace",
                    fontLigatures: true,
                    minimap: { enabled: false },
                    scrollBeyondLastLine: false,
                    automaticLayout: true,
                    lineNumbers: 'on',
                    glyphMargin: true,
                    folding: true,
                    wordWrap: 'off',
                    renderLineHighlight: 'line',
                    cursorBlinking: 'smooth',
                    cursorSmoothCaretAnimation: 'on',
                    smoothScrolling: true,
                    padding: { top: 12, bottom: 12 },
                    bracketPairColorization: { enabled: true },
                });

                if (window.ResizeObserver && container) {
                    const ro = new ResizeObserver(() => {
                        if (this.editor) this.editor.layout();
                    });
                    ro.observe(container);
                }

                console.log('[RecommendationUI] Monaco Studio Editor initialized');
                resolve(this.editor);
            };

            if (window.monaco) {
                createEditorInstance();
            } else if (typeof require !== 'undefined') {
                require(['vs/editor/editor.main'], () => {
                    createEditorInstance();
                });
            } else {
                window.addEventListener('load', createEditorInstance);
            }
        });

        return this._editorReadyPromise;
    },

    _setupKeybindings() {
        const probEl = document.getElementById('rec-problem');
        if (probEl && !probEl._hasKeybound) {
            probEl._hasKeybound = true;
            probEl.addEventListener('keydown', (e) => {
                if ((e.ctrlKey || e.metaKey) && e.key === 'Enter') {
                    e.preventDefault();
                    this.analyze();
                }
            });
        }
    },

    _getStarterTemplate(lang = 'python') {
        const l = (lang || 'python').toLowerCase();
        if (l === 'cpp' || l === 'c++') {
            return `// Verdict Optimal Reference Code\n#include <iostream>\n#include <vector>\nusing namespace std;\n\nclass Solution {\npublic:\n    // Solution code\n};\n`;
        }
        if (l === 'java') {
            return `// Verdict Optimal Reference Code\nimport java.util.*;\n\npublic class Solution {\n    // Solution code\n}\n`;
        }
        return `# Verdict Optimal Reference Code\ndef solve():\n    pass\n`;
    },

    loadTemplate(templateKey) {
        const t = this.templates[templateKey];
        if (!t) return;
        const pEl = document.getElementById('rec-problem');
        const cEl = document.getElementById('rec-constraints');
        const iEl = document.getElementById('rec-sample-input');
        const oEl = document.getElementById('rec-sample-output');

        if (pEl) pEl.value = t.problem;
        if (cEl) cEl.value = t.constraints;
        if (iEl) iEl.value = t.sample_input;
        if (oEl) oEl.value = t.sample_output;

        if (typeof Toast !== 'undefined') {
            Toast.info(`Loaded "${templateKey.replace(/_/g, ' ').toUpperCase()}" template.`);
        }
    },

    _getMonacoLang(lang) {
        const l = (lang || 'python').toLowerCase();
        if (l.includes('c++') || l === 'cpp') return 'cpp';
        if (l.includes('java') && !l.includes('script')) return 'java';
        if (l.includes('javascript') || l === 'js') return 'javascript';
        if (l.includes('go')) return 'go';
        return 'python';
    },

    _updateEditorHeaders(lang) {
        const l = (lang || 'python').toLowerCase();
        const extMap = { python: 'solution.py', cpp: 'solution.cpp', java: 'Solution.java', javascript: 'solution.js', go: 'solution.go' };
        const fname = extMap[l] || 'solution.py';

        const fnEl = document.getElementById('rec-editor-filename');
        if (fnEl) fnEl.textContent = fname;

        const footerLang = document.getElementById('rec-footer-lang');
        if (footerLang) footerLang.textContent = (lang || 'Python').toUpperCase();
    },

    async analyze() {
        const pEl = document.getElementById('rec-problem');
        const cEl = document.getElementById('rec-constraints');
        const siEl = document.getElementById('rec-sample-input');
        const soEl = document.getElementById('rec-sample-output');
        const lEl = document.getElementById('rec-language');

        const problem = (pEl && pEl.value ? pEl.value.trim() : '');
        const constraints = (cEl && cEl.value ? cEl.value.trim() : '');
        const sampleInput = (siEl && siEl.value ? siEl.value.trim() : '');
        const sampleOutput = (soEl && soEl.value ? soEl.value.trim() : '');
        const language = (lEl && lEl.value ? lEl.value : null);

        if (!problem) {
            if (typeof Toast !== 'undefined') {
                Toast.warning('Please enter a programming problem description.');
            }
            if (pEl) pEl.focus();
            return;
        }

        const btn = document.getElementById('btn-analyze-problem');
        if (btn) {
            btn.disabled = true;
            btn.innerHTML = `<span class="animate-spin inline-block w-4 h-4 border-2 border-white border-t-transparent rounded-full mr-2"></span> Analyzing with AI...`;
        }

        try {
            const data = await ApiClient.getRecommendation({
                problem,
                constraints,
                sample_input: sampleInput,
                sample_output: sampleOutput,
                preferred_language: language,
            });

            this.currentResult = data;

            // Transition to Studio Workspace
            await this.showStudioView();
            this.renderReport(data, problem);

            if (typeof Toast !== 'undefined') {
                Toast.success('Solution recommendation generated!');
            }

        } catch (error) {
            console.error('[RecommendationUI] Error:', error);
            if (typeof Toast !== 'undefined') {
                Toast.error(`Analysis failed: ${error.message}`);
            }
        } finally {
            if (btn) {
                btn.disabled = false;
                btn.innerHTML = `
                    <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><path d="M13 2L3 14h9l-1 8 10-12h-9l1-8z"/></svg>
                    <span>Analyze Problem</span>
                `;
            }
        }
    },

    renderReport(data, originalProblem = '') {
        if (!data) return;

        // 1. Studio Header
        const catBadge = document.getElementById('rec-studio-badge-category');
        if (catBadge) catBadge.textContent = data.category || 'Algorithm Strategy';

        const algoTitle = document.getElementById('rec-studio-title-algo');
        if (algoTitle) algoTitle.textContent = data.recommended_algorithm || 'Optimal Approach';

        // 2. 4 Metric Cards
        const elDs = document.getElementById('rec-res-ds');
        if (elDs) elDs.textContent = data.recommended_data_structure || 'Standard Structure';

        const elLang = document.getElementById('rec-res-lang');
        if (elLang) elLang.textContent = data.recommended_language || 'Python';

        const elTime = document.getElementById('rec-res-time');
        if (elTime) elTime.textContent = data.time_complexity || 'O(N)';

        const elSpace = document.getElementById('rec-res-space');
        if (elSpace) elSpace.textContent = data.space_complexity || 'O(1)';

        // 3. Algorithm Walkthrough (Fix unrendered markdown / literal \n)
        const expElement = document.getElementById('rec-res-explanation');
        if (expElement) {
            let rawExp = data.explanation || 'No walkthrough provided.';
            rawExp = rawExp.replace(/\\n/g, '\n');
            if (typeof marked !== 'undefined') {
                expElement.innerHTML = marked.parse(rawExp);
            } else {
                expElement.innerHTML = this.escapeHtml(rawExp).replace(/\n/g, '<br/>');
            }
        }

        // 4. Alternative Approaches
        const altsContainer = document.getElementById('rec-res-alternatives');
        if (altsContainer) {
            if (data.alternative_approaches && data.alternative_approaches.length > 0) {
                altsContainer.innerHTML = data.alternative_approaches.map(alt => `
                    <div class="p-3 bg-void/80 rounded-lg border border-border-subtle text-xs space-y-1.5 font-mono">
                        <div class="flex items-center justify-between">
                            <span class="font-bold text-accent">${this.escapeHtml(alt.name)}</span>
                            <div class="flex gap-1.5 text-[10px] text-text-tertiary">
                                <span class="px-1.5 py-0.5 rounded bg-surface border border-border-subtle">Time: ${this.escapeHtml(alt.time_complexity)}</span>
                                <span class="px-1.5 py-0.5 rounded bg-surface border border-border-subtle">Space: ${this.escapeHtml(alt.space_complexity)}</span>
                            </div>
                        </div>
                        <p class="text-text-secondary leading-relaxed font-sans text-[11.5px]">${this.escapeHtml(alt.trade_offs)}</p>
                    </div>
                `).join('');
            } else {
                altsContainer.innerHTML = `<p class="text-xs text-text-dim italic font-mono">No alternative approaches recorded.</p>`;
            }
        }

        // 5. Update Reference Code in Monaco Editor
        if (this.editor && data.optimized_code) {
            this.editor.setValue(data.optimized_code);
            const targetLang = this._getMonacoLang(data.recommended_language);
            const model = this.editor.getModel();
            if (model && window.monaco) {
                monaco.editor.setModelLanguage(model, targetLang);
            }
            this._updateEditorHeaders(data.recommended_language);

            const badge = document.getElementById('rec-editor-badge');
            if (badge) badge.textContent = `• ${data.recommended_algorithm} (${data.time_complexity})`;

            const footerStatus = document.getElementById('rec-footer-status');
            if (footerStatus) footerStatus.textContent = `Optimal Code Generated`;
        }

        // 6. Reset & Populate Copilot Chat with Full AI Breakdown
        this.chatHistory = [];
        const thread = document.getElementById('rec-chat-thread');
        if (thread) {
            thread.innerHTML = '';
        }

        // Build comprehensive markdown breakdown of all problem details
        let altsSection = '';
        if (data.alternative_approaches && data.alternative_approaches.length > 0) {
            altsSection = '\n\n#### 🔄 Alternative Approaches Considered\n' + data.alternative_approaches.map(a =>
                `- **${a.name}** (\`${a.time_complexity}\` time, \`${a.space_complexity}\` space): ${a.trade_offs}`
            ).join('\n');
        }

        let walkthroughText = (data.explanation || 'Optimal solution generated based on asymptotic efficiency and problem constraints.')
            .replace(/\\n/g, '\n');

        const initialBreakdown = `### 🚀 Problem Architecture & Strategy Breakdown

**Optimal Algorithm**: **${data.recommended_algorithm}**  
- **Category**: \`${data.category || 'Algorithm Strategy'}\`
- **Data Structure**: \`${data.recommended_data_structure}\`
- **Guaranteed Bounds**: Time **${data.time_complexity}** • Space **${data.space_complexity}**
- **Language**: \`${data.recommended_language}\`

---

#### 💡 Core Strategy & Walkthrough
${walkthroughText}
${altsSection}

---

#### 🛠️ Reference Code Mounted
The production-ready reference solution is loaded in the **center code editor**.
- Have any doubts, or want to explore edge cases or code variations? Ask below or click any of the exploration topics!`;

        this.addCopilotMessage({
            role: 'assistant',
            content: initialBreakdown,
            suggested_improvements: [
                'Explain the core intuition simply',
                'Trace step-by-step with an example',
                'What are critical boundary and edge cases?',
                'Can we optimize space or time further?'
            ]
        });
    },

    formatEditorCode() {
        if (!this.editor) return;
        const action = this.editor.getAction('editor.action.formatDocument');
        if (action) {
            action.run();
            if (typeof Toast !== 'undefined') Toast.info('Formatted code.');
        }
    },

    copyCode() {
        if (!this.editor) return;
        const code = this.editor.getValue();
        if (!code) {
            if (typeof Toast !== 'undefined') Toast.warning('No code to copy.');
            return;
        }

        navigator.clipboard.writeText(code).then(() => {
            const btn = document.getElementById('btn-copy-rec-code');
            if (btn) {
                const orig = btn.innerHTML;
                btn.innerHTML = `✓`;
                setTimeout(() => btn.innerHTML = orig, 1800);
            }
            if (typeof Toast !== 'undefined') {
                Toast.success('Reference code copied to clipboard!');
            }
        }).catch(() => {
            if (typeof Toast !== 'undefined') Toast.error('Could not copy to clipboard.');
        });
    },

    async evaluateInIde() {
        const code = this.editor ? this.editor.getValue() : (this.currentResult ? this.currentResult.optimized_code : '');
        if (!code) {
            if (typeof Toast !== 'undefined') Toast.warning('No code available to evaluate.');
            return;
        }

        const pEl = document.getElementById('rec-problem');
        const cEl = document.getElementById('rec-constraints');
        const iEl = document.getElementById('rec-sample-input');
        const oEl = document.getElementById('rec-sample-output');

        const rawProblem = (pEl && pEl.value) ? pEl.value.trim() : 'Recommended Problem';
        const constraints = (cEl && cEl.value) ? cEl.value.trim() : '';
        const sampleInput = (iEl && iEl.value) ? iEl.value.trim() : '';
        const sampleOutput = (oEl && oEl.value) ? oEl.value.trim() : '';
        const rec = this.currentResult || {};

        // 1. Determine Title
        let title = rec.title;
        if (!title || title.length > 80) {
            const firstLine = rawProblem.split('\n')[0].replace(/^#+\s*/, '').trim();
            if (firstLine.length >= 3 && firstLine.length <= 60 && !firstLine.endsWith('.')) {
                title = firstLine;
            } else if (rec.recommended_algorithm) {
                title = `${rec.recommended_algorithm}`;
            } else {
                title = 'Recommended Problem';
            }
        }

        const difficulty = (rec.difficulty || 'medium').toLowerCase();
        const lang = (rec.recommended_language || 'python').toLowerCase();

        // 2. Format comprehensive LeetCode-style Problem Description
        let formattedDesc = `## Problem Statement\n\n${rawProblem}\n\n`;

        if (constraints) {
            formattedDesc += `### Constraints\n\n`;
            const constraintLines = constraints.split('\n').map(l => l.trim()).filter(Boolean);
            if (constraintLines.length > 0) {
                formattedDesc += constraintLines.map(c => `- ${c.replace(/^[•\-\*]\s*/, '')}`).join('\n') + '\n\n';
            } else {
                formattedDesc += `${constraints}\n\n`;
            }
        }

        if (sampleInput || sampleOutput) {
            formattedDesc += `### Examples\n\n**Example 1:**\n`;
            if (sampleInput) formattedDesc += `- **Input:**\n\`\`\`text\n${sampleInput}\n\`\`\`\n`;
            if (sampleOutput) formattedDesc += `- **Output:**\n\`\`\`text\n${sampleOutput}\n\`\`\`\n`;
            formattedDesc += '\n';
        }

        if (rec.recommended_algorithm || rec.explanation) {
            formattedDesc += `### Algorithmic Architecture (from AI Recommendation)\n\n`;
            formattedDesc += `- **Optimal Algorithm:** **${rec.recommended_algorithm || 'Standard Solution'}**\n`;
            if (rec.category) formattedDesc += `- **Category:** \`${rec.category}\`\n`;
            if (rec.recommended_data_structure) formattedDesc += `- **Data Structure:** \`${rec.recommended_data_structure}\`\n`;
            if (rec.time_complexity || rec.space_complexity) {
                formattedDesc += `- **Complexity Bounds:** Time \`${rec.time_complexity || 'O(N)'}\` • Space \`${rec.space_complexity || 'O(1)'}\`\n`;
            }
            formattedDesc += '\n';

            if (rec.explanation) {
                formattedDesc += `#### Strategy & Walkthrough\n\n${rec.explanation}\n\n`;
            }

            if (rec.alternative_approaches && rec.alternative_approaches.length > 0) {
                formattedDesc += `#### Alternative Approaches\n\n`;
                rec.alternative_approaches.forEach(alt => {
                    formattedDesc += `- **${alt.name}** (\`${alt.time_complexity}\` time, \`${alt.space_complexity}\` space): ${alt.trade_offs}\n`;
                });
                formattedDesc += '\n';
            }
        }

        // 3. Prepare initial Test Cases from sample I/O and AI recommendations
        const testCases = [];
        if (rec.sample_test_cases && rec.sample_test_cases.length > 0) {
            rec.sample_test_cases.forEach((tc, idx) => {
                testCases.push({
                    test_id: idx + 1,
                    test_case_id: `Case ${idx + 1}`,
                    description: tc.description || `Sample Case ${idx + 1}`,
                    stdin: tc.stdin ? (tc.stdin.endsWith('\n') ? tc.stdin : tc.stdin + '\n') : '',
                    expected_stdout: tc.expected_stdout || '',
                    is_edge_case: false
                });
            });
        } else if (sampleInput || sampleOutput) {
            testCases.push({
                test_id: 1,
                test_case_id: 'Case 1',
                description: 'Sample Case 1',
                stdin: sampleInput ? (sampleInput.endsWith('\n') ? sampleInput : sampleInput + '\n') : '',
                expected_stdout: sampleOutput || '',
                is_edge_case: false
            });
        }

        try {
            if (typeof Toast !== 'undefined') Toast.info('Creating problem and transferring to Evaluation IDE...');
            const problemRes = await ApiClient.createProblem(title, formattedDesc, difficulty);
            const sessionRes = await ApiClient.createSession({
                problem_id: problemRes.problem_id,
                language: lang,
                submission_label: `${rec.recommended_algorithm || 'Optimal'} Solution`,
                code: code,
                test_cases: testCases
            });

            if (typeof App !== 'undefined') {
                App.switchView('evaluation');
                await App.refreshSidebar();
                await App.openSession(sessionRes.session_id);
            }
            if (typeof Toast !== 'undefined') Toast.success(`Transferred "${title}" into Evaluation IDE!`);
        } catch (err) {
            console.error('[RecommendationUI] evaluateInIde error:', err);
            if (typeof Toast !== 'undefined') Toast.error(`Could not launch evaluation: ${err.message}`);
        }
    },

    downloadReport() {
        if (!this.currentResult) {
            if (typeof Toast !== 'undefined') Toast.warning('Run problem analysis first.');
            return;
        }
        const blob = new Blob([JSON.stringify(this.currentResult, null, 2)], { type: 'application/json' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = `verdict_recommendation_${Date.now()}.json`;
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        URL.revokeObjectURL(url);
        if (typeof Toast !== 'undefined') Toast.success('Analysis report JSON downloaded.');
    },

    // ====================================================================
    // VERDICT AI COPILOT CHAT
    // ====================================================================
    handleChatKey(event) {
        if (event.key === 'Enter' && !event.shiftKey) {
            event.preventDefault();
            this.sendChatMessage();
        }
    },

    sendQuickPrompt(promptText) {
        const input = document.getElementById('rec-chat-input');
        if (input) {
            input.value = promptText;
            this.sendChatMessage();
        }
    },

    clearChat() {
        this.chatHistory = [];
        this._codeUpdates = {};
        const thread = document.getElementById('rec-chat-thread');
        if (thread) {
            thread.innerHTML = '';
        }
        if (this.currentResult) {
            this.renderReport(this.currentResult);
        }
    },

    addCopilotMessage(msg) {
        const thread = document.getElementById('rec-chat-thread');
        if (!thread) return;

        const isUser = msg.role === 'user';
        const msgEl = document.createElement('div');
        msgEl.className = isUser ? 'rec-chat-bubble-user' : 'rec-chat-bubble-ai space-y-2.5';

        if (isUser) {
            msgEl.textContent = msg.content;
        } else {
            let renderedContent = msg.content || '';
            renderedContent = renderedContent.replace(/\\n/g, '\n');
            const html = typeof marked !== 'undefined' ? marked.parse(renderedContent) : this.escapeHtml(renderedContent).replace(/\n/g, '<br/>');

            let codeActionHtml = '';
            if (msg.code_update) {
                const updateId = 'cu_' + Date.now() + '_' + Math.random().toString(36).substr(2, 5);
                this._codeUpdates[updateId] = msg.code_update;
                codeActionHtml = `
                    <div class="rec-code-card flex items-center justify-between gap-3">
                        <div class="flex items-center gap-2">
                            <span class="w-2 h-2 rounded-full bg-accent animate-pulse"></span>
                            <span class="text-xs text-white font-medium">Modified Code Ready</span>
                        </div>
                        <button onclick="RecommendationUI.applyCodeUpdateById('${updateId}')" class="px-3 py-1 rounded bg-accent hover:brightness-110 text-white text-xs font-semibold shadow-sm transition-all flex items-center gap-1.5">
                            <span>✨ Apply to Editor</span>
                        </button>
                    </div>
                `;
            }

            let followUpsHtml = '';
            const suggestions = msg.suggested_improvements || [];
            if (suggestions.length > 0) {
                const chips = suggestions.map(s => {
                    const cleanS = (typeof s === 'string' ? s : '').trim();
                    if (!cleanS) return '';
                    return `<button class="rec-suggestion-chip" onclick="RecommendationUI.sendQuickPrompt(${JSON.stringify(cleanS)})">👉 ${this.escapeHtml(cleanS)}</button>`;
                }).filter(Boolean).join('');

                if (chips) {
                    followUpsHtml = `
                        <div class="pt-2 border-t border-white/5 space-y-1.5 mt-2">
                            <div class="text-[11px] font-mono text-text-tertiary">Explore next doubts & improvements:</div>
                            <div class="flex flex-wrap gap-1.5">${chips}</div>
                        </div>
                    `;
                }
            }

            msgEl.innerHTML = `
                <div class="flex items-center justify-between text-xs font-semibold text-accent font-mono border-b border-white/5 pb-1 mb-1">
                    <div class="flex items-center gap-1.5">
                        <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><polygon points="13 2 3 14 12 14 11 22 21 10 12 10 13 2"/></svg>
                        <span>Verdict AI Copilot</span>
                    </div>
                    <span class="text-[10px] text-text-tertiary font-mono">${new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}</span>
                </div>
                <div class="rec-markdown-body text-[12.5px]">${html}</div>
                ${codeActionHtml}
                ${followUpsHtml}
            `;
            // Attach 1-click copy buttons to code blocks
            msgEl.querySelectorAll('pre').forEach(pre => {
                if (pre.querySelector('.rec-copy-code-btn')) return;
                pre.style.position = 'relative';
                const copyBtn = document.createElement('button');
                copyBtn.className = 'rec-copy-code-btn';
                copyBtn.innerHTML = '📋 Copy';
                copyBtn.title = 'Copy code snippet';
                copyBtn.onclick = (e) => {
                    e.stopPropagation();
                    const codeEl = pre.querySelector('code');
                    const textToCopy = codeEl ? codeEl.innerText : pre.innerText;
                    navigator.clipboard.writeText(textToCopy).then(() => {
                        copyBtn.innerHTML = '✓ Copied';
                        setTimeout(() => { copyBtn.innerHTML = '📋 Copy'; }, 2000);
                    });
                };
                pre.appendChild(copyBtn);
            });
        }

        thread.appendChild(msgEl);
        thread.scrollTop = thread.scrollHeight;
    },

    applyCodeUpdateById(id) {
        const code = this._codeUpdates[id];
        if (!code) return;
        this.applyCodeUpdate(code);
    },

    applyCodeUpdate(newCode) {
        if (!this.editor) return;
        this.editor.setValue(newCode);
        if (typeof Toast !== 'undefined') {
            Toast.success('Applied Copilot code improvements to editor!');
        }
    },

    async sendChatMessage() {
        const input = document.getElementById('rec-chat-input');
        if (!input) return;
        const text = input.value.trim();
        if (!text) return;

        input.value = '';

        this.addCopilotMessage({ role: 'user', content: text });
        this.chatHistory.push({ role: 'user', content: text });

        const thread = document.getElementById('rec-chat-thread');
        const thinkingId = 'copilot-thinking-' + Date.now();
        const thinkingEl = document.createElement('div');
        thinkingEl.id = thinkingId;
        thinkingEl.className = 'rec-chat-bubble-ai flex items-center gap-2 text-xs font-mono text-text-tertiary';
        thinkingEl.innerHTML = `
            <span class="animate-spin inline-block w-3.5 h-3.5 border-2 border-accent border-t-transparent rounded-full"></span>
            <span>Verdict Copilot is analyzing logic & answering...</span>
        `;
        if (thread) {
            thread.appendChild(thinkingEl);
            thread.scrollTop = thread.scrollHeight;
        }

        const sendBtn = document.getElementById('rec-chat-send');
        if (sendBtn) sendBtn.disabled = true;

        const pEl = document.getElementById('rec-problem');
        const problem = pEl ? pEl.value.trim() : '';
        const currentCode = this.editor ? this.editor.getValue() : '';
        const algorithm = this.currentResult ? this.currentResult.recommended_algorithm : '';
        const language = this.currentResult ? this.currentResult.recommended_language : 'Python';

        try {
            const res = await ApiClient.askRecommendationQuestion({
                problem: problem || 'General Competitive Programming Problem',
                code: currentCode,
                algorithm: algorithm,
                language: language,
                question: text,
                chat_history: this.chatHistory
            });

            const tEl = document.getElementById(thinkingId);
            if (tEl) tEl.remove();

            this.addCopilotMessage({
                role: 'assistant',
                content: res.answer,
                code_update: res.code_update,
                suggested_improvements: res.suggested_improvements
            });
            this.chatHistory.push({ role: 'assistant', content: res.answer });

        } catch (err) {
            console.error('[RecommendationUI] Chat error:', err);
            const tEl = document.getElementById(thinkingId);
            if (tEl) tEl.remove();

            this.addCopilotMessage({
                role: 'assistant',
                content: `⚠️ Could not get AI response: ${err.message}. You can try asking again or verify that your problem statement is filled in.`
            });
        } finally {
            if (sendBtn) sendBtn.disabled = false;
        }
    },

    escapeHtml(str) {
        if (!str) return '';
        return str
            .replace(/&/g, '&amp;')
            .replace(/</g, '&lt;')
            .replace(/>/g, '&gt;')
            .replace(/"/g, '&quot;')
            .replace(/'/g, '&#039;');
    }
};