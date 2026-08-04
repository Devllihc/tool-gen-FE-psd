export function buildFallbackPlan(rawTree) {
	function annotate(node) {
		if (node.role === 'asset') {
			return { subRole: 'static-asset', apiHint: null, needsReview: false, reviewReason: null, ...node };
		}
		if (node.role === 'text') {
			return { subRole: 'text', needsReview: false, reviewReason: null, ...node };
		}
		if (node.role === 'list' && node.instanceTemplate) {
			return { ...node, instanceTemplate: { ...node.instanceTemplate, children: node.instanceTemplate.children.map(annotate) } };
		}
		if (node.children) {
			return { ...node, children: node.children.map(annotate) };
		}
		return node;
	}

	return { ...rawTree, root: annotate(rawTree.root), tasks: rawTree.tasks || [] };
}
