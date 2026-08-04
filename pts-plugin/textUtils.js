function deburr(name) {
	return String(name).normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/đ/g, 'd').replace(/Đ/g, 'D');
}
function toPascal(name) {
	return deburr(name).replace(/[^a-zA-Z0-9]+/g, ' ').trim().split(/\s+/)
		.map((w) => w.charAt(0).toUpperCase() + w.slice(1).toLowerCase()).join('') || 'Component';
}
function toSlug(name) {
	return deburr(name).toLowerCase().replace(/[^a-z0-9]+/g, '') || 'section';
}
function fileSafe(name) {
	return deburr(name).toLowerCase().replace(/[^a-z0-9_-]+/g, '_').replace(/^_+|_+$/g, '') || 'layer';
}

module.exports = { deburr, toPascal, toSlug, fileSafe };
