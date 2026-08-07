/**
 * recommendation.js — UI Handler for Solution Recommendation module.
 * Handles form submission, Gemini API call, skeleton loader, and report rendering.
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

        // Show loading state
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
            // Show inline error instead of browser alert
            const report = document.getElementById('rec-report');
            if (report) {
                report.classList.remove('hidden');
                report.innerHTML = `
                    <div class="flex flex-col items-center justify-center py-12 text-center">
                        <svg width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="var(--red-0, #f44)" stroke-width="1.5" class="mb-4 opacity-60">
                            <circle cx="12" cy="12" r="10"/><line x1="15" y1="9" x2="9" y2="15"/><line x1="9" y1="9" x2="15" y2="15"/>
                        </svg>
                        <p class="text-sm font-semibold text-white mb-2">Analysis Failed</p>
                        <p class="text-xs text-text-2 max-w-md leading-relaxed">${error.message}</p>
                        <button onclick="document.getElementById('rec-report').classList.add('hidden'); document.getElementById('rec-empty-state').classList.remove('hidden');"
                                class="mt-4 cmd-btn cmd-secondary text-xs">Dismiss</button>
                    </div>
                `;
            }
            if (emptyState) emptyState.classList.add('hidden');
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

    renderReport(data) {
        const report = document.getElementById('rec-report');
        if (!report) return;

        const userSelectedLang = document.getElementById('rec-language')?.value || null;
        const isAiSelected = !userSelectedLang;
        const badgeHtml = isAiSelected
            ? `<span class="inline-block ml-1 px-1.5 py-0.5 text-[10px] font-mono font-semibold text-accent border border-accent uppercase tracking-wider">[ AI-SELECTED ]</span>`
            : `<span class="inline-block ml-1 px-1.5 py-0.5 text-[10px] font-mono font-semibold text-text-muted border border-line uppercase tracking-wider">[ REQUESTED ]</span>`;

        document.getElementById('rec-res-category').textContent = data.category || 'Algorithm Strategy';
        document.getElementById('rec-res-algorithm').textContent = data.recommended_algorithm || 'Optimal Approach';
        document.getElementById('rec-res-ds').textContent = data.recommended_data_structure || 'Standard Structure';
        document.getElementById('rec-res-lang').innerHTML = `${this.escapeHtml(data.recommended_language || 'Python')} ${badgeHtml}`;
        document.getElementById('rec-res-time').textContent = data.time_complexity || 'O(N)';
        document.getElementById('rec-res-space').textContent = data.space_complexity || 'O(1)';

        // Code block
        const codeElement = document.getElementById('rec-res-code');
        if (codeElement) {
            codeElement.textContent = data.optimized_code || '# No code provided';
        }

        // Explanation
        const expElement = document.getElementById('rec-res-explanation');
        if (expElement) {
            expElement.innerHTML = this.escapeHtml(data.explanation || 'No explanation provided.').replace(/\n/g, '<br/>');
        }

        // Alternatives
        const altsContainer = document.getElementById('rec-res-alternatives');
        if (altsContainer) {
            if (data.alternative_approaches && data.alternative_approaches.length > 0) {
                altsContainer.innerHTML = data.alternative_approaches.map(alt => `
                    <div class="panel p-3 border border-line font-mono">
                        <div class="flex items-center justify-between mb-1">
                            <span class="text-xs font-bold text-accent">${this.escapeHtml(alt.name)}</span>
                            <div class="flex gap-2 text-2xs text-text-muted">
                                <span class="px-1 py-0.5 border border-line bg-surface-2">Time: ${this.escapeHtml(alt.time_complexity)}</span>
                                <span class="px-1 py-0.5 border border-line bg-surface-2">Space: ${this.escapeHtml(alt.space_complexity)}</span>
                            </div>
                        </div>
                        <p class="text-2xs text-text-muted leading-relaxed font-sans">${this.escapeHtml(alt.trade_offs)}</p>
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
