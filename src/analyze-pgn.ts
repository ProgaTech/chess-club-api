import { analyze } from './analysis-engine'
import { parseFinishedPgn } from './analysis-game'

const [input, output] = Bun.argv.slice(2)
if (!input || !output) throw new Error('Usage: bun src/analyze-pgn.ts finished.pgn report.md')
const game = parseFinishedPgn(await Bun.file(input).text())
await Bun.write(output, await analyze(game))
console.log('Wrote ' + output)
