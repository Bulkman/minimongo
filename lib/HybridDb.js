
/*

Database which caches locally in a localDb but pulls results
ultimately from a RemoteDb
 */
var HybridCollection, HybridDb, processFind, utils, _;

_ = require('lodash');

processFind = require('./utils').processFind;

utils = require('./utils');

module.exports = HybridDb = (function() {
  function HybridDb(localDb, remoteDb) {
    this.localDb = localDb;
    this.remoteDb = remoteDb;
    this.collections = {};
  }

  HybridDb.prototype.addCollection = function(name, options, success, error) {
    var collection, _ref;
    if (_.isFunction(options)) {
      _ref = [{}, options, success], options = _ref[0], success = _ref[1], error = _ref[2];
    }
    collection = new HybridCollection(name, this.localDb[name], this.remoteDb[name], options);
    this[name] = collection;
    this.collections[name] = collection;
    if (success != null) {
      return success();
    }
  };

  HybridDb.prototype.removeCollection = function(name, success, error) {
    delete this[name];
    delete this.collections[name];
    if (success != null) {
      return success();
    }
  };

  HybridDb.prototype.upload = function(success, error) {
    var cols, uploadCols;
    cols = _.values(this.collections);
    uploadCols = function(cols, success, error) {
      var col;
      col = _.first(cols);
      if (col) {
        return col.upload(function() {
          return uploadCols(_.rest(cols), success, error);
        }, function(err) {
          return error(err);
        });
      } else {
        return success();
      }
    };
    return uploadCols(cols, success, error);
  };

  HybridDb.prototype.getCollectionNames = function() {
    return _.keys(this.collections);
  };

  return HybridDb;

})();

HybridCollection = (function() {
  function HybridCollection(name, localCol, remoteCol, options) {
    this.name = name;
    this.localCol = localCol;
    this.remoteCol = remoteCol;
    this.options = options || {};
    _.defaults(this.options, {
      cacheFind: true,
      cacheFindOne: true,
      interim: true,
      useLocalOnRemoteError: true,
      shortcut: false,
      timeout: 0,
      sortUpserts: null
    });
  }

  HybridCollection.prototype.find = function(selector, options) {
    if (options == null) {
      options = {};
    }
    return {
      fetch: (function(_this) {
        return function(success, error) {
          return _this._findFetch(selector, options, success, error);
        };
      })(this)
    };
  };

  HybridCollection.prototype.findOne = function(selector, options, success, error) {
    var step2, _ref;
    if (options == null) {
      options = {};
    }
    if (_.isFunction(options)) {
      _ref = [{}, options, success], options = _ref[0], success = _ref[1], error = _ref[2];
    }
    _.defaults(options, this.options);
    step2 = (function(_this) {
      return function(localDoc) {
        var findOptions;
        findOptions = _.cloneDeep(options);
        findOptions.interim = false;
        findOptions.cacheFind = options.cacheFindOne;
        if (selector._id) {
          findOptions.limit = 1;
        } else {
          delete findOptions.limit;
        }
        return _this.find(selector, findOptions).fetch(function(data) {
          if (data.length > 0) {
            if (!_.isEqual(localDoc, data[0])) {
              return success(data[0]);
            }
          } else {
            return success(null);
          }
        }, error);
      };
    })(this);
    if (options.interim || options.shortcut) {
      return this.localCol.findOne(selector, options, function(localDoc) {
        if (localDoc) {
          success(_.cloneDeep(localDoc));
          if (options.shortcut) {
            return;
          }
        }
        return step2(localDoc);
      }, error);
    } else {
      return step2();
    }
  };

  HybridCollection.prototype._findFetch = function(selector, options, success, error) {
    var localSuccess, step2;
    _.defaults(options, this.options);
    step2 = (function(_this) {
      return function(localData, localCount) {
        var remoteError, remoteOptions, remoteSuccess, timedOut, timer;
        remoteOptions = _.cloneDeep(options);
        if (options.cacheFind) {
          delete remoteOptions.fields;
        }
        remoteOptions.localData = localData;
        timer = null;
        timedOut = false;
        remoteSuccess = function(remoteData, remoteCount) {
          var data;
          if (timer) {
            clearTimeout(timer);
          }
          if (timedOut) {
            if (options.cacheFind) {
              _this.localCol.cache(remoteData, selector, options, (function() {}), error);
            }
            return;
          }
          data = remoteData;
          return _this.localCol.pendingRemoves(function(removes) {
            var removesMap;
            if (removes.length > 0) {
              removesMap = _.object(_.map(removes, function(id) {
                return [id, id];
              }));
              data = _.filter(remoteData, function(doc) {
                return !_.has(removesMap, doc._id);
              });
            }
            return _this.localCol.pendingUpserts(function(upserts) {
              var cacheSuccess, itemsCount, tmpCount, upsertsMap;
              itemsCount = remoteCount;
              if (upserts.length > 0) {
                upsertsMap = _.object(_.map(upserts, function(u) {
                  return u.doc._id;
                }), _.map(upserts, function(u) {
                  return u.doc._id;
                }));
                data = _.filter(data, function(doc) {
                  return !_.has(upsertsMap, doc._id);
                });
                data = data.concat(_.pluck(upserts, "doc"));
                tmpCount = {};
                data = processFind(data, selector, options, tmpCount);
                itemsCount = tmpCount.filtered;
              }
              if (!options.interim || !_.isEqual(localData, data)) {
                if (options.cacheFind) {
                  cacheSuccess = function() {
                    return success(data, itemsCount);
                  };
                  return _this.localCol.cache(remoteData, selector, options, cacheSuccess, error);
                } else {
                  return success(data, itemsCount);
                }
              }
            }, error);
          }, error);
        };
        remoteError = function(err) {
          if (timer) {
            clearTimeout(timer);
          }
          if (timedOut) {
            return;
          }
          if (!options.interim) {
            if (options.useLocalOnRemoteError) {
              return success(localData, localCount.cached + localCount.upserted);
            } else {
              if (error) {
                return error(err);
              }
            }
          } else {

          }
        };
        if (options.timeout) {
          timer = setTimeout(function() {
            var localSuccess;
            timer = null;
            timedOut = true;
            if (!options.interim) {
              if (options.useLocalOnRemoteError) {
                localSuccess = function(localData, count) {
                  return success(localData, count.cached + count.upserted);
                };
                return _this.localCol.find(selector, options).fetch(localSuccess, error);
              } else {
                if (error) {
                  return error(new Error("Remote timed out"));
                }
              }
            } else {

            }
          }, options.timeout);
        }
        return _this.remoteCol.find(selector, remoteOptions).fetch(remoteSuccess, remoteError);
      };
    })(this);
    localSuccess = function(localData, count) {
      if (options.interim) {
        success(localData, count.cached + count.upserted);
      }
      return step2(localData, count);
    };
    return this.localCol.find(selector, options).fetch(localSuccess, error);
  };

  HybridCollection.prototype.upsert = function(docs, bases, success, error) {
    return this.localCol.upsert(docs, bases, function(result) {
      if (_.isFunction(bases)) {
        success = bases;
      }
      return typeof success === "function" ? success(docs) : void 0;
    }, error);
  };

  HybridCollection.prototype.remove = function(id, success, error) {
    return this.localCol.remove(id, function() {
      if (success != null) {
        return success();
      }
    }, error);
  };

  HybridCollection.prototype.upload = function(success, error) {
    var uploadRemoves, uploadUpserts;
    uploadUpserts = (function(_this) {
      return function(upserts, success, error) {
        var upsert;
        upsert = _.first(upserts);
        if (upsert) {
          return _this.remoteCol.upsert(upsert.doc, upsert.base, function(remoteDoc) {
            return _this.localCol.resolveUpserts([upsert], function() {
              if (remoteDoc) {
                return _this.localCol.cacheOne(remoteDoc, function() {
                  return uploadUpserts(_.rest(upserts), success, error);
                }, error);
              } else {
                return _this.localCol.remove(upsert.doc._id, function() {
                  return _this.localCol.resolveRemove(upsert.doc._id, function() {
                    return uploadUpserts(_.rest(upserts), success, error);
                  }, error);
                }, error);
              }
            }, error);
          }, function(err) {
            if (err.status === 410 || err.status === 403) {
              return _this.localCol.remove(upsert.doc._id, function() {
                return _this.localCol.resolveRemove(upsert.doc._id, function() {
                  if (err.status === 410) {
                    return uploadUpserts(_.rest(upserts), success, error);
                  } else {
                    return error(err);
                  }
                }, error);
              }, error);
            } else {
              return error(err);
            }
          });
        } else {
          return success();
        }
      };
    })(this);
    uploadRemoves = (function(_this) {
      return function(removes, success, error) {
        var remove;
        remove = _.first(removes);
        if (remove) {
          return _this.remoteCol.remove(remove, function() {
            return _this.localCol.resolveRemove(remove, function() {
              return uploadRemoves(_.rest(removes), success, error);
            }, error);
          }, function(err) {
            if (err.status === 410 || err.status === 403) {
              return _this.localCol.resolveRemove(remove, function() {
                if (err.status === 410) {
                  return uploadRemoves(_.rest(removes), success, error);
                } else {
                  return error(err);
                }
              }, error);
            } else {
              return error(err);
            }
          }, error);
        } else {
          return success();
        }
      };
    })(this);
    return this.localCol.pendingUpserts((function(_this) {
      return function(upserts) {
        if (_this.options.sortUpserts) {
          upserts.sort(function(u1, u2) {
            return _this.options.sortUpserts(u1.doc, u2.doc);
          });
        }
        return uploadUpserts(upserts, function() {
          return _this.localCol.pendingRemoves(function(removes) {
            return uploadRemoves(removes, success, error);
          }, error);
        }, error);
      };
    })(this), error);
  };

  return HybridCollection;

})();
