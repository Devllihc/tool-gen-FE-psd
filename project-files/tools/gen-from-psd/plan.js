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

function hasClaudeCli() {
	const check = spawnSync('claude', ['--version'])
	return check.status === 0
}

function writeFallback() {
	const fallback = buildFallbackPlan(rawTree)
	fs.mkdirSync(cacheDir, { recursive: true })
	fs.writeFileSync(planPath, JSON.stringify(fallback, null, 2))
}

const prompt = `Read the file .claude/commands/gen-plan.md and follow it exactly, treating its $ARGUMENTS as: ${rawTreePath}`

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

console.log(`🤖 Delegating to /gen-plan for: ${rawTreePath}`)
console.log(`   Tip: for step-by-step control, run "/gen-plan ${slug}" inside a Claude Code session instead.\n`)
const result = spawnSync('claude', ['-p', prompt, '--permission-mode', 'acceptEdits'], { stdio: 'inherit', cwd: process.cwd() })

if (result.error || result.status !== 0 || !fs.existsSync(planPath)) {
	console.error('❌ Classification failed or did not write plan.json — falling back to all-static plan.json.')
	writeFallback()
}

console.log(`✅ plan.json ready: ${planPath}\n➡️ Mở lại panel Photoshop, bấm "✂️ Review & Cắt ảnh"`)
