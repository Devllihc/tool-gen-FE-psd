const { fileSafe } = require('./textUtils');

function planCutJobs(slug, root) {
	const jobs = [];
	const used = {};
	function uniqueName(base) {
		used[base] = (used[base] || 0) + 1;
		return used[base] > 1 ? `${base}_${used[base]}` : base;
	}
	function pushAsset(node) {
		const isDynamic = node.subRole === 'dynamic-image';
		const suffix = isDynamic ? '--demo' : '';
		const base = uniqueName(fileSafe(node.name));
		jobs.push({ layerId: node.layerId, fileName: `${slug}__${base}${suffix}.png`, purpose: isDynamic ? 'demo' : 'static' });
		pushVariants(node, base);
	}
	function pushVariants(node, base) {
		if (!Array.isArray(node.variants)) return;
		node.variants.forEach((v) => {
			jobs.push({ layerId: v.layerId, fileName: `${slug}__${base}--${fileSafe(v.key)}.png`, purpose: 'variant' });
		});
	}
	function walk(node) {
		if (node.role === 'asset') {
			if (node.subRole === 'static-per-instance' && Array.isArray(node.layerIds)) {
				const base = uniqueName(fileSafe(node.name));
				node.layerIds.forEach((lid, i) => {
					jobs.push({ layerId: lid, fileName: `${slug}__${base}_${i + 1}.png`, purpose: 'static' });
				});
				return;
			}
			if (node.layerId != null) pushAsset(node);
			return;
		}
		if (node.role === 'list') { if (node.instanceTemplate) node.instanceTemplate.children.forEach(walk); return; }
		if (node.children) node.children.forEach(walk);
	}
	walk(root);
	return jobs;
}

function checkVariants(node, pathLabel, issues) {
	const at = `${pathLabel}${node.name}`;
	if (node.role !== 'asset') {
		issues.push(`${at}: only an "asset" node can carry variants (this one is "${node.role}").`);
		return;
	}
	if (!Array.isArray(node.variants)) {
		issues.push(`${at}: "variants" must be an array.`);
		return;
	}
	if (node.subRole === 'static-per-instance') {
		issues.push(`${at}: "variants" cannot be combined with subRole "static-per-instance" — that mode already cuts one image per instance, so the variant would be ignored. Drop the variants, or set subRole back to "static-asset".`);
	}
	const seenKeys = new Set();
	node.variants.forEach((v, i) => {
		const where = `${at}: variants[${i}]`;
		if (!v || typeof v !== 'object') { issues.push(`${where} is not an object.`); return; }
		if (typeof v.key !== 'string' || !v.key.trim()) {
			issues.push(`${where} needs a non-empty string "key" (the state name, e.g. "claimed").`);
		} else if (seenKeys.has(v.key)) {
			issues.push(`${where} duplicate key "${v.key}" — two variants would cut to the same file name.`);
		} else {
			seenKeys.add(v.key);
		}
		if (typeof v.layerId !== 'number') {
			issues.push(`${where} needs a numeric "layerId" (pick it from the list node's "instanceLayers").`);
		} else if (v.layerId === node.layerId) {
			issues.push(`${where} layerId ${v.layerId} is this node's own layer — a variant must point at a DIFFERENT instance's layer, otherwise it just re-cuts the same image under a second name.`);
		}
	});
}

function validatePlan(root) {
	const issues = [];
	function check(node, pathLabel) {
		if (node.role === 'asset' && !['static-asset', 'dynamic-image', 'static-per-instance'].includes(node.subRole)) {
			issues.push(`${pathLabel}${node.name}: invalid subRole "${node.subRole}"`);
		}
		if (node.role === 'asset' && node.subRole === 'static-per-instance' && !Array.isArray(node.layerIds)) {
			issues.push(`${pathLabel}${node.name}: subRole is "static-per-instance" but has no layerIds — this position was Analyzed as identical across all instances, so switching it to "Per-item" here can't cut per-instance images (Cutting now would silently reuse 1 shared image instead). Either re-run 🔍 Phân tích cấu trúc after the differing instance's group has enough structural difference for classifyList to detect it (name/size/text), or set this back to "Static" and accept 1 shared image.`);
		}
		if (node.role === 'text' && !['text', 'dynamic-text'].includes(node.subRole)) {
			issues.push(`${pathLabel}${node.name}: invalid subRole "${node.subRole}"`);
		}
		if (node.variants !== undefined) checkVariants(node, pathLabel, issues);
		if (node.children) node.children.forEach((c) => check(c, `${pathLabel}${node.name}/`));
		if (node.instanceTemplate) node.instanceTemplate.children.forEach((c) => check(c, `${pathLabel}${node.name}/tpl/`));
	}
	check(root, '');
	return issues;
}

module.exports = { planCutJobs, validatePlan };
