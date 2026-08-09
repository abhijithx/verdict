/**
 * recommendation.js — UI Handler for Solution Recommendation module.
 */

const RecommendationUI = {
    currentResult: null,

    async init() {
        console.log('[RecommendationUI] Initialized');
    },

    async analyze() {
        const problem = document.getElementById('rec-problem')?.value.trim();
        const constraints = document.getElementById('rec-constraints')?.value.trim();
        const sampleInput = document.getElementById('rec-sample-input')?.value.trim();
        const sampleOutput = document.getElementById('rec-sample-output')?.value.trim();
        const language = document.getElementById('rec-language')?.value || null;

        if (!problem) {
            alert('Please enter a programming problem description.');
            return;
        }

        const btn = document.getElementById('btn-analyze-problem');
        const skeleton = document.getElementById('rec-skeleton');
        const report = document.getElementById('rec-report');
        const emptyState = document.getElementById('rec-empty-state');

        if (btn) {
            btn.disabled = true;
            btn.innerHTML = `<span class="animate-spin inline-block w-4 h-4 border-2 border-white border-t-transparent rounded-full mr-2"></span> Analyzing Problem...`;
        }
        if (emptyState) emptyState.classList.add('hidden');
        if (report) report.classList.add('hidden');
        if (skeleton) skeleton.classList.remove('hidden');

        try {
            const data = await ApiClient.getRecommendation({
                problem,
                constraints,
                sample_input: sampleInput,
                sample_output: sampleOutput,
                preferred_language: language,
            });

            this.currentResult = data;
            this.renderReport(data);

        } catch (error) {
            console.error('[RecommendationUI] Error:', error);
            const emptyState = document.getElementById('rec-empty-state');
            if (emptyState) {
                emptyState.classList.remove('hidden');
                emptyState.innerHTML = `
                    <div class="empty-state-icon mx-auto mb-4 border-danger/30 bg-danger/10">
                        <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="var(--danger)" stroke-width="1.5"><circle cx="12" cy="12" r="10"/><line x1="15" y1="9" x2="9" y2="15"/><line x1="9" y1="9" x2="15" y2="15"/></svg>
                    </div>
                    <h3 class="text-[17px] font-display font-medium text-text-primary mb-2">Analysis Failed</h3>
                    <p class="text-[13px] text-text-tertiary max-w-sm leading-relaxed mb-4">${this.escapeHtml(error.message)}</p>
                    <button onclick="RecommendationUI.resetEmptyState()" class="cmd-btn cmd-secondary text-xs">Dismiss</button>
                `;
            }
        } finally {
            if (btn) {
                btn.disabled = false;
                btn.innerHTML = `
                    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M12 2v4M12 18v4M4.93 4.93l2.83 2.83M16.24 16.24l2.83 2.83M2 12h4M18 12h4M4.93 19.07l2.83-2.83M16.24 7.76l2.83-2.83"/></svg>
                    Analyze Problem
                `;
            }
            if (skeleton) skeleton.classList.add('hidden');
        }
    },

    resetEmptyState() {
        const emptyState = document.getElementById('rec-empty-state');
        if (emptyState) {
            emptyState.classList.remove('hidden');
            emptyState.innerHTML = `
                <div class="empty-state-icon mx-auto mb-4">
                    <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" class="text-text-tertiary"><circle cx="12" cy="12" r="10"/><path d="M9.09 9a3 3 0 0 1 5.83 1c0 2-3 3-3 3"/><line x1="12" y1="17" x2="12.01" y2="17"/></svg>
                </div>
                <h3 class="text-[17px] font-display font-medium text-text-primary mb-2">Analysis Results Panel</h3>
                <p class="text-[13px] text-text-tertiary max-w-sm leading-relaxed">
                    Enter your problem statement on the left and click <strong class="text-text-secondary">Analyze</strong> to generate an optimal algorithm strategy, Big-O bounds, and reference code.
                </p>
            `;
        }
    },

    renderReport(data) {
        const report = document.getElementById('rec-report');
        if (!report) return;

        const userSelectedLang = document.getElementById('rec-language')?.value || null;
        const isAiSelected = !userSelectedLang;
        const badgeHtml = isAiSelected
            : `<span class="inline-block ml-1 px-1.5 py-0.5 text-[10px] font-mono font-semibold text-text-tertiary border border-border-subtle uppercase tracking-wider">[ REQUESTED ]</span>`;

        const elCat = document.getElementById('rec-res-category');
        if (elCat) elCat.textContent = data.category || 'Algorithm Strategy';

        const elAlg = document.getElementById('rec-res-algorithm');
        if (elAlg) elAlg.textContent = data.recommended_algorithm || 'Optimal Approach';

        const elDs = document.getElementById('rec-res-ds');
        if (elDs) elDs.textContent = data.recommended_data_structure || 'Standard Structure';

        const elLang = document.getElementById('rec-res-lang');
        if (elLang) elLang.innerHTML = `${this.escapeHtml(data.recommended_language || 'Python')} ${badgeHtml}`;

        const elTime = document.getElementById('rec-res-time');
        if (elTime) elTime.textContent = data.time_complexity || 'O(N)';

        const elSpace = document.getElementById('rec-res-space');
        if (elSpace) elSpace.textContent = data.space_complexity || 'O(1)';

        const codeElement = document.getElementById('rec-res-code');
        if (codeElement) {
            codeElement.textContent = data.optimized_code || '# No code provided';
        }

        const expElement = document.getElementById('rec-res-explanation');
        if (expElement) {
            expElement.innerHTML = this.escapeHtml(data.explanation || 'No explanation provided.').replace(/\n/g, '<br/>');
        }

        const altsContainer = document.getElementById('rec-res-alternatives');
        if (altsContainer) {
            if (data.alternative_approaches && data.alternative_approaches.length > 0) {
                altsContainer.innerHTML = data.alternative_approaches.map(alt => `
                    <div class="panel p-4 border border-border-subtle font-mono">
                        <div class="flex items-center justify-between mb-2">
                            <span class="text-xs font-bold text-accent">${this.escapeHtml(alt.name)}</span>
                            <div class="flex gap-2 text-2xs text-text-tertiary">
                                <span class="px-1.5 py-0.5 border border-border-subtle bg-void rounded">Time: ${this.escapeHtml(alt.time_complexity)}</span>
                                <span class="px-1.5 py-0.5 border border-border-subtle bg-void rounded">Space: ${this.escapeHtml(alt.space_complexity)}</span>
                            </div>
                        </div>
                        <p class="text-2xs text-text-tertiary leading-relaxed font-sans">${this.escapeHtml(alt.trade_offs)}</p>
                    </div>
                `).join('');
            } else {
                altsContainer.innerHTML = `<p class="text-2xs text-text-dim italic font-mono">No alternative approaches reported.</p>`;
            }
        }

        report.classList.remove('hidden');
        report.scrollIntoView({ behavior: 'smooth' });
    },

    copyCode() {
        if (!this.currentResult || !this.currentResult.optimized_code) return;
        navigator.clipboard.writeText(this.currentResult.optimized_code);
        const btn = document.getElementById('btn-copy-rec-code');
        if (btn) {
            const originalText = btn.innerHTML;
            btn.innerHTML = `✓ Copied!`;
            setTimeout(() => btn.innerHTML = originalText, 2000);
        }
    },

    downloadReport() {
        if (!this.currentResult) return;
        const blob = new Blob([JSON.stringify(this.currentResult, null, 2)], { type: 'application/json' });
        downloadBlob(blob, `verdict_recommendation_${Date.now()}.json`);
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