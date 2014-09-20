// Postgres extension for SQLBricks
(function() {
  "use strict";

  var sql;
  if (typeof exports != 'undefined')
    sql = require('sql-bricks');
  else
    sql = window.SqlBricks;

  var Select = sql.select;
  var Insert = sql.insert;
  var Update = sql.update;
  var Delete = sql.delete;

  Insert.prototype.returning = 
    Update.prototype.returning = 
    Delete.prototype.returning = function() {
      return this._addListArgs(arguments, '_returning');
    };
  
  Delete.prototype.using = function() {
    return this._addListArgs(arguments, '_using');
  };

  var returning_tmpl = '{{#if _returning}}RETURNING {{columns _returning}}{{/if}}';
  Insert.defineClause('returning', returning_tmpl, {after: 'values'});
  Update.defineClause('returning', returning_tmpl, {after: 'where'});
  Delete.defineClause('returning', returning_tmpl, {after: 'where'});
  
  Delete.defineClause('using', '{{#if _using}}USING {{tables _using}}{{/if}}', {after: 'delete'});

  // TODO: shouldn't LIMIT/OFFSET use handleValue()? Otherwise isn't it vulnerable to SQL Injection?
  Select.prototype.limit = function(val) {
    this._limit = val;
    return this;
  };
  Select.prototype.offset = function(val) {
    this._offset = val;
    return this;
  };

  Select.defineClause(
    'limit',
    '{{#ifNotNull _limit}}LIMIT {{_limit}}{{/ifNotNull}}',
    {after: 'orderBy'}
  );

  Select.defineClause(
    'offset',
    '{{#ifNotNull _offset}}OFFSET {{_offset}}{{/ifNotNull}}',
    {after: 'limit'}
  );


  if (typeof exports != 'undefined')
    module.exports = sql;
  else
    window.PostgresBricks = sql;

})();
