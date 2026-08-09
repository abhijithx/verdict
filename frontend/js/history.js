/**
 * history.js — Shared History UI Manager.
 */

const HistoryUI = {
    currentTab: 'recommendation',
    items: [],

    async init() {
        await this.load();
    },

    async setTab(tab) {
        this.currentTab = tab;
        const recTab = document.getElementById('hist-tab-rec');
        const evalTab = document.getElementById('hist-tab-eval');

        if (tab === 'recommendation') {
            recTab?.classList.add('active-tab');
            evalTab?.classList.remove('active-tab');
        } else {
            evalTab?.classList.add('active-tab');
            recTab?.classList.remove('active-tab');
        }

        await this.load();
    },

    async load() {
        const searchQuery = document.getElementById('hist-search')?.value.trim() || '';
        const listContainer = document.getElementById('hist-list');
        if (!listContainer) return;

        listContainer.innerHTML = `
            <div class="py-12 text-center text-text-dim">
                <span class="animate-spin inline-block w-5 h-5 border-2 border-accent border-t-transparent rounded-full mb-2"></span>
                <p class="text-xs">Loading history entries...</p>
            </div>
        `;

        try {
            const res = await ApiClient.getHistory(searchQuery, this.currentTab);
            this.items = res.items || [];
            this.renderList();
        } catch (err) {
            console.error('[HistoryUI] Error loading history:', err);
            listContainer.innerHTML = `
                <div class="py-12 text-center text-danger text-xs">
                    Failed to load history items: ${err.message}
                </div>
            `;
        }
    },

    renderList() {
        const listContainer = document.getElementById('hist-list');
        if (!listContainer) return;

        if (this.items.length === 0) {
            listContainer.innerHTML = `
                <div class="py-16 text-center text-text-dim">
                    <svg width="36" height="36" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" class="mx-auto mb-3 opacity-50"><circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/></svg>
                    <p class="text-sm font-medium text-text-tertiary mb-1">No ${this.currentTab} history found</p>
                    <p class="text-2xs">Try adjusting your search terms or create a new ${this.currentTab} session.</p>
                </div>
            `;
            return;
        }

        listContainer.innerHTML = this.items.map(item => {
            if (item.module === 'recommendation') {
                return `
                    <div class="panel p-5 border border-border-subtle flex flex-col justify-between gap-3 font-mono hover:border-border-soft transition-all">
                        <div>
                            <div class="flex items-center justify-between gap-2 mb-3">
                                <span class="text-2xs font-semibold text-accent">[ ${this.escapeHtml(item.category || 'REC')} ]</span>
                                <span class="text-2xs text-text-dim">${this.formatDate(item.timestamp)}</span>
                            </div>
                            <h4 class="text-xs font-bold text-text-primary mb-2">${this.escapeHtml(item.title)}</h4>
                            <div class="flex items-center gap-2 text-2xs text-text-tertiary">
                                <span>Alg: ${this.escapeHtml(item.algorithm || 'N/A')}</span>
                                <span>•</span>
                                <span>[${this.escapeHtml((item.language || 'Python').substring(0,3).toUpperCase())}]</span>
                            </div>
                        </div>

                        <div class="pt-3 border-t border-border-subtle flex items-center justify-between gap-2">
                            <span class="text-2xs text-text-tertiary font-mono">${this.escapeHtml(item.complexity)}</span>
                            <div class="flex items-center gap-1.5">
                                <button class="cmd-btn cmd-secondary text-2xs !h-7 !px-3" onclick="HistoryUI.viewDetails('${item.id}')">View</button>
                                <button class="cmd-btn cmd-ghost text-2xs text-danger !h-7 !px-3" onclick="HistoryUI.deleteItem('${item.id}')">Del</button>
                            </div>
                        </div>
                    </div>
                `;
            } else {
                const vc = { optimal: 'verdict-pass', needs_improvement: 'verdict-warn', incorrect: 'verdict-fail' }[item.verdict] || '';
                const vl = { optimal: '[ OPTIMAL ]', needs_improvement: '[ NEEDS WORK ]', incorrect: '[ INCORRECT ]' }[item.verdict] || `[ ${(item.verdict || 'EVAL').toUpperCase()} ]`;
                return `
                    <div class="panel p-5 border border-border-subtle flex flex-col justify-between gap-3 font-mono hover:border-border-soft transition-all">
                        <div>
                            <div class="flex items-center justify-between gap-2 mb-3">
                                <span class="verdict ${vc} text-2xs">${vl}</span>
                                <span class="text-2xs text-text-dim">${this.formatDate(item.timestamp)}</span>
                            </div>
                            <h4 class="text-xs font-bold text-text-primary mb-1">${this.escapeHtml(item.title)}</h4>
                            <p class="text-2xs text-text-tertiary mb-2 font-sans">${this.escapeHtml(item.submission_label || 'Attempt')}</p>
                            <div class="flex items-center gap-2 text-2xs">
                                <span class="text-text-tertiary">[${this.escapeHtml((item.language || '').substring(0,3).toUpperCase())}]</span>
                                ${item.final_score !== null ? `<span class="text-accent font-bold">Score: ${item.final_score}/100</span>` : ''}
                            </div>
                        </div>

                        <div class="pt-3 border-t border-border-subtle flex items-center justify-between gap-2">
                            <span class="text-2xs text-text-tertiary font-mono">${this.escapeHtml(item.complexity)}</span>
                            <div class="flex items-center gap-1.5">
                                <button class="cmd-btn cmd-secondary text-2xs !h-7 !px-3" onclick="HistoryUI.viewDetails('${item.id}')">View</button>
                                <button class="cmd-btn cmd-ghost text-2xs text-danger !h-7 !px-3" onclick="HistoryUI.deleteItem('${item.id}')">Del</button>
                            </div>
                        </div>
                    </div>
                `;
            }
        }).join('');
    },

    async viewDetails(itemId) {
        try {
            const detail = await ApiClient.getHistoryItem(itemId);
            const modal = document.getElementById('hist-detail-modal');
            const content = document.getElementById('hist-detail-content');
            if (!modal || !content) return;

            content.innerHTML = `
                <div class="space-y-4 text-xs">
                    <div class="flex items-center justify-between border-b border-border-subtle pb-3">
                        <div>
                            <span class="px-2 py-0.5 rounded text-2xs font-semibold bg-accent-ghost text-accent uppercase">${detail.module}</span>
                            <h3 class="text-sm font-bold text-text-primary mt-1">${this.escapeHtml(detail.problem || detail.problem_title)}</h3>
                        </div>
                        <button id="btn-export-detail-json" class="px-3 py-1.5 rounded-lg text-2xs bg-accent text-void font-medium hover:brightness-110 transition-all">Export JSON</button>
                    </div>

                    ${detail.module === 'recommendation' ? `
                        <div class="grid grid-cols-2 gap-2 text-2xs font-mono">
                            <div class="p-2 rounded-lg bg-void border border-border-subtle"><span class="text-text-tertiary">Category:</span> ${this.escapeHtml(detail.category)}</div>
                            <div class="p-2 rounded-lg bg-void border border-border-subtle"><span class="text-text-tertiary">Algorithm:</span> ${this.escapeHtml(detail.recommended_algorithm)}</div>
                            <div class="p-2 rounded-lg bg-void border border-border-subtle"><span class="text-text-tertiary">Time:</span> ${this.escapeHtml(detail.time_complexity)}</div>
                            <div class="p-2 rounded-lg bg-void border border-border-subtle"><span class="text-text-tertiary">Space:</span> ${this.escapeHtml(detail.space_complexity)}</div>
                        </div>
                        <div>
                            <h4 class="font-semibold text-text-secondary mb-1">Optimized Solution (${detail.preferred_language})</h4>
                            <pre class="bg-canvas p-3 rounded-lg border border-border-subtle font-mono text-2xs text-blue-0 whitespace-pre-wrap overflow-x-auto">${this.escapeHtml(detail.optimized_code)}</pre>
                        </div>
                        <div>
                            <h4 class="font-semibold text-text-secondary mb-1">Explanation</h4>
                            <p class="text-text-tertiary leading-relaxed whitespace-pre-wrap">${this.escapeHtml(detail.explanation)}</p>
                        </div>
                    ` : `
                        <div>
                            <h4 class="font-semibold text-text-secondary mb-1">Submitted Code (${detail.language})</h4>
                            <pre class="bg-canvas p-3 rounded-lg border border-border-subtle font-mono text-2xs text-blue-0 whitespace-pre-wrap overflow-x-auto">${this.escapeHtml(detail.user_code)}</pre>
                        </div>
                        ${detail.analysis ? `
                            <div class="p-3 rounded-lg bg-void border border-border-subtle space-y-1">
                                <div class="font-semibold text-accent">Verdict: ${detail.analysis.verdict} (Score: ${detail.analysis.final_score}/100)</div>
                                <div class="text-text-tertiary">${this.escapeHtml(detail.analysis.code_explanation || 'No code explanation available.')}</div>
                            </div>
                        ` : ''}
                    `}
                </div>
            `;

            const exportBtn = content.querySelector('#btn-export-detail-json');
            if (exportBtn) {
                exportBtn.addEventListener('click', () => this.exportDetailJson(detail));
            }

            modal.classList.remove('hidden');
        } catch (err) {
            alert(`Failed to load details: ${err.message}`);
        }
    },

    closeModal() {
        const modal = document.getElementById('hist-detail-modal');
        modal?.classList.add('hidden');
    },

    async deleteItem(itemId) {
        if (!confirm('Are you sure you want to delete this history record?')) return;
        try {
            await ApiClient.deleteHistoryItem(itemId);
            await this.load();
        } catch (err) {
            alert(`Delete failed: ${err.message}`);
        }
    },

    exportDetailJson(data) {
        const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
        downloadBlob(blob, `verdict_history_${data.id}_${Date.now()}.json`);
    },

    exportAllJson() {
        const blob = new Blob([JSON.stringify(this.items, null, 2)], { type: 'application/json' });
        downloadBlob(blob, `verdict_history_export_${Date.now()}.json`);
    },

    formatDate(isoStr) {
        if (!isoStr) return 'N/A';
        try {
            const d = new Date(isoStr);
            return d.toLocaleDateString(undefined, { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' });
        } catch {
            return isoStr;
        }
    },

    escapeHtml(str) {
        if (!str) return '';
        return String(str)
            .replace(/&/g, '&amp;')
            .replace(/</g, '&lt;')
            .replace(/>/g, '&gt;')
            .replace(/"/g, '&quot;')
            .replace(/'/g, '&#039;');
    }
};