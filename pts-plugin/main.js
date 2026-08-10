const { app, core, constants } = require('photoshop');
const fs = require('uxp').storage.localFileSystem;
const { deburr, toPascal, toSlug, fileSafe } = require('./textUtils');
const { planCutJobs, validatePlan } = require('./planCutJobs');
const { buildInstanceTemplate, rosterOf, detectLayout, median } = require('./classifyList');

let targetFolder = null;

const btnBrowse = document.getElementById('btnBrowse');
const projectPathInput = document.getElementById('projectPath');
const sectionNameInput = document.getElementById('sectionName');
const btnAnalyze = document.getElementById('btnAnalyze');
const statusLog = document.getElementById('statusLog');
const cntImages = document.getElementById('cntImages');
const cntText = document.getElementById('cntText');
const cntLayers = document.getElementById('cntLayers');

const reviewSection = document.getElementById('reviewSection');
const reviewList = document.getElementById('reviewList');
const reviewProgress = document.getElementById('reviewProgress');
const chkOnlyReview = document.getElementById('chkOnlyReview');
const chkSkipReview = document.getElementById('chkSkipReview');
const btnOpenPlan = document.getElementById('btnOpenPlan');
const btnReloadPlan = document.getElementById('btnReloadPlan');
const btnCut = document.getElementById('btnCut');
const cutBlockedReason = document.getElementById('cutBlockedReason');

let currentPlan = null;

function log(msg) {
	statusLog.innerText = msg;
}

function isGroup(layer) {
	try { return layer.kind === constants.LayerKind.GROUP; } catch (e) { return false; }
}
function isText(layer) {
	try { return layer.kind === constants.LayerKind.TEXT; } catch (e) { return false; }
}
function isContentKind(kind) {
	return kind === constants.LayerKind.NORMAL ||
		kind === constants.LayerKind.TEXT ||
		kind === constants.LayerKind.SMARTOBJECT ||
		kind === constants.LayerKind.SOLIDFILL ||
		kind === constants.LayerKind.GRADIENTFILL ||
		kind === constants.LayerKind.PATTERNFILL;
}
function unionRect(a, b) {
	if (!a) return b;
	if (!b) return a;
	const x = Math.min(a.x, b.x), y = Math.min(a.y, b.y);
	return {
		x, y,
		w: Math.max(a.x + a.w, b.x + b.w) - x,
		h: Math.max(a.y + a.h, b.y + b.h) - y
	};
}
function rectOf(layer) {
	const b = layer.bounds;
	return { x: b.left, y: b.top, w: b.right - b.left, h: b.bottom - b.top };
}
function boundsOf(layer) {
	if (!isGroup(layer)) return rectOf(layer);
	let acc = null;
	for (const child of Array.from(layer.layers)) {
		if (isGroup(child)) { acc = unionRect(acc, boundsOf(child)); continue; }
		let kind;
		try { kind = child.kind; } catch (e) { kind = null; }
		if (isContentKind(kind)) acc = unionRect(acc, boundsOf(child));
	}
	return acc || rectOf(layer);
}
function colorHex(color) {
	try {
		const c = color.rgb;
		const hex = (n) => Math.round(n).toString(16).padStart(2, '0');
		return `#${hex(c.red)}${hex(c.green)}${hex(c.blue)}`;
	} catch (e) { return undefined; }
}
async function ensureFolder(root, segments) {
	let current = root;
	for (const seg of segments) {
		try { current = await current.createFolder(seg); }
		catch (e) { current = await current.getEntry(seg); }
	}
	return current;
}

function findPathById(layers, id, prefix) {
	for (let i = 0; i < layers.length; i++) {
		const l = layers[i];
		const path = prefix.concat(i);
		if (l.id === id) return path;
		if (isGroup(l)) {
			const found = findPathById(l.layers, id, path);
			if (found) return found;
		}
	}
	return null;
}
function layerAtPath(doc, path) {
	let layers = doc.layers;
	let layer = null;
	for (const idx of path) {
		layer = layers[idx];
		layers = isGroup(layer) ? layer.layers : [];
	}
	return layer;
}
function setVisibleRecursive(layers, val) {
	for (const l of layers) {
		l.visible = val;
		if (isGroup(l)) setVisibleRecursive(l.layers, val);
	}
}
function showPath(doc, path) {
	let layers = doc.layers;
	for (const idx of path) {
		const l = layers[idx];
		l.visible = true;
		layers = isGroup(l) ? l.layers : [];
	}
}
function captureVisibleRecursive(layers, map) {
	for (const l of layers) {
		map.set(l.id, l.visible);
		if (isGroup(l)) captureVisibleRecursive(l.layers, map);
	}
}
function restoreVisibleRecursive(layers, map) {
	for (const l of layers) {
		l.visible = map.get(l.id) ?? true;
		if (isGroup(l)) restoreVisibleRecursive(l.layers, map);
	}
}
async function sliceOne(doc, path, file, opts = {}) {
	const { respectVisibility = false } = opts;
	await core.executeAsModal(async () => {
		const dup = await doc.duplicate();
		try {
			const originalVisibility = respectVisibility ? new Map() : null;
			if (originalVisibility) captureVisibleRecursive(dup.layers, originalVisibility);
			setVisibleRecursive(dup.layers, false);
			showPath(dup, path);
			const target = layerAtPath(dup, path);
			target.visible = true;
			const children = isGroup(target) ? target.layers : [];
			if (originalVisibility) restoreVisibleRecursive(children, originalVisibility);
			else setVisibleRecursive(children, true);
			try { await dup.trim(constants.TrimType.TRANSPARENT); } catch (e) {}
			await dup.saveAs.png(file, {}, true);
		} finally {
			await dup.closeWithoutSaving();
		}
	}, { commandName: 'Slice layer' });
}

function parseMarkers(rawName) {
	const markers = [];
	const clean = String(rawName).replace(/\[([^\]]+)\]/g, (_, m) => { markers.push(m.trim().toLowerCase()); return ''; }).trim();
	const out = { clean: clean || String(rawName), role: null, layout: null, bind: null };
	for (const m of markers) {
		if (m === 'img') out.role = 'asset';
		else if (m === 'cmp') out.role = 'component';
		else if (m === 'list') out.role = 'list';
		else if (m === 'row') { out.role = out.role || 'container'; out.layout = 'row'; }
		else if (m === 'col') { out.role = out.role || 'container'; out.layout = 'column'; }
		else if (m.startsWith('bind:')) out.bind = m.slice(5);
	}
	return out;
}

function structureSig(layer, depth) {
	if (isText(layer)) return 't';
	if (!isGroup(layer)) return 'i';
	if (depth <= 0) return 'g';
	const kids = Array.from(layer.layers).map((l) => structureSig(l, depth - 1)).sort();
	return `g(${kids.join(',')})`;
}
function isAutoList(layer) {
	if (!isGroup(layer)) return false;
	const kids = Array.from(layer.layers);
	const groups = kids.filter(isGroup);
	if (groups.length < 4) return false;
	if (groups.length < kids.length * 0.6) return false;
	const counts = {};
	groups.forEach((k) => { const s = structureSig(k, 2); counts[s] = (counts[s] || 0) + 1; });
	const dominant = Math.max.apply(null, Object.values(counts));
	return dominant >= Math.ceil(groups.length * 0.6);
}

function hasNestedList(layer) {
	if (!isGroup(layer)) return false;
	return Array.from(layer.layers).some((child) => isGroup(child) && (isAutoList(child) || hasNestedList(child)));
}

function describeLayer(layer) {
	const kind = isText(layer) ? 'text' : (isGroup(layer) ? 'group' : 'image');
	const m = parseMarkers(layer.name);
	const d = { kind, name: layer.name, layerId: layer.id, bounds: boundsOf(layer), marker: { role: m.role, bind: m.bind, layout: m.layout } };
	if (kind === 'text') { try { d.text = layer.textItem.contents; } catch (e) {} }
	if (kind === 'group') d.children = Array.from(layer.layers).map(describeLayer);
	return d;
}

function collectFields(layer, out) {
	if (isText(layer)) {
		const m = parseMarkers(layer.name);
		let val = '';
		try { val = layer.textItem.contents; } catch (e) {}
		out[m.bind || fileSafe(m.clean) || 'text'] = val;
		return;
	}
	if (isGroup(layer)) for (const c of layer.layers) collectFields(c, out);
}

let ctx = null;

function makeAsset(layer, path, clean) {
	ctx.counts.images += 1;
	return {
		role: 'asset',
		name: clean,
		type: isGroup(layer) ? 'group' : 'image',
		layerId: layer.id,
		subRole: 'static-asset',
		apiHint: null,
		needsReview: false,
		reviewReason: null,
		bounds: boundsOf(layer)
	};
}

function processNode(layer, path) {
	ctx.counts.total += 1;

	if (isText(layer)) {
		const m = parseMarkers(layer.name);
		ctx.counts.text += 1;
		const node = {
			role: 'text',
			name: m.clean,
			subRole: m.bind ? 'dynamic-text' : 'text',
			apiHint: m.bind || null,
			needsReview: false,
			reviewReason: null,
			bounds: boundsOf(layer)
		};
		try { node.text = layer.textItem.contents; } catch (e) {}
		try {
			const cs = layer.textItem.characterStyle;
			node.style = { fontSize: cs.size, color: colorHex(cs.color) };
		} catch (e) {}
		if (m.bind) node.bind = m.bind;
		return node;
	}

	const m = parseMarkers(layer.name);
	let role = m.role;
	if (!role && isAutoList(layer)) role = 'list';
	if (!role && hasNestedList(layer)) role = 'container';
	if (!role) role = 'asset';

	if (role === 'asset') return makeAsset(layer, path, m.clean);

	if (role === 'list') {
		const kids = Array.from(layer.layers);
		ctx.counts.images += kids.length;
		ctx.counts.total += kids.length;
		const instanceDescs = kids.map(describeLayer);
		const listBounds = boundsOf(layer);
		const instanceOffsets = instanceDescs.map((d) => ({ x: d.bounds.x - listBounds.x, y: d.bounds.y - listBounds.y }));
		const layout = m.layout
			? { direction: m.layout, gap: Math.round(median(instanceDescs.slice(1).map((it, i) => it.bounds.x - (instanceDescs[i].bounds.x + instanceDescs[i].bounds.w)))) || 0 }
			: detectLayout(instanceDescs.map((it) => it.bounds));
		const innerLayout = detectLayout((instanceDescs[0].children || []).map((c) => c.bounds));
		const instanceTemplate = buildInstanceTemplate(instanceDescs, innerLayout, ctx.policy);
		const instanceLayers = instanceDescs.map((d) => (d.children || []).map((c) => rosterOf(c, d.bounds.x, d.bounds.y)));
		return { role: 'list', name: m.clean, component: toPascal(m.clean), layout, bounds: listBounds, count: kids.length, instanceOffsets, instanceLayers, instanceTemplate };
	}

	const kids = Array.from(layer.layers);
	const children = kids.map((child, i) => processNode(child, path.concat(i)));
	const layout = m.layout ? { direction: m.layout, gap: 0 } : detectLayout(children.map((c) => c.bounds));
	return { role, name: m.clean, layout, bounds: boundsOf(layer), children };
}

function processRoot(layer, path) {
	const kids = Array.from(layer.layers);
	const children = kids.map((child, i) => processNode(child, path.concat(i)));
	return {
		role: 'container',
		name: parseMarkers(layer.name).clean,
		layout: detectLayout(children.map((c) => c.bounds)),
		bounds: boundsOf(layer),
		children
	};
}

function normalize(node, ox, oy) {
	if (node.bounds) { node.bounds.x -= ox; node.bounds.y -= oy; }
	if (node.children) node.children.forEach((c) => normalize(c, ox, oy));
	return node;
}

function updateSummary() {
	cntImages.innerText = ctx.counts.images;
	cntText.innerText = ctx.counts.text;
	cntLayers.innerText = ctx.counts.total;
}

btnBrowse.addEventListener('click', async () => {
	try {
		const folder = await fs.getFolder();
		if (folder) {
			targetFolder = folder;
			projectPathInput.value = folder.nativePath;
			log('Target folder: ' + folder.name);
		}
	} catch (err) {
		log('Folder selection cancelled.');
	}
});

let currentSlug = null;

btnAnalyze.addEventListener('click', async () => {
	if (!targetFolder) return log('Choose the target project folder (repo root) first!');

	const doc = app.activeDocument;
	if (!doc) return log('No document open!');

	const selection = doc.activeLayers;
	if (!selection || selection.length === 0) return log('Select 1 group/frame in the Layers panel!');

	const root = selection[0];
	if (!isGroup(root)) return log('Select a GROUP/frame (not a single layer).');

	const sectionName = sectionNameInput.value.trim() || toPascal(parseMarkers(root.name).clean);
	const slug = toSlug(sectionNameInput.value.trim() || parseMarkers(root.name).clean);
	const rootPath = findPathById(doc.layers, root.id, []);
	if (!rootPath) return log('Could not find the selected layer in the document.');

	currentSlug = slug;
	ctx = { counts: { images: 0, text: 0, total: 0 } };
	let varyingImagePolicy = 'api-slot';
	try {
		const cfgEntry = await targetFolder.getEntry('.pts-config.json');
		const cfg = JSON.parse(await cfgEntry.read());
		if (cfg && cfg.varyingImagePolicy) varyingImagePolicy = cfg.varyingImagePolicy;
	} catch (e) {}
	ctx.policy = varyingImagePolicy;

	try {
		const tree = processRoot(root, rootPath);
		const origin = { x: tree.bounds.x, y: tree.bounds.y };
		normalize(tree, origin.x, origin.y);
		updateSummary();

		const cacheFolder = await ensureFolder(targetFolder, ['.pts-cache', slug]);

		log('Exporting preview…');
		const previewFile = await cacheFolder.createFile('preview.png', { overwrite: true });
		await sliceOne(doc, rootPath, previewFile, { respectVisibility: true });

		const rawTree = {
			projectName: targetFolder.name,
			sectionName,
			slug,
			viewport: { width: tree.bounds.w, height: tree.bounds.h },
			source: { group: parseMarkers(root.name).clean },
			previewImage: `.pts-cache/${slug}/preview.png`,
			root: tree
		};

		const treeJson = JSON.stringify(rawTree, null, 2);
		const rawTreeFile = await cacheFolder.createFile('raw-tree.json', { overwrite: true });
		await rawTreeFile.write(treeJson);

		const planFile = await cacheFolder.createFile('plan.json', { overwrite: true });
		await planFile.write(treeJson);

		log(`Analysis done! ${ctx.counts.total} layers (${ctx.counts.images} images, ${ctx.counts.text} text). Review below, then click Cut.\n(Optional: "bun run gen-section --plan ${slug}" to let AI name props / resolve doubts, then click Reload.)`);
		await loadPlan();
	} catch (err) {
		log('Error: ' + err.message);
	}
});

async function loadPlan() {
	try {
		const cacheFolder = await ensureFolder(targetFolder, ['.pts-cache', currentSlug]);
		const planEntry = await cacheFolder.getEntry('plan.json');
		const text = await planEntry.read();
		currentPlan = JSON.parse(text);
		reviewSection.style.display = 'block';
		renderReviewList();
		log(`plan.json loaded: ${collectAnnotatedNodes(currentPlan.root).length} nodes.`);
	} catch (err) {
		log('No plan.json yet — click Analyze structure first.');
	}
}

btnReloadPlan.addEventListener('click', loadPlan);
chkOnlyReview.addEventListener('change', renderReviewList);
chkSkipReview.addEventListener('change', () => updateCutGate(collectAnnotatedNodes(currentPlan.root)));
btnOpenPlan.addEventListener('click', async () => {
	const cacheFolder = await ensureFolder(targetFolder, ['.pts-cache', currentSlug]);
	const planEntry = await cacheFolder.getEntry('plan.json');
	require('uxp').shell.openPath(planEntry.nativePath);
});

function collectAnnotatedNodes(root) {
	const out = [];
	function walk(node, trail, isTemplateChild) {
		if (node.role === 'asset' || node.role === 'text') out.push({ node, trail, isTemplateChild });
		if (node.children) node.children.forEach((c) => walk(c, trail.concat(node === root ? [] : node.name), false));
		if (node.instanceTemplate) {
			node.instanceTemplate.children.forEach((c) => walk(c, trail.concat(node.name), true));
		}
	}
	walk(root, [], false);
	return out;
}

function nodeNeedsReview(node) {
	return !!node.needsReview;
}

function buildAssetIndex(root) {
	const byLayerId = {};
	function walk(node) {
		if (node.role === 'asset') {
			if (node.subRole === 'static-per-instance' && Array.isArray(node.layerIds)) {
				node.images = node.images || new Array(node.layerIds.length).fill(null);
				node.layerIds.forEach((lid, i) => { byLayerId[lid] = { node, index: i }; });
			} else if (node.layerId != null) {
				byLayerId[node.layerId] = { node, index: null };
			}
			if (Array.isArray(node.variants)) {
				node.variants.forEach((v, i) => {
					if (v && v.layerId != null) byLayerId[v.layerId] = { node, index: null, variantIndex: i };
				});
			}
		}
		if (node.children) node.children.forEach(walk);
		if (node.instanceTemplate) node.instanceTemplate.children.forEach(walk);
	}
	walk(root);
	return byLayerId;
}

function updateCutGate(entries) {
	const total = entries.length;
	const pending = entries.filter((e) => nodeNeedsReview(e.node)).length;
	btnCut.disabled = pending > 0 && !chkSkipReview.checked;
	cutBlockedReason.innerText = pending > 0 ? `${pending} node(s) not yet reviewed.` : '';
	if (reviewProgress) {
		reviewProgress.textContent = `${total - pending} / ${total} reviewed`;
		reviewProgress.classList.toggle('is-done', pending === 0);
	}
}

function renderReviewList() {
	const entries = collectAnnotatedNodes(currentPlan.root);
	const visible = chkOnlyReview.checked ? entries.filter((e) => nodeNeedsReview(e.node)) : entries;
	reviewList.innerHTML = '';
	if (!visible.length) {
		const empty = document.createElement('div');
		empty.className = 'review-empty';
		empty.innerHTML = chkOnlyReview.checked
			? '<span class="review-empty__mark">✓</span><span>Nothing pending review.</span>'
			: '<span class="review-empty__mark">–</span><span>No asset/text nodes found.</span>';
		reviewList.appendChild(empty);
	} else {
		visible.forEach((entry) => reviewList.appendChild(renderCard(entry)));
	}
	updateCutGate(entries);
}

function subRoleOptions(entry) {
	if (entry.node.role === 'text') {
		return [{ value: 'text', label: 'Static' }, { value: 'dynamic-text', label: 'Dynamic' }];
	}
	const opts = [{ value: 'static-asset', label: 'Static' }, { value: 'dynamic-image', label: 'Dynamic' }];
	if (entry.isTemplateChild) opts.push({ value: 'static-per-instance', label: 'Per-item' });
	return opts;
}

function subRoleHint(node) {
	switch (node.subRole) {
		case 'static-asset': return 'cut once, shared';
		case 'text': return 'hardcoded label';
		case 'static-per-instance': return `cut all ${(node.layerIds || []).length || 'N'} — no API field`;
		default: return '';
	}
}

function renderCard(entry) {
	const { node, trail } = entry;
	const el = document.createElement('div');
	el.className = 'review-card' + (nodeNeedsReview(node) ? ' review-card--pending' : '');

	const main = document.createElement('div');
	main.className = 'review-card__main';

	const header = document.createElement('div');
	header.className = 'review-card__header';
	const idBox = document.createElement('div');
	idBox.className = 'review-card__id';
	if (trail.length) {
		const crumb = document.createElement('span');
		crumb.className = 'review-card__crumb';
		crumb.textContent = trail.join(' ▸ ');
		idBox.appendChild(crumb);
	}
	const titleEl = document.createElement('span');
	titleEl.className = 'review-card__title';
	titleEl.textContent = node.name;
	idBox.appendChild(titleEl);
	header.appendChild(idBox);

	const reviewedLabel = document.createElement('label');
	reviewedLabel.className = 'review-card__reviewed';
	const reviewedChk = document.createElement('input');
	reviewedChk.type = 'checkbox';
	reviewedChk.checked = !nodeNeedsReview(node);
	reviewedChk.addEventListener('change', () => {
		node.needsReview = !reviewedChk.checked;
		el.classList.toggle('review-card--pending', !reviewedChk.checked);
		updateCutGate(collectAnnotatedNodes(currentPlan.root));
	});
	reviewedLabel.appendChild(reviewedChk);
	const reviewedText = document.createElement('span');
	reviewedText.textContent = 'Reviewed';
	reviewedLabel.appendChild(reviewedText);
	header.appendChild(reviewedLabel);
	main.appendChild(header);

	if (node.reviewReason) {
		const reason = document.createElement('div');
		reason.className = 'review-card__reason';
		reason.textContent = node.reviewReason;
		main.appendChild(reason);
	}

	if (Array.isArray(node.variants) && node.variants.length) {
		const vars = document.createElement('div');
		vars.className = 'review-card__variants';
		vars.textContent = `+${node.variants.length} variant: ${node.variants.map((v) => v.key).join(', ')}`;
		main.appendChild(vars);
	}

	const controls = document.createElement('div');
	controls.className = 'review-card__controls';

	const seg = document.createElement('div');
	seg.className = 'segmented';
	const opts = subRoleOptions(entry);
	const buttons = opts.map((opt) => {
		const b = document.createElement('button');
		b.type = 'button';
		b.className = 'segmented__btn' + (node.subRole === opt.value ? ' segmented__btn--active' : '');
		b.textContent = opt.label;
		b.addEventListener('click', () => {
			node.subRole = opt.value;
			buttons.forEach((bb) => bb.classList.remove('segmented__btn--active'));
			b.classList.add('segmented__btn--active');
			syncApiField();
		});
		seg.appendChild(b);
		return b;
	});
	controls.appendChild(seg);

	const apiWrap = document.createElement('div');
	apiWrap.className = 'review-card__api';
	function syncApiField() {
		const isDynamic = node.subRole === 'dynamic-text' || node.subRole === 'dynamic-image';
		apiWrap.innerHTML = '';
		if (isDynamic) {
			const input = document.createElement('input');
			input.placeholder = 'API field (e.g. avatarUrl)';
			input.value = node.apiHint || '';
			input.addEventListener('input', () => { node.apiHint = input.value; });
			apiWrap.appendChild(input);
		} else {
			const hint = document.createElement('span');
			hint.className = 'review-card__hint';
			hint.textContent = subRoleHint(node);
			apiWrap.appendChild(hint);
		}
	}
	syncApiField();
	controls.appendChild(apiWrap);

	main.appendChild(controls);
	el.appendChild(main);
	return el;
}

btnCut.addEventListener('click', async () => {
	const doc = app.activeDocument;
	if (!doc) return log('No document open!');
	if (!currentPlan) return log('plan.json not loaded.');

	try {
		const issues = validatePlan(currentPlan.root);
		if (issues.length > 0) {
			log('plan.json is invalid:\n' + issues.join('\n'));
			return;
		}

		const jobs = planCutJobs(currentPlan.slug, currentPlan.root);
		const assetIndex = buildAssetIndex(currentPlan.root);
		const imagesFolder = await ensureFolder(targetFolder, ['public', 'images']);
		const skipped = [];

		for (let i = 0; i < jobs.length; i++) {
			const job = jobs[i];
			const layerPath = findPathById(doc.layers, job.layerId, []);
			if (!layerPath) {
				skipped.push(`${job.fileName} (layer id ${job.layerId} not found)`);
				continue;
			}
			log(`Cutting ${i + 1}/${jobs.length}: ${job.fileName}`);
			const file = await imagesFolder.createFile(job.fileName, { overwrite: true });
			await sliceOne(doc, layerPath, file);

			const target = assetIndex[job.layerId];
			if (target) {
				if (target.variantIndex != null) target.node.variants[target.variantIndex].image = job.fileName;
				else if (target.index == null) target.node.image = job.fileName;
				else target.node.images[target.index] = job.fileName;
			}
		}

		const cacheFolder = await ensureFolder(targetFolder, ['.pts-cache', currentPlan.slug]);
		const specFile = await cacheFolder.createFile('design-spec.json', { overwrite: true });
		await specFile.write(JSON.stringify(currentPlan, null, 2));

		const skipNote = skipped.length ? `\nSKIPPED ${skipped.length}:\n- ${skipped.join('\n- ')}` : '';
		log(`Done! ${jobs.length - skipped.length}/${jobs.length} images + design-spec.json.${skipNote}\nbun run gen-section .pts-cache/${currentPlan.slug}/design-spec.json`);
	} catch (err) {
		log('Error: ' + err.message);
	}
});
