/**
 * leaderboard.js — Advanced Problem Leaderboard & Performance Rankings.
 */

const Leaderboard = {
    _currentProblemId: null,
    _data: null,
    _filterLang: 'all',
    _searchQuery: '',

    async load(problemId) {
        if (!problemId || problemId === '') return;
        this._currentProblemId = parseInt(problemId, 10);
        const container = document.getElementById('leaderboard-content');
        const controls = document.getElementById('leaderboard-controls');
        const exportBtn = document.getElementById('btn-export-leaderboard');
        if (!container) return;

        container.innerHTML = `
            <div class="flex flex-col items-center justify-center py-12 text-center text-text-tertiary">
                <span class="animate-spin inline-block w-6 h-6 border-2 border-[#007acc] border-t-transparent rounded-full mb-3"></span>
                <p class="text-xs font-mono">Loading problem leaderboard rankings...</p>
            </div>
        `;

        try {
            const data = await ApiClient.getLeaderboard(this._currentProblemId);
            this._data = data;

            if (controls) controls.classList.remove('hidden');
            if (exportBtn) exportBtn.classList.remove('hidden');

            this.render();
        } catch (e) {
            console.error('[Leaderboard] Failed to load:', e);
            container.innerHTML = `
                <div class="p-8 text-center text-xs text-[#f43f5e] bg-void rounded-xl border border-[#f43f5e]/20">
                    <p class="font-semibold mb-1">Failed to load leaderboard rankings</p>
                    <p class="text-text-tertiary">${this._esc(e.message)}</p>
                </div>
            `;
            if (controls) controls.classList.add('hidden');
            if (exportBtn) exportBtn.classList.add('hidden');
        }
    },

    setLanguage(lang) {
        this._filterLang = (lang || 'all').toLowerCase();
        document.querySelectorAll('.lb-lang-btn').forEach(btn => {
            const bLang = btn.dataset.lang || 'all';
            btn.classList.toggle('active', bLang === this._filterLang);
        });
        this.render();
    },

    setSearch(query) {
        this._searchQuery = (query || '').trim().toLowerCase();
        this.render();
    },

    render() {
        const container = document.getElementById('leaderboard-content');
        if (!container || !this._data) return;

        const allEntries = this._data.entries || [];
        if (allEntries.length === 0) {
            container.innerHTML = `
                <div class="flex flex-col items-center justify-center py-12 px-4 text-center">
                    <div class="w-12 h-12 rounded-xl bg-white/5 border border-white/10 flex items-center justify-center text-2xl mb-3">🏆</div>
                    <h3 class="text-sm font-semibold text-white mb-1">No Leaderboard Submissions Yet</h3>
                    <p class="text-xs text-text-tertiary max-w-sm leading-relaxed mb-4">
                        Be the first to evaluate a solution for <strong class="text-white">${this._esc(this._data.problem_title)}</strong> and claim the top ranking.
                    </p>
                </div>
            `;
            return;
        }

        // Apply language filter and search
        let filtered = allEntries;
        if (this._filterLang !== 'all') {
            filtered = filtered.filter(e => (e.language || '').toLowerCase().startsWith(this._filterLang));
        }
        if (this._searchQuery) {
            filtered = filtered.filter(e => {
                const label = (e.submission_label || '').toLowerCase();
                const profile = (e.profile_name || '').toLowerCase();
                const sid = String(e.session_id || '');
                return label.includes(this._searchQuery) || profile.includes(this._searchQuery) || sid.includes(this._searchQuery);
            });
        }

        // Compute summary metrics across all entries for this problem
        const totalSubmissions = allEntries.length;
        const scores = allEntries.map(e => e.final_score).filter(s => typeof s === 'number' && !isNaN(s));
        const topScore = scores.length > 0 ? Math.max(...scores) : null;
        const avgScore = scores.length > 0 ? Math.round(scores.reduce((a, b) => a + b, 0) / scores.length) : null;
        const optimalCount = allEntries.filter(e => (e.verdict || '').toLowerCase() === 'optimal' || (e.final_score && e.final_score >= 80)).length;
        const optPercent = totalSubmissions > 0 ? Math.round((optimalCount / totalSubmissions) * 100) : 0;

        let html = `
            <!-- Top Summary Cards -->
            <div class="grid grid-cols-2 sm:grid-cols-4 gap-3 mb-4">
                <div class="bg-[#1e1e1e] p-3 rounded-lg border border-white/5">
                    <span class="text-2xs font-mono uppercase tracking-wider text-text-tertiary block">Total Runs</span>
                    <span class="text-xl font-bold font-mono text-white mt-1 block">${totalSubmissions}</span>
                </div>
                <div class="bg-[#1e1e1e] p-3 rounded-lg border border-white/5">
                    <span class="text-2xs font-mono uppercase tracking-wider text-text-tertiary block">Top Score</span>
                    <span class="text-xl font-bold font-mono text-[#38bdf8] mt-1 block">${topScore !== null ? `${topScore}/100` : '--'}</span>
                </div>
                <div class="bg-[#1e1e1e] p-3 rounded-lg border border-white/5">
                    <span class="text-2xs font-mono uppercase tracking-wider text-text-tertiary block">Average Score</span>
                    <span class="text-xl font-bold font-mono text-white mt-1 block">${avgScore !== null ? `${avgScore}/100` : '--'}</span>
                </div>
                <div class="bg-[#1e1e1e] p-3 rounded-lg border border-white/5">
                    <span class="text-2xs font-mono uppercase tracking-wider text-text-tertiary block">Optimal Rate</span>
                    <span class="text-xl font-bold font-mono text-[#2cbb5d] mt-1 block">${optPercent}%</span>
                </div>
            </div>

            <!-- Problem Header & Count -->
            <div class="mb-3 flex items-center justify-between text-xs text-text-tertiary border-b border-white/5 pb-2">
                <div class="flex items-center gap-2">
                    <span class="font-bold text-white text-[13.5px]">${this._esc(this._data.problem_title)}</span>
                    <span class="text-2xs px-2 py-0.5 rounded bg-white/5 font-mono text-text-secondary border border-white/5">Problem #${this._data.problem_id}</span>
                </div>
                <span class="font-mono text-2xs">${filtered.length} of ${totalSubmissions} submissions</span>
            </div>
        `;

        if (filtered.length === 0) {
            html += `
                <div class="p-8 text-center text-xs text-text-tertiary">
                    No submissions found matching language <strong class="text-white">${this._filterLang.toUpperCase()}</strong>.
                </div>
            `;
            container.innerHTML = html;
            return;
        }

        // Leaderboard Table
        html += `
            <table class="lb-tbl w-full text-left">
                <thead>
                    <tr>
                        <th class="w-14 text-center">Rank</th>
                        <th>Submission</th>
                        <th>Language</th>
                        <th>Deterministic Score</th>
                        <th>Profile</th>
                        <th>Verdict</th>
                        <th>Submitted</th>
                        <th class="text-right">Action</th>
                    </tr>
                </thead>
                <tbody>
        `;

        filtered.forEach((e, idx) => {
            const rank = idx + 1;
            let rankBadge = `#${rank}`;
            if (rank === 1) rankBadge = `<span class="inline-flex items-center gap-1 text-amber-300 font-bold">🥇 1</span>`;
            else if (rank === 2) rankBadge = `<span class="inline-flex items-center gap-1 text-slate-300 font-bold">🥈 2</span>`;
            else if (rank === 3) rankBadge = `<span class="inline-flex items-center gap-1 text-amber-600 font-bold">🥉 3</span>`;

            const score = typeof e.final_score === 'number' ? Math.round(e.final_score) : null;
            const scoreColor = score !== null ? (score >= 80 ? 'text-[#2cbb5d]' : (score >= 50 ? 'text-[#f59e0b]' : 'text-[#f43f5e]')) : 'text-text-tertiary';
            const barWidth = score !== null ? Math.max(8, score) : 0;
            const barColor = score !== null ? (score >= 80 ? 'bg-[#2cbb5d]' : (score >= 50 ? 'bg-[#f59e0b]' : 'bg-[#f43f5e]')) : 'bg-white/20';

            const langLower = (e.language || 'python').toLowerCase();
            const langLabel = { python: 'Python', cpp: 'C++', java: 'Java', javascript: 'JS' }[langLower] || (e.language || 'Code');
            const langClass = { python: 'text-[#38bdf8] bg-[#38bdf8]/10 border-[#38bdf8]/20', cpp: 'text-[#f59e0b] bg-[#f59e0b]/10 border-[#f59e0b]/20', java: 'text-[#f43f5e] bg-[#f43f5e]/10 border-[#f43f5e]/20', javascript: 'text-[#facc15] bg-[#facc15]/10 border-[#facc15]/20' }[langLower] || 'text-text-secondary bg-white/5 border-white/10';

            const verdict = (e.verdict || '').toLowerCase();
            const isOpt = verdict === 'optimal' || (score !== null && score >= 80);
            const isErr = verdict === 'incorrect' || verdict === 'deficient';
            const verdictLabel = e.verdict ? e.verdict.toUpperCase() : (isOpt ? 'ACCEPTED' : 'COMPLETE');
            const verdictColor = isOpt ? 'text-[#2cbb5d] bg-[#2cbb5d]/10 border-[#2cbb5d]/20' : (isErr ? 'text-[#f43f5e] bg-[#f43f5e]/10 border-[#f43f5e]/20' : 'text-[#f59e0b] bg-[#f59e0b]/10 border-[#f59e0b]/20');

            const dateStr = e.created_at ? new Date(e.created_at).toLocaleDateString('en-US', { month: 'short', day: 'numeric' }) : '';

            html += `
                <tr class="hover:bg-white/[0.03] transition-colors border-b border-white/5 cursor-pointer group" onclick="Leaderboard.openSession(${e.session_id})">
                    <td class="lb-rank font-mono py-3">${rankBadge}</td>
                    <td class="py-3">
                        <div class="font-medium text-white text-[13px] group-hover:text-[#38bdf8] transition-colors flex items-center gap-1.5">
                            <span>${this._esc(e.submission_label || 'Submission')}</span>
                            <span class="text-2xs font-mono text-text-tertiary">#${e.session_id}</span>
                        </div>
                    </td>
                    <td class="py-3">
                        <span class="inline-flex items-center px-2 py-0.5 rounded text-2xs font-mono border ${langClass}">${langLabel}</span>
                    </td>
                    <td class="py-3">
                        <div class="flex items-center gap-2">
                            <span class="font-mono font-bold text-xs ${scoreColor} w-11">${score !== null ? `${score}/100` : '--'}</span>
                            <div class="w-16 h-1.5 bg-white/10 rounded-full overflow-hidden hidden sm:block">
                                <div class="h-full rounded-full ${barColor}" style="width: ${barWidth}%"></div>
                            </div>
                        </div>
                    </td>
                    <td class="py-3">
                        <span class="text-2xs font-mono text-text-tertiary bg-white/5 px-2 py-0.5 rounded border border-white/5">${this._esc(e.profile_name || 'Standard')}</span>
                    </td>
                    <td class="py-3">
                        <span class="inline-flex items-center px-2 py-0.5 rounded text-[10px] font-mono font-bold border ${verdictColor}">${verdictLabel}</span>
                    </td>
                    <td class="py-3 text-text-tertiary font-mono text-2xs">${dateStr}</td>
                    <td class="py-3 text-right">
                        <button class="lc-run-btn !h-6 !px-2.5 text-2xs opacity-80 group-hover:opacity-100" onclick="event.stopPropagation(); Leaderboard.openSession(${e.session_id})">
                            Open →
                        </button>
                    </td>
                </tr>
            `;
        });

        html += `
                </tbody>
            </table>
        `;

        container.innerHTML = html;
    },

    async openSession(sessionId) {
        if (!sessionId) return;
        App.closeLeaderboard();
        await App.openSession(sessionId);
    },

    async exportPdf() {
        if (!this._currentProblemId) return;
        const btn = document.getElementById('btn-export-leaderboard');
        if (typeof App !== 'undefined') App.setBusy(btn, true, 'Exporting…');
        try {
            if (typeof Toast !== 'undefined') Toast.info('Generating official leaderboard PDF report...');
            const blob = await ApiClient.exportLeaderboardPdf(this._currentProblemId);
            downloadBlob(blob, `leaderboard_problem_${this._currentProblemId}.pdf`);
            if (typeof Toast !== 'undefined') Toast.success('Leaderboard PDF report downloaded.');
        } catch (e) {
            console.error('[Leaderboard] Export failed:', e);
            if (typeof Toast !== 'undefined') Toast.error(`Export failed: ${e.message}`);
        } finally {
            if (typeof App !== 'undefined') App.setBusy(btn, false);
        }
    },

    _esc(s) {
        if (!s) return '';
        const d = document.createElement('div');
        d.textContent = s;
        return d.innerHTML;
    },
};