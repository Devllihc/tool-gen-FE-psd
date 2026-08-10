import fs from 'fs'
import path from 'path'
import { spawnSync } from 'child_process'
import { fileURLToPath } from 'url'

const rawArgs = process.argv.slice(2)
const dryRun = rawArgs.includes('--dry')
const positional = rawArgs.filter((a) => !a.startsWith('--'))

const __dirname = path.dirname(fileURLToPath(import.meta.url))

if (rawArgs.includes('--plan')) {
	const planArgs = positional.concat(dryRun ? ['--dry'] : [])
	const result = spawnSync('bun', [path.join(__dirname, 'plan.js'), ...planArgs], { stdio: 'inherit', cwd: process.cwd() })
	process.exit(result.status ?? 0)
}

const specArg = positional[0] || 'design-spec.json'
const specPath = fs.existsSync(path.resolve(process.cwd(), specArg))
	? specArg
	: `.pts-cache/${specArg}/design-spec.json`

if (!fs.existsSync(path.resolve(process.cwd(), specPath))) {
	console.error(`❌ Spec file not found at: ${specPath}`)
	console.error('   Run the Photoshop UXP plugin (Analyze → Cut) first, or pass a valid slug/path.')
	process.exit(1)
}

const prompt = `Read the file .claude/commands/gen-section.md and follow it exactly, treating its $ARGUMENTS as: ${specPath}`

if (dryRun) {
	console.log(prompt)
	process.exit(0)
}

console.log(`🤖 Delegating to /gen-section for: ${specPath}`)
console.log(`   Tip: for step-by-step control, run "/gen-section ${specArg}" inside a Claude Code session instead.\n`)
const result = spawnSync('claude', ['-p', prompt, '--permission-mode', 'acceptEdits'], { stdio: 'inherit', cwd: process.cwd() })

if (result.error) {
	console.error(`\n❌ Failed to run "claude": ${result.error.message}`)
	console.error('   Is the Claude Code CLI on PATH? Prefer running "/gen-section" inside a Claude Code session.')
	process.exit(1)
}

process.exit(result.status ?? 0)
