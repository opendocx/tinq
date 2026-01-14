export const recurseLimit = 20

export class RecursionError extends Error {
  constructor (message) {
    if (!message) {
      message = `Runaway recursion?  Recurse count exceeds ${recurseLimit}.`
    }
    super(message)
    this.name = 'RecursionError'
    this.frames = []
  }
}
