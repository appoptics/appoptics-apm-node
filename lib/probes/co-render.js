'use strict'

const ao = require('..')
const conf = ao.probes['co-render']

module.exports = function (render) {
  return function (view, opts) {
    const ret = render(view, opts)

    return function* () {
      // Check if there is a trace to continue
      const last = ao.lastSpan;
      if (!last || !conf.enabled) {
        return yield ret
      }

      let span
      try {
        // Create co-render span
        span = last.descend('co-render', {
          TemplateFile: view,
          TemplateLanguage: opts.engine,

          // TODO: Disable for now. Maybe include behind config flag later.
          // Locals: JSON.stringify(options || {})
        })
      } catch (e) {
        ao.loggers.error('co-render failed to build span')
      }

      // Enter, run and exit
      if (span) span.enter()
      const res = yield ret
      if (span) span.exit()
      return res
    }
  }
}
