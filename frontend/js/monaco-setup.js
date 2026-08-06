/**
 * monaco-setup.js — Monaco Editor initialization and management.
 *
 * Loads Monaco Editor from CDN via the AMD loader (no React/build step needed).
 * Handles:
 *   - Editor creation and mounting into the container div
 *   - Language switching (Python / C++ / Java)
 *   - Gutter markers for compile/runtime errors (red line decorations)
 *   - Language-specific boilerplate templates
 *   - Theme configuration (VS Code dark)
 */

// Reference to the Monaco editor instance (set after initialization)
let editorInstance = null;
// Current decorations (for clearing on re-submit)
let currentDecorations = [];

// Language-specific boilerplate code templates
const BOILERPLATES = {
    python: `# Read input and write output
# Example: n = int(input())

`,
    cpp: `#include <iostream>
using namespace std;

int main() {
    // Read input and write output
    // Example: int n; cin >> n;
    
    return 0;
}
`,
    java: `import java.util.Scanner;

public class Main {
    public static void main(String[] args) {
        Scanner sc = new Scanner(System.in);
        // Read input and write output
        // Example: int n = sc.nextInt();
        
    }
}
`,
};

// Map our language names to Monaco language IDs
const MONACO_LANG_MAP = {
    python: 'python',
    cpp: 'cpp',
    java: 'java',
};

const MonacoSetup = {
    /**
     * Initialize Monaco Editor from CDN.
     * 
     * Sets up the AMD loader, configures the worker proxy for cross-origin
     * loading, and creates the editor instance in the container div.
     * 
     * @param {string} containerId - ID of the div to mount the editor into
     * @param {string} language - Initial language ('python', 'cpp', 'java')
     * @param {string} initialCode - Initial code to display (optional)
     * @returns {Promise} - Resolves when the editor is ready
     */
    init(containerId = 'editor-container', language = 'python', initialCode = null) {
        return new Promise((resolve) => {
            // Configure the Monaco AMD loader to use the CDN
            require.config({
                paths: {
                    'vs': 'https://cdn.jsdelivr.net/npm/monaco-editor@0.45.0/min/vs'
                }
            });

            // Set up the worker proxy for cross-origin CDN loading
            // Without this, Monaco throws errors when trying to create Web Workers
            // from a different origin (the CDN vs our localhost)
            window.MonacoEnvironment = {
                getWorkerUrl: function (moduleId, label) {
                    return `data:text/javascript;charset=utf-8,${encodeURIComponent(`
                        self.MonacoEnvironment = {
                            baseUrl: 'https://cdn.jsdelivr.net/npm/monaco-editor@0.45.0/min/'
                        };
                        importScripts('https://cdn.jsdelivr.net/npm/monaco-editor@0.45.0/min/vs/base/worker/workerMain.js');
                    `)}`;
                }
            };

            // Load the editor module and create the instance
            require(['vs/editor/editor.main'], function () {
                const container = document.getElementById(containerId);
                const code = initialCode || BOILERPLATES[language] || '';

                // Create the editor instance with VS Code-like settings
                editorInstance = monaco.editor.create(container, {
                    value: code,
                    language: MONACO_LANG_MAP[language] || 'python',
                    theme: 'vs-dark',                          // Dark theme
                    fontSize: 14,
                    fontFamily: "'JetBrains Mono', 'Consolas', monospace",
                    fontLigatures: true,
                    minimap: { enabled: true, scale: 1 },      // Show minimap
                    scrollBeyondLastLine: false,
                    automaticLayout: true,                     // Auto-resize with container
                    lineNumbers: 'on',
                    glyphMargin: true,                         // Enable gutter for markers
                    folding: true,
                    wordWrap: 'off',
                    renderLineHighlight: 'line',
                    cursorBlinking: 'smooth',
                    cursorSmoothCaretAnimation: 'on',
                    smoothScrolling: true,
                    padding: { top: 8 },
                    suggest: {
                        showKeywords: true,
                        showSnippets: true,
                    },
                    bracketPairColorization: { enabled: true },
                });

                // Update active tab styling
                MonacoSetup._updateTabState(language);

                console.log('[MONACO] Editor initialized with language:', language);
                resolve(editorInstance);
            });
        });
    },

    /**
     * Get the current editor instance.
     * @returns {object|null} Monaco editor instance
     */
    getEditor() {
        return editorInstance;
    },

    /**
     * Get the current code from the editor.
     * @returns {string} Current editor content
     */
    getCode() {
        return editorInstance ? editorInstance.getValue() : '';
    },

    /**
     * Set the editor content.
     * @param {string} code - Code to set
     */
    setCode(code) {
        if (editorInstance) {
            editorInstance.setValue(code);
        }
    },

    /**
     * Switch the editor language and update the UI tab state.
     * 
     * This changes the Monaco language mode (for syntax highlighting)
     * and optionally resets the code to the language boilerplate.
     * 
     * @param {string} language - 'python', 'cpp', or 'java'
     * @param {boolean} resetCode - If true, replace code with boilerplate
     */
    switchLanguage(language, resetCode = false) {
        if (!editorInstance) return;

        const monacoLang = MONACO_LANG_MAP[language] || 'python';
        const model = editorInstance.getModel();

        // Change the language mode on the existing model
        monaco.editor.setModelLanguage(model, monacoLang);

        // Optionally reset code to boilerplate
        if (resetCode) {
            editorInstance.setValue(BOILERPLATES[language] || '');
        }

        // Update tab styling
        MonacoSetup._updateTabState(language);

        // Clear any error markers from the previous language
        MonacoSetup.clearMarkers();

        console.log('[MONACO] Switched to language:', language);
    },

    /**
     * Set a red gutter marker on a specific line (for compile/runtime errors).
     * 
     * Uses Monaco's deltaDecorations API to add a red background highlight
     * and a red dot in the gutter margin on the error line.
     * 
     * @param {number} line - 1-indexed line number
     * @param {string} message - Error message to show on hover
     * @param {string} severity - 'error' (red), 'warning' (yellow), 'info' (blue)
     */
    setGutterMarker(line, message, severity = 'error') {
        if (!editorInstance || !line) return;

        // Map severity to CSS class names
        const severityClasses = {
            error: {
                line: 'errorLineDecoration',
                glyph: 'errorGlyphMargin',
            },
            warning: {
                line: 'warningLineDecoration',
                glyph: 'warningGlyphMargin',
            },
        };
        const classes = severityClasses[severity] || severityClasses.error;

        // Add the decoration
        const newDecorations = editorInstance.deltaDecorations(currentDecorations, [
            {
                range: new monaco.Range(line, 1, line, 1),
                options: {
                    isWholeLine: true,
                    className: classes.line,       // Red/yellow line background
                    glyphMarginClassName: classes.glyph, // Red/yellow dot in gutter
                    glyphMarginHoverMessage: { value: message },
                    overviewRuler: {
                        color: severity === 'error' ? '#f85149' : '#d29922',
                        position: monaco.editor.OverviewRulerLane.Full,
                    },
                },
            },
        ]);
        currentDecorations = newDecorations;

        // Also add a marker for the Problems panel integration
        const model = editorInstance.getModel();
        monaco.editor.setModelMarkers(model, 'codescore', [
            {
                startLineNumber: line,
                startColumn: 1,
                endLineNumber: line,
                endColumn: model.getLineMaxColumn(line),
                message: message,
                severity: severity === 'error'
                    ? monaco.MarkerSeverity.Error
                    : monaco.MarkerSeverity.Warning,
            },
        ]);

        // Scroll to the error line
        editorInstance.revealLineInCenter(line);
    },

    /**
     * Clear all gutter markers and decorations.
     * Called before each new submission to remove previous error indicators.
     */
    clearMarkers() {
        if (!editorInstance) return;

        // Remove decorations
        currentDecorations = editorInstance.deltaDecorations(currentDecorations, []);

        // Remove model markers
        const model = editorInstance.getModel();
        monaco.editor.setModelMarkers(model, 'codescore', []);
    },

    /**
     * Update the active state of the language tab buttons.
     * @param {string} activeLanguage - The currently active language
     * @private
     */
    _updateTabState(activeLanguage) {
        // Remove 'active' class from all tabs
        document.querySelectorAll('.ed-tab').forEach(tab => {
            tab.classList.remove('active');
        });
        // Add 'active' class to the selected tab
        const activeTab = document.querySelector(`.ed-tab[data-lang="${activeLanguage}"]`);
        if (activeTab) {
            activeTab.classList.add('active');
        }
    },
};

// Register custom CSS for error line decorations
// This is done via a <style> tag because Monaco's decoration CSS classes
// need to be in the document head
const decorationStyles = document.createElement('style');
decorationStyles.textContent = `
    /* Red background for error lines */
    .errorLineDecoration {
        background: rgba(248, 81, 73, 0.15) !important;
        border-left: 3px solid #f85149 !important;
    }
    /* Red dot in the gutter margin */
    .errorGlyphMargin {
        background: #f85149;
        border-radius: 50%;
        width: 8px !important;
        height: 8px !important;
        margin-left: 4px;
        margin-top: 6px;
    }
    /* Yellow background for warning lines */
    .warningLineDecoration {
        background: rgba(210, 153, 34, 0.15) !important;
        border-left: 3px solid #d29922 !important;
    }
    /* Yellow dot in the gutter margin */
    .warningGlyphMargin {
        background: #d29922;
        border-radius: 50%;
        width: 8px !important;
        height: 8px !important;
        margin-left: 4px;
        margin-top: 6px;
    }
`;
document.head.appendChild(decorationStyles);
