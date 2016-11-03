'use strict';

const internals = {
}

function DB(cfg, debug){
  this.cfg = cfg;
  this.cfg.connectionLimit = this.cfg.connectionLimit || 20;
  this.debug = debug;
  var mysql = require('mysql');

  if(!internals.pool){
    internals.pool  = mysql.createPool(this.cfg);
  }

  this.pool = internals.pool;
  return this;
}



// module.exports.connection = DB;

DB.prototype.do = function (opts) {

    var me = this;

    if(opts.debug || this.debug){
      
      let info = opts.values ? `DB.${this.cfg.database}.${opts.sql || opts} with values ${opts.values}` : `DB.${this.cfg.database}.${opts.sql || opts}`
      console.time(info)

      return new Promise( function(resolve,reject){

        me.pool.getConnection( (err,conn) => {
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

        me.pool.getConnection( (err,conn) => {
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

}

DB.prototype.exec = function (opts,callback,scope) {

  var me = this;

  if(opts.debug || this.debug)console.log('DB.prototype.exec : sql : %s with values %s',opts.sql, opts.values)

  me.pool.getConnection( (err,conn) => {
    if(err){
      callback.call(scope,err,[])
      return
    }

    conn.query(opts,(err,results)=>{
      callback.call(scope,err,results)
    })

  })

}


module.exports = DB;
