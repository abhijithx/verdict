/**
 * leaderboard.js — Leaderboard table view.
 */

const Leaderboard = {
    _currentProblemId: null,

    async load(problemId) {
        if (!problemId || problemId === '') return;
        this._currentProblemId = parseInt(problemId, 10);
        const container = document.getElementById('leaderboard-content');
        if (!container) return;

        container.innerHTML = '<div class="flex justify-center py-10"><div class="spinner"></div></div>';

        try {
            const data = await ApiClient.getLeaderboard(this._currentProblemId);

            if (!data.entries || data.entries.length === 0) {
                container.innerHTML = `<div class="empty-state"><div class="empty-state-title">No submissions</div>
                    <div class="empty-state-desc">Complete a session for this problem to appear here.</div></div>`;
                return;
            }

            let h = `<div class="mb-3 flex items-center justify-between">
                <span class="text-sm font-semibold text-text-primary">${this._esc(data.problem_title)}</span>
                <span class="text-2xs text-text-tertiary">${data.total_submissions} submission${data.total_submissions!==1?'s':''}</span></div>
                <table class="lb-tbl"><thead><tr><th>Rank</th><th>Submission</th><th>Lang</th><th>Score</th><th>Profile</th><th>Verdict</th><th>Date</th></tr></thead><tbody>`;

            for (const e of data.entries) {
                const rc = e.rank === 1 ? 'text-accent font-bold' : 'text-text-tertiary';
                const vc = { optimal:'verdict-pass', needs_improvement:'verdict-warn', incorrect:'verdict-fail' }[e.verdict] || '';
                const vl = { optimal:'[ OPTIMAL ]', needs_improvement:'[ NEEDS WORK ]', incorrect:'[ INCORRECT ]' }[e.verdict] || `[ ${(e.verdict||'--').toUpperCase()} ]`;
                const dt = new Date(e.created_at).toLocaleDateString('en-US',{month:'short',day:'numeric',year:'numeric'});
                const langTag = `[${(e.language||'').substring(0,3).toUpperCase()}]`;

                h += `<tr class="cursor-pointer" onclick="Leaderboard.openSession(${e.session_id})">
                    <td class="lb-rank font-mono ${rc}">#${e.rank}</td>
                    <td class="font-medium font-sans">${this._esc(e.submission_label)}</td>
                    <td class="text-text-tertiary font-mono text-xs">${langTag}</td>
                    <td class="text-accent font-mono font-bold">${e.final_score??'--'}</td>
                    <td><span class="profile-badge">${this._esc(e.profile_name||'Default')}</span></td>
                    <td><span class="verdict ${vc}">${vl}</span></td>
                    <td class="text-text-tertiary font-mono text-xs">${dt}</td></tr>`;
            }
            h += '</tbody></table>';
            container.innerHTML = h;

            const eb = document.getElementById('btn-export-leaderboard');
            if (eb) eb.classList.remove('hidden');
        } catch (e) {
            container.innerHTML = `<p class="text-danger text-xs text-center py-8">Failed: ${e.message}</p>`;
        }
    },

    async openSession(sessionId) {
        App.closeLeaderboard();
        await App.openSession(sessionId);
    },

    async exportPdf() {
        if (!this._currentProblemId) return;
        const btn = document.getElementById('btn-export-leaderboard');
        if (typeof App !== 'undefined') App.setBusy(btn, true, 'Exporting…');
        try {
            if (typeof Toast !== 'undefined') Toast.info('Generating leaderboard PDF...');
            const blob = await ApiClient.exportLeaderboardPdf(this._currentProblemId);
            downloadBlob(blob, `leaderboard_${this._currentProblemId}.pdf`);
            if (typeof Toast !== 'undefined') Toast.success('Leaderboard PDF downloaded.');
        } catch (e) {
            if (typeof Toast !== 'undefined') Toast.error(`Export failed: ${e.message}`);
        } finally {
            if (typeof App !== 'undefined') App.setBusy(btn, false);
        }
    },

    _esc(s) { if (!s) return ''; const d = document.createElement('div'); d.textContent = s; return d.innerHTML; },
};