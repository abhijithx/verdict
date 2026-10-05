/**
 * charts.js — Chart.js wrapper with Compiler Ledger theme.
 */

Chart.defaults.color = '#4b5563';
Chart.defaults.borderColor = 'rgba(0, 0, 0, 0.08)';
Chart.defaults.font.family = "'JetBrains Mono', monospace";

const Charts = {
    _instances: {},

    renderComplexityChart(canvasId, chartData) {
        if (!chartData || !chartData.labels) return;
        this._destroy(canvasId);
        const canvas = document.getElementById(canvasId);
        if (!canvas) return;

        // Single accent intensity scale
        const colors = ['rgba(79, 70, 229, 0.75)', 'rgba(124, 58, 237, 0.6)', 'rgba(147, 51, 234, 0.45)', 'rgba(79, 70, 229, 0.3)'];
        const borders = ['#4f46e5', '#7c3aed', '#9333ea', '#4f46e5'];

        const datasets = (chartData.datasets || []).map((ds, i) => ({
            label: ds.label, data: ds.values,
            backgroundColor: colors[i % colors.length],
            borderColor: borders[i % borders.length],
            borderWidth: 1, borderRadius: 0,
        }));

        this._instances[canvasId] = new Chart(canvas, {
            type: chartData.type || 'bar',
            data: { labels: chartData.labels, datasets },
            options: {
                responsive: true, maintainAspectRatio: false,
                plugins: {
                    legend: { position:'top', labels:{ padding:8, usePointStyle:false, font:{size:10, family:"'JetBrains Mono', monospace"} } },
                    title: { display:true, text:'Complexity Breakdown', color:'#111827', font:{size:11,weight:'600', family:"'JetBrains Mono', monospace"}, padding:{bottom:8} },
                },
                scales: {
                    y: { beginAtZero:true, grid:{color:'rgba(0,0,0,0.06)'}, ticks:{font:{size:10, family:"'JetBrains Mono', monospace"}} },
                    x: { grid:{display:false}, ticks:{font:{size:10, family:"'JetBrains Mono', monospace"}} },
                },
            },
        });
    },

    renderScoreBreakdown(canvasId, signals, profile) {
        if (!signals) return;
        this._destroy(canvasId);
        const canvas = document.getElementById(canvasId);
        if (!canvas) return;

        const labels = ['Correctness','Performance','Optimization','Quality','Readability','Docs'];
        const scores = [signals.correctness_score||0,signals.performance_score||0,signals.optimization_score||0,signals.quality_score||0,signals.readability_score||0,signals.documentation_score||0];

        const barColors = scores.map(s => `rgba(79, 70, 229, ${Math.max(0.35, s / 100)})`);

        const datasets = [{ label:'Score', data:scores, backgroundColor:barColors, borderWidth:0, borderRadius:0 }];

        if (profile) {
            const w = [(profile.correctness_weight||0)*100,(profile.performance_weight||0)*100,(profile.optimization_weight||0)*100,(profile.quality_weight||0)*100,(profile.readability_weight||0)*100,(profile.documentation_weight||0)*100];
            datasets.push({ label:'Weight %', data:w, backgroundColor:'rgba(147, 51, 234, 0.15)', borderColor:'rgba(0,0,0,0.08)', borderWidth:1, borderRadius:0 });
        }

        this._instances[canvasId] = new Chart(canvas, {
            type:'bar', data:{labels,datasets},
            options: {
                indexAxis:'y', responsive:true, maintainAspectRatio:false,
                plugins: {
                    legend: { position:'top', labels:{padding:6,usePointStyle:false,font:{size:9, family:"'JetBrains Mono', monospace"}} },
                    title: { display:true, text:'Score Signals', color:'#111827', font:{size:11,weight:'600', family:"'JetBrains Mono', monospace"} },
                },
                scales: {
                    x: { beginAtZero:true, max:100, grid:{color:'rgba(0,0,0,0.06)'}, ticks:{font:{size:9, family:"'JetBrains Mono', monospace"}} },
                    y: { grid:{display:false}, ticks:{font:{size:10, family:"'JetBrains Mono', monospace"}} },
                },
            },
        });
    },

    _destroy(id) { if (this._instances[id]) { this._instances[id].destroy(); delete this._instances[id]; } },
};
