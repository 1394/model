const locals = {}

class Query {
  constructor (delim = '`', query) {
    this.delim = delim
    if (query instanceof Query) {
      this.chain = query.chain
    } else {
      this.chain = new Map()
    }
    this.chain._push = (k, v) => {
      const arr = this.chain.get(k) || []
      if (Array.isArray(arr)) {
        arr.push(v)
        this.chain.set(k, arr)
      }
    }
  }

  wrap(s) {
    if (!s.includes(this.delim)) {
      return `${this.delim}${s}${this.delim}`
    } else {
      return s
    }
  }

  wrapDot(s) {
    if (!s.includes(this.delim)) {
      return s.includes('.') ? s.split('.').map(el => this.wrap(el)).join('.') : this.wrap(s)
    } else {
      return s
    }
  }

  _set (k, v) {
    if (typeof k !== 'string' && !v) {
      this.chain.set(...(Object.entries(k)[0]))
    } else {
      this.chain.set(k, v)
    }
  }

  _get (k) {
    return this.chain.get(k)
  }

  isMode(mode) {
    return this._get('mode') === mode
  }

  setMode (mode) {
    this.chain.set('mode', mode)
  }

  reset() {
    this.chain.clear()
  }

  select () {
    this.reset()
    this.setMode('select')
    return this
  }

  from (name, fields) {
    if (this.isMode('insert')) {
      throw new Error('cant run [from] in :insert mode')
    }
    this.chain.set('table', name)
    return this
  }

  into (name, fields) {
    if (this.isMode('select')) {
      throw new Error('cant run into in :select mode')
    }
    this.chain.set('table', name)
    return this
  }

  field (f) {
    if (!this.isMode('select')) {
      throw new Error('cant run field[s] not in :select mode')
    }
    this.chain._push('fields', f)
    return this
  }

  fields (fields) {
    const f = this.chain.get('fields')
    this.chain.set('fields', f.concat(fields))
    return this
  }

  update () {
    this.reset()
    this.setMode('update')
    return this
  }

  insert () {
    this.reset()
    this.setMode('insert')
    return this
  }

  delete () {
    this.reset()
    this.setMode('delete')
    return this
  }

  limit (limit) {
    this._set({limit})
    return this
  }

  offset (offset) {
    this._set({offset})
    return this
  }

  join(table, alias, where, mode) {
    this.chain.push('join', {table, alias, where, mode})
    return this
  }

  distinct(distinct) {
    this._set({distinct})
    return this
  }

  set (k, v) {
    const fields = this.chain.get('setFields')
    fields[k] = v
    this.chain.set('setFields', fields)
    return this
  }

  setFields (fields) {
    if (this.isMode('select')) {
      throw new Error('cant run setFields in :select mode')
    }
    this._set({setFields: fields})
    return this
  }

  order (field, dir) {
    if (typeof(dir) === 'boolean') {
      dir = dir ? 'ASC' : 'DESC'
    } else {
      if (field.includes(' ')) {
        const [a, b] = field.split(' ')
        field = this.wrapDot(a)
        dir = ['ASC', 'asc'].includes(b) ? 'ASC' : 'DESC'
      } else {
        dir = 'ASC'
      }
    }
    this.chain._push('order', `${this.wrapDot(field)} ${dir}`)
    return this
  }

  group (by) {
    this._set('group', by)
    return this
  }

  having (by) {
    this._set('having', by)
    return this
  }

  where (where, vals) {
    if (where.includes('?')) {
      where = [where, vals]
    }
    this.chain._push('where', where)
    return this
  }

  _whereJoin() {
    let where = this._get('where')
    const vals = []
    where = where.map((el) => {
      if (Array.isArray(el)) {
        Array.isArray(el[1]) && el[1].length && (vals.push(el[1]))
        return el[0]
      }
    }).join(' AND ')
    return [where, vals]
  }

  _doSelect() {
    const me = this
    const r = ['SELECT']
    const fields = this._get('fields') || [`${this._get('table')}.*`]
    fields && r.push(fields.map(el => me.wrapDot(el)).join(','))
    r.push(`FROM ${this.wrapDot(this._get('table'))}`)
    if (this._get('where')) {
      const [where, vals] = this._whereJoin()
      this.chain.set('values', vals)
      r.push(where)
    }
    this._get('group') && r.push('GROUP BY ' + this._get('group').join(', '))
    this._get('having') && r.push('HAVING ' + this._get('having').join(' AND '))
    this._get('order') && r.push('ORDER BY ' + this._get('order').join(', '))
    this._get('limit') && r.push(`LIMIT ${this._get('limit')}`)
    this._get('offset') && r.push(`OFFSET ${this._get('offset')}`)
    return {sql: r.join(' '), values: this._get('values')}
  }

  evalChain() {
    const mode = this._get('mode')
    if (mode === 'select') {
      return this._doSelect()
    }
  }

  // from / where / select / group / having / order / limit
  toParam () {
    // todo
  }

  toString () {
    // todo
  }

  clone () {
    return new Query(this.delim, this)
  }

}

module.exports = Query
