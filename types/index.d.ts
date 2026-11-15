export type InboxTask = { text: string; isDone: boolean; line: number }
export type InboxMode = 'auto' | 'manual'

declare module 'claude-code' {
  interface PluginState {
    inbox: {
      tasks: Shaped<InboxTask[]>
      isOpen: boolean
      mode: InboxMode
      isBusy: boolean
      editLine: number | null
    }
  }
}
