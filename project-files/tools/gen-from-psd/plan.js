import fs from 'fs'
import path from 'path'
import { spawnSync } from 'child_process'
import { buildFallbackPlan } from './planFallback.js'

const rawArgs = process.argv.slice(2)
const dryRun = rawArgs.includes('--dry')
const slug = rawArgs.filter((a) => !a.startsWith('--'))[0]

if (!slug) {
	console.error('Usage: bun tools/gen-from-psd/plan.js <slug> [--dry]')
	process.exit(1)
}

const cacheDir = path.resolve(process.cwd(), '.pts-cache', slug)
const rawTreePath = path.join(cacheDir, 'raw-tree.json')
const planPath = path.join(cacheDir, 'plan.json')

if (!fs.existsSync(rawTreePath)) {
	console.error(`❌ raw-tree.json not found at: ${rawTreePath}`)
	console.error('   Run "🔍 Phân tích cấu trúc" in the Photoshop panel first.')
	process.exit(1)
}

const rawTree = JSON.parse(fs.readFileSync(rawTreePath, 'utf-8'))
const previewPath = path.resolve(process.cwd(), rawTree.previewImage)

function hasClaudeCli() {
	const check = spawnSync('claude', ['--version'])
	return check.status === 0
}

function writeFallback() {
	const fallback = buildFallbackPlan(rawTree)
	fs.mkdirSync(cacheDir, { recursive: true })
	fs.writeFileSync(planPath, JSON.stringify(fallback, null, 2))
}

const prompt = `You are classifying a UI design for section "${rawTree.sectionName}", already structurally extracted from Photoshop.

1. Read the preview image to see the design: ${previewPath}
2. Layer tree (raw-tree.json):
${JSON.stringify(rawTree, null, 2)}

TASK — refine, do not replace, the existing "role" tree. Add fields, then write the COMPLETE result (every existing field preserved unchanged — projectName, sectionName, slug, viewport, source, previewImage, and every layerId/bounds/name/text/style/bind/count/instanceTemplate in root — plus your additions) to exactly this path: ${planPath}

- The tree already carries a "subRole" on every "asset"/"text" node and on every "instanceTemplate.children" node, computed structurally from cross-instance variation. RESPECT it. Only change a node's subRole if its "needsReview" is true (the structural signal was ambiguous) or if it is obviously wrong against the preview image. Allowed subRole values for an "asset" node: "static-asset", "dynamic-image", "static-per-instance". "static-per-instance" = a per-instance-distinct fixed image; keep it unless the project treats such images as API data.
- For any node with "needsReview": true, decide its subRole ("static-asset"|"dynamic-image" for assets, "text"|"dynamic-text" for text), set "needsReview": false, and add a one-line "reviewReason" explaining the call.
- For every node whose final subRole is "dynamic-image"/"dynamic-text", suggest a short camelCase "apiHint" (e.g. "itemImg", "milestoneNo") when none is set. Never override an existing "bind"/"apiHint" that came from an explicit [bind:xxx] marker — that is ground truth.
- "list" nodes: walk "instanceTemplate.children" and apply the same rules per child. "container"/"component" nodes pass through unchanged, do not alter "layout".
- Heuristics: a field/image that visibly differs across list instances (different photo, different number) is very likely dynamic; a field/image identical across all instances (frame, icon, static label) is static; text that looks like sample/placeholder data is likely dynamic. When genuinely unsure, set "needsReview": true with a one-sentence "reviewReason" — never guess silently.
- Add a top-level "tasks": string[] — one short line per component/asset group (e.g. "PlayerRow: props { avatarUrl, score } — both dynamic, from list.instances").

Write the file with the Write tool. Do not print the JSON in your response — just write the file.`

if (dryRun) {
	console.log(prompt)
	process.exit(0)
}

if (!hasClaudeCli()) {
	console.log('⚠️  claude CLI not found on PATH — writing an all-static fallback plan.json (no smart classification).')
	writeFallback()
	console.log(`✅ Fallback plan.json written: ${planPath}`)
	process.exit(0)
}

console.log(`🤖 Asking Claude to classify "${rawTree.sectionName}"...\n`)
const result = spawnSync('claude', ['-p', prompt, '--permission-mode', 'acceptEdits'], { stdio: 'inherit', cwd: process.cwd() })

if (result.error || result.status !== 0 || !fs.existsSync(planPath)) {
	console.error('❌ Classification failed or did not write plan.json — falling back to all-static plan.json.')
	writeFallback()
}

console.log(`✅ plan.json ready: ${planPath}\n➡️ Mở lại panel Photoshop, bấm "✂️ Review & Cắt ảnh"`)
