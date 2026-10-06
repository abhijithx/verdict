/**
 * api-client.js — Fetch wrapper for all CodeScore AI backend API calls.
 *
 * Provides a clean async interface for every backend endpoint.
 * All methods return parsed JSON (or throw on error).
 *
 * Usage:
 *   const problems = await ApiClient.getProblems();
 *   const session = await ApiClient.getSession(sessionId);
 */

// Base URL for API calls — same origin since FastAPI serves the frontend
const API_BASE = '/api';

const ApiClient = {
    // ====================================================================
    // Internal fetch helper — wraps fetch() with error handling + JSON parsing
    // ====================================================================
    async _fetch(url, options = {}) {
        try {
            const response = await fetch(`${API_BASE}${url}`, {
                headers: {
                    'Content-Type': 'application/json',
                    ...options.headers,
                },
                ...options,
            });

            // Handle non-OK responses
            if (!response.ok) {
                const errorBody = await response.json().catch(() => ({}));
                const errorMsg = errorBody.detail || `HTTP ${response.status}: ${response.statusText}`;
                throw new Error(errorMsg);
            }

            // Handle empty responses (204 No Content)
            if (response.status === 204) return null;

            // Check if response is PDF (binary)
            const contentType = response.headers.get('content-type');
            if (contentType && contentType.includes('application/pdf')) {
                return await response.blob();
            }

            return await response.json();
        } catch (error) {
            console.error(`[API] Error: ${options.method || 'GET'} ${url}`, error);
            throw error;
        }
    },

    // ====================================================================
    // Problems endpoints
    // ====================================================================

    /** Get all problems with session counts */
    async getProblems() {
        return this._fetch('/problems');
    },

    /** Get a single problem by ID */
    async getProblem(problemId) {
        return this._fetch(`/problems/${problemId}`);
    },

    /** Create a new problem */
    async createProblem(title, description, difficulty = 'medium') {
        return this._fetch('/problems', {
            method: 'POST',
            body: JSON.stringify({ title, description, difficulty }),
        });
    },

    /** Get leaderboard for a problem */
    async getLeaderboard(problemId) {
        return this._fetch(`/problems/${problemId}/leaderboard`);
    },

    /** Get all sessions for a problem */
    async getProblemSessions(problemId) {
        return this._fetch(`/problems/${problemId}/sessions`);
    },

    // ====================================================================
    // Session endpoints
    // ====================================================================

    /** List all sessions (optionally filtered by problem_id) */
    async getSessions(problemId = null) {
        const query = problemId ? `?problem_id=${problemId}` : '';
        return this._fetch(`/sessions${query}`);
    },

    /** Get full session details (used for polling and reopening) */
    async getSession(sessionId) {
        return this._fetch(`/sessions/${sessionId}`);
    },

    /** Delete a session and its associated data */
    async deleteSession(sessionId) {
        return this._fetch(`/sessions/${sessionId}`, {
            method: 'DELETE',
        });
    },

    /**
     * Create a new session for a problem.
     * @param {number} problemId - Problem ID
     * @param {string} language - 'python', 'cpp', or 'java'
     * @param {string} submissionLabel - User-entered label
     * @param {number|null} profileId - Evaluation profile ID
     * @param {string} code - Initial code (optional)
     */
    async createSession(problemIdOrPayload, language, submissionLabel, profileId = null, code = '') {
        if (typeof problemIdOrPayload === 'object' && problemIdOrPayload !== null) {
            const p = problemIdOrPayload;
            return this._fetch(`/sessions?problem_id=${p.problem_id}`, {
                method: 'POST',
                body: JSON.stringify({
                    language: p.language || 'python',
                    submission_label: p.submission_label || 'Draft',
                    profile_id: p.profile_id || null,
                    code: p.code || '',
                }),
            });
        }
        return this._fetch(`/sessions?problem_id=${problemIdOrPayload}`, {
            method: 'POST',
            body: JSON.stringify({
                language,
                submission_label: submissionLabel,
                profile_id: profileId,
                code,
            }),
        });
    },

    /**
     * Run compile/runtime dry-run or user test cases check via native local runner.
     * @param {number} sessionId - Session ID
     * @param {string} code - Source code to check
     * @param {string} [stdin=""] - Optional stdin input to execute against
     * @param {Array} [testCases=null] - Optional user-configured test cases to execute
     * @param {string} [language=null] - Optional language override
     */
    async dryRunSession(sessionId, code, stdin = "", testCases = null, language = null) {
        return this._fetch(`/sessions/${sessionId}/dry-run`, {
            method: 'POST',
            body: JSON.stringify({ code, stdin, test_cases: testCases, language }),
        });
    },

    /**
     * Execute user-configured test cases against the session's code in batch.
     * @param {number} sessionId - Session ID
     * @param {string} code - Source code to test
     * @param {Array} testCases - Array of test cases [{stdin, expected_stdout}]
     * @param {string} [language=null] - Optional language override
     */
    async runTests(sessionId, code, testCases = [], language = null) {
        return this._fetch(`/sessions/${sessionId}/run-tests`, {
            method: 'POST',
            body: JSON.stringify({ code, test_cases: testCases, language }),
        });
    },

    /**
     * Submit code for evaluation — triggers the full pipeline with user test cases.
     * @param {number} sessionId - Session ID
     * @param {string} code - Source code to evaluate
     * @param {Array} [testCases=null] - Optional user-configured test cases to include in evaluation
     * @param {string} [language=null] - Optional language override
     */
    async submitSession(sessionId, code, testCases = null, language = null) {
        return this._fetch(`/sessions/${sessionId}/submit`, {
            method: 'POST',
            body: JSON.stringify({ code, test_cases: testCases, language }),
        });
    },

    // ====================================================================
    // Evaluation Profile endpoints
    // ====================================================================

    /** Get all evaluation profiles */
    async getProfiles() {
        return this._fetch('/evaluation-profiles');
    },

    /** Get a single profile by ID */
    async getProfile(profileId) {
        return this._fetch(`/evaluation-profiles/${profileId}`);
    },

    /**
     * Create a custom evaluation profile.
     * @param {string} name - Profile name
     * @param {object} weights - { correctness_weight, performance_weight, ... }
     */
    async createProfile(name, weights) {
        return this._fetch('/evaluation-profiles', {
            method: 'POST',
            body: JSON.stringify({ name, ...weights }),
        });
    },

    // ====================================================================
    // Export endpoints
    // ====================================================================

    /** Export session report as PDF (returns a Blob) */
    async exportSessionPdf(sessionId) {
        const response = await fetch(`${API_BASE}/sessions/${sessionId}/export`);
        if (!response.ok) throw new Error('PDF export failed');
        return await response.blob();
    },

    /** Export leaderboard as PDF (returns a Blob) */
    async exportLeaderboardPdf(problemId) {
        const response = await fetch(`${API_BASE}/problems/${problemId}/export`);
        if (!response.ok) throw new Error('PDF export failed');
        return await response.blob();
    },

    // ====================================================================
    // Solution Recommendation & Shared History endpoints
    // ====================================================================

    /** Get Solution Recommendation */
    async getRecommendation(data) {
        return this._fetch('/recommendation', {
            method: 'POST',
            body: JSON.stringify(data),
        });
    },

    /** Direct Solution Evaluation submit */
    async submitEvaluation(data) {
        return this._fetch('/evaluation', {
            method: 'POST',
            body: JSON.stringify(data),
        });
    },

    /** Get unified platform history */
    async getHistory(searchQuery = '', moduleType = 'all') {
        const params = new URLSearchParams();
        if (searchQuery) params.append('q', searchQuery);
        if (moduleType) params.append('type', moduleType);
        const queryStr = params.toString() ? `?${params.toString()}` : '';
        return this._fetch(`/history${queryStr}`);
    },

    /** Get details for a history item */
    async getHistoryItem(itemId) {
        return this._fetch(`/history/${itemId}`);
    },

    /** Delete a history item */
    async deleteHistoryItem(itemId) {
        return this._fetch(`/history/${itemId}`, {
            method: 'DELETE',
        });
    },

    /** Get aggregated platform statistics */
    async getPlatformStats() {
        return this._fetch('/problems/stats');
    },

    /** Get URL for session PDF export */
    getSessionPdfUrl(sessionId) {
        return `${API_BASE}/sessions/${sessionId}/export`;
    },

    /** Export a session report as PDF */
    async exportSessionPdf(sessionId) {
        return this._fetch(`/sessions/${sessionId}/export`);
    },

    /** Export a problem leaderboard as PDF */
    async exportLeaderboardPdf(problemId) {
        return this._fetch(`/problems/${problemId}/export`);
    },
};

// Utility: download a Blob as a file
function downloadBlob(blob, filename) {
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
}
