/**
 * charts.js — Chart.js wrapper with Compiler Ledger theme.
 */

Chart.defaults.color = '#8a8d7f';
Chart.defaults.borderColor = '#2b2f22';
Chart.defaults.font.family = "'IBM Plex Mono', monospace";

const Charts = {
    _instances: {},

    renderComplexityChart(canvasId, chartData) {
        if (!chartData || !chartData.labels) return;
        this._destroy(canvasId);
        const canvas = document.getElementById(canvasId);
        if (!canvas) return;

        // Single accent intensity scale
        const colors = ['rgba(93, 220, 122, 0.7)', 'rgba(93, 220, 122, 0.5)', 'rgba(93, 220, 122, 0.35)', 'rgba(93, 220, 122, 0.2)'];
        const borders = ['#5ddc7a', '#5ddc7a', '#5ddc7a', '#5ddc7a'];

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
                    legend: { position:'top', labels:{ padding:8, usePointStyle:false, font:{size:10, family:"'IBM Plex Mono', monospace"} } },
                    title: { display:true, text:'Complexity Breakdown', color:'#e8e6df', font:{size:11,weight:'600', family:"'IBM Plex Mono', monospace"}, padding:{bottom:8} },
                },
                scales: {
                    y: { beginAtZero:true, grid:{color:'#2b2f22'}, ticks:{font:{size:10, family:"'IBM Plex Mono', monospace"}} },
                    x: { grid:{display:false}, ticks:{font:{size:10, family:"'IBM Plex Mono', monospace"}} },
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

        const barColors = scores.map(s => `rgba(93, 220, 122, ${Math.max(0.3, s / 100)})`);

        const datasets = [{ label:'Score', data:scores, backgroundColor:barColors, borderWidth:0, borderRadius:0 }];

        if (profile) {
            const w = [(profile.correctness_weight||0)*100,(profile.performance_weight||0)*100,(profile.optimization_weight||0)*100,(profile.quality_weight||0)*100,(profile.readability_weight||0)*100,(profile.documentation_weight||0)*100];
            datasets.push({ label:'Weight %', data:w, backgroundColor:'rgba(138, 141, 127, 0.2)', borderColor:'#2b2f22', borderWidth:1, borderRadius:0 });
        }

        this._instances[canvasId] = new Chart(canvas, {
            type:'bar', data:{labels,datasets},
            options: {
                indexAxis:'y', responsive:true, maintainAspectRatio:false,
                plugins: {
                    legend: { position:'top', labels:{padding:6,usePointStyle:false,font:{size:9, family:"'IBM Plex Mono', monospace"}} },
                    title: { display:true, text:'Score Signals', color:'#e8e6df', font:{size:11,weight:'600', family:"'IBM Plex Mono', monospace"} },
                },
                scales: {
                    x: { beginAtZero:true, max:100, grid:{color:'#2b2f22'}, ticks:{font:{size:9, family:"'IBM Plex Mono', monospace"}} },
                    y: { grid:{display:false}, ticks:{font:{size:10, family:"'IBM Plex Mono', monospace"}} },
                },
            },
        });
    },

    _destroy(id) { if (this._instances[id]) { this._instances[id].destroy(); delete this._instances[id]; } },
};
