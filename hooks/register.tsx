import { atom, read, update } from 'claude-code'
import type { EngineInterface, Register, Timer } from 'claude-code'

import type { InboxMode, InboxTask } from '../types'

// Die Notizen liegen im Projekt der jeweiligen Session: <cwd>/.claude/INBOX.md
const REL_PATH = '.claude/INBOX.md'
const HEADER =
  '# Inbox\n\n' +
  'Notizen, die während der Arbeit anfallen. Offene Punkte (`- [ ]`) arbeitet\n' +
  'Claude ab (im Modus Auto selbständig, im Modus Manuell auf Knopfdruck) und\n' +
  'hakt sie danach ab (`- [x]`).\n\n'
// Im Auto-Modus wird nach der letzten Notiz kurz gewartet, damit mehrere
// Punkte, die schnell hintereinander kommen, gemeinsam übergeben werden.
const AUTO_DELAY_MS = 15000
// Markiert eine Aufgabe, die auf eine Antwort wartet; Auto übergibt sie nicht erneut.
const QUESTION_MARK = '— Rückfrage:'

const tasks = atom({ plugin: 'inbox', key: 'tasks' } as const, [], {
  shape: 'tasks-2',
})
const isOpen = atom({ plugin: 'inbox', key: 'isOpen' } as const, false)
const mode = atom({ plugin: 'inbox', key: 'mode' } as const, 'manual' as InboxMode)
const isBusy = atom({ plugin: 'inbox', key: 'isBusy' } as const, false)
// Zeile der Aufgabe, die gerade bearbeitet wird (null = keine)
const editLine = atom({ plugin: 'inbox', key: 'editLine' } as const, null as number | null)

const TASK_LINE = /^\s*[-*]\s+\[([ xX])\]\s+(.+?)\s*$/

function parse(text: string): InboxTask[] {
  const out: InboxTask[] = []
  text.split(/\r?\n/).forEach((line, i) => {
    const m = TASK_LINE.exec(line)
    if (m) out.push({ text: m[2] ?? '', isDone: m[1] !== ' ', line: i })
  })
  return out
}

function same(a: InboxTask[], b: InboxTask[]): boolean {
  return (
    a.length === b.length &&
    a.every((t, i) => t.text === b[i]?.text && t.isDone === b[i]?.isDone && t.line === b[i]?.line)
  )
}

let path = REL_PATH
// Aufgaben, die Claude in dieser Session schon übergeben wurden: verhindert,
// dass dieselbe Aufgabe im Auto-Modus endlos neu angestoßen wird.
const offered = new Set<string>()
let noteNonce = 0
let autoTimer: Timer | undefined

async function readFile($: EngineInterface): Promise<string> {
  try {
    return await $.fs.read(path)
  } catch {
    return ''
  }
}

async function refresh($: EngineInterface): Promise<InboxTask[]> {
  const fresh = parse(await readFile($))
  const old = await read($, tasks)
  if (!same(old, fresh)) await update($, tasks, () => fresh)
  return fresh
}

async function addTask($: EngineInterface, raw: string): Promise<boolean> {
  const lines = raw
    .split(/\r?\n/)
    .map(l => l.trim())
    .filter(l => l.length > 0)
  if (lines.length === 0) return false
  let text = await readFile($)
  if (text.trim() === '') text = HEADER
  if (!text.endsWith('\n')) text += '\n'
  for (const l of lines) text += `- [ ] ${l}\n`
  await $.fs.write(path, text)
  await refresh($)
  return true
}

// Ersetzt (text) oder löscht (null) die Aufgabe in Zeile `task.line`, sofern die
// Zeile noch dieselbe Aufgabe enthält (die Datei kann sich inzwischen geändert haben).
async function changeTask($: EngineInterface, task: InboxTask, text: string | null): Promise<boolean> {
  const content = await readFile($)
  const lines = content.split(/\r?\n/)
  const m = TASK_LINE.exec(lines[task.line] ?? '')
  if (!m || m[2] !== task.text) {
    await refresh($)
    $.ui.toast('📝 Die Datei hat sich geändert, bitte nochmal versuchen')
    return false
  }
  const clean = text === null ? '' : text.replace(/\s*\r?\n\s*/g, ' ').trim()
  if (clean === '') lines.splice(task.line, 1)
  else lines[task.line] = `- [${m[1]}] ${clean}`
  await $.fs.write(path, lines.join('\n'))
  offered.delete(task.text)
  await refresh($)
  return true
}

// Die n-te offene Aufgabe (1-basiert), wie sie im Eingabebereich nummeriert ist.
async function openTask($: EngineInterface, n: number): Promise<InboxTask | undefined> {
  return (await refresh($)).filter(t => !t.isDone)[n - 1]
}

// Übergibt offene Aufgaben an Claude. `all`: auch schon einmal übergebene
// (manueller Start); sonst nur neue (Auto-Modus).
async function handOver($: EngineInterface, all: boolean): Promise<number> {
  autoTimer?.cancel()
  autoTimer = undefined
  const open = (await refresh($)).filter(t => !t.isDone)
  // Auto übergibt nur Neues und nichts, was auf eine Antwort wartet (Rückfrage).
  const batch = all
    ? open
    : open.filter(t => !offered.has(t.text) && !t.text.includes(QUESTION_MARK))
  if (batch.length === 0) return 0
  for (const t of batch) offered.add(t.text)
  const list = batch.map(t => `- ${t.text}`).join('\n')
  void $.prompt.submit({
    text:
      `📝 Inbox: In \`${REL_PATH}\` stehen ${batch.length} offene Aufgabe(n):\n\n` +
      `${list}\n\n` +
      'Arbeite die ganze Liste ab:\n' +
      '- Gruppiere die Punkte nach Thema. Voneinander unabhängige Themen gib parallel an ' +
      'Subagenten (Agent-Tool) mit klarem Auftrag; Punkte, die dieselben Dateien betreffen, ' +
      'erledigst du selbst oder in einem gemeinsamen Agenten, damit sich nichts überschreibt.\n' +
      '- Hake jede erledigte Aufgabe direkt in der Datei ab (`- [ ]` → `- [x]`).\n' +
      `- Ist ein Punkt unklar, lass ihn offen, häng \` ${QUESTION_MARK} <Frage>\` an die Zeile an (solche Punkte startet der Auto-Modus nicht erneut) und ` +
      'fass am Ende zusammen, was erledigt ist und was offen blieb.',
  })
  $.ui.toast(`📝 ${batch.length} Inbox-Aufgabe(n) an Claude übergeben`)
  return batch.length
}

// Im Auto-Modus: übergeben, sobald Claude frei ist (nach kurzer Sammelpause).
async function scheduleAuto($: EngineInterface): Promise<void> {
  if ((await read($, mode)) !== 'auto') return
  autoTimer?.cancel()
  autoTimer = $.clock.after(AUTO_DELAY_MS, () => {
    autoTimer = undefined
    void (async () => {
      if ((await read($, mode)) === 'auto' && !(await read($, isBusy))) {
        await handOver($, false)
      }
    })()
  })
}

async function setMode($: EngineInterface, next: InboxMode): Promise<void> {
  await update($, mode, () => next)
  if (next === 'auto') {
    // Beim Umschalten auf Auto alles Offene übergeben, auch früher Notiertes.
    if (!(await read($, isBusy))) await handOver($, true)
    else offered.clear() // wird am Ende des laufenden Turns übergeben
  } else {
    autoTimer?.cancel()
    autoTimer = undefined
  }
}

export const register: Register = on => {
  on('session.start', async ($, e, next) => {
    const cwd = await $.session.cwd()
    path = `${cwd.replace(/[\\/]+$/, '')}/${REL_PATH}`
    await $.command.register({
      name: 'inbox',
      description:
        'Inbox: ohne Text Eingabefeld ein/aus · <Text> notieren · del <Nr> · edit <Nr> <Text> · run · auto / manuell',
    })
    await update($, isBusy, () => false)
    await refresh($)
    $.clock.every(3000, () => void refresh($))
    return next(e)
  })

  on('command.run', { command: 'inbox' }, async ($, e) => {
    const args = (e.args ?? '').trim()
    if (args === '') {
      const now = !(await read($, isOpen))
      await update($, isOpen, () => now)
      return { text: now ? 'Inbox-Eingabefeld geöffnet.' : 'Inbox-Eingabefeld geschlossen.' }
    }
    if (args === 'auto' || args === 'manuell' || args === 'manual') {
      await setMode($, args === 'auto' ? 'auto' : 'manual')
      return { text: `Inbox-Modus: ${args === 'auto' ? 'Auto' : 'Manuell'}.` }
    }
    const del = /^(?:del|lösch|loesch|rm)\s+(\d+)$/i.exec(args)
    if (del) {
      const task = await openTask($, Number(del[1]))
      if (!task) return { text: `Keine offene Aufgabe Nr. ${del[1]}.` }
      await changeTask($, task, null)
      return { text: `Gelöscht: ${task.text}` }
    }
    const edit = /^(?:edit|bearbeiten)\s+(\d+)\s+([\s\S]+)$/i.exec(args)
    if (edit) {
      const task = await openTask($, Number(edit[1]))
      if (!task) return { text: `Keine offene Aufgabe Nr. ${edit[1]}.` }
      await changeTask($, task, edit[2] ?? '')
      return { text: `Geändert: ${edit[2]}` }
    }
    if (args === 'run') {
      const n = await handOver($, true)
      return { text: n === 0 ? 'Keine offenen Inbox-Aufgaben.' : `${n} Inbox-Aufgabe(n) übergeben.` }
    }
    await addTask($, args)
    await scheduleAuto($)
    return { text: `Notiert in ${REL_PATH}: ${args}` }
  })

  on('turn.start', async ($, e, next) => {
    if (!e.agentId) await update($, isBusy, () => true)
    return next(e)
  })

  on('turn.complete', async ($, e, next) => {
    const result = await next(e)
    if (!e.agentId) {
      await update($, isBusy, () => false)
      if (e.reason === 'answer' && (await read($, mode)) === 'auto') {
        await handOver($, false)
      }
    }
    return result
  })

  on('ui.render', { component: 'AbovePrompt' }, async ($, e, next) => {
    if (e.props.hasSurvey) return next(e)

    const { Box, Button, Input, Text } = $.ui.resolve(e)
    const list = await read($, tasks)
    const open = list.filter(t => !t.isDone)
    const isEditing = await read($, isOpen)
    const current = await read($, mode)
    const busy = await read($, isBusy)
    const editing = await read($, editLine)
    const showRun = current === 'manual' && open.length > 0

    return (
      <Box flexDirection="column">
        <Box flexDirection="row" flexWrap="nowrap" columnGap={1}>
          <Text color={open.length > 0 ? 'yellow' : undefined} dimColor={open.length === 0}>
            📝 Inbox: {open.length} offen
          </Text>
          <Button
            key="toggle"
            label={isEditing ? 'Schließen' : 'Notiz +'}
            onPress={() => update($, isOpen, v => !v)}
          />
          <Button
            key="mode"
            label={current === 'auto' ? 'Modus: Auto' : 'Modus: Manuell'}
            onPress={() => setMode($, current === 'auto' ? 'manual' : 'auto')}
          />
          {showRun && (
            <Button key="run" label="▶ Abarbeiten" onPress={() => handOver($, true)} />
          )}
          {showRun && busy && <Text dimColor>(startet nach aktuellem Auftrag)</Text>}
        </Box>
        {isEditing && (
          <Box flexDirection="column">
            {open.map((t, i) =>
              editing === t.line ? (
                <Box flexDirection="row" columnGap={1}>
                  <Input
                    key={`edit-${t.line}`}
                    label={`${i + 1}. `}
                    value={t.text}
                    submitLabel="speichern"
                    autoFocus
                    onSubmit={async value => {
                      await changeTask($, t, value)
                      await update($, editLine, () => null)
                    }}
                  />
                  <Button key={`cancel-${t.line}`} label="Abbrechen" onPress={() => update($, editLine, () => null)} />
                </Box>
              ) : (
                <Box flexDirection="row" columnGap={1}>
                  <Text dimColor>
                    {'  '}
                    {i + 1}. ☐ {t.text}
                  </Text>
                  <Button key={`edit-btn-${t.line}`} label="✎" onPress={() => update($, editLine, () => t.line)} />
                  <Button key={`del-btn-${t.line}`} label="✕" onPress={() => changeTask($, t, null)} />
                </Box>
              ),
            )}
            {editing === null && (
              <Input
                key={`note-${noteNonce}`}
                label="› "
                placeholder="Neue Aufgabe notieren, Enter speichert…"
                submitLabel="notieren"
                autoFocus
                onSubmit={async value => {
                  if (await addTask($, value)) {
                    noteNonce += 1
                    $.ui.toast(`📝 Notiert: ${value.trim().split(/\r?\n/)[0]}`)
                    await scheduleAuto($)
                  }
                }}
              />
            )}
          </Box>
        )}
      </Box>
    )
  })
}
