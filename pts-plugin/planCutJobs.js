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
		const fileName = `${slug}__${uniqueName(fileSafe(node.name))}${suffix}.png`;
		jobs.push({ layerId: node.layerId, fileName, purpose: isDynamic ? 'demo' : 'static' });
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

function validatePlan(root) {
	const issues = [];
	function check(node, pathLabel) {
		if (node.role === 'asset' && !['static-asset', 'dynamic-image', 'static-per-instance'].includes(node.subRole)) {
			issues.push(`${pathLabel}${node.name}: invalid subRole "${node.subRole}"`);
		}
		if (node.role === 'text' && !['text', 'dynamic-text'].includes(node.subRole)) {
			issues.push(`${pathLabel}${node.name}: invalid subRole "${node.subRole}"`);
		}
		if (node.children) node.children.forEach((c) => check(c, `${pathLabel}${node.name}/`));
		if (node.instanceTemplate) node.instanceTemplate.children.forEach((c) => check(c, `${pathLabel}${node.name}/tpl/`));
	}
	check(root, '');
	return issues;
}

module.exports = { planCutJobs, validatePlan };
