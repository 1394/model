'use strict';

const mysql = require('mysql');

const internals = {
  pools: {}
}

const DB = function(cfg, debug){
  if(!cfg.databases || !cfg.databases.length){
    throw new Error('cant find databases in config!')
  }
  internals.default = cfg.default;
  internals.debug = debug;
  cfg.databases.forEach( dbCfg => {
    createPool( dbCfg, debug )
  })

  return internals
};

function createPool(cfg, debug){
  cfg.connectionLimit = cfg.connectionLimit || 20;
  let db = cfg.database;

  internals.pools[db]  = mysql.createPool(cfg);

  internals.pools[db].connCounter = 0;

  internals.pools[db].on('connection', function (connection) {
    internals.pools[db].connCounter = internals.pools[db]._connectionQueue.length;
  }.bind(this))
}

internals.getPool = function getPool(db){
  return this.pools[db] || this.pools[this.default]
}.bind(internals)



// module.exports.connection = DB;

internals.do = function ( opts, db) {

    var me = this;

    if(me.debug){
      
      let info = opts.values ? `DB.${this.cfg.database}.${opts.sql || opts} with values ${opts.values}` : `DB.${this.cfg.database}.${opts.sql || opts}`
      console.time(info)

      return new Promise( function(resolve,reject){

        me.getPool( db ).getConnection( (err,conn) => {
          if(err){
            reject(err);
            return;
          }
          conn.query(opts,function(err,results,fields){
            console.timeEnd(info)
            if(err){
              reject(err)
            }
            conn.release();
            resolve(results,fields)
          })

        })

      })
      // .then( function(result){console.timeEnd(info);return result})
      

    }else{

      return new Promise( function(resolve,reject){

        me.getPool( db ).getConnection( (err,conn) => {
          if(err){
            reject(err);
            return;
          }
          conn.query(opts,function(err,results,fields){
            conn.release();
            err ? reject(err) : resolve(results,fields)
          })

        })

        // me.conn.query(opts,function(err,results,fields){
        //   err ? reject(err) : resolve(results,fields)
        // })

      })

    }

}.bind(internals)

internals.exec = function ( db, opts,callback,scope) {

  var me = this;

  if(me.debug)console.log('DB.prototype.exec : sql : %s with values %s',opts.sql, opts.values)

  me.getPool( db ).getConnection( (err,conn) => {
    if(err){
      callback.call(scope,err,[])
      return
    }

    conn.query(opts,(err,results)=>{
      callback.call(scope,err,results)
    })

  })

}.bind(internals)


module.exports = DB;
