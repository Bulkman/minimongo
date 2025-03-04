var $, Collection, RemoteDb, async, jQueryHttpClient, quickfind, utils, _;

_ = require('lodash');

$ = require('jquery');

async = require('async');

utils = require('./utils');

jQueryHttpClient = require('./jQueryHttpClient');

quickfind = require('./quickfind');

module.exports = RemoteDb = (function() {
  function RemoteDb(url, client, httpClient, useQuickFind, usePostFind) {
    if (useQuickFind == null) {
      useQuickFind = false;
    }
    if (usePostFind == null) {
      usePostFind = false;
    }
    this.url = url;
    this.client = client;
    this.collections = {};
    this.httpClient = httpClient;
    this.useQuickFind = useQuickFind;
    this.usePostFind = usePostFind;
  }

  RemoteDb.prototype.addCollection = function(name, options, success, error) {
    var collection, url, usePostFind, useQuickFind, _ref;
    if (options == null) {
      options = {};
    }
    if (_.isFunction(options)) {
      _ref = [{}, options, success], options = _ref[0], success = _ref[1], error = _ref[2];
    }
    if (options.url) {
      url = options.url;
    } else {
      if (_.isArray(this.url)) {
        url = _.map(this.url, function(url) {
          return url + name;
        });
      } else {
        url = this.url + name;
      }
    }
    useQuickFind = this.useQuickFind;
    if (options.useQuickFind != null) {
      useQuickFind = options.useQuickFind;
    }
    usePostFind = this.usePostFind;
    if (options.usePostFind != null) {
      usePostFind = options.usePostFind;
    }
    collection = new Collection(name, url, this.client, this.httpClient, useQuickFind, usePostFind);
    this[name] = collection;
    this.collections[name] = collection;
    if (success != null) {
      return success();
    }
  };

  RemoteDb.prototype.removeCollection = function(name, success, error) {
    delete this[name];
    delete this.collections[name];
    if (success != null) {
      return success();
    }
  };

  RemoteDb.prototype.getCollectionNames = function() {
    return _.keys(this.collections);
  };

  return RemoteDb;

})();

Collection = (function() {
  function Collection(name, url, client, httpClient, useQuickFind, usePostFind) {
    this.name = name;
    this.url = url;
    this.client = client;
    this.httpClient = httpClient || jQueryHttpClient;
    this.useQuickFind = useQuickFind;
    this.usePostFind = usePostFind;
  }

  Collection.prototype.getUrl = function() {
    var url;
    if (_.isArray(this.url)) {
      url = this.url.pop();
      this.url.unshift(url);
      return url;
    }
    return this.url;
  };

  Collection.prototype.find = function(selector, options) {
    if (options == null) {
      options = {};
    }
    return {
      fetch: (function(_this) {
        return function(success, error) {
          var body, method, params;
          if (_this.useQuickFind && options.localData && (!options.fields || options.fields._rev) && !(options.limit && !options.sort && !options.orderByExprs)) {
            method = "quickfind";
          } else if (_this.usePostFind && JSON.stringify({
            selector: selector,
            sort: options.sort,
            fields: options.fields
          }).length > 500) {
            method = "post";
          } else {
            method = "get";
          }
          if (method === "get") {
            params = {};
            params.selector = JSON.stringify(selector || {});
            if (options.sort) {
              params.sort = JSON.stringify(options.sort);
            }
            if (options.limit != null) {
              params.limit = options.limit;
            }
            if (options.skip != null) {
              params.skip = options.skip;
            }
            if (options.fields) {
              params.fields = JSON.stringify(options.fields);
            }
            if (options.whereExpr) {
              params.whereExpr = JSON.stringify(options.whereExpr);
            }
            if (options.orderByExprs) {
              params.orderByExprs = JSON.stringify(options.orderByExprs);
            }
            if (_this.client) {
              params.client = _this.client;
            }
            if ((typeof navigator !== "undefined" && navigator !== null) && navigator.userAgent.toLowerCase().indexOf('android 2.3') !== -1) {
              params._ = new Date().getTime();
            }
            _this.httpClient("GET", _this.getUrl(), params, null, success, error);
            return;
          }
          body = {
            selector: selector || {}
          };
          if (options.sort) {
            body.sort = options.sort;
          }
          if (options.limit != null) {
            body.limit = options.limit;
          }
          if (options.skip != null) {
            body.skip = options.skip;
          }
          if (options.fields) {
            body.fields = options.fields;
          }
          if (options.whereExpr) {
            body.whereExpr = options.whereExpr;
          }
          if (options.orderByExprs) {
            body.orderByExprs = options.orderByExprs;
          }
          params = {};
          if (_this.client) {
            params.client = _this.client;
          }
          if (method === "quickfind") {
            body.quickfind = quickfind.encodeRequest(options.localData);
            _this.httpClient("POST", _this.getUrl() + "/quickfind", params, body, function(encodedResponse, count) {
              return success(quickfind.decodeResponse(encodedResponse, options.localData, options.sort), count);
            }, error);
            return;
          }
          return _this.httpClient("POST", _this.getUrl() + "/find", params, body, function(encodedResponse, count) {
            return success(quickfind.decodeResponse(encodedResponse, options.localData, options.sort), count);
          }, error);
        };
      })(this)
    };
  };

  Collection.prototype.findOne = function(selector, options, success, error) {
    var params, _ref;
    if (options == null) {
      options = {};
    }
    if (_.isFunction(options)) {
      _ref = [{}, options, success], options = _ref[0], success = _ref[1], error = _ref[2];
    }
    params = {};
    if (options.sort) {
      params.sort = JSON.stringify(options.sort);
    }
    params.limit = 1;
    if (this.client) {
      params.client = this.client;
    }
    params.selector = JSON.stringify(selector || {});
    if ((typeof navigator !== "undefined" && navigator !== null) && navigator.userAgent.toLowerCase().indexOf('android 2.3') !== -1) {
      params._ = new Date().getTime();
    }
    return this.httpClient("GET", this.getUrl(), params, null, function(results, count) {
      if (results && results.length > 0) {
        return success(results[0], count);
      } else {
        return success(null);
      }
    }, error);
  };

  Collection.prototype.upsert = function(docs, bases, success, error) {
    var basesPresent, items, params, results, _ref;
    _ref = utils.regularizeUpsert(docs, bases, success, error), items = _ref[0], success = _ref[1], error = _ref[2];
    if (!this.client) {
      throw new Error("Client required to upsert");
    }
    results = [];
    basesPresent = _.compact(_.pluck(items, "base")).length > 0;
    params = {
      client: this.client
    };
    if ((typeof navigator !== "undefined" && navigator !== null) && navigator.userAgent.toLowerCase().indexOf('android 2.3') !== -1) {
      params._ = new Date().getTime();
    }
    if (items.length === 1) {
      if (basesPresent) {
        return this.httpClient("PATCH", this.getUrl(), params, items[0], function(result) {
          if (_.isArray(docs)) {
            return success([result]);
          } else {
            return success(result);
          }
        }, function(err) {
          if (error) {
            return error(err);
          }
        });
      } else {
        return this.httpClient("POST", this.getUrl(), params, items[0].doc, function(result) {
          if (_.isArray(docs)) {
            return success([result]);
          } else {
            return success(result);
          }
        }, function(err) {
          if (error) {
            return error(err);
          }
        });
      }
    } else {
      if (basesPresent) {
        return this.httpClient("PATCH", this.getUrl(), params, {
          doc: _.pluck(items, "doc"),
          base: _.pluck(items, "base")
        }, function(result) {
          return success(result);
        }, function(err) {
          if (error) {
            return error(err);
          }
        });
      } else {
        return this.httpClient("POST", this.getUrl(), params, _.pluck(items, "doc"), function(result) {
          return success(result);
        }, function(err) {
          if (error) {
            return error(err);
          }
        });
      }
    }
  };

  Collection.prototype.remove = function(id, success, error) {
    var params;
    if (!this.client) {
      throw new Error("Client required to remove");
    }
    params = {
      client: this.client
    };
    return this.httpClient("DELETE", this.getUrl() + "/" + id, params, null, success, function(err) {
      if (err.status === 410) {
        return success();
      } else {
        return error(err);
      }
    });
  };

  return Collection;

})();
