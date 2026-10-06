/**
 * leetcode-modal.js — LeetCode Problem Explorer and Import Studio for Verdict AI.
 *
 * Provides:
 *   1. Direct URL/Slug instant fetch (e.g., https://leetcode.com/problems/two-sum/)
 *   2. Instant live search across all 4,000+ LeetCode problems
 *   3. Curated classics (Blind 75 / Top 150)
 *   4. Full problem preview with rendered Markdown, tags, and starter code snippets
 *   5. 1-Click transfer to:
 *      - Evaluation IDE (creates problem + session with starter code & test cases)
 *      - AI Recommendation Studio (loads problem and runs optimal algorithm analysis)
 *      - Problem Catalog (persists into database)
 */

const LeetCodeModal = {
    _isOpen: false,
    _selectedProblem: null,
    _catalogList: [],
    _curatedList: [],
    _searchTimeout: null,
    _currentDifficulty: null,
    _activeLang: 'python3',

    init() {
        this._ensureModalHtml();
        this._bindEvents();
    },

    _ensureModalHtml() {
        if (document.getElementById('leetcode-explorer-modal')) return;

        const modalHtml = `
        <div id="leetcode-explorer-modal" class="fixed inset-0 z-50 hidden flex items-center justify-center p-4 bg-void/80 backdrop-blur-md transition-opacity">
            <div class="relative w-full max-w-5xl h-[88vh] max-h-[820px] bg-surface border border-border rounded-xl shadow-2xl flex flex-col overflow-hidden animate-in fade-in zoom-in-95 duration-150">
                
                <!-- Modal Header -->
                <div class="flex items-center justify-between px-6 py-4 border-b border-border bg-surface-alt/70 select-none">
                    <div class="flex items-center gap-3">
                        <div class="w-8 h-8 rounded-lg bg-[#FFA116]/10 border border-[#FFA116]/30 flex items-center justify-center text-[#FFA116] font-bold text-base shadow-sm">
                            <svg width="18" height="18" viewBox="0 0 24 24" fill="currentColor">
                                <path d="M13.483 0a1.374 1.374 0 0 0-.961.438L7.116 6.226l-3.854 4.126a5.266 5.266 0 0 0-1.209 2.104 5.35 5.35 0 0 0-.125.513 5.527 5.527 0 0 0 .062 2.362 5.83 5.83 0 0 0 .349 1.017 5.938 5.938 0 0 0 1.271 1.818l4.277 4.193.039.038c2.248 2.165 5.852 2.133 8.063-.074l2.396-2.392c.54-.54.54-1.414.003-1.955a1.378 1.378 0 0 0-1.951-.003l-2.396 2.392a3.021 3.021 0 0 1-4.205.038l-.02-.019-4.276-4.193c-.652-.64-.972-1.469-.948-2.263a2.68 2.68 0 0 1 .066-.523 2.545 2.545 0 0 1 .619-1.164L9.13 8.114c1.058-1.134 3.204-1.27 4.43-.278l3.501 2.831c.593.48 1.461.387 1.94-.207a1.384 1.384 0 0 0-.207-1.943l-3.5-2.831c-.8-.647-1.766-.991-2.738-1.026a3.86 3.86 0 0 0-.073-.003z"/>
                            </svg>
                        </div>
                        <div>
                            <div class="flex items-center gap-2">
                                <h3 class="text-sm font-semibold text-text-primary tracking-wide">LeetCode Problem Explorer</h3>
                                <span class="px-2 py-0.5 text-[10px] font-mono font-medium rounded-full bg-[#FFA116]/10 text-[#FFA116] border border-[#FFA116]/30">4,000+ Problems</span>
                            </div>
                            <p class="text-xs text-text-tertiary">Search catalog or paste any LeetCode URL to import into IDE or AI Recommendation</p>
                        </div>
                    </div>
                    <button id="btn-lc-modal-close" class="p-1.5 rounded-lg text-text-tertiary hover:text-text-primary hover:bg-surface-highlight transition-colors">
                        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M18 6L6 18M6 6l12 12"/></svg>
                    </button>
                </div>

                <!-- Top Input & Filter Bar -->
                <div class="p-4 border-b border-border bg-surface/50 space-y-3">
                    <!-- URL Paste Bar -->
                    <div class="flex items-center gap-2">
                        <div class="relative flex-1">
                            <span class="absolute inset-y-0 left-0 flex items-center pl-3 pointer-events-none text-text-tertiary">
                                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71"/><path d="M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71"/></svg>
                            </span>
                            <input id="lc-url-input" type="text" placeholder="Paste LeetCode URL or slug (e.g. https://leetcode.com/problems/two-sum/ or 'trapping-rain-water')..." 
                                class="w-full pl-9 pr-3 py-2 bg-void/70 border border-border rounded-lg text-xs font-mono text-text-primary placeholder:text-text-dim focus:outline-none focus:border-[#FFA116] transition-colors" />
                        </div>
                        <button id="btn-lc-fetch-url" class="px-4 py-2 bg-[#FFA116] hover:brightness-110 text-black text-xs font-semibold rounded-lg shadow-sm transition-all flex items-center gap-1.5 shrink-0">
                            <span>Fetch Problem</span>
                        </button>
                    </div>

                    <!-- Search & Filter Controls -->
                    <div class="flex items-center justify-between gap-3 text-xs">
                        <div class="relative flex-1 max-w-sm">
                            <span class="absolute inset-y-0 left-0 flex items-center pl-3 pointer-events-none text-text-tertiary">
                                <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="11" cy="11" r="8"/><path d="m21 21-4.3-4.3"/></svg>
                            </span>
                            <input id="lc-search-input" type="text" placeholder="Filter by keyword, topic, or #..." 
                                class="w-full pl-8 pr-3 py-1.5 bg-void/50 border border-border rounded-lg text-xs text-text-primary placeholder:text-text-dim focus:outline-none focus:border-accent transition-colors" />
                        </div>

                        <!-- Difficulty Pills -->
                        <div class="flex items-center gap-1.5 bg-void/50 p-1 rounded-lg border border-border-subtle">
                            <button data-diff="" class="lc-diff-filter-btn px-2.5 py-1 rounded text-[11px] font-medium transition-colors bg-surface text-text-primary">All</button>
                            <button data-diff="EASY" class="lc-diff-filter-btn px-2.5 py-1 rounded text-[11px] font-medium transition-colors text-text-tertiary hover:text-[#2cbb5d]">Easy</button>
                            <button data-diff="MEDIUM" class="lc-diff-filter-btn px-2.5 py-1 rounded text-[11px] font-medium transition-colors text-text-tertiary hover:text-[#f59e0b]">Medium</button>
                            <button data-diff="HARD" class="lc-diff-filter-btn px-2.5 py-1 rounded text-[11px] font-medium transition-colors text-text-tertiary hover:text-[#f43f5e]">Hard</button>
                        </div>
                    </div>
                </div>

                <!-- Main Split View -->
                <div class="flex-1 flex overflow-hidden">
                    
                    <!-- Left Column: Problem Catalog List -->
                    <div class="w-2/5 border-r border-border flex flex-col bg-surface/30">
                        <div class="px-4 py-2 border-b border-border/50 text-[11px] font-mono text-text-tertiary flex items-center justify-between bg-surface-alt/40">
                            <span id="lc-results-count">Catalog (Loading...)</span>
                            <span class="text-[10px]">Click to inspect</span>
                        </div>
                        <div id="lc-problem-list" class="flex-1 overflow-y-auto divide-y divide-border/40 p-2 space-y-1">
                            <!-- Populated dynamically -->
                            <div class="p-8 text-center text-xs text-text-tertiary">Loading LeetCode catalog...</div>
                        </div>
                    </div>

                    <!-- Right Column: Live Problem Preview -->
                    <div id="lc-preview-pane" class="w-3/5 flex flex-col bg-surface overflow-hidden">
                        <div id="lc-empty-state" class="flex-1 flex flex-col items-center justify-center p-8 text-center text-text-tertiary space-y-3">
                            <div class="w-12 h-12 rounded-full bg-surface-highlight flex items-center justify-center text-text-tertiary">
                                <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/><line x1="16" y1="13" x2="8" y2="13"/><line x1="16" y1="17" x2="8" y2="17"/><polyline points="10 9 9 9 8 9"/></svg>
                            </div>
                            <div>
                                <h4 class="text-sm font-semibold text-text-primary">No Problem Selected</h4>
                                <p class="text-xs text-text-dim max-w-xs mt-1">Select any problem from the list on the left or paste a URL above to inspect and import.</p>
                            </div>
                        </div>

                        <!-- Active Problem Content (Hidden initially) -->
                        <div id="lc-active-content" class="hidden flex-1 flex flex-col overflow-hidden">
                            <!-- Problem Header -->
                            <div class="p-5 border-b border-border bg-surface-alt/40 space-y-2">
                                <div class="flex items-center justify-between">
                                    <div class="flex items-center gap-2">
                                        <span id="lc-prev-diff" class="px-2 py-0.5 rounded text-[11px] font-semibold uppercase tracking-wider">Easy</span>
                                        <h3 id="lc-prev-title" class="text-base font-bold text-text-primary">Problem Title</h3>
                                    </div>
                                    <a id="lc-prev-link" href="#" target="_blank" class="text-xs text-accent hover:underline flex items-center gap-1 font-mono">
                                        <span>LeetCode ↗</span>
                                    </a>
                                </div>
                                <div id="lc-prev-tags" class="flex flex-wrap gap-1">
                                    <!-- Tag pills -->
                                </div>
                            </div>

                            <!-- Problem Tabs: Description vs Starter Code -->
                            <div class="px-5 pt-2 border-b border-border flex items-center justify-between bg-surface/50 text-xs">
                                <div class="flex gap-4">
                                    <button id="lc-tab-desc" class="pb-2 border-b-2 border-accent text-accent font-semibold transition-colors">Description</button>
                                    <button id="lc-tab-code" class="pb-2 border-b-2 border-transparent text-text-tertiary hover:text-text-primary transition-colors">Starter Code Signature</button>
                                </div>
                                <div id="lc-lang-picker" class="hidden items-center gap-1 pb-1">
                                    <button data-lang="python3" class="lc-lang-btn px-2 py-0.5 rounded text-[10px] font-mono bg-accent/20 text-accent">Python</button>
                                    <button data-lang="cpp" class="lc-lang-btn px-2 py-0.5 rounded text-[10px] font-mono text-text-tertiary hover:text-white">C++</button>
                                    <button data-lang="java" class="lc-lang-btn px-2 py-0.5 rounded text-[10px] font-mono text-text-tertiary hover:text-white">Java</button>
                                    <button data-lang="javascript" class="lc-lang-btn px-2 py-0.5 rounded text-[10px] font-mono text-text-tertiary hover:text-white">JS</button>
                                </div>
                            </div>

                            <!-- Tab Contents -->
                            <div class="flex-1 overflow-y-auto p-5">
                                <div id="lc-view-desc" class="rec-markdown-body text-xs text-text-secondary leading-relaxed">
                                    <!-- Markdown content -->
                                </div>
                                <div id="lc-view-code" class="hidden">
                                    <pre id="lc-code-display" class="p-3 bg-void rounded-lg border border-border text-xs font-mono text-text-primary overflow-x-auto"></pre>
                                </div>
                            </div>

                            <!-- Bottom Action Drawer -->
                            <div class="p-4 border-t border-border bg-surface-alt/70 flex items-center justify-between gap-3">
                                <button id="btn-lc-action-recommend" class="px-3.5 py-2 rounded-lg bg-surface hover:bg-surface-highlight border border-border text-text-primary text-xs font-semibold shadow-sm transition-all flex items-center gap-1.5">
                                    <span>💡 Analyze in AI Recommendation</span>
                                </button>
                                <div class="flex items-center gap-2">
                                    <button id="btn-lc-action-save" class="px-3 py-2 rounded-lg bg-surface hover:bg-surface-highlight border border-border text-text-tertiary hover:text-text-primary text-xs font-medium transition-colors">
                                        <span>Save to Catalog</span>
                                    </button>
                                    <button id="btn-lc-action-ide" class="px-4 py-2 rounded-lg bg-accent hover:brightness-110 text-white text-xs font-semibold shadow-sm transition-all flex items-center gap-1.5">
                                        <span>🚀 Open in Evaluation IDE</span>
                                    </button>
                                </div>
                            </div>
                        </div>
                    </div>
                </div>
            </div>
        </div>
        `;

        document.body.insertAdjacentHTML('beforeend', modalHtml);
    },

    _bindEvents() {
        const closeBtn = document.getElementById('btn-lc-modal-close');
        if (closeBtn) closeBtn.onclick = () => this.close();

        // Close on backdrop click
        const modal = document.getElementById('leetcode-explorer-modal');
        if (modal) {
            modal.onclick = (e) => {
                if (e.target === modal) this.close();
            };
        }

        // URL Fetch
        const fetchBtn = document.getElementById('btn-lc-fetch-url');
        const urlInput = document.getElementById('lc-url-input');
        if (fetchBtn && urlInput) {
            const doFetch = () => {
                const val = urlInput.value.trim();
                if (val) this.fetchByUrlOrSlug(val);
            };
            fetchBtn.onclick = doFetch;
            urlInput.onkeydown = (e) => {
                if (e.key === 'Enter') doFetch();
            };
        }

        // Search Catalog
        const searchInput = document.getElementById('lc-search-input');
        if (searchInput) {
            searchInput.oninput = (e) => {
                clearTimeout(this._searchTimeout);
                this._searchTimeout = setTimeout(() => {
                    this.loadCatalog(e.target.value.trim(), this._currentDifficulty);
                }, 300);
            };
        }

        // Difficulty Filters
        document.querySelectorAll('.lc-diff-filter-btn').forEach(btn => {
            btn.onclick = () => {
                document.querySelectorAll('.lc-diff-filter-btn').forEach(b => {
                    b.classList.remove('bg-surface', 'text-text-primary');
                    b.classList.add('text-text-tertiary');
                });
                btn.classList.add('bg-surface', 'text-text-primary');
                btn.classList.remove('text-text-tertiary');
                this._currentDifficulty = btn.dataset.diff || null;
                const kw = searchInput ? searchInput.value.trim() : '';
                this.loadCatalog(kw, this._currentDifficulty);
            };
        });

        // Tabs
        const tabDesc = document.getElementById('lc-tab-desc');
        const tabCode = document.getElementById('lc-tab-code');
        const viewDesc = document.getElementById('lc-view-desc');
        const viewCode = document.getElementById('lc-view-code');
        const langPicker = document.getElementById('lc-lang-picker');

        if (tabDesc && tabCode) {
            tabDesc.onclick = () => {
                tabDesc.className = 'pb-2 border-b-2 border-accent text-accent font-semibold transition-colors';
                tabCode.className = 'pb-2 border-b-2 border-transparent text-text-tertiary hover:text-text-primary transition-colors';
                viewDesc.classList.remove('hidden');
                viewCode.classList.add('hidden');
                langPicker.classList.add('hidden');
                langPicker.classList.remove('flex');
            };
            tabCode.onclick = () => {
                tabCode.className = 'pb-2 border-b-2 border-accent text-accent font-semibold transition-colors';
                tabDesc.className = 'pb-2 border-b-2 border-transparent text-text-tertiary hover:text-text-primary transition-colors';
                viewDesc.classList.add('hidden');
                viewCode.classList.remove('hidden');
                langPicker.classList.remove('hidden');
                langPicker.classList.add('flex');
                this._renderCodeSnippet();
            };
        }

        // Code Language Switcher
        document.querySelectorAll('.lc-lang-btn').forEach(btn => {
            btn.onclick = () => {
                document.querySelectorAll('.lc-lang-btn').forEach(b => {
                    b.classList.remove('bg-accent/20', 'text-accent');
                    b.classList.add('text-text-tertiary');
                });
                btn.classList.add('bg-accent/20', 'text-accent');
                btn.classList.remove('text-text-tertiary');
                this._activeLang = btn.dataset.lang;
                this._renderCodeSnippet();
            };
        });

        // Action Buttons
        const btnIde = document.getElementById('btn-lc-action-ide');
        const btnRecommend = document.getElementById('btn-lc-action-recommend');
        const btnSave = document.getElementById('btn-lc-action-save');

        if (btnIde) btnIde.onclick = () => this.transferToIde();
        if (btnRecommend) btnRecommend.onclick = () => this.transferToRecommendation();
        if (btnSave) btnSave.onclick = () => this.saveToCatalogOnly();
    },

    open() {
        this._ensureModalHtml();
        const modal = document.getElementById('leetcode-explorer-modal');
        if (modal) {
            modal.classList.remove('hidden');
            this._isOpen = true;
            if (this._catalogList.length === 0) {
                this.loadCatalog();
            }
        }
    },

    close() {
        const modal = document.getElementById('leetcode-explorer-modal');
        if (modal) {
            modal.classList.add('hidden');
            this._isOpen = false;
        }
    },

    async loadCatalog(keyword = '', difficulty = null) {
        const listEl = document.getElementById('lc-problem-list');
        const countEl = document.getElementById('lc-results-count');
        if (listEl) {
            listEl.innerHTML = `<div class="p-6 text-center text-xs text-text-tertiary flex items-center justify-center gap-2">
                <span class="animate-spin inline-block w-3.5 h-3.5 border-2 border-accent border-t-transparent rounded-full"></span>
                <span>Querying LeetCode catalog...</span>
            </div>`;
        }

        try {
            const data = await ApiClient.searchLeetCodeProblems({
                keyword: keyword || undefined,
                difficulty: difficulty || undefined,
                limit: 40
            });

            this._catalogList = data.questions || [];
            if (data.curated) this._curatedList = data.curated;

            if (countEl) {
                countEl.textContent = `Showing ${this._catalogList.length} of ${data.total.toLocaleString()} problems`;
            }

            this._renderCatalogList();
        } catch (err) {
            console.error('[LeetCodeModal] Error loading catalog:', err);
            if (listEl) {
                listEl.innerHTML = `<div class="p-4 text-xs text-[#f43f5e]">Failed to load LeetCode catalog: ${err.message}</div>`;
            }
        }
    },

    _renderCatalogList() {
        const listEl = document.getElementById('lc-problem-list');
        if (!listEl) return;

        if (this._catalogList.length === 0) {
            listEl.innerHTML = `<div class="p-8 text-center text-xs text-text-tertiary">No matching problems found.</div>`;
            return;
        }

        const diffColor = {
            Easy: 'text-[#2cbb5d] bg-[#2cbb5d]/10 border-[#2cbb5d]/20',
            Medium: 'text-[#f59e0b] bg-[#f59e0b]/10 border-[#f59e0b]/20',
            Hard: 'text-[#f43f5e] bg-[#f43f5e]/10 border-[#f43f5e]/20',
        };

        listEl.innerHTML = this._catalogList.map(item => `
            <div data-slug="${item.title_slug}" class="lc-problem-row p-3 rounded-lg hover:bg-surface-highlight cursor-pointer transition-colors flex items-center justify-between group">
                <div class="space-y-1 min-w-0 pr-2">
                    <div class="flex items-center gap-2">
                        <span class="text-xs font-mono font-medium text-text-tertiary">#${item.frontend_id || ''}</span>
                        <span class="text-xs font-medium text-text-primary truncate group-hover:text-accent transition-colors">${item.title}</span>
                    </div>
                    ${item.topic_tags && item.topic_tags.length > 0 ? `
                        <div class="flex flex-wrap gap-1">
                            ${item.topic_tags.slice(0, 2).map(t => `<span class="px-1.5 py-0.2 text-[9px] font-mono rounded bg-void/60 text-text-dim border border-border-subtle">${t}</span>`).join('')}
                        </div>
                    ` : ''}
                </div>
                <span class="px-2 py-0.5 rounded text-[10px] font-semibold border ${diffColor[item.difficulty] || diffColor.Medium} shrink-0">
                    ${item.difficulty}
                </span>
            </div>
        `).join('');

        // Attach click handlers
        listEl.querySelectorAll('.lc-problem-row').forEach(row => {
            row.onclick = () => {
                listEl.querySelectorAll('.lc-problem-row').forEach(r => r.classList.remove('bg-surface-highlight', 'border-accent/40'));
                row.classList.add('bg-surface-highlight');
                this.fetchByUrlOrSlug(row.dataset.slug);
            };
        });
    },

    async fetchByUrlOrSlug(urlOrSlug) {
        if (!urlOrSlug) return;
        const emptyState = document.getElementById('lc-empty-state');
        const activeContent = document.getElementById('lc-active-content');

        if (emptyState) {
            emptyState.innerHTML = `
                <div class="animate-spin inline-block w-6 h-6 border-2 border-accent border-t-transparent rounded-full mb-3"></div>
                <h4 class="text-sm font-semibold text-text-primary">Fetching Problem Specification...</h4>
                <p class="text-xs text-text-dim">Retrieving problem statement, test cases, and code signatures from LeetCode...</p>
            `;
            emptyState.classList.remove('hidden');
        }
        if (activeContent) activeContent.classList.add('hidden');

        try {
            const prob = await ApiClient.fetchLeetCodeProblem(urlOrSlug);
            this._selectedProblem = prob;
            this._renderActiveProblem(prob);

            if (emptyState) emptyState.classList.add('hidden');
            if (activeContent) activeContent.classList.remove('hidden');

            if (typeof Toast !== 'undefined') {
                Toast.success(`Loaded LeetCode problem: "${prob.title}"`);
            }
        } catch (err) {
            console.error('[LeetCodeModal] Fetch error:', err);
            if (emptyState) {
                emptyState.innerHTML = `
                    <div class="text-[#f43f5e] text-2xl mb-2">⚠️</div>
                    <h4 class="text-sm font-semibold text-text-primary">Failed to load problem</h4>
                    <p class="text-xs text-text-dim max-w-sm mt-1">${err.message}</p>
                `;
            }
            if (typeof Toast !== 'undefined') {
                Toast.error(`Could not fetch problem: ${err.message}`);
            }
        }
    },

    _renderActiveProblem(prob) {
        const titleEl = document.getElementById('lc-prev-title');
        const diffEl = document.getElementById('lc-prev-diff');
        const linkEl = document.getElementById('lc-prev-link');
        const tagsEl = document.getElementById('lc-prev-tags');
        const descEl = document.getElementById('lc-view-desc');

        if (titleEl) titleEl.textContent = `${prob.frontend_id ? prob.frontend_id + '. ' : ''}${prob.title}`;
        if (linkEl) linkEl.href = `https://leetcode.com/problems/${prob.title_slug}/`;

        const diffClasses = {
            Easy: 'bg-[#2cbb5d]/10 text-[#2cbb5d] border border-[#2cbb5d]/30',
            Medium: 'bg-[#f59e0b]/10 text-[#f59e0b] border border-[#f59e0b]/30',
            Hard: 'bg-[#f43f5e]/10 text-[#f43f5e] border border-[#f43f5e]/30',
        };
        if (diffEl) {
            diffEl.className = `px-2 py-0.5 rounded text-[11px] font-semibold uppercase tracking-wider ${diffClasses[prob.difficulty] || diffClasses.Medium}`;
            diffEl.textContent = prob.difficulty;
        }

        if (tagsEl) {
            tagsEl.innerHTML = (prob.topic_tags || []).map(t => 
                `<span class="px-2 py-0.5 rounded text-[10px] font-mono bg-void border border-border-subtle text-text-tertiary">${t}</span>`
            ).join('');
        }

        if (descEl) {
            if (typeof marked !== 'undefined') {
                descEl.innerHTML = marked.parse(prob.description || 'No description provided.');
            } else {
                descEl.textContent = prob.description || '';
            }
        }

        this._renderCodeSnippet();
    },

    _renderCodeSnippet() {
        const display = document.getElementById('lc-code-display');
        if (!display || !this._selectedProblem) return;

        const snippets = this._selectedProblem.code_snippets || {};
        const code = snippets[this._activeLang] || snippets.python3 || snippets.python || '// No snippet available for this language.';
        display.textContent = code;
    },

    async transferToIde() {
        if (!this._selectedProblem) return;
        const prob = this._selectedProblem;
        const canonicalTitle = `${prob.frontend_id ? prob.frontend_id + '. ' : ''}${prob.title}`;
        const difficulty = (prob.difficulty || 'medium').toLowerCase();

        const langMap = { python3: 'python', cpp: 'cpp', java: 'java', javascript: 'javascript' };
        const selectedLang = langMap[this._activeLang] || 'python';
        const codeSnippet = (prob.code_snippets && prob.code_snippets[this._activeLang]) 
            ? prob.code_snippets[this._activeLang] 
            : (prob.code_snippets && prob.code_snippets.python3) || '';

        // Prepare test cases
        const testCases = (prob.sample_test_cases || []).map((tc, idx) => ({
            test_id: idx + 1,
            test_case_id: tc.test_case_id || `Case ${idx + 1}`,
            description: tc.description || `Sample ${idx + 1}`,
            stdin: tc.stdin ? (tc.stdin.endsWith('\n') ? tc.stdin : tc.stdin + '\n') : '',
            expected_stdout: tc.expected_stdout || '',
            is_edge_case: false
        }));

        try {
            if (typeof Toast !== 'undefined') Toast.info('Creating problem and transferring to Evaluation IDE...');
            
            // Create problem
            const pRes = await ApiClient.createProblem(canonicalTitle, prob.description, difficulty);
            
            // Create session
            const sRes = await ApiClient.createSession({
                problem_id: pRes.problem_id,
                language: selectedLang,
                submission_label: `LeetCode Attempt - ${prob.title}`,
                code: codeSnippet,
                test_cases: testCases
            });

            this.close();

            if (typeof App !== 'undefined') {
                App.switchView('evaluation');
                await App.refreshSidebar();
                await App.openSession(sRes.session_id);
            }
            if (typeof Toast !== 'undefined') Toast.success(`Imported "${canonicalTitle}" into Evaluation IDE!`);
        } catch (err) {
            console.error('[LeetCodeModal] Transfer to IDE error:', err);
            if (typeof Toast !== 'undefined') Toast.error(`Transfer failed: ${err.message}`);
        }
    },

    async transferToRecommendation() {
        if (!this._selectedProblem) return;
        const prob = this._selectedProblem;

        const pEl = document.getElementById('rec-problem');
        const cEl = document.getElementById('rec-constraints');
        const siEl = document.getElementById('rec-sample-input');
        const soEl = document.getElementById('rec-sample-output');

        if (pEl) pEl.value = prob.description;

        // Extract constraints and sample I/O if available
        if (cEl && prob.description) {
            const cm = prob.description.match(/\*\*Constraints:?\*\*\s*\n([\s\S]*?)(?=\n\n\*\*|\n\n#|\n\n<|\Z)/i) ||
                       prob.description.match(/Constraints:?\s*\n([\s\S]*?)(?=\n\n|\Z)/i);
            if (cm) {
                const lines = cm[1].split('\n')
                    .map(l => l.replace(/^[*\-•\s`]+|[*\-•\s`]+$/g, '').trim())
                    .filter(Boolean);
                cEl.value = lines.join(', ');
            }
        }
        if (prob.sample_test_cases && prob.sample_test_cases.length > 0) {
            if (siEl) siEl.value = prob.sample_test_cases[0].stdin || '';
            if (soEl) soEl.value = prob.sample_test_cases[0].expected_stdout || '';
        }

        this.close();

        if (typeof App !== 'undefined') {
            App.switchView('recommendation');
        }

        if (typeof RecommendationUI !== 'undefined') {
            if (typeof Toast !== 'undefined') Toast.info(`Loaded "${prob.title}" into AI Recommendation.`);
            // Automatically launch recommendation analysis
            setTimeout(() => {
                RecommendationUI.analyze();
            }, 300);
        }
    },

    async saveToCatalogOnly() {
        if (!this._selectedProblem) return;
        try {
            const res = await ApiClient.importLeetCodeProblem(this._selectedProblem.title_slug);
            if (typeof Toast !== 'undefined') {
                Toast.success(`Saved "${this._selectedProblem.title}" to Problem Catalog (ID #${res.problem_id})!`);
            }
            if (typeof App !== 'undefined') {
                await App.refreshSidebar();
            }
        } catch (err) {
            if (typeof Toast !== 'undefined') Toast.error(`Could not save: ${err.message}`);
        }
    }
};

window.LeetCodeModal = LeetCodeModal;
