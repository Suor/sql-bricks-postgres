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
  var pgsql = sql._extension();

  var Select = pgsql.select;
  var Insert = pgsql.insert;
  var Update = pgsql.update;
  var Delete = pgsql.delete;

  Insert.prototype.returning =
    Update.prototype.returning =
    Delete.prototype.returning = function() {
      return this._addListArgs(arguments, '_returning');
    };

  Insert.prototype.select = function select() {
    var select = Insert.super_.prototype.select.apply(this, arguments);
    select.returning = this.returning.bind(this);
    return select;
  };

  Delete.prototype.using = function() {
    return this._addListArgs(arguments, '_using');
  };

  // NOTE: clauses - a separate obstacle for clean extensions
  var returning_render_fn = function(opts) {
    if (this._returning)
      return `RETURNING ${sql._handleColumns(this._returning, opts)}`;
  };
  Insert.defineClause('returning', returning_render_fn, {after: 'values'});
  Update.defineClause('returning', returning_render_fn, {after: 'where'});
  Delete.defineClause('returning', returning_render_fn, {after: 'where'});

  Delete.defineClause('using', function(opts) { if (this._using) return `USING ${sql._handleTables(this._using, opts)}`; }, {after: 'delete'});

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
    function(opts) { if (this._limit != null) return `LIMIT ${this._limit}`; },
    {after: 'orderBy'}
  );

  Select.defineClause(
    'offset',
    function(opts) { if (this._offset != null) return `OFFSET ${this._offset}`; },
    {after: 'limit'}
  );

  // UPDATE ... FROM
  Update.prototype.from = function() {
    return this._addListArgs(arguments, '_from');
  };
  Update.defineClause('from', function(opts) { if (this._from) return `FROM ${sql._handleTables(this._from, opts)}`; }, {after: 'set'});

  // ilike
  // --------------------------------------------------------
  pgsql.ilike = function (col, val, escape_char) {
    return new ILike(col, val, escape_char);
  };

  var ILike = sql.inherits(function ILike(col, val, escape_char) {
    this.col = col;
    this.val = val;
    this.escape_char = escape_char;
  }, sql.like("", "").constructor);


  ILike.prototype.clone = function clone() {
    return new ILike(this.col, this.val, this.escape_char);
  };

  ILike.prototype.toString = function(opts) {
    var exp = sql._handleColumn(this.col, opts) + ' ILIKE ' + sql._handleValue(this.val, opts);
    if (this.escape_char)
      exp += " ESCAPE '" + this.escape_char + "'";
    return exp;
  };

  // ON CONFLICT ... DO NOTHING / DO UPDATE SET ...
  Insert.prototype.onConflict = function () {
    this._addListArgs(arguments, '_onConflict');
    this.where = this.and = function() {
      return this._addExpression(arguments, '_onConflictWhere');
    }
    this.onConstraint = function(name) {
      this._onConstraint = name;
      return this;
    }
    return this;
  }

  Insert.prototype.doNothing = function () {
    this._doNothing = true;
    return this;
  }

  Insert.prototype.doUpdate = function (cols) {
    this._doUpdate = cols || true;
    this.where = this.and = function () {
      return this._addExpression(arguments, '_doUpdateWhere');
    }
    this.set = this.and = function() {
      return this._addExpression(arguments, '_doUpdateSet');
    }
    return this;
  }

  Insert.defineClause(
    'onConflict',
    function(opts) {
      if (this._onConflict != null)
        return `ON CONFLICT${!_.isEmpty(this._onConflict) ? ` (${sql._handleColumns(this._onConflict, opts)})` : ''}${this._onConflictWhere ? ` WHERE ${sql._handleExpression(this._onConflictWhere, opts)}` : ''}`; },
    {after: 'values'}
  );
  Insert.defineClause('onConstraint', function(opts) { if (this._onConstraint) return `ON CONSTRAINT ${this._onConstraint}`; },
    {after: 'onConflict'});
  Insert.defineClause(
    'doUpdateSet',
    function (opts) { if (this._doUpdateSet) return `DO UPDATE SET ${sql._handleExpression(this._doUpdateSet, opts)}`; },
    {after: 'onConstraint'}
  );
  Insert.defineClause('doNothing', function(opts) { if (this._doNothing) return `DO NOTHING`; }, {after: 'onConstraint'});
  Insert.defineClause('doUpdate', function(opts) {
      if(this._doUpdateSet) return;
      if(!this._doUpdate) return;

      var columns = this._doUpdate;
      if (this._doUpdate === true) columns = _.keys(this._values[0]);

      return 'DO UPDATE SET ' + columns.map(function(col) {
        var col = sql._handleColumn(col, opts);
        return col + ' = EXCLUDED.' + col;
      }).join(', ');
    }, {after: 'doUpdateSet'}
  );
  Insert.defineClause(
    'doUpdateWhere',
    function (opts) { if (this._doUpdateWhere) return `WHERE ${sql._handleExpression(this._doUpdateWhere, opts)}`; },
    {after: 'doUpdate'}
  );

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

  // Convert objects to JSON
  // HACK: we are pollluting sql namespace here, but currently there is no way around,
  //       see https://github.com/CSNW/sql-bricks/issues/62
  var _convert = sql.convert;
  sql.convert = function (val) {
    // support pg types if available. this handles types like interval.
    if (val && typeof val.toPostgres === 'function') {
        val = val.toPostgres();
    }
    if (_.isObject(val) && !_.isArray(val) && !_.isArguments(val))
      return _convert(JSON.stringify(val));

    return _convert(val);
  }

  // HACK: changing sql._reserved globally, will alter behaviour of sql-bricks
  sql._reserved.binary = 'binary';

  // Use SQL-99 syntax for arrays since it's easier to implement
  sql.conversions.Array = function(arr) {
    return 'ARRAY[' + arr.map(sql.convert).join(', ') + ']';
  };

  if (typeof exports != 'undefined')
    module.exports = pgsql;
  else
    window.PostgresBricks = pgsql;

})();
