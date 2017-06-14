'use strict'

const internals = {
  pools: {},
  driver: require('mysql2')
}

const injectConnectOptions = function (instance, sql) {
  instance.justStarted = false
  console.log('SET AUTOCOMMIT=0;')
  if (typeof sql === 'string') {
    sql = 'SET AUTOCOMMIT=0;' + sql
  } else {
    if (typeof sql.sql === 'string') {
      sql.sql = 'SET AUTOCOMMIT=0;' + sql.sql
    }
  }
}

class DBService {
  constructor (cfg, debug, options) {
    this.cfg = cfg
    this.justStarted = true
    options = options || {}
    this.cfg.connectionLimit = this.cfg.connectionLimit || 20
    this.db = this.cfg.database
    this.debug = debug
    if (!internals.pools[this.cfg.database]) {
      internals.pools[this.cfg.database] = internals.driver.createPool(this.cfg)
    }
    this.pools = internals.pools
    if (options.serviceConn) {
      let serviceCfg = Object.assign({}, this.cfg)
      delete serviceCfg.database
      let serviceConn = internals.driver.createConnection(serviceCfg)
      this.serviceConn = (sql) => {
        if (this.justStarted) {
          sql = injectConnectOptions(this, sql)
        }
        return new Promise((resolve, reject) => {
          serviceConn.query(sql, (err, result) => {
            err ? reject(err) : resolve(result)
          })
        })
      }
    }
    this.connCounter = 0
    return this
  }

  getPool () {
    return this.pools[this.db]
  }

  logTime (startTime, info) {
    this.debug && console.log(`${info} >>>>> execute in ${Date.now() - startTime}ms`)
  }

  getConn () {
    const me = this
    return new Promise(function (resolve, reject) {
      me.getPool().getConnection((err, conn) => {
        err ? reject(err, conn) : resolve(conn)
      })
    })
  }

  doConn (conn, opts) {
    const startTime = Date.now()
    let info = opts.values ? `DB.${this.cfg.database}.${opts.sql || opts} with values ${opts.values}` : `DB.${this.cfg.database}.${opts.sql || opts}`
    return new Promise(function (resolve, reject) {
      conn.query(opts, function (err, results, fields) {
        this.logTime(startTime, info)
        if (err) {
          return reject(err, conn)
        }
        return resolve(results, fields, conn)
      })
    })
  }

  do (opts) {
    const me = this
    const startTime = Date.now()
    let info = opts.values ? `DB.${this.cfg.database}.${opts.sql || opts} with values ${opts.values}` : `DB.${this.cfg.database}.${opts.sql || opts}`
    return new Promise(function (resolve, reject) {
      me.getPool().getConnection((err, conn) => {
        if (err) {
          if (conn && !opts.returnConnection) {
            conn.release()
          } else {
            console.error('connection wasn`t created')
          }
          this.logTime(startTime, info)
          return opts.returnConnection && conn ? reject(err, conn) : reject(err)
        } else {
          conn.query(opts, function (err, results, fields) {
            !opts.returnConnection && conn.release()
            this.logTime(startTime, info)
            if (err) {
              return opts.returnConnection && conn ? reject(err, conn) : reject(err)
            }
            return opts.returnConnection && conn ? resolve(results, fields, conn) : resolve(results, fields)
          })
        }
      })
    })
    // }
  }
}

module.exports = DBService
