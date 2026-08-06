/**
 * charts.js — Chart.js wrapper (dark theme).
 */

Chart.defaults.color = '#6b7385';
Chart.defaults.borderColor = '#2a2d37';
Chart.defaults.font.family = "'Inter', sans-serif";

const Charts = {
    _instances: {},

    renderComplexityChart(canvasId, chartData) {
        if (!chartData || !chartData.labels) return;
        this._destroy(canvasId);
        const canvas = document.getElementById(canvasId);
        if (!canvas) return;

        const colors = ['rgba(108,138,239,0.6)','rgba(167,139,250,0.5)','rgba(34,211,238,0.5)','rgba(251,191,36,0.5)'];
        const borders = ['#6c8aef','#a78bfa','#22d3ee','#fbbf24'];

        const datasets = (chartData.datasets || []).map((ds, i) => ({
            label: ds.label, data: ds.values,
            backgroundColor: colors[i % colors.length],
            borderColor: borders[i % borders.length],
            borderWidth: 1, borderRadius: 3,
        }));

        this._instances[canvasId] = new Chart(canvas, {
            type: chartData.type || 'bar',
            data: { labels: chartData.labels, datasets },
            options: {
                responsive: true, maintainAspectRatio: false,
                plugins: {
                    legend: { position:'top', labels:{ padding:8, usePointStyle:true, font:{size:10} } },
                    title: { display:true, text:'Complexity', color:'#eceff4', font:{size:11,weight:'600'}, padding:{bottom:8} },
                },
                scales: {
                    y: { beginAtZero:true, grid:{color:'#1b1e25'}, ticks:{font:{size:10}} },
                    x: { grid:{display:false}, ticks:{font:{size:10}} },
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

        const barColors = scores.map(s => s>=80?'rgba(74,222,128,0.6)':s>=60?'rgba(108,138,239,0.6)':s>=40?'rgba(251,191,36,0.6)':'rgba(248,113,113,0.6)');

        const datasets = [{ label:'Score', data:scores, backgroundColor:barColors, borderWidth:0, borderRadius:3 }];

        if (profile) {
            const w = [(profile.correctness_weight||0)*100,(profile.performance_weight||0)*100,(profile.optimization_weight||0)*100,(profile.quality_weight||0)*100,(profile.readability_weight||0)*100,(profile.documentation_weight||0)*100];
            datasets.push({ label:'Weight %', data:w, backgroundColor:'rgba(255,255,255,0.06)', borderColor:'rgba(255,255,255,0.12)', borderWidth:1, borderRadius:3 });
        }

        this._instances[canvasId] = new Chart(canvas, {
            type:'bar', data:{labels,datasets},
            options: {
                indexAxis:'y', responsive:true, maintainAspectRatio:false,
                plugins: {
                    legend: { position:'top', labels:{padding:6,usePointStyle:true,font:{size:9}} },
                    title: { display:true, text:'Score Breakdown', color:'#eceff4', font:{size:11,weight:'600'} },
                },
                scales: {
                    x: { beginAtZero:true, max:100, grid:{color:'#1b1e25'}, ticks:{font:{size:9}} },
                    y: { grid:{display:false}, ticks:{font:{size:10}} },
                },
            },
        });
    },

    _destroy(id) { if (this._instances[id]) { this._instances[id].destroy(); delete this._instances[id]; } },
};
