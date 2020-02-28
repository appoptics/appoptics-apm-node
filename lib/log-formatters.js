'use strict'
/**
 * Define AppOptics-specific formatters for debugging and logging.
 */

module.exports = function (d) {
  const ao = require('./')
  const format = require('util').format

  /**
   * format like console.log when replacing stdout, stderr
   */
  if (!process.stdout.isTTY || !process.stderr.isTTY) {
    d.formatters.s = s => format('%s', s)
    d.formatters.d = d => format('%d', d)
  }

  d.formatters.i = i => format('%i', i)
  d.formatters.f = f => format('%f', f)
  d.formatters.o = o => format('%o', o)
  d.formatters.O = o => format('%O', o)

  /**
   * Format an xtrace ID - could be a string or any object that
   * can return metadata.
   */
  d.formatters.x = xid => (xid ? humanID(xid) : '<no xtrace>')

  /**
   * Format metadata
   */
  d.formatters.m = md => {
    if (md instanceof ao.MB) {
      return md.toString(ao.MB.fmtHuman);
    }
    return String(md);
  }

  /**
   * Format a span. The letter is 'l' because spans used
   * to be called layers. and because 's' is used by strings.
   */
  d.formatters.l = span => {
    if (!span) {
      return '<none>'
    }
    const text = [span.name]
    Object.keys(span.events).forEach(n => {
      if (n === 'internal') return
      text.push(d.formatters.e(span.events[n]))
    })
    return text.join(' ')
  }

  /**
   * Format an event
   */
  d.formatters.e = event => {
    if (!event) {
      return '<undefined>'
    }

    if (event instanceof ao.Event) {
      return event.Layer + ':' + event.Label + ' ' + humanID(event.mb);
    }

    return '?:? ' + humanID(event)
  }

  /**
   * Format continuation-local-storage
   */
  d.formatters.c = cls => {
    const active = cls.active ? getContextLines(cls.active).join('\n ') : '<no active context>'
    const activeId = cls.active ? cls.active.id : '-'
    let previous = []

    for (let i = cls._set.length - 1; i >= 0; i--) {
      //previous.push(i + ':')
      if (cls._set[i]) {
        previous.push(`${i} (id: ${cls._set[i].id})`)
      }
      previous = previous.concat(getContextLines(cls._set[i]))
    }

    return `\nactive (id: ${activeId})\n ${active}\n${previous.join('\n')}`
  }

  /**
   * Format an X-Trace ID in easier to look at format.
   */
  function humanID (x) {
    // both events and metadata toString() return the metadata
    if (x instanceof ao.Event || x instanceof ao.MB) {
      return x.toString(ao.MB.fmtHuman);
    }

    if (typeof x === 'string' && x.length === 60) {
      x = x.toLowerCase()
      return x.slice(0, 2) + '-' + x.slice(2, 42) + '-' + x.slice(42, 58) + '-' + x.slice(-2)
    }

    // not sure what it is so do the best we can.
    return '?-?-?-?(' + String(x) + ')'
  }

  /**
   * format one CLS context.
   */
  function getContextLines (ctx) {
    const lines = []

    if (!ctx) {
      return ['null']
    }

    function hop (key) {
      return Object.prototype.hasOwnProperty.call(ctx, key)
    }

    const keys = Object.keys(ctx)

    let line = ''

    lines.push('keys: ' + keys.join(', '))
    lines.push(`${ctx._ns_name} id ${ctx.id}, xuc ${ctx._xuc} uc ${ctx._iuc}`)

    if (ctx.lastSpan) {
      let label = !hop('lastSpan') ? '\u2193lastSpan' : 'lastSpan'
      label += ctx.lastSpan.descended ? ' (descended):' : ':'
      lines.push(label)

      // get the object keys. the events might not be "entry" and "exit" so
      // loop through the keys ignoring "internal"
      const keys = Object.keys(ctx.lastSpan.events)
      //let keys = Object.getOwnPropertyNames(ctx.lastSpan.events)

      keys.forEach(k => {
        if (k === 'internal') return
        lines.push(d.formatters.e(ctx.lastSpan.events[k]))
      })
    }

    if (ctx.lastEvent) {
      lines.push(!hop('lastEvent') ? '\u2193lastEvent:' : 'lastEvent:')
      lines.push(d.formatters.e(ctx.lastEvent))
    }

    line = ''
    if (hop('tag')) {
      line = 'tag:' + ctx.tag + ' '
    }
    if (hop('rootMetadata')) {
      line += 'rootMetadata: ' + ctx.rootMetadata.toString(ao.MB.fmtHuman);
    }
    if (line) {
      lines.push(line)
    }

    return lines
  }
}
