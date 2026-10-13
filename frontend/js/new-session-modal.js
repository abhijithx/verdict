/**
 * new-session-modal.js — New Session modal logic.
 */

const NewSessionModal = {
    _lang: 'python',
    _problemId: 'new',

    async open(preselectedProblemId = null) {
        if (typeof App !== 'undefined') App._rememberFocus();
        document.getElementById('new-session-modal').classList.remove('hidden');
        if (typeof App !== 'undefined') App._focusModal('new-session-modal');

        try {
            const problems = await ApiClient.getProblems();
            const sel = document.getElementById('modal-problem-select');
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
        } catch (e) { console.error(e); }

        try {
            const profiles = await ApiClient.getProfiles();
            const sel = document.getElementById('modal-profile-select');
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
        } catch (e) { console.error(e); }

        this._lang = 'python';
        this._problemId = preselectedProblemId ? String(preselectedProblemId) : 'new';
        const isNew = this._problemId === 'new';
        const newFields = document.getElementById('new-problem-fields');
        if (newFields) newFields.style.display = isNew ? '' : 'none';

        const probSel = document.getElementById('modal-problem-select');
        if (probSel && preselectedProblemId) probSel.value = String(preselectedProblemId);

        document.getElementById('modal-submission-label').value = '';
        document.getElementById('modal-problem-title').value = '';
        document.getElementById('modal-problem-desc').value = '';
        const aiPromptEl = document.getElementById('modal-ai-prompt');
        if (aiPromptEl) aiPromptEl.value = '';
        this._generatedTestCases = null;
        this._generatedSnippets = null;
        const diffSel = document.getElementById('modal-problem-diff');
        if (diffSel) diffSel.value = 'medium';
        const sampleIn = document.getElementById('modal-sample-input');
        if (sampleIn) sampleIn.value = '';
        const sampleOut = document.getElementById('modal-sample-output');
        if (sampleOut) sampleOut.value = '';
        document.getElementById('custom-profile-panel').classList.add('hidden');
        this.selectLanguage('python');

        if (preselectedProblemId) {
            const labelInput = document.getElementById('modal-submission-label');
            if (labelInput) setTimeout(() => labelInput.focus(), 50);
        }
    },

    close() {
        document.getElementById('new-session-modal').classList.add('hidden');
        if (typeof App !== 'undefined') App._restoreFocus();
    },

    selectLanguage(lang) {
        this._lang = lang;
        document.querySelectorAll('#lang-selector .lang-pill').forEach(b => {
            b.classList.toggle('active', b.dataset.lang === lang);
        });
    },

    onProblemChange(val) {
        this._problemId = val;
        document.getElementById('new-problem-fields').style.display = val === 'new' ? '' : 'none';
    },

    onProfileChange(val) {
        const panel = document.getElementById('custom-profile-panel');
        if (val === 'custom') { panel.classList.remove('hidden'); EvaluationProfileUI.render('custom-profile-panel'); }
        else panel.classList.add('hidden');
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
                cpp: `#include <vector>\nusing namespace std;\n\nclass Solution {\npublic:\n    vector<int> twoSum(vector<int>& nums, int target) {\n        \n    }\n};\n`,
                java: `class Solution {\n    public int[] twoSum(int[] nums, int target) {\n        return new int[]{};\n    }\n}\n`,
                javascript: `/**\n * @param {number[]} nums\n * @param {number} target\n * @return {number[]}\n */\nvar twoSum = function(nums, target) {\n    \n};\n`
            };
        }

        return {
            python: `class Solution:\n    def ${methodName}(self, *args, **kwargs):\n        # Implement your solution\n        pass\n`,
            cpp: `#include <iostream>\n#include <vector>\n#include <string>\nusing namespace std;\n\nclass Solution {\npublic:\n    // Implement ${methodName}\n};\n`,
            java: `class Solution {\n    // Implement ${methodName}\n}\n`,
            javascript: `/**\n * Solution\n */\nvar ${methodName} = function() {\n    // Implement your solution\n};\n`
        };
    },

    async generateWithAi() {
        const titleInput = document.getElementById('modal-problem-title');
        const descInput = document.getElementById('modal-problem-desc');
        const diffSel = document.getElementById('modal-problem-diff');
        const btn = document.getElementById('btn-modal-ai-generate');

        let promptText = (titleInput ? titleInput.value.trim() : '') || (descInput ? descInput.value.trim() : '');
        if (!promptText) {
            promptText = window.prompt('Enter problem topic or concept to generate with AI (e.g. "Longest Palindromic Substring", "LRU Cache", "Valid Parentheses"):');
            if (!promptText || !promptText.trim()) return;
            if (titleInput) titleInput.value = promptText.trim();
        }

        const difficulty = diffSel ? diffSel.value : 'medium';

        let origBtnHtml = '';
        if (btn) {
            origBtnHtml = btn.innerHTML;
            btn.disabled = true;
            btn.innerHTML = `<span class="animate-spin inline-block w-3 h-3 border-2 border-current border-t-transparent rounded-full mr-1"></span> Generating...`;
        }
        if (typeof Toast !== 'undefined') Toast.info(`Generating LeetCode specification & testcases for "${promptText}"...`);

        try {
            const data = await ApiClient.generateProblem(promptText, difficulty);
            if (titleInput && data.title) titleInput.value = data.title;
            if (diffSel && data.difficulty) diffSel.value = data.difficulty.toLowerCase();
            if (descInput && data.description) descInput.value = data.description;

            const sampleInEl = document.getElementById('modal-sample-input');
            const sampleOutEl = document.getElementById('modal-sample-output');
            if (data.sample_test_cases && data.sample_test_cases.length > 0) {
                const firstCase = data.sample_test_cases[0];
                if (sampleInEl) sampleInEl.value = firstCase.stdin || '';
                if (sampleOutEl) sampleOutEl.value = firstCase.expected_stdout || '';
                this._generatedTestCases = data.sample_test_cases.map((tc, idx) => ({
                    test_id: idx + 1,
                    test_case_id: tc.test_case_id || `Case ${idx + 1}`,
                    description: tc.description || `Sample Case ${idx + 1}`,
                    stdin: tc.stdin || '',
                    expected_stdout: tc.expected_stdout || '',
                    is_edge_case: tc.is_edge_case || false
                }));
            }

            if (data.code_snippets) {
                this._generatedSnippets = data.code_snippets;
            }

            if (typeof Toast !== 'undefined') {
                const count = this._generatedTestCases ? this._generatedTestCases.length : 0;
                Toast.success(`✨ Generated "${data.title}" with LeetCode templates & ${count} testcases!`);
            }
        } catch (err) {
            console.error('[NewSessionModal] generateWithAi error:', err);
            if (typeof Toast !== 'undefined') Toast.error(`AI generation note: ${err.message}`);
        } finally {
            if (btn) {
                btn.disabled = false;
                btn.innerHTML = origBtnHtml || '<span>✨ AI Auto-Generate</span>';
            }
        }
    },

    async create() {
        const label = document.getElementById('modal-submission-label').value.trim();
        if (!label) {
            if (typeof Toast !== 'undefined') Toast.warning('Please enter a submission label (e.g. "Attempt 1").');
            return;
        }

        let problemId = this._problemId;
        let testCases = null;
        let snippets = null;

        if (problemId === 'new') {
            const title = document.getElementById('modal-problem-title').value.trim();
            const desc = document.getElementById('modal-problem-desc').value.trim();
            const diffEl = document.getElementById('modal-problem-diff');
            const difficulty = diffEl ? diffEl.value : 'medium';
            const sampleInEl = document.getElementById('modal-sample-input');
            const sampleOutEl = document.getElementById('modal-sample-output');
            const sampleIn = sampleInEl ? sampleInEl.value.trim() : '';
            const sampleOut = sampleOutEl ? sampleOutEl.value.trim() : '';

            if (!title) {
                if (typeof Toast !== 'undefined') Toast.warning('Please enter a problem title.');
                return;
            }
            if (!desc) {
                if (typeof Toast !== 'undefined') Toast.warning('Please enter a problem statement.');
                return;
            }

            snippets = this._generatedSnippets || this._generateSnippetsForTitle(title);

            if (this._generatedTestCases && this._generatedTestCases.length > 0) {
                testCases = this._generatedTestCases;
            } else if (sampleIn || sampleOut) {
                testCases = [{
                    test_id: 1,
                    test_case_id: 'Case 1',
                    description: 'Sample Case 1',
                    stdin: sampleIn ? (sampleIn.endsWith('\n') ? sampleIn : sampleIn + '\n') : '',
                    expected_stdout: sampleOut,
                    is_edge_case: false
                }];
            }

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
        }

        const profileSel = document.getElementById('modal-profile-select');
        let profileId = profileSel.value;
        if (profileId === 'custom') {
            if (typeof Toast !== 'undefined') Toast.warning('Please save your custom evaluation profile first.');
            return;
        }
        profileId = parseInt(profileId, 10) || null;

        const createBtn = document.getElementById('btn-create-session');
        if (typeof App !== 'undefined') App.setBusy(createBtn, true, 'Creating…');
        try {
            const initialCode = (snippets && snippets[this._lang]) ? snippets[this._lang] : '';
            const result = await ApiClient.createSession({
                problem_id: parseInt(problemId, 10),
                language: this._lang,
                submission_label: label,
                profile_id: profileId,
                code: initialCode,
                test_cases: testCases
            });
            this.close();
            if (typeof Toast !== 'undefined') Toast.success('Session created successfully!');
            await App.openSession(result.session_id);
            await App.refreshSidebar();
        } catch (e) {
            if (typeof Toast !== 'undefined') Toast.error(`Failed to create session: ${e.message}`);
        } finally {
            if (typeof App !== 'undefined') App.setBusy(createBtn, false);
        }
    },
};
