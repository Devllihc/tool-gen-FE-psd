const { deburr } = require('./textUtils');

function stripMarkers(name) {
	const c = String(name).replace(/\[[^\]]*\]/g, '').trim();
	return c || String(name);
}
function cleanKey(name) {
	return deburr(stripMarkers(name)).toLowerCase();
}
function normText(s) {
	return String(s == null ? '' : s).replace(/\s+/g, ' ').trim().toLowerCase();
}
function sizeBucket(n) {
	return Math.round((n || 0) / 2) * 2; // tolerate ±1px rounding
}

// Recursive signature — excludes absolute x/y.
function sigOf(desc) {
	if (!desc) return '';
	const size = `${sizeBucket(desc.bounds.w)}x${sizeBucket(desc.bounds.h)}`;
	if (desc.kind === 'text') return `t:${cleanKey(desc.name)}:${normText(desc.text)}:${size}`;
	if (desc.kind === 'image') return `i:${cleanKey(desc.name)}:${size}`;
	const kids = (desc.children || []).map(sigOf).sort();
	return `g:${cleanKey(desc.name)}:${size}:(${kids.join(',')})`;
}

// All text content inside a subtree, joined — used to tell a data-driven label
// (a milestone number that changes per item) from a purely visual/state group.
function deepText(desc) {
	if (!desc) return '';
	if (desc.kind === 'text') return normText(desc.text);
	if (desc.kind === 'group') return (desc.children || []).map(deepText).join('|');
	return '';
}
function firstText(desc) {
	if (!desc) return '';
	if (desc.kind === 'text') return desc.text != null ? desc.text : '';
	if (desc.kind === 'group') {
		for (const c of desc.children || []) { const t = firstText(c); if (t) return t; }
	}
	return '';
}

function markerFor(desc) {
	const mk = desc.marker || {};
	if (mk.bind) return { subRole: desc.kind === 'text' ? 'dynamic-text' : 'dynamic-image', apiHint: mk.bind };
	return null;
}

// Pick the instance whose direct-child structure is the most common (modal), so an
// atypical state variant (e.g. a "claimed" milestone with an extra ribbon layer)
// neither becomes the template nor corrupts the cross-instance comparison. Keeps each
// typical instance's original index (typicalIndices) so a per-instance bounds override
// can be mapped back to the right list position later.
function pickRepresentative(instances) {
	const counts = instances.map((g) => (g.children || []).length);
	const freq = {};
	counts.forEach((c) => { freq[c] = (freq[c] || 0) + 1; });
	const modalCount = Number(Object.keys(freq).sort((a, b) => (freq[b] - freq[a]) || (Number(a) - Number(b)))[0]);
	const repIdx = counts.indexOf(modalCount);
	const typical = [];
	const typicalIndices = [];
	counts.forEach((c, i) => { if (c === modalCount) { typical.push(instances[i]); typicalIndices.push(i); } });
	return { repIdx, typical, typicalIndices };
}

// Some list instances genuinely differ in inner geometry from the representative — not
// just position, but size (e.g. a perspective goal-frame design where the outer frames
// are drawn larger than the inner ones). A single shared `bounds` can't represent that;
// record a per-instance override only where it deviates beyond rounding noise, so a
// uniform list (the common case) gets none and its output stays exactly as before.
const BOUNDS_OVERRIDE_TOLERANCE = 3; // px
function relTo(desc, originX, originY) {
	return { x: desc.bounds.x - originX, y: desc.bounds.y - originY, w: desc.bounds.w, h: desc.bounds.h };
}
function boundsDiffer(a, b) {
	return Math.abs(a.x - b.x) > BOUNDS_OVERRIDE_TOLERANCE || Math.abs(a.y - b.y) > BOUNDS_OVERRIDE_TOLERANCE ||
		Math.abs(a.w - b.w) > BOUNDS_OVERRIDE_TOLERANCE || Math.abs(a.h - b.h) > BOUNDS_OVERRIDE_TOLERANCE;
}
function buildBoundsOverride(typical, typicalIndices, childIndex, baseRel) {
	const overrides = {};
	typical.forEach((instance, m) => {
		const child = (instance.children || [])[childIndex];
		if (!child) return;
		const instRel = relTo(child, instance.bounds.x, instance.bounds.y);
		if (boundsDiffer(instRel, baseRel)) overrides[typicalIndices[m]] = instRel;
	});
	return Object.keys(overrides).length ? overrides : null;
}

// Classify one aligned position across the "typical" instances into a template node.
function classifyAligned(aligned, originX, originY, policy) {
	const first = aligned[0];
	const rel = { x: first.bounds.x - originX, y: first.bounds.y - originY, w: first.bounds.w, h: first.bounds.h };
	const mk = markerFor(first);
	const name = stripMarkers(first.name);

	const asAsset = (subRole, apiHint) => ({
		role: 'asset', name, layerId: first.layerId, subRole, apiHint: apiHint || null,
		image: null, needsReview: false, reviewReason: null, bounds: rel
	});
	const asText = (subRole, apiHint) => ({
		role: 'text', name, subRole, text: first.text != null ? first.text : '',
		bind: apiHint || null, apiHint: apiHint || null, needsReview: false, reviewReason: null, bounds: rel
	});

	// Explicit marker is ground truth.
	if (mk) return first.kind === 'text' ? asText(mk.subRole, mk.apiHint) : asAsset(mk.subRole, mk.apiHint);

	const sigs = aligned.map(sigOf);
	const allSame = sigs.every((s) => s === sigs[0]);
	if (allSame) return first.kind === 'text' ? asText('text') : asAsset('static-asset');

	// Varies across the typical instances → dynamic.
	if (first.kind === 'text') return asText('dynamic-text');
	if (first.kind === 'image') {
		if (policy === 'fixed-all') {
			return {
				role: 'asset', name, subRole: 'static-per-instance',
				layerIds: aligned.map((a) => a.layerId), images: null,
				apiHint: null, needsReview: false, reviewReason: null, bounds: rel
			};
		}
		// api-slot: default to a single API demo, but KEEP every instance's layerId so the
		// review UI's "Per-item" toggle can cut all N later without a re-analyze (harmless
		// while it stays dynamic-image — planCutJobs/buildAssetIndex key off subRole).
		const node = asAsset('dynamic-image');
		node.layerIds = aligned.map((a) => a.layerId);
		return node;
	}

	// A GROUP that varies: distinguish data-driven from state-driven variation.
	const texts = aligned.map(deepText);
	const textVaries = texts.some((t) => t !== texts[0]) && texts.some((t) => t.length > 0);
	if (textVaries) {
		// The variation is carried by text (e.g. the milestone number) → dynamic-text.
		const node = asText('dynamic-text');
		node.text = firstText(first);
		return node;
	}
	// No varying text — the group differs only visually (e.g. podium gold vs gray by
	// claimed/locked state). Cut the whole group once as a representative static image
	// and flag it so the reviewer confirms the state handling.
	const node = asAsset('static-asset');
	node.needsReview = true;
	node.reviewReason = 'Group changes by state across items (not data) — cut one representative image, please double-check.';
	return node;
}

function buildInstanceTemplate(instanceDescs, instanceLayout, policy) {
	const pol = policy || 'api-slot';
	const layout = instanceLayout || { direction: 'absolute' };
	if (!instanceDescs || !instanceDescs.length) return { layout, children: [] };
	const { repIdx, typical, typicalIndices } = pickRepresentative(instanceDescs);
	const rep = instanceDescs[repIdx];
	const originX = rep.bounds.x;
	const originY = rep.bounds.y;
	const repChildren = rep.children || [];
	const children = repChildren.map((_, k) => {
		const node = classifyAligned(typical.map((g) => (g.children || [])[k]), originX, originY, pol);
		const override = buildBoundsOverride(typical, typicalIndices, k, node.bounds);
		if (override) node.boundsOverride = override;
		return node;
	});
	return { layout, children };
}

module.exports = { sigOf, buildInstanceTemplate };
