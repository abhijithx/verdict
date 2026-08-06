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
        const language = document.getElementById('rec-language')?.value || 'Python';

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
            alert(`Analysis failed: ${error.message}`);
            if (emptyState) emptyState.classList.remove('hidden');
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

        document.getElementById('rec-res-category').textContent = data.category || 'Algorithm Strategy';
        document.getElementById('rec-res-algorithm').textContent = data.recommended_algorithm || 'Optimal Approach';
        document.getElementById('rec-res-ds').textContent = data.recommended_data_structure || 'Standard Structure';
        document.getElementById('rec-res-lang').textContent = data.recommended_language || 'Python';
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
                    <div class="glass-card p-3 rounded-lg border border-border-0 hover:border-accent/30 transition-all">
                        <div class="flex items-center justify-between mb-1">
                            <span class="text-xs font-semibold text-accent">${this.escapeHtml(alt.name)}</span>
                            <div class="flex gap-2 text-2xs">
                                <span class="px-1.5 py-0.5 rounded bg-surface-3 text-cyan-0">Time: ${this.escapeHtml(alt.time_complexity)}</span>
                                <span class="px-1.5 py-0.5 rounded bg-surface-3 text-violet-0">Space: ${this.escapeHtml(alt.space_complexity)}</span>
                            </div>
                        </div>
                        <p class="text-2xs text-text-2 leading-relaxed">${this.escapeHtml(alt.trade_offs)}</p>
                    </div>
                `).join('');
            } else {
                altsContainer.innerHTML = `<p class="text-2xs text-text-3 italic">No alternative approaches reported.</p>`;
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
