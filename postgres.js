// Postgres extension for SQLBricks
(function() {
  "use strict";

  var sql, _;
  if (typeof exports != 'undefined') {
    sql = require('sql-bricks');
    _ = require('underscore');
  } else {
    sql = window.SqlBricks;
    _ = window._;
  }

  // We create this wrapper to not contaminate original sql namespace
  function pgsql(str) {
    if (!(this instanceof pgsql))
      return new pgsql(str);

    return sql.apply(this, arguments);
  }
  pgsql = sql.inherits(pgsql, sql);
  for (var p in sql) {
    if (sql.hasOwnProperty(p))
      pgsql[p] = sql[p];
  }


  function construct(constructor, args) {
      function F() {
          return constructor.apply(this, args);
      }
      F.prototype = constructor.prototype;
      return new F();
  }

  function makeSubclass(base) {
    var cls = function () {
      if (!(this instanceof cls))
        return construct(cls, arguments);

      base.apply(this, arguments);
    }

    var sub = sql.inherits(cls, base);
    sub.defineClause = base.defineClause;
    sub.prototype.clauses = base.prototype.clauses.slice();

    return sub;
  }

  var Select = pgsql.select = makeSubclass(sql.select);
  var Insert = pgsql.insert = makeSubclass(sql.insert);
  var Update = pgsql.update = makeSubclass(sql.update);
  var Delete = pgsql.delete = makeSubclass(sql.delete);

  Insert.prototype.returning =
    Update.prototype.returning =
    Delete.prototype.returning = function() {
      return this._addListArgs(arguments, '_returning');
    };

  Delete.prototype.using = function() {
    return this._addListArgs(arguments, '_using');
  };

  // NOTE: clauses - a separate obstacle for clean extensions
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

  // UPDATE ... FROM
  Update.prototype.from = function() {
    return this._addListArgs(arguments, '_from');
  };
  Update.defineClause('from', '{{#if _from}}FROM {{tables _from}}{{/if}}', {after: 'set'});

  // VALUES statement for SELECT/UPDATE/DELETE ... FROM VALUES
  function Values(_values) {
    if (!(this instanceof Values))
      return new Values(_values);

    Values.super_.call(this, 'values');
    this._values = _.isArray(_values) ? _values : [_values];
    return this;
  }
  pgsql.values = sql.inherits(Values, sql.Statement);
  Values.defineClause = Select.defineClause;

  Values.defineClause('values', function (opts) {
    var types = this._types;
    var handleRow = types === true ? function (row, opts) {
        return typedValues(_.values(row), opts)
      }
      : types ? function (row, opts) {
        return _.map(row, function (val, field) {
          return (sql._handleValue(val, opts)
                  + (types[field] ? '::' + types[field] : typeCoerce(val)));
        })
      }
      : function (row, opts) {
        return sql._handleValues(_.values(row), opts);
      }

    var values = this._values.map(function (row) {
      return '(' + handleRow(row, opts).join(', ') + ')';
    }).join(', ');

    return 'VALUES ' + values;
  });

  // Sometimes values need to be typed
  Values.prototype.types = function (types) {
    this._types = types || true;
    return this;
  }

  function typeCoerce(val) {
    if (typeof val === 'number') {
      return (val % 1 ===  0) ? '::int' : '::float';
    } else if (typeof val === 'boolean') {
      return '::bool';
    } else {
      return ''
    }
  }
  function typedValues(vals, opts) {
    return vals.map(function (val) {
      return sql._handleValue(val, opts) + typeCoerce(val);
    });
  }

  // VALUES alias and columns
  Values.prototype.columns = function () {
    this._columns = true;
    return this;
  }
  Values.prototype.as = Select.prototype.as;
  Values.prototype._toNestedString = Select.prototype._toNestedString;
  Values.prototype._aliasToString = function (opts) {
    if (!this._alias) return '';

    var alias = ' ' + sql._autoQuote(this._alias);
    if (this._columns) {
      alias += ' (' + sql._handleColumns(_.keys(this._values[0])) + ')';
    }
    return alias;
  }

  if (typeof exports != 'undefined')
    module.exports = pgsql;
  else
    window.PostgresBricks = pgsql;

})();


