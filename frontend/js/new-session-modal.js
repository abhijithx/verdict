/**
 * new-session-modal.js — New Session modal logic.
 */

const NewSessionModal = {
    _lang: 'python',
    _problemId: 'new',

    async open() {
        document.getElementById('new-session-modal').classList.remove('hidden');

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
        this._problemId = 'new';
        document.getElementById('modal-submission-label').value = '';
        document.getElementById('modal-problem-title').value = '';
        document.getElementById('modal-problem-desc').value = '';
        document.getElementById('new-problem-fields').style.display = '';
        document.getElementById('custom-profile-panel').classList.add('hidden');
        this.selectLanguage('python');
    },

    close() { document.getElementById('new-session-modal').classList.add('hidden'); },

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

    async create() {
        const label = document.getElementById('modal-submission-label').value.trim();
        if (!label) {
            if (typeof Toast !== 'undefined') Toast.warning('Please enter a submission label (e.g. "Attempt 1").');
            return;
        }

        let problemId = this._problemId;
        if (problemId === 'new') {
            const title = document.getElementById('modal-problem-title').value.trim();
            const desc = document.getElementById('modal-problem-desc').value.trim();
            if (!title) {
                if (typeof Toast !== 'undefined') Toast.warning('Please enter a problem title.');
                return;
            }
            if (!desc) {
                if (typeof Toast !== 'undefined') Toast.warning('Please enter a problem statement.');
                return;
            }
            try {
                const p = await ApiClient.createProblem(title, desc);
                problemId = p.problem_id;
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

        try {
            const result = await ApiClient.createSession(parseInt(problemId, 10), this._lang, label, profileId);
            this.close();
            if (typeof Toast !== 'undefined') Toast.success('Session created successfully!');
            await App.openSession(result.session_id);
            await App.refreshSidebar();
        } catch (e) {
            if (typeof Toast !== 'undefined') Toast.error(`Failed to create session: ${e.message}`);
        }
    },
};
