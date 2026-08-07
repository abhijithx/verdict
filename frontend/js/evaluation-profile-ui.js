/**
 * evaluation-profile-ui.js — Weight slider panel for custom profiles.
 */

const EvaluationProfileUI = {
    _weights: { correctness:40, performance:20, optimization:15, quality:15, readability:5, documentation:5 },

    _dims: [
        { key:'correctness', label:'Correctness', color:'#5ddc7a' },
        { key:'performance', label:'Performance', color:'#5ddc7a' },
        { key:'optimization', label:'Optimization', color:'#5ddc7a' },
        { key:'quality', label:'Quality', color:'#5ddc7a' },
        { key:'readability', label:'Readability', color:'#5ddc7a' },
        { key:'documentation', label:'Documentation', color:'#5ddc7a' },
    ],

    render(containerId) {
        const el = document.getElementById(containerId);
        if (!el) return;

        let h = `<div class="mb-3"><label class="field-label-sm">Profile Name</label>
            <input id="custom-profile-name" type="text" placeholder="e.g., My Profile" class="field-input mt-1"></div>
            <p class="text-2xs text-text-2 mb-3">Weights must total 100%.</p>`;

        for (const d of this._dims) {
            const v = this._weights[d.key];
            h += `<div class="slider-group"><div class="slider-header">
                <span class="slider-label" style="color:${d.color}">${d.label}</span>
                <span class="slider-value" id="sv-${d.key}" style="color:${d.color}">${v}%</span></div>
                <input type="range" class="profile-slider" id="sl-${d.key}" min="0" max="100" step="5" value="${v}"
                    oninput="EvaluationProfileUI.onChange('${d.key}',this.value)"></div>`;
        }

        h += `<div id="wt-ind" class="weight-total valid"><span>Total</span><span id="wt-val">100%</span></div>
            <button id="btn-save-profile" class="cmd-btn cmd-primary w-full mt-3" onclick="EvaluationProfileUI.save()">Save Profile</button>`;
        el.innerHTML = h;
        this._updateTotal();
    },

    onChange(key, val) {
        this._weights[key] = parseInt(val, 10);
        const e = document.getElementById(`sv-${key}`);
        if (e) e.textContent = `${val}%`;
        this._updateTotal();
    },

    _updateTotal() {
        const total = Object.values(this._weights).reduce((s,v)=>s+v,0);
        const ind = document.getElementById('wt-ind');
        const tv = document.getElementById('wt-val');
        const btn = document.getElementById('btn-save-profile');
        if (tv) tv.textContent = `${total}%`;
        if (ind) ind.className = `weight-total ${total===100?'valid':'invalid'}`;
        if (btn) btn.disabled = total !== 100;
    },

    async save() {
        const name = (document.getElementById('custom-profile-name')?.value || '').trim();
        if (!name) return alert('Enter a profile name.');
        const total = Object.values(this._weights).reduce((s,v)=>s+v,0);
        if (total !== 100) return alert(`Weights must sum to 100% (currently ${total}%).`);

        try {
            const weights = {};
            for (const k of Object.keys(this._weights)) weights[`${k}_weight`] = this._weights[k]/100;
            const profile = await ApiClient.createProfile(name, weights);

            const sel = document.getElementById('modal-profile-select');
            if (sel) {
                const o = document.createElement('option');
                o.value = profile.profile_id;
                o.textContent = profile.name;
                const co = sel.querySelector('option[value="custom"]');
                if (co) sel.insertBefore(o, co); else sel.appendChild(o);
                sel.value = profile.profile_id;
            }
            document.getElementById('custom-profile-panel')?.classList.add('hidden');
            alert(`Profile "${name}" saved.`);
        } catch (e) { alert(`Failed: ${e.message}`); }
    },

    getWeights() {
        const w = {};
        for (const k of Object.keys(this._weights)) w[`${k}_weight`] = this._weights[k]/100;
        return w;
    },
};
