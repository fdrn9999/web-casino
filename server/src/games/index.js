import { BlackjackRunner } from './blackjack/BlackjackRunner.js'
import { RouletteRunner } from './roulette/RouletteRunner.js'
import { BaccaratRunner } from './baccarat/BaccaratRunner.js'
import { registerRunner } from './registry.js'
import { listTables, broadcastTables } from '../services/tables.js'

export const RUNNER_CLASSES = { blackjack: BlackjackRunner, roulette: RouletteRunner, baccarat: BaccaratRunner }

export function startRunner(db, io, table) {
  const RunnerClass = RUNNER_CLASSES[table.game]
  if (!RunnerClass) return null
  const nsp = io.of(`/${table.game}`)
  const row = db.prepare('SELECT * FROM tables WHERE id = ?').get(table.id)
  const runner = new RunnerClass({
    db,
    nsp,
    table: row,
    onSeatsChange: () => broadcastTables(db, io),
  })
  registerRunner(table.id, runner)
  runner.start()
  return runner
}

export function startAllOpenTables(db, io) {
  for (const table of listTables(db)) {
    if (table.status === 'open' && RUNNER_CLASSES[table.game]) startRunner(db, io, table)
  }
}
