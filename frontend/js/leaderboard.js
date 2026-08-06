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
                <span class="text-sm font-semibold text-text-0">${this._esc(data.problem_title)}</span>
                <span class="text-2xs text-text-2">${data.total_submissions} submission${data.total_submissions!==1?'s':''}</span></div>
                <table class="lb-tbl"><thead><tr><th>Rank</th><th>Submission</th><th>Lang</th><th>Score</th><th>Profile</th><th>Verdict</th><th>Date</th></tr></thead><tbody>`;

            for (const e of data.entries) {
                const rc = e.rank<=3 ? `lb-rank-${e.rank}` : '';
                const vc = { optimal:'verdict-pass', needs_improvement:'verdict-warn', incorrect:'verdict-fail' }[e.verdict] || '';
                const sc = (e.final_score||0) >= 80 ? 'text-green-0' : (e.final_score||0) >= 50 ? 'text-amber-0' : 'text-red-0';
                const dt = new Date(e.created_at).toLocaleDateString('en-US',{month:'short',day:'numeric',year:'numeric'});

                h += `<tr class="cursor-pointer" onclick="Leaderboard.openSession(${e.session_id})">
                    <td class="lb-rank ${rc}">${e.rank}</td>
                    <td class="font-medium">${this._esc(e.submission_label)}</td>
                    <td class="text-text-2 font-mono text-xs">${e.language}</td>
                    <td class="${sc} font-bold">${e.final_score??'--'}</td>
                    <td><span class="profile-badge">${this._esc(e.profile_name||'Default')}</span></td>
                    <td><span class="verdict ${vc}" style="font-size:10px">${e.verdict||'--'}</span></td>
                    <td class="text-text-2 text-xs">${dt}</td></tr>`;
            }
            h += '</tbody></table>';
            container.innerHTML = h;

            const eb = document.getElementById('btn-export-leaderboard');
            if (eb) eb.classList.remove('hidden');
        } catch (e) {
            container.innerHTML = `<p class="text-red-0 text-xs text-center py-8">Failed: ${e.message}</p>`;
        }
    },

    async openSession(sessionId) {
        App.closeLeaderboard();
        await App.openSession(sessionId);
    },

    async exportPdf() {
        if (!this._currentProblemId) return;
        try {
            const blob = await ApiClient.exportLeaderboardPdf(this._currentProblemId);
            downloadBlob(blob, `leaderboard_${this._currentProblemId}.pdf`);
        } catch (e) { alert(`Export failed: ${e.message}`); }
    },

    _esc(s) { if (!s) return ''; const d = document.createElement('div'); d.textContent = s; return d.innerHTML; },
};
