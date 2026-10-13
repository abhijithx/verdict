/**
 * new-session-modal.js — New Session modal logic with AI Problem Architect & Interactive Review Studio.
 */

const NewSessionModal = {
    _lang: 'python',
    _problemId: 'new',
    _currentAiProblem: null,
    _originalUserPrompt: '',
    _generatedTestCases: null,
    _generatedSnippets: null,

    _escapeHtml(str) {
        if (!str) return '';
        return String(str)
            .replace(/&/g, '&amp;')
            .replace(/</g, '&lt;')
            .replace(/>/g, '&gt;')
            .replace(/"/g, '&quot;')
            .replace(/'/g, '&#39;');
    },

    async open(preselectedProblemId = null) {
        if (typeof App !== 'undefined') App._rememberFocus();
        const modal = document.getElementById('new-session-modal');
        if (modal) modal.classList.remove('hidden');
        if (typeof App !== 'undefined') App._focusModal('new-session-modal');

        // Reset state
        this._currentAiProblem = null;
        this._originalUserPrompt = '';
        this._generatedTestCases = null;
        this._generatedSnippets = null;

        // Reset panels
        const inputFields = document.getElementById('new-problem-input-fields');
        const reviewPanel = document.getElementById('modal-problem-review-panel');
        if (inputFields) inputFields.classList.remove('hidden');
        if (reviewPanel) reviewPanel.classList.add('hidden');

        let calculatedAttempt = 'Attempt 1';
        try {
            const problems = await ApiClient.getProblems();
            const sel = document.getElementById('modal-problem-select');
            if (sel) {
                sel.innerHTML = '<option value="new">+ New Problem</option>';
                for (const p of problems) {
                    const o = document.createElement('option');
                    o.value = p.problem_id;
                    o.textContent = `${p.title} (${p.difficulty})`;
                    sel.appendChild(o);
                }
                if (preselectedProblemId) {
                    sel.value = String(preselectedProblemId);
                }
            }

            if (preselectedProblemId) {
                try {
                    const allSessions = await ApiClient.getSessions();
                    const count = allSessions.filter(s => String(s.problem_id) === String(preselectedProblemId)).length;
                    calculatedAttempt = `Attempt ${count + 1}`;
                } catch (e) {}
            }
        } catch (e) { console.error('[NewSessionModal] getProblems error:', e); }

        try {
            const profiles = await ApiClient.getProfiles();
            const sel = document.getElementById('modal-profile-select');
            if (sel) {
                sel.innerHTML = '';
                for (const p of profiles) {
                    const o = document.createElement('option');
                    o.value = p.profile_id;
                    o.textContent = p.name + (p.is_default ? ' *' : '');
                    sel.appendChild(o);
                }
                const co = document.createElement('option');
                co.value = 'custom';
                co.textContent = '+ Custom Profile';
                sel.appendChild(co);
            }
        } catch (e) { console.error('[NewSessionModal] getProfiles error:', e); }

        this._lang = 'python';
        this._problemId = preselectedProblemId ? String(preselectedProblemId) : 'new';
        const isNew = this._problemId === 'new';
        const newFields = document.getElementById('new-problem-fields');
        if (newFields) newFields.style.display = isNew ? '' : 'none';

        const probSel = document.getElementById('modal-problem-select');
        if (probSel) probSel.value = this._problemId;

        const labelInput = document.getElementById('modal-submission-label');
        if (labelInput) labelInput.value = calculatedAttempt;

        const titleInput = document.getElementById('modal-problem-title');
        if (titleInput) titleInput.value = '';
        const descInput = document.getElementById('modal-problem-desc');
        if (descInput) descInput.value = '';
        const diffSel = document.getElementById('modal-problem-diff');
        if (diffSel) diffSel.value = 'medium';
        const sampleIn = document.getElementById('modal-sample-input');
        if (sampleIn) sampleIn.value = '';
        const sampleOut = document.getElementById('modal-sample-output');
        if (sampleOut) sampleOut.value = '';
        const refineIn = document.getElementById('modal-refine-input');
        if (refineIn) refineIn.value = '';

        const custProf = document.getElementById('custom-profile-panel');
        if (custProf) custProf.classList.add('hidden');
        this.selectLanguage('python');

        if (preselectedProblemId && labelInput) {
            setTimeout(() => labelInput.focus(), 50);
        } else if (titleInput) {
            setTimeout(() => titleInput.focus(), 50);
        }
    },

    close() {
        const modal = document.getElementById('new-session-modal');
        if (modal) modal.classList.add('hidden');
        if (typeof App !== 'undefined') App._restoreFocus();
    },

    selectLanguage(lang) {
        this._lang = lang;
        document.querySelectorAll('#lang-selector .lang-pill').forEach(b => {
            b.classList.toggle('active', b.dataset.lang === lang);
        });
    },

    async onProblemChange(val) {
        this._problemId = val;
        const newFields = document.getElementById('new-problem-fields');
        if (newFields) newFields.style.display = val === 'new' ? '' : 'none';

        const labelInput = document.getElementById('modal-submission-label');
        if (val === 'new') {
            if (labelInput) labelInput.value = 'Attempt 1';
        } else {
            try {
                const allSessions = await ApiClient.getSessions();
                const count = allSessions.filter(s => String(s.problem_id) === String(val)).length;
                if (labelInput) labelInput.value = `Attempt ${count + 1}`;
            } catch (e) {}
        }
    },


    onProfileChange(val) {
        const panel = document.getElementById('custom-profile-panel');
        if (!panel) return;
        if (val === 'custom') {
            panel.classList.remove('hidden');
            if (typeof EvaluationProfileUI !== 'undefined') EvaluationProfileUI.render('custom-profile-panel');
        } else {
            panel.classList.add('hidden');
        }
    },

    backToEditFields() {
        const inputFields = document.getElementById('new-problem-input-fields');
        const reviewPanel = document.getElementById('modal-problem-review-panel');
        if (inputFields) inputFields.classList.remove('hidden');
        if (reviewPanel) reviewPanel.classList.add('hidden');
    },

    async processWithAi(feedback = null) {
        const titleInput = document.getElementById('modal-problem-title');
        const descInput = document.getElementById('modal-problem-desc');
        const diffSel = document.getElementById('modal-problem-diff');
        const sampleInEl = document.getElementById('modal-sample-input');
        const sampleOutEl = document.getElementById('modal-sample-output');

        const title = titleInput ? titleInput.value.trim() : '';
        const desc = descInput ? descInput.value.trim() : '';
        const sampleIn = sampleInEl ? sampleInEl.value.trim() : '';
        const sampleOut = sampleOutEl ? sampleOutEl.value.trim() : '';
        const difficulty = diffSel ? diffSel.value : 'medium';

        let promptText = '';
        if (!feedback) {
            const parts = [];
            if (title) parts.push(`Title: ${title}`);
            if (desc) parts.push(`Description/Requirements: ${desc}`);
            if (sampleIn) parts.push(`Sample Input: ${sampleIn}`);
            if (sampleOut) parts.push(`Expected Output: ${sampleOut}`);

            promptText = parts.join('\n\n');
            if (!promptText.trim()) {
                if (typeof Toast !== 'undefined') Toast.warning('Please enter a problem title or statement before processing with AI.');
                return false;
            }
            this._originalUserPrompt = promptText;
        } else {
            promptText = this._originalUserPrompt || title || 'Algorithmic Problem';
        }

        const btnGen = document.getElementById('btn-modal-ai-generate');
        const btnRefine = document.getElementById('btn-modal-refine-submit');
        const createBtn = document.getElementById('btn-create-session');
        const continueBtn = document.getElementById('btn-modal-review-continue');
        const activeBtn = feedback ? btnRefine : btnGen;

        let origBtnHtml = '';
        if (activeBtn) {
            origBtnHtml = activeBtn.innerHTML;
            activeBtn.disabled = true;
            activeBtn.innerHTML = `<span class="animate-spin inline-block w-3 h-3 border-2 border-current border-t-transparent rounded-full mr-1.5"></span> ${feedback ? 'Refining with AI...' : 'Architecting LeetCode Spec...'}`;
        }
        if (typeof App !== 'undefined') {
            if (createBtn) App.setBusy(createBtn, true, feedback ? 'Refining with AI…' : 'Architecting Spec…');
            if (continueBtn) App.setBusy(continueBtn, true, feedback ? 'Refining with AI…' : 'Architecting Spec…');
        }

        if (typeof Toast !== 'undefined') {
            Toast.info(feedback ? `Refining specification: "${feedback.slice(0, 35)}..."` : `AI Architecting LeetCode specification & test cases...`);
        }


        try {
            const data = await ApiClient.generateProblem(
                promptText,
                difficulty,
                feedback,
                this._currentAiProblem
            );

            this._currentAiProblem = data;

            // Sync test cases and starter snippets
            if (data.sample_test_cases && data.sample_test_cases.length > 0) {
                this._generatedTestCases = data.sample_test_cases.map((tc, idx) => ({
                    test_id: idx + 1,
                    test_case_id: tc.test_case_id || `Case ${idx + 1}`,
                    description: tc.description || `Sample Case ${idx + 1}`,
                    stdin: tc.stdin || '',
                    expected_stdout: tc.expected_stdout || '',
                    is_edge_case: Boolean(tc.is_edge_case)
                }));
            } else {
                this._generatedTestCases = [];
            }

            if (data.code_snippets) {
                this._generatedSnippets = data.code_snippets;
            }

            // Sync back into form inputs in background
            if (titleInput && data.title) titleInput.value = data.title;
            if (diffSel && data.difficulty) diffSel.value = data.difficulty.toLowerCase();
            if (descInput && data.description) descInput.value = data.description;

            // Render interactive review panel
            this.renderProblemReview(data);

            const inputFields = document.getElementById('new-problem-input-fields');
            const reviewPanel = document.getElementById('modal-problem-review-panel');
            if (inputFields) inputFields.classList.add('hidden');
            if (reviewPanel) reviewPanel.classList.remove('hidden');

            const refineInput = document.getElementById('modal-refine-input');
            if (refineInput) refineInput.value = '';

            if (typeof Toast !== 'undefined') {
                const count = this._generatedTestCases.length;
                Toast.success(feedback ? `✨ Problem specification updated based on your feedback!` : `✨ Generated "${data.title}" LeetCode specification with ${count} testcases!`);
            }
            return true;
        } catch (err) {
            console.error('[NewSessionModal] processWithAi error:', err);
            if (typeof Toast !== 'undefined') Toast.error(`AI generation note: ${err.message}`);
            return false;
        } finally {
            if (activeBtn) {
                activeBtn.disabled = false;
                activeBtn.innerHTML = origBtnHtml;
            }
            if (typeof App !== 'undefined') {
                if (createBtn) App.setBusy(createBtn, false);
                if (continueBtn) App.setBusy(continueBtn, false);
            }
        }
    },


    async refineWithAi() {
        const refineInput = document.getElementById('modal-refine-input');
        const feedback = refineInput ? refineInput.value.trim() : '';
        if (!feedback) {
            if (typeof Toast !== 'undefined') Toast.warning('Please describe what changes or adjustments you need.');
            if (refineInput) refineInput.focus();
            return;
        }
        await this.processWithAi(feedback);
    },

    renderProblemReview(data) {
        // 1. Problem Title
        const titleEl = document.getElementById('review-problem-title');
        if (titleEl) titleEl.textContent = data.title || 'Algorithmic Problem';

        // 2. Difficulty Badge
        const diffBadge = document.getElementById('review-difficulty-badge');
        if (diffBadge) {
            const diff = (data.difficulty || 'medium').toLowerCase();
            diffBadge.textContent = diff.toUpperCase();
            diffBadge.className = 'px-2 py-0.5 text-[10px] font-mono rounded border uppercase ';
            if (diff === 'easy') {
                diffBadge.className += 'bg-emerald-500/10 text-emerald-400 border-emerald-500/30';
            } else if (diff === 'hard') {
                diffBadge.className += 'bg-rose-500/10 text-rose-400 border-rose-500/30';
            } else {
                diffBadge.className += 'bg-amber-500/10 text-amber-400 border-amber-500/30';
            }
        }

        // 3. Test Cases Count Badge
        const countBadge = document.getElementById('review-cases-count');
        const tcList = data.sample_test_cases || [];
        if (countBadge) countBadge.textContent = `${tcList.length} Test Cases`;

        // 4. Method Signature Preview
        const sigEl = document.getElementById('review-method-sig');
        if (sigEl) {
            let sigText = '';
            if (data.code_snippets && data.code_snippets.python) {
                const pyLines = data.code_snippets.python.split('\n');
                const defLine = pyLines.find(l => l.trim().startsWith('def '));
                if (defLine) {
                    sigText = defLine.trim().replace(/:$/, '');
                }
            }
            if (!sigText) {
                sigText = `def ${data.method_name || 'solve'}(...)`;
            }
            sigEl.textContent = sigText;
        }

        // 5. Render Markdown Description
        const descEl = document.getElementById('review-problem-statement');
        if (descEl) {
            const rawDesc = data.description || 'No description provided.';
            if (typeof marked !== 'undefined' && typeof marked.parse === 'function') {
                descEl.innerHTML = marked.parse(rawDesc);
            } else {
                descEl.innerHTML = this._escapeHtml(rawDesc).replace(/\n/g, '<br>');
            }
        }

        // 6. Test Cases List Preview
        const tcContainer = document.getElementById('review-testcases-list');
        if (tcContainer) {
            tcContainer.innerHTML = '';
            if (tcList.length === 0) {
                tcContainer.innerHTML = '<div class="text-xs text-text-tertiary italic p-2">No test cases generated.</div>';
            } else {
                tcList.forEach((tc, idx) => {
                    const item = document.createElement('div');
                    item.className = 'p-2 rounded bg-surface-base border border-border-subtle flex flex-col gap-1 text-2xs';
                    const isEdge = Boolean(tc.is_edge_case);
                    item.innerHTML = `
                        <div class="flex items-center justify-between">
                            <span class="font-semibold text-text-primary">${this._escapeHtml(tc.test_case_id || `Case ${idx + 1}`)} <span class="text-text-tertiary font-normal">(${this._escapeHtml(tc.description || 'Test')})</span></span>
                            <span class="text-3xs px-1.5 py-0.5 rounded font-mono ${isEdge ? 'bg-amber-500/15 text-amber-400 border border-amber-500/30' : 'bg-emerald-500/15 text-emerald-400 border border-emerald-500/30'}">${isEdge ? 'Edge Case' : 'Public Example'}</span>
                        </div>
                        <div class="grid grid-cols-2 gap-2 font-mono text-3xs mt-0.5">
                            <div class="bg-surface-elevated/70 p-1.5 rounded truncate"><span class="text-text-tertiary font-sans">Input:</span> <span class="text-text-secondary">${this._escapeHtml(tc.stdin || '')}</span></div>
                            <div class="bg-surface-elevated/70 p-1.5 rounded truncate"><span class="text-text-tertiary font-sans">Output:</span> <span class="text-emerald-400">${this._escapeHtml(tc.expected_stdout || '')}</span></div>
                        </div>
                    `;
                    tcContainer.appendChild(item);
                });
            }
        }
    },

    _generateSnippetsForTitle(title) {
        const cleanTitle = (title || 'Solution').replace(/[^a-zA-Z0-9\s]/g, '').trim();
        const words = cleanTitle.split(/\s+/).filter(Boolean);
        let methodName = 'solve';
        if (words.length > 0) {
            methodName = words[0].toLowerCase() + words.slice(1).map(w => w.charAt(0).toUpperCase() + w.slice(1).toLowerCase()).join('');
        }
        if (!/^[a-zA-Z_][a-zA-Z0-9_]*$/.test(methodName)) {
            methodName = 'solve';
        }

        const isTwoSum = cleanTitle.toLowerCase().includes('two sum');
        if (isTwoSum) {
            return {
                python: `class Solution:\n    def twoSum(self, nums: list[int], target: int) -> list[int]:\n        pass\n`,
                cpp: `#include <vector>\nusing namespace std;\n\nclass Solution {\npublic:\n    vector<int> twoSum(vector<int>& nums, int target) {\n        return {};\n    }\n};\n`,
                java: `class Solution {\n    public int[] twoSum(int[] nums, int target) {\n        return new int[]{};\n    }\n}\n`,
                javascript: `/**\n * @param {number[]} nums\n * @param {number} target\n * @return {number[]}\n */\nvar twoSum = function(nums, target) {\n    return [];\n};\n`
            };
        }

        return {
            python: `class Solution:\n    def ${methodName}(self, *args, **kwargs):\n        # Implement your solution\n        pass\n`,
            cpp: `#include <iostream>\n#include <vector>\n#include <string>\nusing namespace std;\n\nclass Solution {\npublic:\n    void ${methodName}() {\n        // Implement your solution\n    }\n};\n`,
            java: `import java.util.*;\n\nclass Solution {\n    public void ${methodName}() {\n        // Implement your solution\n    }\n}\n`,
            javascript: `/**\n * @return {void}\n */\nvar ${methodName} = function() {\n    // Implement your solution\n};\n`
        };
    },

    async create() {
        const labelEl = document.getElementById('modal-submission-label');
        let label = labelEl ? labelEl.value.trim() : '';
        if (!label) {
            label = 'Attempt 1';
            if (labelEl) labelEl.value = label;
        }

        const probSel = document.getElementById('modal-problem-select');
        let problemId = probSel ? probSel.value : this._problemId;
        this._problemId = problemId;

        let testCases = null;
        let snippets = null;

        const createBtn = document.getElementById('btn-create-session');
        const continueBtn = document.getElementById('btn-modal-review-continue');
        if (typeof App !== 'undefined') {
            if (createBtn) App.setBusy(createBtn, true, 'Synthesizing & Creating…');
            if (continueBtn) App.setBusy(continueBtn, true, 'Creating…');
        }

        try {
            if (problemId === 'new') {
                const titleVal = document.getElementById('modal-problem-title')?.value.trim() || '';
                const descVal = document.getElementById('modal-problem-desc')?.value.trim() || '';
                if (!titleVal && !descVal) {
                    if (typeof Toast !== 'undefined') Toast.warning('Please enter a problem title or statement.');
                    return;
                }

                // If the user hasn't generated/reviewed the problem with AI yet, synthesize spec now
                if (!this._currentAiProblem) {
                    if (typeof Toast !== 'undefined') Toast.info('Synthesizing LeetCode problem specification with AI...');
                    try {
                        await this.processWithAi();
                    } catch (e) {
                        console.warn('[NewSessionModal] processWithAi notice:', e);
                    }
                }

                // User has reviewed or synthesized the problem
                const title = (this._currentAiProblem && this._currentAiProblem.title) || titleVal || 'Custom Problem';
                const desc = (this._currentAiProblem && this._currentAiProblem.description) || descVal || 'Implement your solution.';
                const diffSel = document.getElementById('modal-problem-diff');
                const difficulty = ((this._currentAiProblem && this._currentAiProblem.difficulty) || (diffSel ? diffSel.value : 'medium')).toLowerCase();

                snippets = this._generatedSnippets || (this._currentAiProblem && this._currentAiProblem.code_snippets) || this._generateSnippetsForTitle(title);
                testCases = this._generatedTestCases && this._generatedTestCases.length > 0 ? this._generatedTestCases : null;

                try {
                    const p = await ApiClient.createProblem(title, desc, difficulty, snippets);
                    problemId = p.problem_id;
                    try {
                        localStorage.setItem(`verdict_snippets_${problemId}`, JSON.stringify(snippets));
                    } catch (e) {}
                } catch (e) {
                    if (typeof Toast !== 'undefined') Toast.error(`Failed to create problem: ${e.message}`);
                    return;
                }
            } else {
                // Existing problem selected: fetch problem snippets if available, or generate them
                try {
                    const p = await ApiClient.getProblem(problemId);
                    if (p && p.code_snippets) {
                        snippets = p.code_snippets;
                    } else if (p && p.title) {
                        snippets = this._generateSnippetsForTitle(p.title);
                    }
                    if (snippets) {
                        try {
                            localStorage.setItem(`verdict_snippets_${problemId}`, JSON.stringify(snippets));
                        } catch (e) {}
                    }
                } catch (e) {}
            }

            const profileSel = document.getElementById('modal-profile-select');
            let profileId = profileSel ? profileSel.value : null;
            if (profileId === 'custom') {
                if (typeof Toast !== 'undefined') Toast.warning('Please save your custom evaluation profile first.');
                return;
            }
            profileId = parseInt(profileId, 10) || null;

            if (createBtn) App.setBusy(createBtn, true, 'Creating Session…');
            if (continueBtn) App.setBusy(continueBtn, true, 'Creating Session…');

            if (!snippets) {
                snippets = this._generateSnippetsForTitle('Solution');
            }
            const initialCode = (snippets && snippets[this._lang]) ? snippets[this._lang] : (this._generateSnippetsForTitle('Solution')[this._lang] || '');

            const result = await ApiClient.createSession({
                problem_id: parseInt(problemId, 10),
                language: this._lang,
                submission_label: label,
                profile_id: profileId,
                code: initialCode,
                test_cases: testCases
            });
            this.close();
            if (typeof Toast !== 'undefined') Toast.success('Session created successfully with LeetCode specification & test cases!');
            await App.openSession(result.session_id);
            await App.refreshSidebar();
        } catch (e) {
            console.error('[NewSessionModal] createSession error:', e);
            if (typeof Toast !== 'undefined') Toast.error(`Failed to create session: ${e.message}`);
        } finally {
            if (typeof App !== 'undefined') {
                if (createBtn) App.setBusy(createBtn, false);
                if (continueBtn) App.setBusy(continueBtn, false);
            }
        }
    },

};
