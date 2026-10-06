/**
 * monaco-setup.js — Monaco Editor initialization and management.
 *
 * Loads Monaco Editor from CDN via AMD loader.
 * Handles:
 *   - Editor creation and mounting
 *   - Language switching (Python / C++ / Java / JavaScript)
 *   - Gutter markers for errors
 *   - Language templates
 *   - VS Code Dark & LeetCode Dark Theme
 */

let editorInstance = null;
let currentDecorations = [];

const BOILERPLATES = {
    python: `# Write your solution here
def solve():
    # Read input and solve
    pass

if __name__ == '__main__':
    solve()
`,
    cpp: `#include <iostream>
#include <vector>
#include <string>
#include <algorithm>
using namespace std;

int main() {
    ios_base::sync_with_stdio(false);
    cin.tie(NULL);
    
    // Write your solution here
    
    return 0;
}
`,
    java: `import java.util.*;
import java.io.*;

public class Solution {
    public static void main(String[] args) {
        Scanner sc = new Scanner(System.in);
        // Write your solution here
        
    }
}
`,
    javascript: `const fs = require('fs');

function solve() {
    const input = fs.readFileSync(0, 'utf-8').trim();
    // Write your solution here
}

solve();
`,
};

const MONACO_LANG_MAP = {
    python: 'python',
    py: 'python',
    cpp: 'cpp',
    'c++': 'cpp',
    java: 'java',
    javascript: 'javascript',
    js: 'javascript',
    node: 'javascript',
};

const MonacoSetup = {
    _currentLanguage: 'python',

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

                const vsCodeDarkPlusRules = [
                    { token: '', background: '1e1e1e', foreground: 'd4d4d4' },
                    { token: 'comment', foreground: '6a9955', fontStyle: 'italic' },
                    { token: 'keyword', foreground: '569cd6', fontStyle: 'bold' },
                    { token: 'keyword.control', foreground: 'c586c0' },
                    { token: 'string', foreground: 'ce9178' },
                    { token: 'number', foreground: 'b5cea8' },
                    { token: 'type', foreground: '4ec9b0' },
                    { token: 'function', foreground: 'dcdcaa' },
                    { token: 'variable', foreground: '9cdcfe' },
                    { token: 'variable.parameter', foreground: '9cdcfe' },
                    { token: 'operator', foreground: 'd4d4d4' },
                    { token: 'delimiter', foreground: 'd4d4d4' },
                ];

                const vsCodeDarkPlusColors = {
                    'editor.background': '#1e1e1e',
                    'editor.foreground': '#d4d4d4',
                    'editor.lineHighlightBackground': '#282828',
                    'editor.lineHighlightBorder': '#28282800',
                    'editorCursor.foreground': '#007acc',
                    'editor.selectionBackground': '#264f78',
                    'editor.inactiveSelectionBackground': '#3a3d41',
                    'editorWhitespace.foreground': '#333333',
                    'editorIndentGuide.background': '#404040',
                    'editorIndentGuide.activeBackground': '#007acc99',
                    'editorLineNumber.foreground': '#858585',
                    'editorLineNumber.activeForeground': '#c6c6c6',
                    'editorGutter.background': '#1e1e1e',
                    'editorBracketMatch.background': '#007acc33',
                    'editorBracketMatch.border': '#007acc',
                };

                monaco.editor.defineTheme('vscode-dark-plus', {
                    base: 'vs-dark',
                    inherit: true,
                    rules: vsCodeDarkPlusRules,
                    colors: vsCodeDarkPlusColors,
                });

                monaco.editor.defineTheme('leetcode-dark', {
                    base: 'vs-dark',
                    inherit: true,
                    rules: vsCodeDarkPlusRules,
                    colors: vsCodeDarkPlusColors,
                });

                editorInstance = monaco.editor.create(container, {
                    value: code,
                    language: MONACO_LANG_MAP[activeLang] || 'python',
                    theme: 'vscode-dark-plus',
                    fontSize: 13.5,
                    fontFamily: "'JetBrains Mono', Consolas, 'Courier New', monospace",
                    fontLigatures: true,
                    minimap: { enabled: false },
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
                    padding: { top: 12, bottom: 12 },
                    suggest: {
                        showKeywords: true,
                        showSnippets: true,
                    },
                    bracketPairColorization: { enabled: true },
                });

                // Ctrl+Enter / Cmd+Enter shortcut to Run
                editorInstance.addCommand(monaco.KeyMod.CtrlCmd | monaco.KeyCode.Enter, function () {
                    if (typeof SessionView !== 'undefined' && SessionView.dryRun) {
                        SessionView.dryRun();
                    }
                });

                // Ctrl+Shift+Enter / Cmd+Shift+Enter shortcut to Submit
                editorInstance.addCommand(monaco.KeyMod.CtrlCmd | monaco.KeyMod.Shift | monaco.KeyCode.Enter, function () {
                    if (typeof SessionView !== 'undefined' && SessionView.submit) {
                        SessionView.submit();
                    }
                });

                // Invalidate verification when user types in editor
                editorInstance.onDidChangeModelContent(function () {
                    if (typeof SessionView !== 'undefined' && SessionView.onCodeChange) {
                        SessionView.onCodeChange();
                    }
                });

                if (window.ResizeObserver && container) {
                    let layoutRaf = null;
                    const ro = new ResizeObserver(() => {
                        if (container.offsetWidth === 0 || container.offsetHeight === 0) {
                            return;
                        }
                        if (layoutRaf) cancelAnimationFrame(layoutRaf);
                        layoutRaf = requestAnimationFrame(() => {
                            if (editorInstance && container.offsetWidth > 0 && container.offsetHeight > 0) {
                                editorInstance.layout();
                            }
                        });
                    });
                    ro.observe(container);
                }

                window.monacoEditor = editorInstance;
                MonacoSetup.switchLanguage(activeLang);

                console.log('[MONACO] Editor initialized with language:', activeLang);
                resolve(editorInstance);
            });
        });
    },

    layout() {
        const ed = this.getEditor();
        const container = document.getElementById('editor-container');
        if (ed && container && container.offsetWidth > 0 && container.offsetHeight > 0) {
            ed.layout();
        }
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

    resetCode() {
        const activeLang = this._currentLanguage || 'python';
        this.setCode(BOILERPLATES[activeLang] || '');
        if (typeof Toast !== 'undefined') {
            Toast.info(`Reset code to ${activeLang.toUpperCase()} starter template.`);
        }
    },

    formatCode() {
        const ed = this.getEditor();
        if (ed) {
            const action = ed.getAction('editor.action.formatDocument');
            if (action) action.run();
            if (typeof Toast !== 'undefined') {
                Toast.info('Formatted code.');
            }
        }
    },

    copyCode() {
        const code = this.getCode();
        if (!code) {
            if (typeof Toast !== 'undefined') Toast.warning('No code to copy.');
            return;
        }
        navigator.clipboard.writeText(code).then(() => {
            if (typeof Toast !== 'undefined') Toast.success('Code copied to clipboard!');
        }).catch(() => {
            if (typeof Toast !== 'undefined') Toast.error('Could not copy to clipboard.');
        });
    },

    switchLanguage(language, resetCode = false) {
        const lang = (language || 'python').toLowerCase();
        this._currentLanguage = lang;
        this._updateTabState(lang, true);

        // Sync dropdown selector if present
        const langSelect = document.getElementById('lang-select');
        if (langSelect && langSelect.value !== lang) {
            langSelect.value = lang;
        }

        const ed = this.getEditor();
        if (!ed) return;

        const monacoLang = MONACO_LANG_MAP[lang] || 'python';
        const model = ed.getModel();

        if (model) {
            monaco.editor.setModelLanguage(model, monacoLang);
        }

        if (resetCode) {
            ed.setValue(BOILERPLATES[lang] || '');
        }

        this.clearMarkers();
        if (typeof SessionView !== 'undefined' && SessionView.onLanguageChange) {
            SessionView.onLanguageChange(lang);
        }
        console.log('[MONACO] Switched to language:', lang);
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
                        color: severity === 'error' ? 'rgba(244, 63, 94, 0.7)' : 'rgba(245, 158, 11, 0.7)',
                        position: monaco.editor.OverviewRulerLane.Right,
                    },
                },
            },
        ]);
        currentDecorations = newDecorations;

        const model = ed.getModel();
        if (model) {
            monaco.editor.setModelMarkers(model, 'verdict', [
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
    },

    clearMarkers() {
        const ed = this.getEditor();
        if (ed) {
            currentDecorations = ed.deltaDecorations(currentDecorations, []);
            const model = ed.getModel();
            if (model) {
                monaco.editor.setModelMarkers(model, 'verdict', []);
            }
        }
    },

    _updateTabState(language, isVisible) {
        document.querySelectorAll('.ed-tab').forEach((tab) => {
            const isMatch = tab.dataset.lang === language;
            tab.classList.toggle('active', isMatch);
            if (isVisible) {
                tab.style.display = isMatch ? 'inline-flex' : 'none';
            }
        });
    },

    showOnlyTab(language) {
        this._updateTabState(language, true);
    },
};
