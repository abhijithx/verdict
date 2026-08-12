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
    _currentLanguage: 'python',

    /**
     * Initialize Monaco Editor from CDN.
     */
    init(containerId = 'editor-container', language = 'python', initialCode = null) {
        if (editorInstance || window.monacoEditor) {
            return Promise.resolve(window.monacoEditor || editorInstance);
        }

        return new Promise((resolve) => {
            require.config({
                paths: {
                    'vs': 'https://cdn.jsdelivr.net/npm/monaco-editor@0.45.0/min/vs'
                }
            });

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

            require(['vs/editor/editor.main'], function () {
                const container = document.getElementById(containerId);
                const activeLang = MonacoSetup._currentLanguage || language;
                const code = initialCode || BOILERPLATES[activeLang] || '';

                monaco.editor.defineTheme('verdict-dark', {
                    base: 'vs-dark',
                    inherit: true,
                    rules: [
                        { token: '', background: '0d0e0c' },
                        { token: 'comment', foreground: '52564a', fontStyle: 'italic' },
                        { token: 'keyword', foreground: '5ddc7a', fontStyle: 'bold' },
                        { token: 'string', foreground: 'e8e6df' },
                        { token: 'number', foreground: '5ddc7a' },
                    ],
                    colors: {
                        'editor.background': '#0d0e0c',
                        'editor.foreground': '#e8e6df',
                        'editor.lineHighlightBackground': '#16180f',
                        'editorCursor.foreground': '#5ddc7a',
                        'editorWhitespace.foreground': '#2b2f22',
                        'editorIndentGuide.background': '#1c1f16',
                        'editorIndentGuide.activeBackground': '#2b2f22',
                        'editorLineNumber.foreground': '#52564a',
                        'editorLineNumber.activeForeground': '#e8e6df',
                    }
                });

                editorInstance = monaco.editor.create(container, {
                    value: code,
                    language: MONACO_LANG_MAP[activeLang] || 'python',
                    theme: 'verdict-dark',
                    fontSize: 13,
                    fontFamily: "'IBM Plex Mono', 'Consolas', monospace",
                    fontLigatures: true,
                    minimap: { enabled: true, scale: 1 },
                    scrollBeyondLastLine: false,
                    automaticLayout: true,
                    lineNumbers: 'on',
                    glyphMargin: true,
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

                window.monacoEditor = editorInstance;
                MonacoSetup.switchLanguage(activeLang);

                console.log('[MONACO] Editor initialized with language:', activeLang);
                resolve(editorInstance);
            });
        });
    },

    getEditor() {
        return editorInstance || window.monacoEditor;
    },

    getCode() {
        const ed = this.getEditor();
        return ed ? ed.getValue() : '';
    },

    setCode(code) {
        const ed = this.getEditor();
        if (ed) {
            ed.setValue(code);
        }
    },

    switchLanguage(language, resetCode = false) {
        this._currentLanguage = language;
        MonacoSetup._updateTabState(language, true);

        const ed = this.getEditor();
        if (!ed) return;

        const monacoLang = MONACO_LANG_MAP[language] || 'python';
        const model = ed.getModel();

        if (model) {
            monaco.editor.setModelLanguage(model, monacoLang);
        }

        if (resetCode) {
            ed.setValue(BOILERPLATES[language] || '');
        }

        MonacoSetup.clearMarkers();
        console.log('[MONACO] Switched to language:', language);
    },

    setGutterMarker(line, message, severity = 'error') {
        const ed = this.getEditor();
        if (!ed || !line) return;

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

        const newDecorations = ed.deltaDecorations(currentDecorations, [
            {
                range: new monaco.Range(line, 1, line, 1),
                options: {
                    isWholeLine: true,
                    className: classes.line,
                    glyphMarginClassName: classes.glyph,
                    glyphMarginHoverMessage: { value: message },
                    overviewRuler: {
                        color: severity === 'error' ? '#e0563f' : '#d9a441',
                        position: monaco.editor.OverviewRulerLane.Full,
                    },
                },
            },
        ]);
        currentDecorations = newDecorations;

        const model = ed.getModel();
        if (model) {
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
        }

        ed.revealLineInCenter(line);
    },

    clearMarkers() {
        const ed = this.getEditor();
        if (!ed) return;

        currentDecorations = ed.deltaDecorations(currentDecorations, []);
        const model = ed.getModel();
        if (model) {
            monaco.editor.setModelMarkers(model, 'codescore', []);
        }
    },

    /**
     * Update the active state of the language tab buttons.
     * @param {string} activeLanguage - The currently active language
     * @private
     */
    _updateTabState(activeLanguage, showOnlyActive = true) {
        // Remove 'active' class from all tabs, hide non-active if showOnlyActive is true
        document.querySelectorAll('.ed-tab').forEach(tab => {
            const isActive = tab.dataset.lang === activeLanguage;
            tab.classList.toggle('active', isActive);
            if (showOnlyActive) {
                tab.style.display = isActive ? '' : 'none';
            }
        });
    },

    /**
     * Show only the tab for the given language, hiding the rest.
     * Called when a session is loaded to avoid showing irrelevant language tabs.
     * @param {string} language - The session's language
     */
    showOnlyTab(language) {
        this._updateTabState(language, true);
    },

    /**
     * Restore all language tabs to visible.
     * Called when no session is active or when the user needs to switch.
     */
    showAllTabs() {
        document.querySelectorAll('.ed-tab').forEach(tab => {
            tab.style.display = '';
        });
    },
};

// Register custom CSS for error line decorations
const decorationStyles = document.createElement('style');
decorationStyles.textContent = `
    .errorLineDecoration {
        background: rgba(224, 86, 63, 0.15) !important;
        border-left: 3px solid #e0563f !important;
    }
    .errorGlyphMargin {
        background: #e0563f;
        border-radius: 50%;
        width: 8px !important;
        height: 8px !important;
        margin-left: 4px;
        margin-top: 6px;
    }
    .warningLineDecoration {
        background: rgba(217, 164, 65, 0.15) !important;
        border-left: 3px solid #d9a441 !important;
    }
    .warningGlyphMargin {
        background: #d9a441;
        border-radius: 50%;
        width: 8px !important;
        height: 8px !important;
        margin-left: 4px;
        margin-top: 6px;
    }
`;
document.head.appendChild(decorationStyles);
