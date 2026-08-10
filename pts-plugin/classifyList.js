const { deburr, toPascal } = require('./textUtils');

function median(arr) {
	if (!arr.length) return 0;
	const s = [...arr].sort((a, b) => a - b);
	const m = Math.floor(s.length / 2);
	return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
}

function detectLayout(items) {
	if (items.length < 2) return { direction: 'absolute' };
	const xs = items.map((i) => i.x), ys = items.map((i) => i.y);
	const spanX = Math.max(...xs) - Math.min(...xs);
	const spanY = Math.max(...ys) - Math.min(...ys);
	const horizontal = spanX >= spanY;
	const sorted = [...items].sort((a, b) => (horizontal ? a.x - b.x : a.y - b.y));
	const gaps = [];
	for (let i = 1; i < sorted.length; i++) {
		const prev = sorted[i - 1];
		gaps.push(horizontal ? sorted[i].x - (prev.x + prev.w) : sorted[i].y - (prev.y + prev.h));
	}
	if (Math.min(...gaps) < -20) return { direction: 'absolute' };
	return { direction: horizontal ? 'row' : 'column', gap: Math.max(0, Math.round(median(gaps))) };
}

function stripMarkers(name) {
	const c = String(name).replace(/\[[^\]]*\]/g, '').trim();
	return c || String(name);
}
function stripCopySuffix(name) {
	const c = name.replace(/\s+copy(\s+\d+)?$/i, '').trim();
	return c || name;
}
function cleanKey(name) {
	return deburr(stripCopySuffix(stripMarkers(name))).toLowerCase();
}
function normText(s) {
	return String(s == null ? '' : s).replace(/\s+/g, ' ').trim().toLowerCase();
}

const SIZE_TOLERANCE = 1;
const SIZE_BORDERLINE = 3;
function sizeMatches(a, b, tol) {
	return Math.abs(a.bounds.w - b.bounds.w) <= tol && Math.abs(a.bounds.h - b.bounds.h) <= tol;
}

function sigOf(desc) {
	if (!desc) return '';
	if (desc.kind === 'text') return `t:${cleanKey(desc.name)}:${normText(desc.text)}`;
	if (desc.kind === 'image') return `i:${cleanKey(desc.name)}`;
	const kids = (desc.children || []).map(sigOf).sort();
	return `g:${cleanKey(desc.name)}:(${kids.join(',')})`;
}

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

function markerFor(aligned) {
	const list = Array.isArray(aligned) ? aligned : [aligned];
	for (const desc of list) {
		const mk = (desc && desc.marker) || {};
		if (mk.bind) return { subRole: desc.kind === 'text' ? 'dynamic-text' : 'dynamic-image', apiHint: mk.bind };
	}
	return null;
}

function roleMarkerFor(aligned) {
	for (const desc of aligned) {
		const mk = (desc && desc.marker) || {};
		if (mk.role && mk.role !== 'asset') return { role: mk.role, layout: mk.layout || null };
	}
	return null;
}

const AUTO_LIST_MIN = 4;
function structureSigDesc(desc, depth) {
	if (!desc) return '';
	if (desc.kind === 'text') return 't';
	if (desc.kind !== 'group') return 'i';
	if (depth <= 0) return 'g';
	const kids = (desc.children || []).map((c) => structureSigDesc(c, depth - 1)).sort();
	return `g(${kids.join(',')})`;
}
function isAutoListDesc(desc) {
	if (!desc || desc.kind !== 'group') return false;
	const kids = desc.children || [];
	const groups = kids.filter((k) => k.kind === 'group');
	if (groups.length < AUTO_LIST_MIN) return false;
	if (groups.length < kids.length * 0.6) return false;
	const counts = {};
	groups.forEach((k) => { const s = structureSigDesc(k, 2); counts[s] = (counts[s] || 0) + 1; });
	const dominant = Math.max.apply(null, Object.values(counts));
	return dominant >= Math.ceil(groups.length * 0.6);
}

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

const BOUNDS_OVERRIDE_TOLERANCE = 3;
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

function classifyAligned(aligned, originX, originY, policy) {
	const first = aligned[0];
	const rel = { x: first.bounds.x - originX, y: first.bounds.y - originY, w: first.bounds.w, h: first.bounds.h };
	const mk = markerFor(aligned);
	const name = stripMarkers(first.name);

	const asAsset = (subRole, apiHint) => ({
		role: 'asset', name, layerId: first.layerId, subRole, apiHint: apiHint || null,
		image: null, needsReview: false, reviewReason: null, bounds: rel
	});
	const asText = (subRole, apiHint) => ({
		role: 'text', name, subRole, text: first.text != null ? first.text : '',
		bind: apiHint || null, apiHint: apiHint || null, needsReview: false, reviewReason: null, bounds: rel
	});

	if (mk) return first.kind === 'text' ? asText(mk.subRole, mk.apiHint) : asAsset(mk.subRole, mk.apiHint);

	const roleMk = roleMarkerFor(aligned);
	if (roleMk && first.kind === 'group') {
		if (roleMk.role === 'list') return buildNestedList(first, name, rel, roleMk.layout, policy);
		return buildNestedContainer(first, aligned, name, rel, roleMk, policy);
	}

	const sigs = aligned.map(sigOf);
	const sigsSame = sigs.every((s) => s === sigs[0]);
	const sizesSame = aligned.every((a) => sizeMatches(a, first, SIZE_TOLERANCE));
	if (sigsSame && sizesSame) {
		if (first.kind === 'group' && isAutoListDesc(first)) return buildNestedList(first, name, rel, null, policy);
		return first.kind === 'text' ? asText('text') : asAsset('static-asset');
	}

	const borderline = sigsSame && !sizesSame &&
		aligned.every((a) => sizeMatches(a, first, SIZE_BORDERLINE));
	const borderlineNote = borderline
		? 'Instances differ in size by only a few px (name/text identical) — likely PSD rounding noise, not real per-item art. Double-check before relying on this as dynamic.'
		: null;

	if (first.kind === 'text') {
		const node = asText('dynamic-text');
		node.reviewReason = borderlineNote;
		return node;
	}
	if (first.kind === 'image') {
		if (policy === 'fixed-all') {
			return {
				role: 'asset', name, subRole: 'static-per-instance',
				layerIds: aligned.map((a) => a.layerId), images: null,
				apiHint: null, needsReview: false, reviewReason: borderlineNote, bounds: rel
			};
		}
		const node = asAsset('dynamic-image');
		node.layerIds = aligned.map((a) => a.layerId);
		node.reviewReason = borderlineNote;
		return node;
	}

	const texts = aligned.map(deepText);
	const textVaries = texts.some((t) => t !== texts[0]) && texts.some((t) => t.length > 0);
	if (textVaries) {
		const node = asText('dynamic-text');
		node.text = firstText(first);
		return node;
	}
	const node = asAsset('static-asset');
	node.needsReview = true;
	node.reviewReason = 'Group changes by state across items (not data) — cut one representative image, please double-check.';
	return node;
}

function rosterOf(desc, ox, oy) {
	const out = {
		name: stripMarkers(desc.name),
		layerId: desc.layerId,
		kind: desc.kind,
		bounds: { x: desc.bounds.x - ox, y: desc.bounds.y - oy, w: desc.bounds.w, h: desc.bounds.h }
	};
	if (desc.text != null) out.text = desc.text;
	if (desc.children) out.children = desc.children.map((c) => rosterOf(c, ox, oy));
	return out;
}

function buildNestedList(desc, name, rel, markerLayout, policy) {
	const subInstances = desc.children || [];
	const layout = markerLayout
		? { direction: markerLayout, gap: 0 }
		: detectLayout(subInstances.map((c) => c.bounds));
	const innerLayout = detectLayout(((subInstances[0] || {}).children || []).map((c) => c.bounds));
	return {
		role: 'list',
		name,
		component: toPascal(name),
		layout,
		bounds: rel,
		count: subInstances.length,
		instanceOffsets: subInstances.map((c) => ({ x: c.bounds.x - desc.bounds.x, y: c.bounds.y - desc.bounds.y })),
		instanceLayers: subInstances.map((c) => (c.children || []).map((g) => rosterOf(g, c.bounds.x, c.bounds.y))),
		instanceTemplate: buildInstanceTemplate(subInstances, innerLayout, policy)
	};
}

function buildNestedContainer(desc, aligned, name, rel, roleMk, policy) {
	const kids = desc.children || [];
	const children = kids.map((_, k) => {
		const alignedKids = aligned.map((g) => (g && g.children || [])[k]).filter(Boolean);
		return classifyAligned(alignedKids, desc.bounds.x, desc.bounds.y, policy);
	});
	const layout = roleMk.layout
		? { direction: roleMk.layout, gap: 0 }
		: detectLayout(children.map((c) => c.bounds));
	return { role: roleMk.role === 'component' ? 'component' : 'container', name, layout, bounds: rel, children };
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
		if (node.subRole === 'static-per-instance') expandToAllInstances(node, instanceDescs, k);
		return node;
	});
	return { layout, children };
}

function expandToAllInstances(node, instanceDescs, k) {
	node.layerIds = instanceDescs.map((inst, origIdx) => {
		const child = (inst.children || [])[k];
		if (child) return child.layerId;
		node.needsReview = true;
		node.reviewReason = (node.reviewReason ? node.reviewReason + ' ' : '') +
			`Instance ${origIdx + 1} has fewer layers than the template at this position — no matching layer found, skipped; verify/re-cut manually.`;
		return null;
	});
}

module.exports = { sigOf, buildInstanceTemplate, rosterOf, detectLayout, median };
